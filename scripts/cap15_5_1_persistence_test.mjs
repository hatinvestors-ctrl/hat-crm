// scripts/cap15_5_1_persistence_test.mjs
// Post-migration real persistence verification. Uses the safe
// TEST-PROBE-DELETE-ME-zillow_auto lead + a throwaway inserted lead for
// the creation test. All changes restored/cleaned up at the end.
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import { recalculateDecisionV2, maybeRecalculateDecisionV2 } from '../src/lib/decisionV2Persistence.js'
import { applyHumanOverride } from '../src/lib/decisionEngineV2.js'

const envText = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
const env = Object.fromEntries(envText.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)] }))
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const PROBE_ID = '4de3c8f4-60ca-4d76-bb6f-aa1f0b6bd9b7'

async function getLead(id) { const { data } = await supabase.from('leads').select('*').eq('id', id).single(); return data }
async function patch(id, p) { const { data } = await supabase.from('leads').update(p).eq('id', id).select().single(); return data }

const results = {}

async function main() {
  const original = await getLead(PROBE_ID)

  // ── 1. Lead creation ────────────────────────────────────────────────
  const { data: newLead } = await supabase.from('leads').insert({
    workspace_id: original.workspace_id, address: 'TEST-PROBE-2-DELETE-ME', city: 'Jacksonville', state: 'FL',
    lead_source: 'other', status: 'triage', asking_price: 120000, arv: 200000, zip_code: '32210', property_type: 'single_family',
  }).select().single()
  await recalculateDecisionV2(supabase, newLead, 'NEW_LEAD')
  const afterCreate = await getLead(newLead.id)
  results.creation = { written: !!afterCreate.decision_v2, updated_at: afterCreate.decision_v2_updated_at, opp: afterCreate.decision_v2?.opportunity?.score, fit: afterCreate.decision_v2?.fit?.status }
  await supabase.from('leads').delete().eq('id', newLead.id) // cleanup

  // ── Baseline on probe lead ──────────────────────────────────────────
  let lead = await patch(PROBE_ID, { asking_price: 150000, arv: 220000, zip_code: '32210', property_type: 'single_family' })
  await recalculateDecisionV2(supabase, lead, 'MANUAL_RECALCULATION')
  const baselineStored = await getLead(PROBE_ID)
  const t0 = baselineStored.decision_v2_updated_at

  async function fieldTest(name, patchObj) {
    const before = await getLead(PROBE_ID)
    const updated = await patch(PROBE_ID, patchObj)
    await maybeRecalculateDecisionV2(supabase, before, updated)
    const after = await getLead(PROBE_ID)
    results[name] = {
      written: !!after.decision_v2,
      updated_at_changed: after.decision_v2_updated_at !== before.decision_v2_updated_at,
      opp: after.decision_v2?.opportunity?.score, conf: after.decision_v2?.confidence?.score, fit: after.decision_v2?.fit?.status,
      rec: after.decision_v2?.recommendation, strategy: after.decision_v2?.strategy,
    }
    return after
  }

  await fieldTest('asking_price_update', { asking_price: 135000 })
  await fieldTest('arv_update', { arv: 250000 })
  await fieldTest('renovation_update', { renovation_cost: 40000 })
  await fieldTest('rent_update', { rent_estimate: 1900 })
  await fieldTest('zip_property_type_update', { property_type: 'condo' })
  await patch(PROBE_ID, { property_type: 'single_family' }) // restore fit before status test
  await recalculateDecisionV2(supabase, await getLead(PROBE_ID), 'PROPERTY_DATA_UPDATE')
  await fieldTest('status_update', { status: 'follow_up' })

  // ── BatchData/distress-style update (simulated field change) ────────
  await fieldTest('distress_update_simulated', { status: 'triage' })

  // ── Human Override persistence ───────────────────────────────────────
  const preOverride = await getLead(PROBE_ID)
  const decisionBefore = preOverride.decision_v2
  await patch(PROBE_ID, { acquisition_override: { active: true, decision: 'DO_NOT_PURSUE', reason: 'Persistence test', created_by: 'cap15_5_1_verify', created_at: new Date().toISOString() } })
  const withOverrideLead = await getLead(PROBE_ID)
  const decisionWithOverride = applyHumanOverride(withOverrideLead, decisionBefore)
  await supabase.from('leads').update({ decision_v2: decisionWithOverride, decision_v2_updated_at: new Date().toISOString() }).eq('id', PROBE_ID)
  const afterOverrideWrite = await getLead(PROBE_ID)
  results.human_override_apply = {
    fit_unchanged: afterOverrideWrite.decision_v2.fit.status === decisionBefore.fit.status,
    opp_unchanged: afterOverrideWrite.decision_v2.opportunity.score === decisionBefore.opportunity.score,
    recommendation_is_pass: afterOverrideWrite.decision_v2.recommendation === 'PASS',
    next_action: afterOverrideWrite.decision_v2.next_best_action,
  }

  // Remove override
  await patch(PROBE_ID, { acquisition_override: null })
  const afterRemoveLead = await getLead(PROBE_ID)
  await recalculateDecisionV2(supabase, afterRemoveLead, 'MANUAL_RECALCULATION')
  const afterRemoveDecision = await getLead(PROBE_ID)
  results.human_override_remove = {
    recommendation_restored: afterRemoveDecision.decision_v2.recommendation !== 'PASS' || decisionBefore.recommendation === 'PASS',
    recommendation: afterRemoveDecision.decision_v2.recommendation,
    matches_pre_override: afterRemoveDecision.decision_v2.recommendation === decisionBefore.recommendation,
  }

  // ── Cleanup: fully restore probe lead ────────────────────────────────
  await supabase.from('leads').update({
    asking_price: original.asking_price, arv: original.arv, renovation_cost: original.renovation_cost, rent_estimate: original.rent_estimate,
    zip_code: original.zip_code, property_type: original.property_type, status: original.status,
    acquisition_override: null, decision_v2: null, decision_v2_updated_at: null,
  }).eq('id', PROBE_ID)
  const finalCheck = await getLead(PROBE_ID)
  results.cleanup_verified = finalCheck.asking_price === original.asking_price && finalCheck.decision_v2 === null

  console.log(JSON.stringify(results, null, 2))
  fs.writeFileSync(new URL('./cap15_5_1_persistence_results.json', import.meta.url), JSON.stringify(results, null, 2))
}
main().catch(e => { console.error(e); process.exit(1) })
