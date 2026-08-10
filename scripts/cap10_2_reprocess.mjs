// scripts/cap10_2_reprocess.mjs
// Capability #10.2 — re-processes the existing Capability #10 pilot leads
// in place: re-resolves via Duval (now with zip_code mapped), attempts a
// single best-effort statewide lookup for year_built/sqft, classifies the
// distress event from the real Lis Pendens filer name (source snapshot),
// applies the HAT buy box, computes an explainable Opportunity Score, and
// UPDATES the existing lead row + enrichment_data. No new leads created,
// no new properties created — ONE PROPERTY stays ONE PROPERTY throughout.

import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import { resolveDuvalOwnerIdentity, mapDuvalAttributesToEnrichedProperty, tryFetchStatewideCharacteristics } from '../src/lib/propertyEnrichment.js'
import { qualifyBuyBox } from '../src/lib/buyBox.js'
import { classifyDistress, computeOpportunityScore } from '../src/lib/distressScoring.js'
import { normalizeAddressForDB } from '../src/lib/leadDedup.js'

const envText = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
const env = Object.fromEntries(envText.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)] }))
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const GOV_OWNER_MARKERS = ['CITY OF', 'COUNTY OF', 'STATE OF', 'DUVAL COUNTY', 'JACKSONVILLE HOUSING', 'HABITAT FOR HUMANITY']
// Found during Capability #10.2 real-pilot review: "0 GATEWAY CT", owned by
// an HOA (a common-area/retention-pond parcel — house number "0" is
// itself a strong tell), scored a top-2 REVIEW purely because the LIS
// PENDENS FILER happened to match a mortgage-lender pattern. The filer
// classifies the EVENT; it says nothing about whether the CURRENT OWNER
// is even a house HAT could buy. This checks the owner side specifically.
const NON_TARGET_OWNER_MARKERS = ['HOMEOWNERS ASSOCIATION', 'OWNERS ASSOCIATION', 'CONDOMINIUM ASSOCIATION', 'COMMUNITY ASSOCIATION']

async function main() {
  // Source-of-truth filer names — real data captured live from the Duval
  // Clerk in Capability #10 (scripts/lispendens-source-snapshot.json),
  // matched back to each lead by instrument number (parsed from notes).
  const snapshot = JSON.parse(fs.readFileSync(new URL('./lispendens-source-snapshot.json', import.meta.url), 'utf8'))
  const filerByInstrument = new Map(snapshot.Data.map(r => [r.InstrumentNumber, r.DirectName]))

  const { data: leads } = await supabase.from('leads').select('*').ilike('notes', '⚠ DISTRESSED OPPORTUNITY%')
  console.log(`Pilot leads found: ${leads.length}`)

  const results = []

  for (const lead of leads) {
    const instrumentMatch = lead.notes.match(/Case\/Instrument:\s*(\S+)/)
    const instrument = instrumentMatch?.[1] || null
    const filer = instrument ? filerByInstrument.get(instrument) : null
    const sourcePartyMatch = lead.notes.match(/Source Party:\s*(.+)/)
    const sourceParty = sourcePartyMatch?.[1]?.trim() || lead.owner_name

    // 1. Re-resolve via Duval (now maps zip_code — the only functional change to that path).
    let resolution
    try {
      resolution = await resolveDuvalOwnerIdentity(sourceParty)
    } catch (err) {
      resolution = { status: 'ERROR', record: null, error: err.message }
    }
    const enriched = resolution.status === 'EXACT_ADDRESS'
      ? mapDuvalAttributesToEnrichedProperty(resolution.record, 'EXACT_ADDRESS')
      : (lead.enrichment_data || {})

    // 2. Best-effort supplementary statewide characteristics (single attempt, may be null).
    const statewide = await tryFetchStatewideCharacteristics(enriched.property_address || lead.address)

    // 3. Distress classification from REAL filer evidence.
    const classification = classifyDistress({ filer })

    // 4. Exclusion check — real evidence found in this batch: government
    // ownership AND association/HOA-owned common-area parcels (see
    // NON_TARGET_OWNER_MARKERS comment above).
    const ownerUpper = (enriched.owner_name || lead.owner_name || '').toUpperCase()
    const isGovOwned = GOV_OWNER_MARKERS.some(m => ownerUpper.includes(m))
    const isNonTargetOwner = NON_TARGET_OWNER_MARKERS.some(m => ownerUpper.includes(m))
    const isExcluded = isGovOwned || isNonTargetOwner
    const exclusionReason = isGovOwned ? 'GOVERNMENT_OWNED' : (isNonTargetOwner ? 'NON_TARGET_OWNER' : null)

    // 5. Buy-box qualification — reuses existing property columns, never fabricates.
    const zipCode = enriched.zip_code || lead.zip_code || null
    const buyBox = qualifyBuyBox({ zip_code: zipCode, property_type: lead.property_type, bedrooms: lead.bedrooms })

    // 6. Property Intelligence — has this address appeared before (multi-signal)?
    const normalizedAddress = normalizeAddressForDB(lead.address)
    const { data: property } = await supabase
      .from('properties').select('id, event_count')
      .eq('workspace_id', lead.workspace_id).eq('normalized_address', normalizedAddress).maybeSingle()
    const priorHistory = (property?.event_count || 0) > 1 // >1 because the pilot's own lead_created event is #1

    // 7. Opportunity Score.
    const hasCharacteristics = !!(statewide?.year_built || statewide?.living_area || lead.bedrooms || lead.bathrooms)
    const opp = computeOpportunityScore({
      distressCategory: classification.distress_category,
      buyBoxFit: buyBox.fit,
      ownerMatchStatus: resolution.ownerMatchStatus || 'MATCH', // all 19 were originally inserted as MATCH
      absenteeOwner: enriched.absentee_owner ?? 'unknown',
      identityVerified: resolution.status === 'EXACT_ADDRESS',
      zipCode,
      propertyType: lead.property_type,
      hasCharacteristics,
      priorPropertyIntelHistory: priorHistory,
      excluded: isExcluded,
    })

    // 8. Build the update payload — only EXISTING columns, never invented ones.
    const updatedEnrichmentData = {
      ...enriched,
      ...(statewide ? {
        year_built: statewide.year_built ?? enriched.year_built ?? null,
        living_area: statewide.living_area ?? enriched.living_area ?? null,
        unit_count: statewide.unit_count ?? enriched.unit_count ?? null,
        last_sale_price: statewide.last_sale_price ?? enriched.last_sale_price ?? null,
        last_sale_date: statewide.last_sale_date ?? enriched.last_sale_date ?? null,
        supplementary_source: statewide.source,
      } : {}),
      // Capability #10.2 additions — reusing the existing enrichment_data
      // JSONB column (Capability #9) rather than requiring the still-
      // unapplied distress_data migration for this feature to work.
      distress_category: classification.distress_category,
      distress_category_confidence: classification.distress_category_confidence,
      distress_category_reason: classification.distress_category_reason,
      buy_box_fit: buyBox.fit,
      buy_box_reasons: buyBox.reasons,
      opportunity_score: opp.score,
      opportunity_priority: opp.priority,
      opportunity_why: opp.why,
      opportunity_missing: opp.missing,
      excluded: isExcluded,
      excluded_reason: exclusionReason,
    }

    const leadUpdate = {
      zip_code: zipCode || lead.zip_code,
      year_built: statewide?.year_built ?? lead.year_built,
      sqft: statewide?.living_area ?? lead.sqft,
      enrichment_data: updatedEnrichmentData,
    }

    const { error: updErr } = await supabase.from('leads').update(leadUpdate).eq('id', lead.id)
    if (updErr) console.warn('Update failed for', lead.address, updErr.message)

    results.push({
      address: lead.address,
      instrument,
      filer,
      owner: enriched.owner_name || lead.owner_name,
      absentee: enriched.absentee_owner,
      zipCode,
      yearBuilt: statewide?.year_built ?? null,
      sqft: statewide?.living_area ?? null,
      distress: classification,
      buyBox,
      opportunity: opp,
      excluded: isExcluded,
      priorHistory,
      propertyEventCount: property?.event_count ?? null,
    })
    console.log(lead.address, '->', classification.distress_category, '|', buyBox.fit, '|', opp.score, opp.priority.key, isExcluded ? `[EXCLUDED: ${exclusionReason}]` : '')
  }

  fs.writeFileSync(new URL('./cap10_2_results.json', import.meta.url), JSON.stringify(results, null, 2))
  console.log(`\nDone. ${results.length} leads reprocessed. Results written to scripts/cap10_2_results.json`)
}

main().catch(err => { console.error(err); process.exit(1) })
