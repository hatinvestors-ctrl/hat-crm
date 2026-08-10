// One-off correction: refresh enrichment_data/notes for the 19 leads
// already inserted by the pilot, using the fixed absentee-owner logic.
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import { resolveDuvalOwnerIdentity, mapDuvalAttributesToEnrichedProperty } from '../src/lib/propertyEnrichment.js'

const envText = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
const env = Object.fromEntries(envText.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)] }))
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const results = JSON.parse(fs.readFileSync(new URL('./lispendens-pilot-results.json', import.meta.url), 'utf8'))
const inserted = results.results.filter(r => r.outcome === 'INSERTED')

let fixed = 0
for (const r of inserted) {
  const resolution = await resolveDuvalOwnerIdentity(r.sourceParty)
  if (resolution.status !== 'EXACT_ADDRESS') continue
  const enriched = mapDuvalAttributesToEnrichedProperty(resolution.record, 'EXACT_ADDRESS')

  const leadId = r.importResult?.leadId
  if (!leadId) continue

  const notes = `⚠ DISTRESSED OPPORTUNITY — Lis Pendens\n` +
    `Filed: ${r.filingDate}\nCase/Instrument: ${r.instrument}\n` +
    `Source Party: ${r.sourceParty}\nOwner Match: ${r.distressData.owner_match_status}\n` +
    `Absentee Owner: ${enriched.absentee_owner}\nParcel (Duval RE): ${enriched.parcel_id}\n` +
    `Source: Duval County Public Record (https://or.duvalclerk.com/ (Official Records, Doc Type: LIS PENDENS))`

  await supabase.from('leads').update({
    owner_mailing_address: enriched.owner_mailing_address,
    enrichment_data: enriched,
    notes,
  }).eq('id', leadId)
  fixed++
  console.log(enriched.property_address, '-> absentee:', enriched.absentee_owner)
}
console.log(`\nFixed ${fixed} leads.`)
