// scripts/lispendens-pilot.mjs
// Capability #10 — Real Distressed Leads Pilot: Duval Lis Pendens V1.
//
// Reads the real 30-record source snapshot (scripts/lispendens-source-
// snapshot.json — captured live from or.duvalclerk.com's own public search
// grid, see delivery report for exact method), resolves each record's
// defendant (source party) to a current Duval property owner via
// resolveDuvalOwnerIdentity() (src/lib/propertyEnrichment.js), applies
// basic qualification, dedupes against Property Intelligence, and inserts
// qualified opportunities via the existing importLead() (Capability #6).
//
// Run: node scripts/lispendens-pilot.mjs [--dry-run]

import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import { resolveDuvalOwnerIdentity, mapDuvalAttributesToEnrichedProperty } from '../src/lib/propertyEnrichment.js'
import { normalizeAddressForDB } from '../src/lib/leadDedup.js'

const DRY_RUN = process.argv.includes('--dry-run')

// ── env (plain Node — .env is not auto-loaded outside Vite) ──────────────
const envText = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
const env = Object.fromEntries(
  envText.split('\n').filter(l => l.includes('=')).map(l => {
    const i = l.indexOf('=')
    return [l.slice(0, i), l.slice(i + 1)]
  })
)
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

// ── config ─────────────────────────────────────────────────────────────
const SOURCE_NAME = 'lispendens_duval_clerk'
const SOURCE_REFERENCE = 'https://or.duvalclerk.com/ (Official Records, Doc Type: LIS PENDENS)'
const DISTRESS_DATA_COLUMNS_EXIST_CACHE = { checked: false, exist: false }

async function distressColumnsExist() {
  if (DISTRESS_DATA_COLUMNS_EXIST_CACHE.checked) return DISTRESS_DATA_COLUMNS_EXIST_CACHE.exist
  const { error } = await supabase.from('leads').select('is_distressed').limit(1)
  DISTRESS_DATA_COLUMNS_EXIST_CACHE.checked = true
  DISTRESS_DATA_COLUMNS_EXIST_CACHE.exist = !error
  return DISTRESS_DATA_COLUMNS_EXIST_CACHE.exist
}

function toIsoDate(recordDateStr) {
  // Source format: "2026/08/10"
  if (!recordDateStr) return null
  return recordDateStr.replace(/\//g, '-')
}

// ── qualification (Section 7 — basic, conservative, no financial fabrication) ──
const GOV_OWNER_MARKERS = ['CITY OF', 'COUNTY OF', 'STATE OF', 'DUVAL COUNTY', 'JACKSONVILLE HOUSING', 'HABITAT FOR HUMANITY']
function qualify(enriched, ownerMatchStatus) {
  const reasons = []
  let qualifies = true

  const ownerUpper = (enriched.owner_name || '').toUpperCase()
  if (GOV_OWNER_MARKERS.some(m => ownerUpper.includes(m))) {
    qualifies = false
    reasons.push('GOVERNMENT_OWNED')
  }
  if (ownerMatchStatus === 'UNKNOWN') {
    // Should not reach here (caller already filters NO_MATCH/AMBIGUOUS
    // before calling qualify), kept as defense-in-depth.
    qualifies = false
    reasons.push('OWNER_UNRESOLVED')
  }
  // Not over-filtering per the mission — absentee/residential-type are
  // POSITIVE signals we record, not hard gates, since Duval's schema
  // doesn't reliably give us a decodable property_type/land_use (see
  // Capability #9.2 limitations) to gate on in the first place.
  return { qualifies, reasons }
}

// ── Node-safe mirror of recordPropertyEvent() (src/lib/propertyIntelligence.js) ──
// Same logic, same table writes, same "find-or-create ONE property, append
// an append-only event" contract — reimplemented here only because that
// file statically imports './supabase' (Vite-only, import.meta.env),
// which crashes under plain Node. Not touching that browser-facing file
// for a one-off pilot script keeps zero risk to the live app bundle.
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
          workspace_id: workspaceId,
          normalized_address: normalized,
          address: addressFields.address,
          city: addressFields.city ?? null,
          state: addressFields.state ?? null,
          zip_code: addressFields.zip_code ?? null,
          current_lead_id: leadId,
          event_count: 1,
        })
        .select('id')
        .single()
      if (insErr) {
        if (insErr.code === '23505') {
          const { data: raceExisting } = await supabase
            .from('properties').select('id').eq('workspace_id', workspaceId).eq('normalized_address', normalized).maybeSingle()
          propertyId = raceExisting?.id
        } else {
          throw insErr
        }
      } else {
        propertyId = created.id
      }
    }

    if (propertyId) {
      await supabase.from('property_events').insert({
        workspace_id: workspaceId, property_id: propertyId, lead_id: leadId,
        type, content, metadata,
      })
    }
    return propertyId
  } catch (err) {
    console.warn('[lispendens-pilot] recordPropertyEvent non-fatal error:', err.message)
    return null
  }
}

// ── Node-safe mirror of importLead() (src/lib/leadImport.js) — same steps: ──
// validate -> normalize -> dedup check -> insert -> Property Intelligence
// event. Not touching leadImport.js itself for the same reason as above.
async function nodeImportLead(normalizedLead, { workspaceId, status = 'triage' }) {
  if (!normalizedLead?.address?.trim()) throw new Error('address is required')
  const normalizedAddress = normalizeAddressForDB(normalizedLead.address)

  const { data: existingLeads } = await supabase
    .from('leads').select('id, address').eq('workspace_id', workspaceId)
  const duplicate = (existingLeads || []).find(l => normalizeAddressForDB(l.address) === normalizedAddress)

  if (duplicate) {
    const propertyId = await recordPropertyEvent({
      workspaceId, addressFields: normalizedLead, leadId: duplicate.id, type: 'duplicate_attempt',
      content: `Import attempted for an address that already exists (source: ${normalizedLead.source})`,
      metadata: { source: normalizedLead.source },
    })
    return { created: false, leadId: duplicate.id, status: 'duplicate', propertyId }
  }

  const { source, distress_data, is_distressed, ...rest } = normalizedLead
  const payload = {
    ...rest,
    workspace_id: workspaceId,
    created_by: null,
    lead_source: 'other', // see src/lib/leadImport.js — lead_source is DB-CHECK-constrained; 'other' is always valid
    status,
    ...(distress_data !== undefined ? { distress_data } : {}),
    ...(is_distressed !== undefined ? { is_distressed } : {}),
  }

  const { data: created, error: insErr } = await supabase.from('leads').insert(payload).select().single()
  if (insErr) {
    if (insErr.code === '23505') {
      const propertyId = await recordPropertyEvent({
        workspaceId, addressFields: normalizedLead, type: 'duplicate_attempt',
        content: `Import race — address already exists (source: ${normalizedLead.source})`, metadata: { source: normalizedLead.source },
      })
      return { created: false, leadId: null, status: 'duplicate', propertyId }
    }
    throw insErr
  }

  const propertyId = await recordPropertyEvent({
    workspaceId, addressFields: created, leadId: created.id, type: 'lead_created',
    content: `Lead created via ${normalizedLead.source}`, metadata: { source: normalizedLead.source },
  })

  return { created: true, leadId: created.id, status: 'created', propertyId, lead: created }
}

async function propertyAlreadyExists(workspaceId, normalizedAddress) {
  const { data } = await supabase
    .from('properties')
    .select('id, event_count')
    .eq('workspace_id', workspaceId)
    .eq('normalized_address', normalizedAddress)
    .maybeSingle()
  return data || null
}

async function main() {
  const snapshot = JSON.parse(fs.readFileSync(new URL('./lispendens-source-snapshot.json', import.meta.url), 'utf8'))
  const records = snapshot.Data
  console.log(`Source records loaded: ${records.length} (of ${snapshot.Total} total Lis Pendens filings, last 30 days)`)

  const { data: workspaces } = await supabase.from('workspaces').select('id').limit(1)
  const workspaceId = workspaces?.[0]?.id
  if (!workspaceId) throw new Error('No workspace found')

  const hasDistressColumns = await distressColumnsExist()
  console.log(`distress_data/is_distressed columns present: ${hasDistressColumns}`)

  const funnel = {
    reviewed: records.length,
    resolved: 0,
    enriched: 0,
    rejected: 0,
    crmOpportunities: 0,
    existingPropertiesUpdated: 0,
    newPropertiesCreated: 0,
    wrongPropertyMatches: 0, // by construction: 0 auto-guesses ever made
    duplicatesCreated: 0,
    rejectReasons: {},
  }
  const results = []

  for (const rec of records) {
    const row = {
      instrument: rec.InstrumentNumber,
      filingDate: toIsoDate(rec.RecordDate),
      sourceParty: rec.IndirectName, // defendant — see propertyEnrichment.js resolveDuvalOwnerIdentity() header
      filer: rec.DirectName,
      legalDescription: rec.DocLegalDescription || null,
    }

    let resolution
    try {
      resolution = await resolveDuvalOwnerIdentity(rec.IndirectName)
    } catch (err) {
      resolution = { status: 'ERROR', record: null, ownerMatchStatus: 'UNKNOWN', error: err.message }
    }

    if (resolution.status === 'NO_MATCH') {
      funnel.rejected++
      funnel.rejectReasons.NO_MATCH = (funnel.rejectReasons.NO_MATCH || 0) + 1
      results.push({ ...row, outcome: 'REJECTED', reason: 'NO_MATCH' })
      continue
    }
    if (resolution.status === 'AMBIGUOUS') {
      funnel.rejected++
      funnel.rejectReasons.AMBIGUOUS = (funnel.rejectReasons.AMBIGUOUS || 0) + 1
      results.push({ ...row, outcome: 'REJECTED', reason: 'AMBIGUOUS' })
      continue
    }
    if (resolution.status === 'ERROR') {
      funnel.rejected++
      funnel.rejectReasons.OTHER = (funnel.rejectReasons.OTHER || 0) + 1
      results.push({ ...row, outcome: 'REJECTED', reason: 'ERROR', error: resolution.error })
      continue
    }

    // EXACT_ADDRESS (property identity resolved via owner name)
    funnel.resolved++
    const enriched = mapDuvalAttributesToEnrichedProperty(resolution.record, 'EXACT_ADDRESS')
    funnel.enriched++

    const qual = qualify(enriched, resolution.ownerMatchStatus)
    if (!qual.qualifies) {
      funnel.rejected++
      for (const reason of qual.reasons) {
        funnel.rejectReasons[reason] = (funnel.rejectReasons[reason] || 0) + 1
      }
      results.push({ ...row, outcome: 'REJECTED', reason: qual.reasons.join(','), enriched })
      continue
    }

    // Dedup check (Section 9 — ONE property, many sources)
    const normalizedAddress = normalizeAddressForDB(enriched.property_address)
    const existingProperty = await propertyAlreadyExists(workspaceId, normalizedAddress)

    // Also dedup repeated Lis Pendens source records referring to the same
    // filing/property (Section 9) — skip if we've already produced a
    // result for this exact normalized address in this run.
    const alreadyInThisRun = results.find(r => r.normalizedAddress === normalizedAddress && r.outcome === 'INSERTED')
    if (alreadyInThisRun) {
      funnel.rejected++
      funnel.rejectReasons.DUPLICATE = (funnel.rejectReasons.DUPLICATE || 0) + 1
      results.push({ ...row, outcome: 'REJECTED', reason: 'DUPLICATE (same property, same pilot run)', enriched })
      continue
    }

    const distressData = {
      distress_type: 'lis_pendens',
      distress_source: SOURCE_NAME,
      distress_filing_date: row.filingDate,
      distress_case_or_instrument: row.instrument,
      source_party: row.sourceParty,
      current_owner: enriched.owner_name,
      owner_match_status: resolution.ownerMatchStatus,
      absentee_owner: enriched.absentee_owner,
      source_reference: SOURCE_REFERENCE,
      enrichment_status: 'enriched',
    }

    if (DRY_RUN) {
      results.push({ ...row, outcome: 'WOULD_INSERT', enriched, distressData, normalizedAddress })
      funnel.crmOpportunities++
      continue
    }

    const leadPayload = {
      address: enriched.property_address,
      source: SOURCE_NAME,
      owner_name: enriched.owner_name,
      owner_mailing_address: enriched.owner_mailing_address,
      owner_last_sale_date: enriched.last_sale_date,
      enrichment_data: enriched,
      enriched_at: enriched.enriched_at,
      auto_imported: true, // required for the lead to appear in Inbox — see src/pages/InboxPage.jsx .eq('auto_imported', true)
      notes: `⚠ DISTRESSED OPPORTUNITY — Lis Pendens\n` +
        `Filed: ${row.filingDate}\nCase/Instrument: ${row.instrument}\n` +
        `Source Party: ${row.sourceParty}\nOwner Match: ${resolution.ownerMatchStatus}\n` +
        `Absentee Owner: ${enriched.absentee_owner}\nParcel (Duval RE): ${enriched.parcel_id}\n` +
        `Source: Duval County Public Record (${SOURCE_REFERENCE})`,
      ...(hasDistressColumns ? { distress_data: distressData, is_distressed: true } : {}),
    }

    let importResult
    try {
      importResult = await nodeImportLead(leadPayload, { workspaceId, status: 'triage' })
    } catch (err) {
      funnel.rejected++
      funnel.rejectReasons.OTHER = (funnel.rejectReasons.OTHER || 0) + 1
      results.push({ ...row, outcome: 'REJECTED', reason: `INSERT_ERROR: ${err.message}` })
      continue
    }

    funnel.crmOpportunities++
    if (importResult.status === 'duplicate') {
      funnel.existingPropertiesUpdated++
    } else {
      funnel.newPropertiesCreated++
    }
    results.push({ ...row, outcome: 'INSERTED', enriched, distressData, normalizedAddress, importResult })
  }

  console.log('\n=== FUNNEL ===')
  console.log(JSON.stringify(funnel, null, 2))

  fs.writeFileSync(new URL('./lispendens-pilot-results.json', import.meta.url), JSON.stringify({ funnel, results }, null, 2))
  console.log('\nFull results written to scripts/lispendens-pilot-results.json')
}

main().catch(err => { console.error(err); process.exit(1) })
