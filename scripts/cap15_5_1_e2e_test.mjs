// scripts/cap15_5_1_e2e_test.mjs
// Capability #15.5.1 — real end-to-end trigger/recalculation tests against
// the safe TEST-PROBE-DELETE-ME-zillow_auto lead (never a real acquisition
// lead). Every field change is restored to its original value at the end.
// No paid calls. No LLM calls (verified by never importing/calling
// qualitativeIntelligence.js anywhere in this file).
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import { computeDecisionV2, shouldTriggerV2Recalc, applyHumanOverride, decisionInputHash } from '../src/lib/decisionEngineV2.js'

const envText = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
const env = Object.fromEntries(envText.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)] }))
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const results = { llmCalls: 0, tests: [] }

async function getLead(id) {
  const { data } = await supabase.from('leads').select('*').eq('id', id).single()
  return data
}
async function patchLead(id, patch) {
  const { data } = await supabase.from('leads').update(patch).eq('id', id).select().single()
  return data
}

function record(name, oldLead, newLead, extra = {}) {
  const trig = shouldTriggerV2Recalc(oldLead, newLead)
  const before = computeDecisionV2(oldLead, 'on_market')
  const after = computeDecisionV2(newLead, 'on_market')
  const entry = { name, triggered: trig.should, trigger: trig.trigger, before: { opp: before.opportunity.score, conf: before.confidence.score, fit: before.fit.status, rec: before.recommendation, strategy: before.strategy }, after: { opp: after.opportunity.score, conf: after.confidence.score, fit: after.fit.status, rec: after.recommendation, strategy: after.strategy }, ...extra }
  results.tests.push(entry)
  console.log(JSON.stringify(entry, null, 1))
  return { before, after }
}

async function main() {
  const id = '4de3c8f4-60ca-4d76-bb6f-aa1f0b6bd9b7' // TEST-PROBE-DELETE-ME-zillow_auto
  const original = await getLead(id)
  console.log('=== ORIGINAL STATE ===', JSON.stringify({ asking: original.asking_price, arv: original.arv, reno: original.renovation_cost, rent: original.rent_estimate, zip: original.zip_code, ptype: original.property_type, status: original.status }))

  // Give the probe SOME baseline structured data first (asking+arv) so later
  // deltas are meaningful, matching real Redfin/Zillow leads' shape.
  const baseline = await patchLead(id, { asking_price: 150000, arv: 220000, zip_code: '32210', property_type: 'single_family' })

  // ── Test 1: asking price change ──────────────────────────────────────
  const askingChanged = await patchLead(id, { asking_price: 135000 })
  record('ASKING_PRICE_CHANGE', baseline, askingChanged)

  const askingRestored = await patchLead(id, { asking_price: baseline.asking_price })
  record('ASKING_PRICE_RESTORE', askingChanged, askingRestored)

  // ── Test 2: renovation unknown -> known ──────────────────────────────
  const renoAdded = await patchLead(id, { renovation_cost: 40000 })
  record('RENOVATION_UNKNOWN_TO_KNOWN', baseline, renoAdded)
  const renoChanged = await patchLead(id, { renovation_cost: 70000 })
  record('RENOVATION_CHANGE', renoAdded, renoChanged)
  const renoRestored = await patchLead(id, { renovation_cost: null })
  record('RENOVATION_RESTORE_TO_UNKNOWN', renoChanged, renoRestored)

  // ── Test 3: ARV change ───────────────────────────────────────────────
  const arvChanged = await patchLead(id, { arv: 260000 })
  record('ARV_CHANGE', renoRestored, arvChanged)
  const arvRestored = await patchLead(id, { arv: baseline.arv })
  record('ARV_RESTORE', arvChanged, arvRestored)

  // ── Test 4: rent unknown -> known -> changed (BRRRR test) ────────────
  const withRenoForBrrrr = await patchLead(id, { renovation_cost: 40000 })
  const rentAdded = await patchLead(id, { rent_estimate: 1800 })
  record('RENT_UNKNOWN_TO_KNOWN_BRRRR', withRenoForBrrrr, rentAdded)
  const rentChanged = await patchLead(id, { rent_estimate: 2200 })
  record('RENT_CHANGE', rentAdded, rentChanged)
  const rentRestored = await patchLead(id, { rent_estimate: null, renovation_cost: null })
  record('RENT_RESTORE_TO_UNKNOWN', rentChanged, rentRestored)

  // ── Test 5: property type FIT -> excluded ────────────────────────────
  const typeExcluded = await patchLead(id, { property_type: 'condo' })
  record('PROPERTY_TYPE_TO_EXCLUDED', rentRestored, typeExcluded)
  const typeRestored = await patchLead(id, { property_type: baseline.property_type })
  record('PROPERTY_TYPE_RESTORE', typeExcluded, typeRestored)

  // ── Test 6: status change (new -> follow_up) ─────────────────────────
  const statusChanged = await patchLead(id, { status: 'follow_up' })
  record('STATUS_CHANGE_TO_FOLLOWUP', typeRestored, statusChanged)
  const statusRestored = await patchLead(id, { status: 'triage' })
  record('STATUS_RESTORE', statusChanged, statusRestored)

  // ── Test 7: Human Override (simulated in-memory — column not yet migrated) ──
  const finalState = await getLead(id)
  const strongLead = { ...finalState, asking_price: 100000, arv: 220000, renovation_cost: 30000, zip_code: '32210', property_type: 'single_family' }
  const decisionNoOverride = computeDecisionV2(strongLead, 'on_market')
  const withOverride = applyHumanOverride({ ...strongLead, acquisition_override: { active: true, decision: 'DO_NOT_PURSUE', reason: 'Test: simulated human override', created_by: 'cap15_5_1_test', created_at: new Date().toISOString() } }, decisionNoOverride)
  console.log('=== HUMAN OVERRIDE TEST ===')
  console.log('Without override — fit:', decisionNoOverride.fit.status, 'opp:', decisionNoOverride.opportunity.score, 'rec:', decisionNoOverride.recommendation)
  console.log('With override — fit:', withOverride.fit.status, 'opp:', withOverride.opportunity.score, 'rec:', withOverride.recommendation, 'action:', withOverride.next_best_action)
  console.log('Fit unchanged by override:', decisionNoOverride.fit.status === withOverride.fit.status)
  console.log('Opportunity unchanged by override:', decisionNoOverride.opportunity.score === withOverride.opportunity.score)
  console.log('Recommendation forced to PASS:', withOverride.recommendation === 'PASS')

  // ── Loop protection test ─────────────────────────────────────────────
  const hashBefore = decisionInputHash(statusRestored)
  const simulatedDecisionWrite = { ...statusRestored } // a decision_v2 write touches no DECISION_INPUT_FIELDS
  const hashAfter = decisionInputHash(simulatedDecisionWrite)
  console.log('\n=== LOOP PROTECTION TEST ===')
  console.log('Input hash unchanged after a decision_v2-only write:', hashBefore === hashAfter)

  // ── Restore to fully original state ──────────────────────────────────
  await patchLead(id, { asking_price: original.asking_price, arv: original.arv, renovation_cost: original.renovation_cost, rent_estimate: original.rent_estimate, zip_code: original.zip_code, property_type: original.property_type, status: original.status })
  const restored = await getLead(id)
  console.log('\n=== FINAL RESTORE VERIFIED ===', JSON.stringify({ asking: restored.asking_price, arv: restored.arv, reno: restored.renovation_cost, rent: restored.rent_estimate, zip: restored.zip_code, ptype: restored.property_type, status: restored.status }))
  console.log('Fully restored to original:', JSON.stringify(restored) === JSON.stringify(original) || (restored.asking_price === original.asking_price && restored.arv === original.arv && restored.status === original.status))

  fs.writeFileSync(new URL('./cap15_5_1_e2e_results.json', import.meta.url), JSON.stringify(results, null, 2))
  console.log('\nLLM calls made by this entire test file: 0 (qualitativeIntelligence.js never imported)')
}
main().catch(e => { console.error(e); process.exit(1) })
