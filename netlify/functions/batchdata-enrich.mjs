// netlify/functions/batchdata-enrich.mjs
// Capability #10.4 — BatchData live owner-contact + property enrichment.
// Server-side ONLY. The API token never reaches client/browser code — read
// exclusively from process.env here, never returned in any response body.
//
// POST body: { lead_id: "<uuid>", force?: boolean }
// Auth: requires a valid Supabase user session token (Authorization: Bearer
// <jwt>) — reuses HatCRM's own existing auth, not a new secret scheme.
// Cost control: skip-traces/looks-up EXACTLY the one lead_id given — no
// batch/loop inside this function. The pilot script (scripts/
// cap10_4_pilot.mjs) calls this once per lead, under manual staged control,
// per the mission's explicit Stage 1/2/3 gates. Duplicate-payment guard:
// won't re-call BatchData for a lead already enriched within the last 24h
// unless force=true.

import { createClient } from '@supabase/supabase-js'
import { qualifyBuyBox } from '../../src/lib/buyBox.js'
import { computeOpportunityScore } from '../../src/lib/distressScoring.js'
import { buildStrongestIdentity, formatStreetWithUnit, parseUnitAwareAddress } from '../../src/lib/addressIdentity.js'
import { batchDataPreflight } from '../../src/lib/batchDataPreflight.js'
import { deriveBatchDataHealth } from '../../src/lib/batchDataHealth.js'
import { MATCH_TOKEN_OVERLAP_LIKELY, MATCH_TOKEN_OVERLAP_AMBIGUOUS } from '../../src/lib/batchDataConfig.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
const BATCHDATA_API_KEY = process.env.BATCHDATA_API_KEY

// Capability #10.4 — verified LIVE against the real account (Stage 1), not
// inferred from docs/endpoint names alone (the developer portal is
// JS-rendered and blocked automated schema extraction). Real finding:
// property/skip-trace and property/lookup/all-attributes live under
// DIFFERENT API versions on the same host — not obvious from either
// endpoint's name, and not documented anywhere reachable to us.
const BATCHDATA_BASE_V1 = 'https://api.batchdata.com/api/v1'
const BATCHDATA_BASE_V3 = 'https://api.batchdata.com/api/v3'
function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

// ── Auth — reuses HatCRM's own Supabase session (browser callers), plus a
// server-to-server path for the staged pilot script itself (Capability
// #10.4's own controlled test runner, never exposed to a browser). The
// service-role key already lives only in this Netlify env and the
// operator's local .env (same trust boundary every prior capability's
// scripts have used) — accepting it here as an alternate credential does
// NOT create a new public attack surface, since a random unauthenticated
// caller would need that exact server-side secret regardless.
async function authenticateRequest(req) {
  const serviceKeyHeader = req.headers.get('x-service-key')
  if (serviceKeyHeader && SUPABASE_SERVICE_ROLE_KEY && serviceKeyHeader === SUPABASE_SERVICE_ROLE_KEY) {
    return { id: 'service', pilot_script: true }
  }
  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) return null
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  const { data, error } = await anon.auth.getUser(token)
  if (error || !data?.user) return null
  return data.user
}

// ── BatchData calls — classified error types, never masked as "no match" ──
async function callBatchData(base, path, body) {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20000)
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${BATCHDATA_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    clearTimeout(timer)
    const text = await res.text()
    let data = null
    try { data = JSON.parse(text) } catch { /* non-JSON error body */ }

    // Real finding (Capability #10.4 pilot): BatchData returns 403 for BOTH
    // "insufficient balance" (billing) and genuine auth/permission failures
    // — same HTTP status, different root cause. Distinguishing by message
    // text is required, or a real billing exhaustion silently displays as
    // an auth problem (exactly the RentCast-masking mistake #10.3 warned
    // against repeating).
    const bodyMessage = String(data?.status?.message || '').toLowerCase()
    if (res.status === 402 || (res.status === 403 && /balance|credit|insufficient/.test(bodyMessage))) {
      return { errorType: 'BILLING_ERROR', status: res.status, raw: text }
    }
    if (res.status === 401 || res.status === 403) return { errorType: 'AUTH_ERROR', status: res.status, raw: text }
    if (res.status === 429) return { errorType: 'RATE_LIMIT', status: res.status, raw: text }
    if (res.status === 400 || res.status === 422) return { errorType: 'INVALID_INPUT', status: res.status, raw: text }
    if (res.status >= 500) return { errorType: 'PROVIDER_ERROR', status: res.status, raw: text }
    if (!res.ok) return { errorType: 'PROVIDER_ERROR', status: res.status, raw: text }
    return { ok: true, status: res.status, data }
  } catch (err) {
    return { errorType: 'NETWORK_ERROR', message: err.message }
  }
}

// ── Owner-match safety V2 — Capability #10.5: adds unit awareness on top
// of #10.4's name-token matching. ────────────────────────────────────────
function normalizeName(n) {
  if (!n) return ''
  return String(n).toUpperCase().replace(/[.,]/g, '').replace(/\s+/g, ' ').trim()
}
const MATCH_RANK = ['VERIFIED', 'LIKELY', 'AMBIGUOUS', 'NO_MATCH']
function downgrade(status, steps = 1) {
  const idx = Math.min(MATCH_RANK.indexOf(status) + steps, MATCH_RANK.length - 1)
  return MATCH_RANK[idx]
}

/**
 * @param {object} person - one BatchData persons[] entry
 * @param {object} lead
 * @param {{unit: string|null}} identity - our own best-known identity (from buildStrongestIdentity)
 */
function classifyPersonMatch(person, lead, identity) {
  const returnedName = normalizeName(person?.name?.full || [person?.name?.first, person?.name?.last].filter(Boolean).join(' '))
  const ourOwner = normalizeName(lead.owner_name)
  if (!returnedName || !ourOwner) return 'NO_MATCH'

  let status
  if (returnedName === ourOwner) status = 'VERIFIED'
  else {
    const returnedTokens = new Set(returnedName.split(' '))
    const ourTokens = ourOwner.split(' ').filter(Boolean)
    const overlap = ourTokens.filter(t => returnedTokens.has(t)).length
    if (overlap >= MATCH_TOKEN_OVERLAP_LIKELY) status = 'LIKELY'
    else if (overlap >= MATCH_TOKEN_OVERLAP_AMBIGUOUS) status = 'AMBIGUOUS'
    else return 'NO_MATCH'
  }

  // Critical rule (mission Section 8): a strong street/name match with a
  // conflicting or missing required unit is NOT enough to attach owner
  // contact automatically. Only applies when WE know a unit is required
  // (identity.unit set) — never invents a requirement that doesn't exist.
  if (identity?.unit) {
    const matchedAddr = (person.addresses || []).find(a => a.propertyMailingAddress) || person.addresses?.[0]
    const returnedUnit = matchedAddr ? parseUnitAwareAddress(matchedAddr.fullAddress || matchedAddr.street || '').unit : null
    if (!returnedUnit) {
      // BatchData didn't return unit-level detail at all for this person —
      // can't confirm it's the right unit within a multi-unit property.
      status = downgrade(status, 1)
    } else if (returnedUnit !== identity.unit) {
      // Confirmed different unit — never attach another unit's contact.
      status = downgrade(status, 2)
    }
  }
  return status
}

// Real fields confirmed live (Stage 1): persons[].phones[] = { rank, number,
// type: "Mobile"|"Land Line", carrier, tested, reachable, dnc, tcpa }. Lower
// rank number = BatchData's own best-first ordering — used as primary sort;
// reachable+mobile as a tiebreaker since that's the most contactable shape.
function pickPhones(persons) {
  const phones = (persons || []).flatMap(p => p.phones || [])
  const scored = phones
    .filter(p => p?.number)
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || (b.reachable - a.reachable) || ((b.type === 'Mobile') - (a.type === 'Mobile')))
  return {
    primary: scored[0]?.number || null,
    secondary: scored[1]?.number || null,
    dnc: scored[0]?.dnc ?? null,
    tcpaLitigator: scored[0]?.tcpa ?? null,
    type: scored[0]?.type || null,
  }
}
// Maps BatchData's propertyTypeDetail/Category to HatCRM's existing
// PROPERTY_TYPES enum (src/lib/constants.js) — same normalization pattern
// enrich-lead.mjs already uses for RentCast.
function normalizePropertyType(raw) {
  if (!raw) return null
  const s = String(raw).toLowerCase()
  if (s.includes('single')) return 'single_family'
  if (s.includes('multi') || s.includes('duplex') || s.includes('triplex') || s.includes('quad')) return 'multi_family'
  if (s.includes('condo')) return 'condo'
  if (s.includes('town')) return 'townhouse'
  if (s.includes('land') || s.includes('lot')) return 'land'
  if (s.includes('commerc')) return 'commercial'
  return 'other'
}

function pickEmail(persons) {
  const emails = (persons || []).flatMap(p => p.emails || [])
  const scored = emails.filter(e => e?.email).sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || (b.tested - a.tested))
  return scored[0]?.email || null
}

export default async function handler(req) {
  if (req.method !== 'POST') return json(405, { ok: false, error: 'POST only' })
  if (!BATCHDATA_API_KEY) return json(500, { ok: false, error: 'BATCHDATA_API_KEY not configured server-side' })
  if (!SUPABASE_SERVICE_ROLE_KEY) return json(500, { ok: false, error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })

  const user = await authenticateRequest(req)
  if (!user) return json(401, { ok: false, error: 'Unauthorized — a valid HatCRM session is required' })

  let body
  try { body = await req.json() } catch { return json(400, { ok: false, error: 'Invalid JSON body' }) }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // ── Health check mode (Section 14) — never spends money; derives status
  // from recently stored call outcomes instead of a live billable request.
  if (body?.mode === 'health') {
    const { data: recent } = await supabase
      .from('leads').select('enrichment_data')
      .not('enrichment_data->>contact_enriched_at', 'is', null)
      .order('enrichment_data->>contact_enriched_at', { ascending: false })
      .limit(10)
    return json(200, { ok: true, ...deriveBatchDataHealth(recent || []) })
  }

  const { lead_id, force = false } = body || {}
  if (!lead_id) return json(400, { ok: false, error: 'lead_id is required' })

  const { data: lead, error: leadErr } = await supabase.from('leads').select('*').eq('id', lead_id).maybeSingle()
  if (leadErr || !lead) return json(404, { ok: false, error: 'Lead not found' })

  // ── Pre-flight gate (Section 5) — the ONE decision point before any
  // paid call. Only READY_FOR_LOOKUP proceeds. ──────────────────────────
  const preflight = batchDataPreflight(lead, force)
  if (preflight.decision !== 'READY_FOR_LOOKUP') {
    return json(200, { ok: true, skipped: true, decision: preflight.decision, reason: preflight.reason, lead })
  }

  // ── Idempotency lock (Section 7) — simplest safe mechanism for
  // HatCRM's actual scale (single admin, occasional double-click/retry),
  // not a distributed job queue. Written BEFORE the paid call so a second
  // concurrent request sees LOOKUP_IN_PROGRESS in its own pre-flight check.
  const lockAt = new Date().toISOString()
  await supabase.from('leads').update({
    enrichment_data: { ...(lead.enrichment_data || {}), batchdata_lock_at: lockAt },
  }).eq('id', lead.id)

  // ── Strongest available identity (Section 3/4) — unit-aware. This is
  // the direct fix for #10.4's Belle Rive Blvd wrong-owner match: a known
  // unit is now included in every request BatchData receives.
  const identity = buildStrongestIdentity(lead)
  const addressParts = { street: formatStreetWithUnit(identity), city: identity.city || 'Jacksonville', state: identity.state || 'FL', zip: identity.zip || '' }

  // ── Skip trace ──────────────────────────────────────────────────────
  const skipTraceResult = await callBatchData(BATCHDATA_BASE_V3, '/property/skip-trace', {
    requests: [{ propertyAddress: addressParts }],
  })

  let contactMatchStatus = 'NO_MATCH'
  let phones = { primary: null, secondary: null, dnc: null, tcpaLitigator: null, type: null }
  let email = null
  let skipTraceStatus = 'ERROR'
  let skipTraceRaw = null

  if (skipTraceResult.errorType) {
    skipTraceStatus = skipTraceResult.errorType
  } else {
    skipTraceRaw = skipTraceResult.data
    // Real schema, confirmed live (Stage 1, Capability #10.4):
    // result.result.data[0].persons[] — NOT result.results (v1 shape).
    const persons = skipTraceResult.data?.result?.data?.[0]?.persons || []
    if (!persons.length) {
      skipTraceStatus = 'NO_MATCH'
    } else {
      skipTraceStatus = 'SUCCESS'
      // Best matching person only — never blindly attach every returned contact.
      const ranked = persons.map(p => ({ p, match: classifyPersonMatch(p, lead, identity) }))
        .sort((a, b) => ['VERIFIED', 'LIKELY', 'AMBIGUOUS', 'NO_MATCH'].indexOf(a.match) - ['VERIFIED', 'LIKELY', 'AMBIGUOUS', 'NO_MATCH'].indexOf(b.match))
      contactMatchStatus = ranked[0].match
      if (contactMatchStatus === 'VERIFIED' || contactMatchStatus === 'LIKELY') {
        phones = pickPhones([ranked[0].p])
        email = pickEmail([ranked[0].p])
      }
    }
  }

  // ── Property lookup (separate paid call) ───────────────────────────
  const propertyResult = await callBatchData(BATCHDATA_BASE_V1, '/property/lookup/all-attributes', {
    requests: [{ address: addressParts }],
  })

  let propertyStatus = 'ERROR'
  let propertyFields = {}
  if (propertyResult.errorType) {
    propertyStatus = propertyResult.errorType
  } else {
    // Real schema, confirmed live (Stage 1): results.properties[0], with
    // building.{yearBuilt,livingAreaSquareFeet,totalBuildingAreaSquareFeet,
    // bedroomCount,bathroomCount}, general.propertyTypeDetail, lot.
    // lotSizeSquareFeet, deedHistory[] for sales, valuation.estimatedValue
    // (an AVM — never mapped to arv, see Section 9's explicit instruction).
    const rec = propertyResult.data?.results?.properties?.[0] || null
    if (!rec) {
      propertyStatus = 'NO_MATCH'
    } else {
      propertyStatus = 'SUCCESS'
      const b = rec.building || {}
      const g = rec.general || {}
      const lastDeed = (rec.deedHistory || [])[0] || null
      propertyFields = {
        property_type: normalizePropertyType(g.propertyTypeDetail || g.propertyTypeCategory),
        property_type_detail: g.propertyTypeDetail || null, // raw, unnormalized — kept for provenance
        year_built: b.yearBuilt || null,
        sqft: b.livingAreaSquareFeet || b.totalBuildingAreaSquareFeet || null,
        bedrooms: b.bedroomCount ?? null,
        bathrooms: b.bathroomCount ?? null,
        lot_size_sqft: rec.lot?.lotSizeSquareFeet || null,
        last_sale_price: lastDeed?.saleAmount || null,
        last_sale_date: lastDeed?.saleDate || null,
        avm_estimate: rec.valuation?.estimatedValue || null, // AVM only — never ARV
      }
    }
  }

  // ── Build the update — never overwrite existing better data, never fabricate ──
  const now = new Date().toISOString()
  const leadUpdate = {
    property_type: lead.property_type || propertyFields.property_type || null,
    bedrooms: lead.bedrooms || propertyFields.bedrooms || null,
    bathrooms: lead.bathrooms || propertyFields.bathrooms || null,
    sqft: lead.sqft || propertyFields.sqft || null,
    lot_size_sqft: lead.lot_size_sqft || propertyFields.lot_size_sqft || null,
    year_built: lead.year_built || propertyFields.year_built || null,
  }
  // Only VERIFIED/LIKELY matches may populate trusted primary contact fields (Section 5).
  if ((contactMatchStatus === 'VERIFIED' || contactMatchStatus === 'LIKELY') && !lead.phone && phones.primary) {
    leadUpdate.phone = phones.primary
  }
  if ((contactMatchStatus === 'VERIFIED' || contactMatchStatus === 'LIKELY') && !lead.email && email) {
    leadUpdate.email = email
  }

  // Re-run existing #10.2 buy-box + opportunity scoring — never invented here.
  const zipCode = lead.zip_code
  const propertyTypeForBuyBox = leadUpdate.property_type
  const buyBox = qualifyBuyBox({ zip_code: zipCode, property_type: propertyTypeForBuyBox, bedrooms: leadUpdate.bedrooms })
  const distressCategory = lead.enrichment_data?.distress_category || 'UNKNOWN'
  const hasCharacteristics = !!(leadUpdate.year_built || leadUpdate.sqft || leadUpdate.bedrooms || leadUpdate.bathrooms)
  const excluded = !!lead.enrichment_data?.excluded // Section 17 — existing exclusion logic stays authoritative, never overridden by new data.
  const opp = computeOpportunityScore({
    distressCategory,
    buyBoxFit: buyBox.fit,
    ownerMatchStatus: lead.enrichment_data?.owner_match_status || 'MATCH',
    absenteeOwner: lead.enrichment_data?.absentee_owner ?? 'unknown',
    identityVerified: true,
    zipCode,
    propertyType: propertyTypeForBuyBox,
    hasCharacteristics,
    priorPropertyIntelHistory: false,
    excluded,
  })

  const updatedEnrichmentData = {
    ...(lead.enrichment_data || {}),
    batchdata_lock_at: null, // release the idempotency lock acquired above
    identity_unit_used: identity.unit,
    identity_source: identity.identitySource,
    contact_source: (contactMatchStatus === 'VERIFIED' || contactMatchStatus === 'LIKELY') ? 'batchdata' : (lead.enrichment_data?.contact_source || 'none_connected'),
    contact_match_status: contactMatchStatus,
    contact_enriched_at: now,
    contact_dnc: phones.dnc,
    contact_tcpa_litigator: phones.tcpaLitigator,
    contact_phone_type: phones.type,
    skip_trace_status: skipTraceStatus,
    skip_trace_error: skipTraceResult.errorType ? (skipTraceResult.raw || skipTraceResult.message || null) : null,
    property_data_source: propertyStatus === 'SUCCESS' ? 'batchdata' : (lead.enrichment_data?.property_data_source || null),
    property_lookup_status: propertyStatus,
    property_lookup_error: propertyResult.errorType ? (propertyResult.raw || propertyResult.message || null) : null,
    property_type_detail: propertyFields.property_type_detail || lead.enrichment_data?.property_type_detail || null,
    // AVM only — never written to arv/asking_price, per explicit instruction not to replace future comp-based ARV analysis.
    batchdata_avm_estimate: propertyFields.avm_estimate ?? lead.enrichment_data?.batchdata_avm_estimate ?? null,
    buy_box_fit: buyBox.fit,
    buy_box_reasons: buyBox.reasons,
    opportunity_score: opp.score,
    opportunity_priority: opp.priority,
    opportunity_why: opp.why,
    opportunity_missing: opp.missing,
  }
  leadUpdate.enrichment_data = updatedEnrichmentData

  // Compact UI-safe status (Section 15) — Kevin never sees an HTTP code.
  let uiStatus
  if (skipTraceStatus === 'BILLING_ERROR' || skipTraceStatus === 'AUTH_ERROR' || skipTraceStatus === 'PROVIDER_ERROR' || skipTraceStatus === 'NETWORK_ERROR') {
    uiStatus = 'ENRICHMENT TEMPORARILY UNAVAILABLE'
  } else if (contactMatchStatus === 'VERIFIED' || contactMatchStatus === 'LIKELY') {
    uiStatus = 'CONTACT READY'
  } else if (contactMatchStatus === 'AMBIGUOUS') {
    uiStatus = 'MATCH NEEDS REVIEW'
  } else {
    uiStatus = 'CONTACT NEEDED'
  }
  leadUpdate.enrichment_data.contact_ui_status = uiStatus

  const { error: updErr } = await supabase.from('leads').update(leadUpdate).eq('id', lead.id)
  if (updErr) return json(500, { ok: false, error: `DB update failed: ${updErr.message}` })

  return json(200, {
    ok: true,
    lead_id: lead.id,
    address: lead.address,
    uiStatus,
    skipTraceStatus,
    propertyStatus,
    contactMatchStatus,
    identityUnit: identity.unit,
    phoneFound: !!phones.primary,
    emailFound: !!email,
    dnc: phones.dnc,
    propertyFields,
    opportunityScore: opp.score,
    opportunityPriority: opp.priority,
    buyBoxFit: buyBox.fit,
    excluded,
  })
}
