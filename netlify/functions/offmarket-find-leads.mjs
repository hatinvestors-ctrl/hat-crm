// netlify/functions/offmarket-find-leads.mjs
// Capability — Off-Market Engine Control Center V1.
//
// Server-side wrapper around the SAME live Duval Official Records fetch
// mechanism already proven in scripts/cap14_lien_pipeline.mjs (disclaimer
// accept -> session cookie -> Kendo grid search) and the SAME real
// resolve/classify/dedupe/import logic scripts/lispendens-pilot.mjs and
// cap14_lien_pipeline.mjs already use — resolveDuvalOwnerIdentity(),
// mapDuvalAttributesToEnrichedProperty(), classifyDistress(),
// qualifyBuyBox(), normalizeAddressForDB(). Nothing here reimplements
// distress classification, scoring, Buy Box rules, or dedupe — every
// business decision is delegated to the exact same functions the rest of
// the app already trusts (see this capability's audit report).
//
// HONESTY CONTRACT — DocTypes value:
// cap14's LIEN pipeline verified its DocTypes form value (103) live
// against or.duvalclerk.com before shipping. No equivalent numeric
// DocTypes value for "LIS PENDENS" existed anywhere in this codebase, in
// any commit message, or in any doc — only the plain description string
// "LIS PENDENS" appeared, inside an already-captured, static snapshot file
// (scripts/lispendens-source-snapshot.json).
//
// LIS_PENDENS_DOC_TYPE = 104 was supplied by the user directly from the
// original Capability #10 delivery report. IMPORTANT — this sandboxed
// environment has no outbound internet access (confirmed: direct fetch
// attempts to or.duvalclerk.com time out), so this value could NOT be
// independently live-verified in this session the way cap14's 103 was.
// Run ONE real dry-run (dryRun:true) from an environment with real
// internet access before the live demo and confirm every returned
// record's DocTypeDescription reads "LIS PENDENS" — if it doesn't, stop
// and fix this constant before running for real.
//
// POST /.netlify/functions/offmarket-find-leads
// body: { dateRangeDays: 7|30|<custom int>, maxRecords: 10|25|50|100,
//         onlyNew: boolean, buyBoxOnly?: boolean, dryRun?: boolean }
// Returns: { ok, blocked?, reason?, funnel, results, duplicatesSkipped }

import { createClient } from '@supabase/supabase-js'
import { resolveDuvalOwnerIdentity, mapDuvalAttributesToEnrichedProperty } from '../../src/lib/propertyEnrichment.js'
import { normalizeAddressForDB } from '../../src/lib/leadDedup.js'
import { classifyDistress, computeOpportunityScore } from '../../src/lib/distressScoring.js'
import { qualifyBuyBox } from '../../src/lib/buyBox.js'
import { isContactReady } from '../../src/lib/contactEnrichment.js'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const HEADERS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST,OPTIONS',
}

// Real, live-verified value for the LIEN category (scripts/
// cap14_lien_pipeline.mjs) — kept here ONLY as a working reference example
// of the form shape. NOT used for Lis Pendens.
const KNOWN_DOC_TYPES = { LIEN: '103' }

// User-confirmed from the Capability #10 delivery report (see header
// comment) — NOT independently live-verified in this sandboxed session.
const LIS_PENDENS_DOC_TYPE = '104'

const SOURCE_NAME = 'lispendens_duval_clerk'
const SOURCE_REFERENCE = 'https://or.duvalclerk.com/ (Official Records, Doc Type: LIS PENDENS)'
const GOV_OWNER_MARKERS = ['CITY OF', 'COUNTY OF', 'STATE OF', 'DUVAL COUNTY', 'JACKSONVILLE HOUSING', 'HABITAT FOR HUMANITY']

const MAX_RECORDS_ALLOWED = [10, 25, 50, 100]
const DATE_RANGE_MAX_DAYS = 90 // hard ceiling even for a "custom" range — never an unbounded fetch

function toIsoDate(recordDateStr) {
  if (!recordDateStr) return null
  return recordDateStr.replace(/\//g, '-')
}

// ── Live source fetch — same disclaimer -> cookie -> grid pattern as
// cap14_lien_pipeline.mjs's fetchLiveLienRecords(), generalized to accept
// a docType + date range + record limit instead of being hardcoded. ──────
async function fetchLiveRecords({ docType, dateRangeDays, maxRecords }) {
  const cookieJar = {}
  const baseHeaders = { 'User-Agent': 'Mozilla/5.0 (HAT Acquisition OS research pilot)' }

  function storeCookies(res) {
    for (const raw of res.headers.getSetCookie?.() || []) {
      const [pair] = raw.split(';')
      const [k, v] = pair.split('=')
      cookieJar[k.trim()] = v
    }
  }
  function cookieHeader() {
    return Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ')
  }
  async function post(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...baseHeaders, Cookie: cookieHeader(), 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body,
    })
    storeCookies(res)
    return res
  }

  await post('https://or.duvalclerk.com/search/Disclaimer', 'disclaimer=true')

  const today = new Date()
  const from = new Date(today.getTime() - dateRangeDays * 24 * 60 * 60 * 1000)
  const fmt = (d) => `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`

  const params = new URLSearchParams({ DocTypes: docType, RecordDateFrom: fmt(from), RecordDateTo: fmt(today) })
  await post('https://or.duvalclerk.com/search/SearchTypeDocType', params.toString())

  const gridRes = await post(
    'https://or.duvalclerk.com/Search/GridResults',
    new URLSearchParams({ take: String(maxRecords), skip: '0', page: '1', pageSize: String(maxRecords) }).toString()
  )
  const json = await gridRes.json()
  return { total: json.Total, records: json.Data || [] }
}

// Part 4/5 — safe, clamped criteria. Never trust the client blindly.
// Extracted as a pure function so it's directly unit-testable without
// mocking network/DB (same convention as every other lib in this repo).
export function clampCriteria({ dateRangeDays: rawDateRangeDays, maxRecords: rawMaxRecords }) {
  const dateRangeDays = Math.min(Math.max(Number(rawDateRangeDays) || 30, 1), DATE_RANGE_MAX_DAYS)
  const maxRecords = MAX_RECORDS_ALLOWED.includes(Number(rawMaxRecords)) ? Number(rawMaxRecords) : 10
  return { dateRangeDays, maxRecords }
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS })
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: HEADERS })

  const body = await req.json().catch(() => ({}))
  const {
    onlyNew = true,
    buyBoxOnly = false,
    workspaceId,
    dryRun = false,
  } = body
  const { dateRangeDays, maxRecords } = clampCriteria(body)

  if (!workspaceId) {
    return new Response(JSON.stringify({ ok: false, error: 'workspaceId required' }), { status: 400, headers: HEADERS })
  }

  // ── Part 20 honesty contract — refuse rather than guess. ──────────────
  if (!LIS_PENDENS_DOC_TYPE) {
    return new Response(JSON.stringify({
      ok: false,
      blocked: true,
      reason: 'Lis Pendens live fetch is not yet connected — the source site\'s numeric DocTypes value for "LIS PENDENS" has not been confirmed. Submitting a guessed value could silently fetch the wrong document type. See Capability audit report.',
    }), { status: 501, headers: HEADERS })
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

  const funnel = {
    recordsFound: 0, newRecords: 0, propertyMatches: 0, buyBoxFit: 0,
    contactReady: 0, highPriority: 0, duplicatesSkipped: 0, errors: 0, needsReview: 0,
  }
  const createdLeads = []
  const errors = []

  try {
    const { total, records } = await fetchLiveRecords({ docType: LIS_PENDENS_DOC_TYPE, dateRangeDays, maxRecords })
    funnel.recordsFound = records.length

    const { data: existingLeads } = await supabase.from('leads').select('id, address').eq('workspace_id', workspaceId)
    const existingNormalized = new Set((existingLeads || []).map(l => normalizeAddressForDB(l.address)))
    const seenThisRun = new Set()

    for (const rec of records) {
      const row = {
        instrument: rec.InstrumentNumber, filingDate: toIsoDate(rec.RecordDate),
        sourceParty: rec.IndirectName, filer: rec.DirectName, legalDescription: rec.DocLegalDescription || null,
      }

      let resolution
      try {
        resolution = await resolveDuvalOwnerIdentity(rec.IndirectName)
      } catch (err) {
        funnel.errors++
        errors.push({ instrument: row.instrument, error: err.message })
        continue
      }

      if (resolution.status === 'NO_MATCH' || resolution.status === 'AMBIGUOUS' || resolution.status === 'ERROR') {
        funnel.needsReview++
        continue
      }

      funnel.propertyMatches++
      const enriched = mapDuvalAttributesToEnrichedProperty(resolution.record, 'EXACT_ADDRESS')
      const normalizedAddress = normalizeAddressForDB(enriched.property_address)

      const isDuplicate = existingNormalized.has(normalizedAddress) || seenThisRun.has(normalizedAddress)
      if (isDuplicate) {
        funnel.duplicatesSkipped++
        if (onlyNew) continue
      }
      seenThisRun.add(normalizedAddress)
      if (!isDuplicate) funnel.newRecords++

      const ownerUpper = (enriched.owner_name || '').toUpperCase()
      if (GOV_OWNER_MARKERS.some(m => ownerUpper.includes(m))) {
        funnel.needsReview++
        continue
      }

      // Part 7 — fetch -> classify -> score -> MARK Buy Box fit; never
      // refuse to ingest a record merely because it's outside the Buy
      // Box (the mission explicitly rejects that as the preferred
      // behavior). buyBoxOnly is accepted for future use but never
      // excludes a record from creation in V1 — see final report.
      const buyBoxResult = qualifyBuyBox({ zip_code: enriched.zip_code })
      const isBuyBoxFit = buyBoxResult.fit === 'FIT'
      if (isBuyBoxFit) funnel.buyBoxFit++

      const { distress_category, distress_category_confidence, distress_category_reason } = classifyDistress({ filer: row.filer })

      const distressData = {
        distress_type: 'lis_pendens', distress_source: SOURCE_NAME, distress_filing_date: row.filingDate,
        distress_case_or_instrument: row.instrument, source_party: row.sourceParty,
        current_owner: enriched.owner_name, owner_match_status: resolution.ownerMatchStatus,
        absentee_owner: enriched.absentee_owner, source_reference: SOURCE_REFERENCE, enrichment_status: 'enriched',
        distress_category, distress_category_confidence, distress_category_reason,
      }

      const opportunity = computeOpportunityScore({
        distressCategory: distress_category,
        buyBoxFit: buyBoxResult.fit,
        ownerMatchStatus: resolution.ownerMatchStatus,
        absenteeOwner: enriched.absentee_owner ?? 'unknown',
        identityVerified: resolution.status === 'EXACT_ADDRESS',
        zipCode: enriched.zip_code,
        propertyType: enriched.property_type,
        hasCharacteristics: !!(enriched.year_built || enriched.living_area || enriched.bedrooms || enriched.bathrooms),
        priorPropertyIntelHistory: false,
      })
      if (opportunity.priority?.key === 'HIGH_PRIORITY') funnel.highPriority++

      // isContactReady() only ever reads phone/email — neither is populated
      // at ingestion time (no skip-trace provider is connected yet, see
      // src/lib/contactEnrichment.js header). Called for real regardless,
      // so this count stays honestly 0 rather than hardcoded, in case that
      // ever changes.
      if (isContactReady({ phone: null, email: null })) funnel.contactReady++

      if (isDuplicate || dryRun) continue

      const leadPayload = {
        address: enriched.property_address, workspace_id: workspaceId, status: 'triage',
        lead_source: 'off_market', created_by: null,
        owner_name: enriched.owner_name, owner_mailing_address: enriched.owner_mailing_address,
        owner_last_sale_date: enriched.last_sale_date, enrichment_data: enriched, enriched_at: enriched.enriched_at,
        auto_imported: true, distress_data: distressData, is_distressed: true,
        notes: `⚠ DISTRESSED OPPORTUNITY — Lis Pendens\nFiled: ${row.filingDate}\nCase/Instrument: ${row.instrument}\n` +
          `Source Party: ${row.sourceParty}\nOwner Match: ${resolution.ownerMatchStatus}\nAbsentee Owner: ${enriched.absentee_owner}\n` +
          `Source: Duval County Public Record (${SOURCE_REFERENCE})`,
      }

      const { data: created, error: insErr } = await supabase.from('leads').insert(leadPayload).select('id, address').single()
      if (insErr) {
        funnel.errors++
        errors.push({ instrument: row.instrument, error: insErr.message })
        continue
      }
      createdLeads.push(created)
    }

    return new Response(JSON.stringify({
      ok: true,
      sourceRawTotal: total,
      funnel,
      createdLeads,
      errors,
      criteria: { dateRangeDays, maxRecords, onlyNew, buyBoxOnly, dryRun },
    }), { status: 200, headers: HEADERS })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message, funnel, createdLeads, errors }), { status: 500, headers: HEADERS })
  }
}

export { KNOWN_DOC_TYPES, LIS_PENDENS_DOC_TYPE, MAX_RECORDS_ALLOWED, DATE_RANGE_MAX_DAYS }
