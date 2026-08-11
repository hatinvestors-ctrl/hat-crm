// scripts/cap14_lien_pipeline.mjs
// Capability #14 — Duval Recorded Liens Off-Market Source V1.
//
// Live-fetches real, current LIEN (doc type "LN", value 103) records from
// the SAME public Official Records system already proven for Lis Pendens
// (or.duvalclerk.com) — same disclaimer-accept -> session-cookie -> grid
// search flow, no CAPTCHA/auth/rate-limit bypass. Classifies each record
// conservatively using ONLY real source evidence (existing
// classifyDistress() + new classifyLienStrength(), both in
// src/lib/distressScoring.js), resolves property identity via the EXISTING
// resolveDuvalOwnerIdentity() stack (no new resolver), free-filters before
// any paid lookup, and either creates a new off-market opportunity or
// attaches a new signal to an EXISTING property/lead found from a prior
// source (Lis Pendens, Redfin, Zillow, manual) — one property stays one
// property.
//
// Run: node scripts/cap14_lien_pipeline.mjs [--dry-run] [--sample=50]

import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import { resolveDuvalOwnerIdentity, mapDuvalAttributesToEnrichedProperty } from '../src/lib/propertyEnrichment.js'
import { normalizeAddressForDB } from '../src/lib/leadDedup.js'
import { classifyDistress, classifyLienStrength, computeOpportunityScore } from '../src/lib/distressScoring.js'
import { qualifyBuyBox } from '../src/lib/buyBox.js'

const DRY_RUN = process.argv.includes('--dry-run')
const SAMPLE_SIZE = Number((process.argv.find(a => a.startsWith('--sample=')) || '').split('=')[1]) || 50

// ── env ────────────────────────────────────────────────────────────────
const envText = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
const env = Object.fromEntries(
  envText.split('\n').filter(l => l.includes('=')).map(l => {
    const i = l.indexOf('=')
    return [l.slice(0, i), l.slice(i + 1)]
  })
)
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const SOURCE_NAME = 'liens_duval_clerk'
const SOURCE_REFERENCE = 'https://or.duvalclerk.com/ (Official Records, Doc Type: LIEN)'
const LIEN_DOC_TYPE_VALUE = '103' // real vocabulary value verified live from the site's own DocTypesDisplay dataSource — see delivery report
const GOV_OWNER_MARKERS = ['CITY OF', 'COUNTY OF', 'STATE OF', 'DUVAL COUNTY', 'JACKSONVILLE HOUSING', 'HABITAT FOR HUMANITY']
const BUSINESS_SUFFIX_RE = /\b(LLC|INC|CORP|CO\.?|LP|LLP|L\.P\.|COMPANY|ASSOCIATES?|GROUP|ENTERPRISES?|HOLDINGS|MANAGEMENT|SERVICES|PARTNERS)\b\.?\s*$/i

// ── Step 1/2 — live source fetch, legitimate public-access pattern only ──
async function fetchLiveLienRecords(sampleSize) {
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
  async function get(url) {
    const res = await fetch(url, { headers: { ...baseHeaders, Cookie: cookieHeader() } })
    storeCookies(res)
    return res
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

  // Accept the public disclaimer (same as any human visitor must do — no bypass).
  await post('https://or.duvalclerk.com/search/Disclaimer', 'disclaimer=true')

  const today = new Date()
  const from = new Date(today.getTime() - 45 * 24 * 60 * 60 * 1000)
  const fmt = (d) => `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`

  // Submit the real Doc Type search form (sets the server-side search session).
  const params = new URLSearchParams({ DocTypes: LIEN_DOC_TYPE_VALUE, RecordDateFrom: fmt(from), RecordDateTo: fmt(today) })
  await post('https://or.duvalclerk.com/search/SearchTypeDocType', params.toString())

  // Read results from the same Kendo grid endpoint the page itself calls.
  const gridRes = await post(
    'https://or.duvalclerk.com/Search/GridResults',
    new URLSearchParams({ take: String(sampleSize), skip: '0', page: '1', pageSize: String(sampleSize) }).toString()
  )
  const json = await gridRes.json()
  return { total: json.Total, records: json.Data || [] }
}

function toIsoDate(recordDateStr) {
  if (!recordDateStr) return null
  return recordDateStr.replace(/\//g, '-')
}

// ── Step 8 — free filtering (before ANY paid lookup) ─────────────────────
function freeFilter({ enriched, ownerMatchStatus, party, buyBoxResult }) {
  const reasons = []
  const ownerUpper = (enriched?.owner_name || '').toUpperCase()

  if (GOV_OWNER_MARKERS.some(m => ownerUpper.includes(m))) reasons.push('GOVERNMENT_OWNED')
  if (BUSINESS_SUFFIX_RE.test((party || '').trim())) reasons.push('PARTY_IS_BUSINESS_NOT_OWNER')
  if (ownerMatchStatus === 'UNKNOWN') reasons.push('OWNER_UNRESOLVED')
  if (buyBoxResult?.fit === 'NOT_FIT') reasons.push(`BUY_BOX_NOT_FIT: ${buyBoxResult.reasons.join(', ')}`)

  return { rejected: reasons.length > 0, reasons }
}

// ── Node-safe mirrors of Property Intelligence + importLead (same pattern
// as scripts/lispendens-pilot.mjs — see that file's header for why these
// are reimplemented here rather than importing the browser-facing modules) ──
async function findExistingProperty(workspaceId, normalizedAddress) {
  const { data } = await supabase
    .from('properties')
    .select('id, event_count, current_lead_id')
    .eq('workspace_id', workspaceId)
    .eq('normalized_address', normalizedAddress)
    .maybeSingle()
  return data || null
}

async function recordPropertyEvent({ workspaceId, addressFields, leadId = null, type, content = '', metadata = {} }) {
  try {
    if (!workspaceId || !addressFields?.address || !type) return null
    const normalized = normalizeAddressForDB(addressFields.address)
    if (!normalized) return null

    const { data: existing } = await supabase
      .from('properties')
      .select('id, event_count')
      .eq('workspace_id', workspaceId)
      .eq('normalized_address', normalized)
      .maybeSingle()

    let propertyId = existing?.id
    if (propertyId) {
      await supabase
        .from('properties')
        .update({
          last_seen_at: new Date().toISOString(),
          event_count: (existing.event_count || 0) + 1,
          updated_at: new Date().toISOString(),
          ...(leadId ? { current_lead_id: leadId } : {}),
        })
        .eq('id', propertyId)
    } else {
      const { data: created, error: insErr } = await supabase
        .from('properties')
        .insert({
          workspace_id: workspaceId, normalized_address: normalized, address: addressFields.address,
          city: addressFields.city ?? null, state: addressFields.state ?? null, zip_code: addressFields.zip_code ?? null,
          current_lead_id: leadId, event_count: 1,
        })
        .select('id').single()
      if (insErr) {
        if (insErr.code === '23505') {
          const { data: raceExisting } = await supabase.from('properties').select('id').eq('workspace_id', workspaceId).eq('normalized_address', normalized).maybeSingle()
          propertyId = raceExisting?.id
        } else throw insErr
      } else propertyId = created.id
    }

    if (propertyId) {
      await supabase.from('property_events').insert({ workspace_id: workspaceId, property_id: propertyId, lead_id: leadId, type, content, metadata })
    }
    return propertyId
  } catch (err) {
    console.warn('[cap14] recordPropertyEvent non-fatal error:', err.message)
    return null
  }
}

async function distressColumnsExist() {
  const { error } = await supabase.from('leads').select('is_distressed').limit(1)
  return !error
}

async function nodeImportLead(normalizedLead, { workspaceId, status = 'triage' }) {
  if (!normalizedLead?.address?.trim()) throw new Error('address is required')
  const normalizedAddress = normalizeAddressForDB(normalizedLead.address)

  const { data: existingLeads } = await supabase.from('leads').select('id, address').eq('workspace_id', workspaceId)
  const duplicate = (existingLeads || []).find(l => normalizeAddressForDB(l.address) === normalizedAddress)
  if (duplicate) return { created: false, leadId: duplicate.id, status: 'duplicate' }

  const { source, distress_data, is_distressed, ...rest } = normalizedLead
  const basePayload = { ...rest, workspace_id: workspaceId, created_by: null, status, ...(distress_data !== undefined ? { distress_data } : {}), ...(is_distressed !== undefined ? { is_distressed } : {}) }

  let created, insErr
  ;({ data: created, error: insErr } = await supabase.from('leads').insert({ ...basePayload, lead_source: 'off_market' }).select().single())
  if (insErr && insErr.code === '23514') {
    ;({ data: created, error: insErr } = await supabase.from('leads').insert({ ...basePayload, lead_source: 'other' }).select().single())
  }
  if (insErr) {
    if (insErr.code === '23505') return { created: false, leadId: null, status: 'duplicate' }
    throw insErr
  }

  const propertyId = await recordPropertyEvent({ workspaceId, addressFields: created, leadId: created.id, type: 'lead_created', content: `Lead created via ${normalizedLead.source}`, metadata: { source: normalizedLead.source } })
  return { created: true, leadId: created.id, status: 'created', propertyId, lead: created }
}

async function main() {
  console.log(`Fetching live LIEN records from ${SOURCE_REFERENCE} (last 45 days, sample up to ${SAMPLE_SIZE})...`)
  const { total, records } = await fetchLiveLienRecords(SAMPLE_SIZE)
  console.log(`RAW LIEN RECORDS AVAILABLE (45-day window): ${total}`)
  console.log(`SAMPLE REVIEWED: ${records.length}`)

  const { data: workspaces } = await supabase.from('workspaces').select('id').limit(1)
  const workspaceId = workspaces?.[0]?.id
  if (!workspaceId) throw new Error('No workspace found')
  const hasDistressColumns = await distressColumnsExist()

  const funnel = {
    rawAvailable: total, sampleReviewed: records.length,
    uniqueProperty: 0, propertyResolved: 0, freeRejected: 0,
    paidBatchDataCandidates: 0, insertedNew: 0, attachedToExisting: 0,
    duplicatesInBatch: 0, wrongMatches: 0, alreadyKnownFromLisPendens: 0,
    rejectReasons: {},
    lienStrengthCounts: {},
  }
  const results = []
  const seenNormalizedAddresses = new Set()

  for (const rec of records) {
    const row = {
      instrument: rec.InstrumentNumber, filingDate: toIsoDate(rec.RecordDate),
      filer: rec.DirectName, party: rec.IndirectName, legalDescription: rec.DocLegalDescription || null,
      amount: rec.Consideration || null, bookPage: rec.BookPage || null, docType: rec.DocTypeDescription,
    }

    let resolution
    try {
      resolution = await resolveDuvalOwnerIdentity(rec.IndirectName)
    } catch (err) {
      resolution = { status: 'ERROR', record: null, ownerMatchStatus: 'UNKNOWN', error: err.message }
    }

    if (resolution.status === 'NO_MATCH' || resolution.status === 'AMBIGUOUS' || resolution.status === 'ERROR') {
      funnel.freeRejected++
      funnel.rejectReasons[resolution.status] = (funnel.rejectReasons[resolution.status] || 0) + 1
      results.push({ ...row, outcome: 'REJECTED', reason: resolution.status })
      continue
    }

    funnel.propertyResolved++
    const enriched = mapDuvalAttributesToEnrichedProperty(resolution.record, 'EXACT_ADDRESS')
    const normalizedAddress = normalizeAddressForDB(enriched.property_address)

    if (!seenNormalizedAddresses.has(normalizedAddress)) {
      seenNormalizedAddresses.add(normalizedAddress)
      funnel.uniqueProperty++
    } else {
      funnel.duplicatesInBatch++
      funnel.freeRejected++
      funnel.rejectReasons.DUPLICATE_IN_BATCH = (funnel.rejectReasons.DUPLICATE_IN_BATCH || 0) + 1
      results.push({ ...row, outcome: 'REJECTED', reason: 'DUPLICATE_IN_BATCH (same property, this run)' })
      continue
    }

    // Buy box — property_type is not yet known pre-BatchData (same
    // INSUFFICIENT_DATA state Lis Pendens sees at this stage), so this is a
    // ZIP-only pre-check; the real Buy Box call happens again after any
    // BatchData property-type enrichment below.
    const buyBoxResult = qualifyBuyBox({ zip_code: enriched.zip_code })

    const filterResult = freeFilter({ enriched, ownerMatchStatus: resolution.ownerMatchStatus, party: row.party, buyBoxResult })
    if (filterResult.rejected) {
      funnel.freeRejected++
      for (const reason of filterResult.reasons) funnel.rejectReasons[reason] = (funnel.rejectReasons[reason] || 0) + 1
      results.push({ ...row, outcome: 'REJECTED', reason: filterResult.reasons.join(', '), enriched })
      continue
    }

    // Distress category + conservative lien-strength classification (Section 3).
    const { distress_category, distress_category_confidence, distress_category_reason } = classifyDistress({ filer: row.filer })

    // Multi-signal check (Section 6/7) — does this property already exist
    // from Lis Pendens/Redfin/Zillow/manual? ONE property stays ONE property.
    const existingProperty = await findExistingProperty(workspaceId, normalizedAddress)
    let otherSignalCount = 0
    let existingLeadDistressType = null
    if (existingProperty?.current_lead_id) {
      const { data: existingLead } = await supabase.from('leads').select('id, distress_data, notes').eq('id', existingProperty.current_lead_id).maybeSingle()
      if (existingLead) {
        existingLeadDistressType = existingLead.distress_data?.distress_type || (existingLead.notes?.includes('Lis Pendens') ? 'lis_pendens' : null)
        if (existingLeadDistressType) otherSignalCount++
      }
    }

    const lienStrength = classifyLienStrength({
      distressCategory: distress_category,
      hasLegalDescription: Boolean(row.legalDescription),
      partyLooksLikeBusiness: BUSINESS_SUFFIX_RE.test(row.party || ''),
      otherSignalCount,
    })
    funnel.lienStrengthCounts[lienStrength.strength] = (funnel.lienStrengthCounts[lienStrength.strength] || 0) + 1

    if (lienStrength.strength === 'NON_ACQUISITION_SIGNAL' || lienStrength.strength === 'UNKNOWN') {
      funnel.freeRejected++
      funnel.rejectReasons[lienStrength.strength] = (funnel.rejectReasons[lienStrength.strength] || 0) + 1
      results.push({ ...row, outcome: 'REJECTED', reason: lienStrength.strength, lienStrength, enriched })
      continue
    }

    const distressData = {
      distress_type: 'recorded_lien', distress_source: SOURCE_NAME, distress_filing_date: row.filingDate,
      distress_case_or_instrument: row.instrument, source_party: row.party,
      current_owner: enriched.owner_name, owner_match_status: resolution.ownerMatchStatus,
      absentee_owner: enriched.absentee_owner, source_reference: SOURCE_REFERENCE, enrichment_status: 'enriched',
      lien_amount: row.amount > 0 ? row.amount : null, lien_status: 'unknown', // source grid never exposes release/satisfaction status directly — honestly unknown, not guessed
      distress_category, distress_category_confidence, distress_category_reason,
      lien_strength: lienStrength.strength, lien_strength_reason: lienStrength.reason,
    }

    // Multi-signal property already known — attach event, do NOT create a
    // second lead for the same property (Section 6).
    if (existingProperty && otherSignalCount > 0) {
      funnel.attachedToExisting++
      if (existingLeadDistressType === 'lis_pendens') funnel.alreadyKnownFromLisPendens++
      if (!DRY_RUN) {
        await recordPropertyEvent({
          workspaceId, addressFields: { address: enriched.property_address, city: enriched.city, state: enriched.state, zip_code: enriched.zip_code },
          leadId: existingProperty.current_lead_id, type: 'lien_signal_added',
          content: `Recorded lien found — ${distress_category} (${row.instrument}, filed ${row.filingDate})`,
          metadata: distressData,
        })
      }
      results.push({ ...row, outcome: 'ATTACHED_MULTI_SIGNAL', enriched, distressData, lienStrength, normalizedAddress })
      continue
    }

    funnel.paidBatchDataCandidates++
    if (DRY_RUN) {
      results.push({ ...row, outcome: 'WOULD_INSERT', enriched, distressData, lienStrength, normalizedAddress })
      continue
    }

    const leadPayload = {
      address: enriched.property_address, source: SOURCE_NAME, owner_name: enriched.owner_name,
      owner_mailing_address: enriched.owner_mailing_address, owner_last_sale_date: enriched.last_sale_date,
      enrichment_data: enriched, enriched_at: enriched.enriched_at, auto_imported: true,
      notes: `⚠ DISTRESSED OPPORTUNITY — Recorded Lien\n` +
        `Filed: ${row.filingDate}\nCase/Instrument: ${row.instrument}\n` +
        `Source Party: ${row.party}\nOwner Match: ${resolution.ownerMatchStatus}\n` +
        `Absentee Owner: ${enriched.absentee_owner}\nParcel (Duval RE): ${enriched.parcel_id}\n` +
        `Lien Type: ${distress_category}\nAmount: ${row.amount > 0 ? row.amount : 'Not disclosed'}\nStatus: Unknown\n` +
        `Source: Duval County Public Record (${SOURCE_REFERENCE})`,
      ...(hasDistressColumns ? { distress_data: distressData, is_distressed: true } : {}),
    }

    let importResult
    try {
      importResult = await nodeImportLead(leadPayload, { workspaceId, status: 'triage' })
    } catch (err) {
      funnel.freeRejected++
      funnel.rejectReasons.INSERT_ERROR = (funnel.rejectReasons.INSERT_ERROR || 0) + 1
      results.push({ ...row, outcome: 'REJECTED', reason: `INSERT_ERROR: ${err.message}` })
      continue
    }

    if (importResult.status === 'duplicate') funnel.duplicatesInBatch++
    else funnel.insertedNew++
    results.push({ ...row, outcome: 'INSERTED', enriched, distressData, lienStrength, normalizedAddress, importResult })
  }

  console.log('\n=== FUNNEL ===')
  console.log(JSON.stringify(funnel, null, 2))

  fs.writeFileSync(new URL('./cap14_lien_pipeline_results.json', import.meta.url), JSON.stringify({ funnel, results }, null, 2))
  console.log('\nFull results written to scripts/cap14_lien_pipeline_results.json')
}

main().catch(err => { console.error(err); process.exit(1) })
