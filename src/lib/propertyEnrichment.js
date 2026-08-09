// src/lib/propertyEnrichment.js
// Property Appraiser & Statewide Cadastral Enrichment Layer V1 — Capability #9, Cycle 3.
//
// ONE reusable interface — enrichProperty(identity, options) — that turns a
// bare property identity (address / parcel_id / owner_name) into a reliable
// public property record. This is NOT a new lead source: no lead is ever
// created here, nothing is scored, nothing touches the Acquisition Engine.
// It exists so a future distress connector (Lis Pendens, Tax Delinquent,
// Probate, ...) never has to know how the Florida Statewide Cadastral API
// works — it just calls enrichProperty() and gets back a typed object.
//
// Verified official source used (Capability #8 discovery, confirmed by
// direct fetch, not invented):
//   Florida Statewide Cadastral / Parcels — Esri ArcGIS FeatureServer
//   https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0
//   Fields used below (OWN_NAME, OWN_ADDR1, PHY_ADDR1, PARCEL_ID, JV, etc.)
//   are exactly the fields Capability #8 verified exist on this service —
//   nothing here was guessed.
//
// Duval Property Appraiser bulk tax-roll files (also verified in Capability
// #8) are NOT implemented in V1 — see "Decision: live API only for V1"
// below. The interface is structured so that source can be added later as
// a fallback without any caller-visible change.

import { normalizeAddress, normalizeAddressForDB, streetCore } from './leadDedup.js'

const CADASTRAL_FEATURE_SERVICE =
  'https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0/query'

// Duval County = the consolidated City of Jacksonville. IMPORTANT (found
// during live testing, not assumed): filtering by PHY_CITY or CO_NO in the
// query's WHERE clause causes this statewide service to take 15-20+ seconds
// (observed via direct curl timing) — those fields are evidently not
// indexed the way PARCEL_ID (exact) and PHY_ADDR1 (prefix LIKE) are, which
// stay under 2 seconds. So Duval scoping is applied CLIENT-SIDE against the
// already-fast address/parcel query result, not as a query predicate.
const DUVAL_CITY_NAMES = new Set(['JACKSONVILLE'])

// Verified during live testing (Capability #9): this shared public ArcGIS
// Online service is fast and reliable (under ~2s, repeatedly) for an EXACT
// PARCEL_ID match, REGARDLESS of how many output fields are requested. It
// is slow/unreliable (often 15-25s+, sometimes timing out) for a PHY_ADDR1
// LIKE query as soon as either (a) the pattern includes the street name, or
// (b) more than a handful of output fields are requested — confirmed via
// repeated direct timing tests, not assumed. 10s was too aggressive for the
// slow path and caused false NO_MATCH timeouts during real testing.
const FETCH_TIMEOUT_MS = 25000

// Because of the above, address lookups are done in TWO fast/reliable steps
// instead of one slow one: (1) a minimal-field, broad house-number-only
// query to find the candidate parcel(s), (2) an exact PARCEL_ID query with
// the full field list for the actual match. See queryByAddress()/
// matchProperty() below.
const LOOKUP_FIELDS = 'PARCEL_ID,PHY_ADDR1,PHY_CITY'

// Only request the fields this module actually maps below — respects the
// "don't download unnecessary geometry/fields" instruction and keeps every
// request well under the service's 2,000-record (32,000 no-geometry) limits.
const OUT_FIELDS = [
  'PARCEL_ID', 'PHY_ADDR1', 'PHY_CITY', 'PHY_ZIPCD',
  'OWN_NAME', 'OWN_ADDR1', 'OWN_ADDR2', 'OWN_CITY', 'OWN_STATE', 'OWN_ZIPCD',
  'DOR_UC', 'EFF_YR_BLT', 'ACT_YR_BLT', 'TOT_LVG_AR', 'NO_RES_UNT',
  'JV', 'AV_SD', 'TV_SD',
  'SALE_PRC1', 'SALE_YR1', 'SALE_MO1', 'SALE_PRC2', 'SALE_YR2', 'SALE_MO2',
].join(',')

/**
 * @typedef {Object} PropertyIdentity
 * @property {string} [address]
 * @property {string} [parcel_id]
 * @property {string} [owner_name] - never used as a primary matcher; only
 *   informational unless the caller already knows it from the raw record.
 */

/**
 * @typedef {'EXACT_PARCEL'|'EXACT_ADDRESS'|'NO_MATCH'|'AMBIGUOUS'} MatchConfidence
 */

/**
 * @typedef {Object} EnrichedProperty
 * @property {boolean} matched
 * @property {string|null} parcel_id
 * @property {string|null} property_address
 * @property {string|null} owner_name
 * @property {string|null} owner_mailing_address
 * @property {string|null} property_type - best-effort only; see limitations, often null
 * @property {string|null} land_use - raw DOR use-code, verified field, not decoded
 * @property {number|null} year_built
 * @property {number|null} living_area
 * @property {number|null} unit_count
 * @property {number|null} just_value - public record reference value, NOT an ARV
 * @property {number|null} assessed_value - public record reference value, NOT an ARV
 * @property {number|null} taxable_value - public record reference value, NOT an ARV
 * @property {number|null} last_sale_price
 * @property {string|null} last_sale_date
 * @property {number|null} previous_sale_price
 * @property {string|null} previous_sale_date
 * @property {true|false|'unknown'} absentee_owner
 * @property {string} enrichment_source
 * @property {string} enriched_at - ISO timestamp
 * @property {MatchConfidence} match_confidence
 */

async function fetchWithTimeout(url, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) {
      throw new Error(`Cadastral API returned HTTP ${res.status}`)
    }
    let json
    try {
      json = await res.json()
    } catch {
      throw new Error('Cadastral API returned a malformed (non-JSON) response')
    }
    if (json.error) {
      throw new Error(`Cadastral API error: ${json.error.message || JSON.stringify(json.error)}`)
    }
    return json
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Cadastral API request timed out after ${timeoutMs}ms`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

function buildQueryUrl(where, { fields = OUT_FIELDS, resultRecordCount = 5 } = {}) {
  const params = new URLSearchParams({
    where,
    outFields: fields,
    returnGeometry: 'false', // never download geometry — not needed, saves bandwidth/quota
    resultRecordCount: String(resultRecordCount),
    f: 'json',
  })
  return `${CADASTRAL_FEATURE_SERVICE}?${params.toString()}`
}

function escapeSqlString(s) {
  return String(s).replace(/'/g, "''")
}

// Fast, reliable path (verified: ~0.5-1.5s regardless of field count) —
// used both for a caller-supplied parcel_id and as step 2 of an address
// lookup below.
async function queryByParcelIdFull(parcelId) {
  const where = `PARCEL_ID = '${escapeSqlString(parcelId)}'`
  const json = await fetchWithRetry(buildQueryUrl(where, { fields: OUT_FIELDS }))
  return json.features || []
}

// Step 1 of an address lookup — broad, minimal-field query, verified fast
// (~1-2s). Deliberately does NOT include the street name or a city/county
// predicate in the WHERE clause: both were tested directly and found to
// make this service unreliable (15-25s+, sometimes timing out) — the exact
// opposite of normal index behavior, where a more selective query should be
// faster. Street-name and Duval/Jacksonville precision are applied
// client-side against this broader, fast result instead.
// This shared public service's latency was found (extensive direct timing
// during Capability #9) to vary unpredictably for the identical query at
// different times — anywhere from under 1s to a full 25s timeout — with no
// parameter change reliably explaining the difference. A single retry after
// a real timeout is the correct response to that kind of transient upstream
// flakiness (not a workaround for a bug in this module's own query).
async function fetchWithRetry(url, attempts = 2) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetchWithTimeout(url)
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr
}

async function queryByHouseNumberLookupOnly(houseNum) {
  const where = `PHY_ADDR1 LIKE '${escapeSqlString(houseNum)} %'`
  // resultRecordCount is capped at 50, NOT the service's 2,000 limit —
  // verified via direct timing that this service gets sharply slower/
  // unreliable above ~50-100 records (50 -> under 1s; 100 -> ~5s; 500 ->
  // times out, repeatedly). Known trade-off: a house number shared by more
  // than 50 properties statewide (before Duval filtering) could miss a real
  // match beyond this window — see delivery report "Limitations".
  const json = await fetchWithRetry(buildQueryUrl(where, { fields: LOOKUP_FIELDS, resultRecordCount: 50 }))
  return json.features || []
}

// ── 1. Property matching ────────────────────────────────────────────────
// Priority: parcel ID → normalized full address → (deliberately) nothing
// else. Owner name is never used to locate a property — matching a house
// by owner name risks enriching the wrong property for common names, which
// the mission explicitly warns against ("avoid enriching the wrong house").
// Never fuzzy-matches; returns AMBIGUOUS/NO_MATCH rather than guessing.
async function matchProperty({ address, parcel_id }) {
  if (parcel_id) {
    const features = await queryByParcelIdFull(parcel_id)
    if (features.length === 1) return { status: 'EXACT_PARCEL', record: features[0].attributes }
    if (features.length > 1) return { status: 'AMBIGUOUS', record: null }
    // 0 results for a supplied parcel_id — fall through to address if we have one,
    // rather than assuming NO_MATCH outright (the parcel_id itself could be stale).
  }

  if (address) {
    const normalized = normalizeAddress(address)
    const core = streetCore(normalized)
    if (!core) {
      // Address didn't parse into "house number + street name" at all —
      // not enough to safely match on. Do not guess.
      return { status: 'NO_MATCH', record: null }
    }

    // Step 1: broad, fast, minimal-field lookup by house number.
    const candidates = await queryByHouseNumberLookupOnly(core.num)
    // Client-side precision filtering — exact house number (guards against
    // '123%' matching '1234'), street-name words, and Duval/Jacksonville
    // scoping — all applied here rather than as query predicates, per the
    // performance finding above.
    const matches = candidates.filter(f => {
      const attrs = f.attributes || {}
      const fCore = streetCore(normalizeAddress(attrs.PHY_ADDR1 || ''))
      const inDuval = DUVAL_CITY_NAMES.has(String(attrs.PHY_CITY || '').toUpperCase())
      return inDuval && fCore && fCore.num === core.num && fCore.words === core.words
    })
    if (matches.length === 0) return { status: 'NO_MATCH', record: null }
    if (matches.length > 1) return { status: 'AMBIGUOUS', record: null }

    // Step 2: exactly one candidate — fetch its full field set via the
    // fast, reliable parcel-ID path rather than trusting the minimal-field
    // step-1 record.
    const matchedParcelId = matches[0].attributes?.PARCEL_ID
    if (!matchedParcelId) return { status: 'AMBIGUOUS', record: null }
    const fullFeatures = await queryByParcelIdFull(matchedParcelId)
    if (fullFeatures.length !== 1) return { status: 'AMBIGUOUS', record: null }
    return { status: 'EXACT_ADDRESS', record: fullFeatures[0].attributes }
  }

  return { status: 'NO_MATCH', record: null }
}

// ── 4. Absentee owner signal — deterministic, no AI ─────────────────────
// Conservative by design: normalizes both addresses through the exact same
// suffix-expansion/punctuation-stripping normalizeAddress() already used
// for lead dedup, so "123 MAIN ST" vs "123 Main Street" never produces a
// false positive. Returns 'unknown' whenever there isn't enough data to be
// sure, rather than guessing true/false.
export function computeAbsenteeOwner(ownerAddressParts, propertyAddress) {
  const { own_addr1 } = ownerAddressParts || {}
  if (!own_addr1 || !propertyAddress) return 'unknown'

  // BUG FOUND DURING TESTING, FIXED: comparing the owner's full mailing
  // address (street + city + state + zip all concatenated) against the
  // property's street-only address corrupted streetCore()'s house-number/
  // street-word split — e.g. "123 Main St Jacksonville FL 32210" would
  // extract different "words" than "123 Main Street" even for the exact
  // same street, producing a FALSE absentee=true for a same-address owner.
  // Fixed by comparing street-line to street-line only (own_addr1 vs
  // propertyAddress), exactly like every other address comparison in this
  // codebase (leadDedup.js) already does — city/state/zip are not part of
  // the street-core match, by design.
  const normalizedOwnerStreet = normalizeAddress(own_addr1)
  const normalizedProperty = normalizeAddress(propertyAddress)
  if (!normalizedOwnerStreet || !normalizedProperty) return 'unknown'

  const ownerCore = streetCore(normalizedOwnerStreet)
  const propertyCore = streetCore(normalizedProperty)
  if (!ownerCore || !propertyCore) {
    // Couldn't reduce one side to "house number + street" (e.g. owner
    // address is a PO Box or out-of-format) — that itself is a real signal
    // the mailing address differs in kind from the property address.
    return normalizedOwnerStreet === normalizedProperty ? false : true
  }
  return !(ownerCore.num === propertyCore.num && ownerCore.words === propertyCore.words)
}

function toIsoDate(year, month) {
  if (!year) return null
  const y = Number(year)
  const m = month ? String(month).padStart(2, '0') : '01'
  if (!y) return null
  return `${y}-${m}-01`
}

// Maps raw ArcGIS attributes → the exact EnrichedProperty shape the mission
// specifies. Field-by-field provenance is the Statewide Cadastral fields
// Capability #8 verified — nothing invented, nothing decoded beyond what's
// safe (DOR_UC is returned as the raw code in `land_use`, not translated
// into a friendly property_type — see limitations in the delivery report).
function mapAttributesToEnrichedProperty(attrs, matchStatus) {
  const now = new Date().toISOString()
  if (!attrs) {
    return {
      matched: false,
      parcel_id: null, property_address: null, owner_name: null, owner_mailing_address: null,
      property_type: null, land_use: null, year_built: null, living_area: null, unit_count: null,
      just_value: null, assessed_value: null, taxable_value: null,
      last_sale_price: null, last_sale_date: null, previous_sale_price: null, previous_sale_date: null,
      absentee_owner: 'unknown',
      enrichment_source: 'fl_statewide_cadastral', enriched_at: now,
      match_confidence: matchStatus,
    }
  }

  const ownerMailing = [attrs.OWN_ADDR1, attrs.OWN_CITY, attrs.OWN_STATE, attrs.OWN_ZIPCD].filter(Boolean).join(', ') || null

  return {
    matched: true,
    parcel_id: attrs.PARCEL_ID ?? null,
    property_address: attrs.PHY_ADDR1 ?? null,
    owner_name: attrs.OWN_NAME ?? null,
    owner_mailing_address: ownerMailing,
    property_type: null, // see limitations — DOR_UC decoding intentionally not guessed at in V1
    land_use: attrs.DOR_UC ?? null,
    year_built: attrs.ACT_YR_BLT ?? attrs.EFF_YR_BLT ?? null,
    living_area: attrs.TOT_LVG_AR ?? null,
    unit_count: attrs.NO_RES_UNT ?? null,
    just_value: attrs.JV ?? null,
    assessed_value: attrs.AV_SD ?? null,
    taxable_value: attrs.TV_SD ?? null,
    last_sale_price: attrs.SALE_PRC1 ?? null,
    last_sale_date: toIsoDate(attrs.SALE_YR1, attrs.SALE_MO1),
    previous_sale_price: attrs.SALE_PRC2 ?? null,
    previous_sale_date: toIsoDate(attrs.SALE_YR2, attrs.SALE_MO2),
    absentee_owner: computeAbsenteeOwner(
      { own_addr1: attrs.OWN_ADDR1, own_city: attrs.OWN_CITY, own_state: attrs.OWN_STATE, own_zipcd: attrs.OWN_ZIPCD },
      attrs.PHY_ADDR1
    ),
    enrichment_source: 'fl_statewide_cadastral',
    enriched_at: now,
    match_confidence: matchStatus,
  }
}

const CACHE_FRESHNESS_MS = 30 * 24 * 60 * 60 * 1000 // 30 days — cadastral data itself only updates annually/monthly (Capability #8)

// ── 9. Caching — reuses Property Intelligence's existing `properties` row,
// no new table, no Redis, no queue. Best-effort: a cache failure never
// blocks returning a live enrichment result.
async function readCache(supabase, workspaceId, normalizedAddress) {
  try {
    const { data, error } = await supabase
      .from('properties')
      .select('enrichment_data, enrichment_source, enriched_at')
      .eq('workspace_id', workspaceId)
      .eq('normalized_address', normalizedAddress)
      .maybeSingle()
    if (error || !data?.enrichment_data || !data?.enriched_at) return null
    const age = Date.now() - new Date(data.enriched_at).getTime()
    if (age > CACHE_FRESHNESS_MS) return null
    return data.enrichment_data
  } catch (err) {
    console.warn('[property-enrichment] cache read non-fatal error:', err)
    return null
  }
}

async function writeCache(supabase, workspaceId, addressFields, enriched) {
  try {
    const normalizedAddress = normalizeAddressForDB(addressFields.address)
    const { data: existing } = await supabase
      .from('properties')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('normalized_address', normalizedAddress)
      .maybeSingle()
    if (!existing) {
      // #7 — do not create a property row purely for enrichment; only
      // attach to a property that already exists (created by Property
      // Intelligence via a real lead). "ONE PROPERTY, MANY SOURCES" means
      // enrichment joins existing identity, it doesn't mint new identity.
      return
    }
    await supabase
      .from('properties')
      .update({
        parcel_id: enriched.parcel_id || null,
        enrichment_data: enriched,
        enrichment_source: enriched.enrichment_source,
        enriched_at: enriched.enriched_at,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
  } catch (err) {
    console.warn('[property-enrichment] cache write non-fatal error:', err)
  }
}

/**
 * THE reusable enrichment entry point. Future distress connectors call this
 * — they never talk to the Statewide Cadastral API directly.
 *
 * @param {PropertyIdentity} identity
 * @param {Object} [options]
 * @param {Object} [options.supabase] - a Supabase client, for caching via
 *   Property Intelligence. Omit to always do a live lookup (e.g. from the CLI).
 * @param {string} [options.workspaceId] - required alongside `supabase` for caching.
 * @param {boolean} [options.useCache=true]
 * @returns {Promise<EnrichedProperty>}
 */
export async function enrichProperty(identity, options = {}) {
  const { supabase, workspaceId, useCache = true } = options
  const address = identity?.address?.trim() || null
  const parcelId = identity?.parcel_id?.trim() || null

  if (!address && !parcelId) {
    return mapAttributesToEnrichedProperty(null, 'NO_MATCH')
  }

  const canCache = Boolean(supabase && workspaceId && address && useCache)
  const normalizedAddress = address ? normalizeAddressForDB(address) : null

  if (canCache) {
    const cached = await readCache(supabase, workspaceId, normalizedAddress)
    if (cached) return cached
  }

  let result
  try {
    const { status, record } = await matchProperty({ address, parcel_id: parcelId })
    result = mapAttributesToEnrichedProperty(record, status)
  } catch (err) {
    // #2 — API/network/timeout/malformed-response error handling: never
    // throw into the caller, degrade to an explicit no-match-with-error
    // shape so a future distress connector can decide what to do next.
    console.warn('[property-enrichment] enrichment failed, degrading to NO_MATCH:', err.message)
    result = mapAttributesToEnrichedProperty(null, 'NO_MATCH')
    result.error = err.message
  }

  if (canCache && result.matched) {
    await writeCache(supabase, workspaceId, { address }, result)
  }

  return result
}
