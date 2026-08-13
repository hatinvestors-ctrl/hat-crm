// scripts/cap16_1_before_after_test.mjs
// Capability #16.1 — real before/after verification. Runs the ACTUAL
// production analysis path (generate-core-analysis + generate-comps, the
// same deployed functions DealAnalysisCard.jsx calls) against 5 real,
// active leads, applies the identical write-back + V2 recalculation logic
// just added to DealAnalysisCard.jsx, and records before/after.
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import { computeDecisionV2 } from '../src/lib/decisionEngineV2.js'
import { getArvProvenance, getDecisionMaturity } from '../src/lib/arvProvenance.js'

const envText = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
const env = Object.fromEntries(envText.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)] }))
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const SITE = 'https://gilded-elf-31457a.netlify.app'

const ADDRESSES = ['1012 BECKNER Avenue', '7859 Denham Rd W', '8321 Old Plank Rd', '4618 HERCULES Avenue', '12186 Pebble Point Dr']

function snapshot(lead, label) {
  const maturity = getDecisionMaturity(lead)
  const prov = getArvProvenance(lead)
  return {
    label, address: lead.address,
    comps: prov.comps_count, arv: lead.arv, arv_source: prov.source,
    reno: lead.renovation_cost,
    opportunity: lead.decision_v2?.opportunity?.score ?? null,
    confidence: lead.decision_v2?.confidence?.score ?? null,
    recommendation: lead.decision_v2?.recommendation ?? null,
    next_action: lead.decision_v2?.next_best_action ?? null,
    maturity,
  }
}

async function callFn(name, body) {
  const res = await fetch(`${SITE}/.netlify/functions/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json()
  if (!res.ok || !data.ok) throw new Error(data.error || `${name} failed`)
  return data
}

async function runFor(addressFragment) {
  const { data: rows } = await supabase.from('leads').select('*').ilike('address', `%${addressFragment}%`).limit(1)
  const lead = rows?.[0]
  if (!lead) { console.log('NOT FOUND:', addressFragment); return null }

  const before = snapshot(lead, 'BEFORE')

  // Real comps call (same as DealAnalysisCard.jsx's Phase 1)
  let compsNotes = ''
  try {
    const compsRes = await callFn('generate-comps', { lead })
    compsNotes = compsRes.notes || ''
  } catch (e) { console.warn('comps call failed (non-fatal, continuing without):', e.message) }

  // Real core analysis call (same as DealAnalysisCard.jsx's Phase 1)
  const coreRes = await callFn('generate-core-analysis', { lead: { ...lead, notes: (lead.notes || '') + (compsNotes ? `\n\n${compsNotes}` : '') } })
  const coreNotes = coreRes.notes || ''
  const finalArv = coreRes.computed_arv ?? null
  const finalMao = coreRes.computed_mao ?? null
  const fullNotes = `Generated (Cap #16.1 test): ${new Date().toISOString()}\n\n${coreNotes}${compsNotes ? '\n\n' + compsNotes : ''}`

  const dbUpdate = {
    ai_notes: fullNotes,
    ...(finalArv != null ? { arv: finalArv } : {}),
    ...(finalMao != null ? { mao: finalMao } : {}),
  }
  await supabase.from('leads').update(dbUpdate).eq('id', lead.id)

  const merged = { ...lead, ...dbUpdate }
  const marketType = merged.is_distressed ? 'off_market' : 'on_market'
  const decision = computeDecisionV2(merged, marketType, { trigger: 'PROPERTY_DATA_UPDATE' })
  await supabase.from('leads').update({ decision_v2: decision, decision_v2_updated_at: decision.calculated_at }).eq('id', lead.id)

  const after = snapshot({ ...merged, decision_v2: decision }, 'AFTER')
  return { before, after }
}

async function main() {
  const results = []
  for (const a of ADDRESSES) {
    console.log('\n=== Running:', a, '===')
    const r = await runFor(a)
    if (r) { console.log('BEFORE:', JSON.stringify(r.before)); console.log('AFTER: ', JSON.stringify(r.after)); results.push(r) }
  }
  fs.writeFileSync(new URL('./cap16_1_before_after_results.json', import.meta.url), JSON.stringify(results, null, 2))
  console.log(`\n\nLeads tested: ${results.length}`)
}
main().catch(e => { console.error(e); process.exit(1) })
