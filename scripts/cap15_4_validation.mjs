// scripts/cap15_4_validation.mjs
// Capability #15.4 — large-scale V2 shadow validation + decision quality
// audit. READ-ONLY. No writes. No BatchData calls. No LLM calls.
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import { computeDecisionV2, computeConfidence, computeUrgency, computeStrategy } from '../src/lib/decisionEngineV2.js'
import { derivePriority } from '../src/lib/leadPriority.js'
import { getOpportunityInfo } from '../src/lib/distressInfo.js'

const envText = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
const env = Object.fromEntries(envText.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)] }))
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

async function main() {
  const { data: onMarketAll } = await supabase.from('leads').select('*').not('ai_notes', 'is', null).order('created_at', { ascending: false }).limit(80)
  const { data: offMarketAll } = await supabase.from('leads').select('*').eq('is_distressed', true).order('created_at', { ascending: false }).limit(30)

  const onPicks = onMarketAll.slice(0, 50)
  const offPicks = offMarketAll.slice(0, Math.min(30, offMarketAll.length))

  const rows = []
  for (const lead of onPicks) {
    const v2 = computeDecisionV2(lead, 'on_market')
    const priorityInfo = derivePriority(lead.ai_notes)
    rows.push({ lead, marketType: 'on_market', v2, v1: priorityInfo })
  }
  for (const lead of offPicks) {
    const v2 = computeDecisionV2(lead, 'off_market')
    const opp = getOpportunityInfo(lead)
    rows.push({ lead, marketType: 'off_market', v2, v1: opp })
  }

  // ── Missing-data behavior audit (Sections 3/6/7/8) ─────────────────────
  const renoUnknown = onPicks.filter(l => l.renovation_cost == null)
  const arvUnknown = onPicks.filter(l => l.arv == null)
  const rentUnknown = onPicks.filter(l => l.rent_estimate == null)
  const renoUnknownDetail = renoUnknown.slice(0, 8).map(l => {
    const v2 = computeDecisionV2(l, 'on_market')
    const strategy = computeStrategy(l)
    return {
      address: l.address, asking: l.asking_price, arv: l.arv, reno: l.renovation_cost, rent: l.rent_estimate,
      flipStrength: strategy.flip.strength, flipViable: strategy.flip.viable, flipReason: strategy.flip.reason,
      brrrrStrength: strategy.brrrr.strength, brrrrViable: strategy.brrrr.viable, brrrrReason: strategy.brrrr.reason,
      opportunity: v2.opportunity.score, confidence: v2.confidence.score, recommendation: v2.recommendation, next_action: v2.next_best_action,
    }
  })
  const rentUnknownDetail = rentUnknown.slice(0, 6).map(l => {
    const strategy = computeStrategy(l)
    return { address: l.address, rent: l.rent_estimate, flipViable: strategy.flip.viable, brrrrViable: strategy.brrrr.viable, brrrrReason: strategy.brrrr.reason, best: strategy.best }
  })

  // ── Opportunity distribution + buckets ──────────────────────────────────
  const buckets = { '90-100': 0, '80-89': 0, '70-79': 0, '60-69': 0, '50-59': 0, '40-49': 0, '<40': 0 }
  const oppScores = []
  for (const r of rows) {
    const s = r.v2.opportunity.score
    oppScores.push(s)
    if (s >= 90) buckets['90-100']++
    else if (s >= 80) buckets['80-89']++
    else if (s >= 70) buckets['70-79']++
    else if (s >= 60) buckets['60-69']++
    else if (s >= 50) buckets['50-59']++
    else if (s >= 40) buckets['40-49']++
    else buckets['<40']++
  }
  const avgOpp = Math.round(oppScores.reduce((a, b) => a + b, 0) / oppScores.length)
  const confScores = rows.map(r => r.v2.confidence.score)
  const avgConf = Math.round(confScores.reduce((a, b) => a + b, 0) / confScores.length)

  // ── Urgency distribution ────────────────────────────────────────────────
  const urgencyCounts = { HIGH: 0, MEDIUM: 0, LOW: 0 }
  const highUrgencyLeads = []
  for (const r of rows) {
    urgencyCounts[r.v2.urgency.level]++
    if (r.v2.urgency.level === 'HIGH') highUrgencyLeads.push({ address: r.lead.address, reasons: r.v2.urgency.reasons, marketType: r.marketType })
  }

  // ── Recommendation distribution + guardrail check ──────────────────────
  const recCounts = { ACT_NOW: 0, REVIEW_TODAY: 0, RESEARCH: 0, FOLLOW_UP: 0, MONITOR: 0, PASS: 0 }
  let guardrailFailures = 0
  for (const r of rows) {
    recCounts[r.v2.recommendation] = (recCounts[r.v2.recommendation] || 0) + 1
    if (r.v2.fit.status === 'NOT_FIT' && (r.v2.recommendation === 'ACT_NOW' || r.v2.next_best_action === 'SEND_OFFER')) guardrailFailures++
  }

  // ── Repeatability ────────────────────────────────────────────────────────
  const repeatLead = onPicks[0]
  const rep1 = computeDecisionV2(repeatLead, 'on_market')
  const rep2 = computeDecisionV2(repeatLead, 'on_market')
  const repeatable = JSON.stringify({ ...rep1, calculated_at: null }) === JSON.stringify({ ...rep2, calculated_at: null })

  // ── Score sensitivity test (Section 25) — synthetic, no writes ─────────
  const sensitivityBase = onPicks.find(l => l.arv && l.asking_price) || onPicks[0]
  const sensitivity = []
  for (const reno of [30000, 60000, 90000]) {
    const synthetic = { ...sensitivityBase, renovation_cost: reno }
    const v2 = computeDecisionV2(synthetic, 'on_market')
    sensitivity.push({ variable: 'renovation_cost', value: reno, opportunity: v2.opportunity.score, confidence: v2.confidence.score, recommendation: v2.recommendation, strategy: v2.strategy })
  }
  for (const delta of [0, -10000, -20000]) {
    const synthetic = { ...sensitivityBase, asking_price: (sensitivityBase.asking_price || 150000) + delta }
    const v2 = computeDecisionV2(synthetic, 'on_market')
    sensitivity.push({ variable: 'asking_price_delta', value: delta, opportunity: v2.opportunity.score, confidence: v2.confidence.score, recommendation: v2.recommendation, strategy: v2.strategy })
  }

  console.log('=== CAP 15.4 VALIDATION SUMMARY ===')
  console.log('Sample:', onPicks.length, 'on-market +', offPicks.length, 'off-market =', onPicks.length + offPicks.length)
  console.log('\nReno unknown:', renoUnknown.length, '| ARV unknown:', arvUnknown.length, '| Rent unknown:', rentUnknown.length)
  console.log('\nOpportunity buckets:', JSON.stringify(buckets, null, 2))
  console.log('Avg Opportunity:', avgOpp, '| Avg Confidence:', avgConf)
  console.log('\nUrgency:', JSON.stringify(urgencyCounts, null, 2))
  console.log('\nRecommendations:', JSON.stringify(recCounts, null, 2))
  console.log('Guardrail failures (NOT_FIT -> ACT_NOW/SEND_OFFER):', guardrailFailures)
  console.log('\nRepeatability:', repeatable)

  fs.writeFileSync(new URL('./cap15_4_validation_results.json', import.meta.url), JSON.stringify({
    sampleCounts: { onMarket: onPicks.length, offMarket: offPicks.length, total: onPicks.length + offPicks.length },
    renoUnknownCount: renoUnknown.length, arvUnknownCount: arvUnknown.length, rentUnknownCount: rentUnknown.length,
    renoUnknownDetail, rentUnknownDetail,
    buckets, avgOpp, avgConf, urgencyCounts, highUrgencyLeads, recCounts, guardrailFailures, repeatable, sensitivity,
    rows: rows.map(r => ({
      address: r.lead.address, marketType: r.marketType, status: r.lead.status,
      v1: r.marketType === 'on_market' ? { score: r.v1?.confidence, verdict: r.v1?.verdict, priority: r.v1?.priority } : { score: r.v1?.opportunity_score, priority: r.v1?.opportunity_priority?.key, buyBoxFit: r.v1?.buy_box_fit },
      v2: { fit: r.v2.fit.status, opportunity: r.v2.opportunity.score, confidence: r.v2.confidence.score, urgency: r.v2.urgency.level, recommendation: r.v2.recommendation, next_action: r.v2.next_best_action, strategy: r.v2.strategy, why: r.v2.why, risks: r.v2.risks_missing },
    })),
  }, null, 2))
  console.log('\nWritten to scripts/cap15_4_validation_results.json')
}

main().catch(e => { console.error(e); process.exit(1) })
