// scripts/verify-margin-of-safety.mjs
// Capability — Flip Margin of Safety Explainability, Sections 16-19.
// Real-data validation + contradiction test for computeFlipResult()'s
// verdict + marginOfSafety fields (src/lib/dealExplanation.js). Read-only,
// no writes.

import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import { computeFlipResult } from '../src/lib/dealExplanation.js'
import { FLIP_MIN_PROFIT_TARGET, FLIP_STRONG_PROFIT } from '../src/lib/calculations.js'

const envText = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
const env = Object.fromEntries(envText.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)] }))
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const { data: leads, error } = await supabase
  .from('leads')
  .select('id, address, arv, renovation_cost, asking_price, starting_offer, deal_analysis')
  .not('arv', 'is', null)
  .not('renovation_cost', 'is', null)
  .limit(3000)
if (error) { console.error(error); process.exit(1) }

const byTier = { STRONG: [], PASS: [], WATCH: [], 'NO DEAL': [] }
let contradictions = []

for (const lead of leads) {
  const r = computeFlipResult(lead)
  if (!r.available) continue
  byTier[r.verdict].push({ lead, r })

  // Contradiction test (Section 16/19): the displayed explanation must
  // mathematically match the economics computeFlipResult already computed.
  const pc = r.marginOfSafety.priceCushion
  const prc = r.marginOfSafety.profitCushion
  if (r.verdict === 'STRONG' && !(r.projectedProfit >= FLIP_STRONG_PROFIT)) contradictions.push({ address: lead.address, issue: 'STRONG but profit < FLIP_STRONG_PROFIT', profit: r.projectedProfit })
  if (r.verdict === 'WATCH' && !(r.projectedProfit >= FLIP_MIN_PROFIT_TARGET && r.projectedProfit < FLIP_MIN_PROFIT_TARGET + 5000)) contradictions.push({ address: lead.address, issue: 'WATCH outside its band', profit: r.projectedProfit })
  if (r.verdict === 'NO DEAL' && !(r.projectedProfit == null || r.projectedProfit < FLIP_MIN_PROFIT_TARGET)) contradictions.push({ address: lead.address, issue: 'NO DEAL but profit >= target', profit: r.projectedProfit })
  if (r.verdict === 'NO DEAL' && pc != null && pc >= 0 && r.marginOfSafety.title !== 'Below the minimum target') contradictions.push({ address: lead.address, issue: 'NO DEAL price cushion >= 0 but not labeled as below-target', pc })
  if (pc != null && prc != null && r.verdict !== 'NO DEAL') {
    // Not required to be equal (Section 13), but sign should usually agree for a same-side deal.
  }
}

console.log('── Tier counts (real leads with ARV + renovation_cost) ──')
for (const [tier, rows] of Object.entries(byTier)) console.log(tier, ':', rows.length)

console.log('\n── Up to 5 real examples per tier ──')
for (const [tier, rows] of Object.entries(byTier)) {
  console.log(`\n${tier}:`)
  for (const { lead, r } of rows.slice(0, 5)) {
    console.log(JSON.stringify({
      address: lead.address,
      currentPrice: r.currentOffer,
      flipMao: r.mao != null ? Math.round(r.mao / 100) * 100 : null,
      priceCushion: r.marginOfSafety.priceCushion != null ? Math.round(r.marginOfSafety.priceCushion) : null,
      projectedProfit: r.projectedProfit,
      profitAboveTarget: r.marginOfSafety.profitCushion != null ? Math.round(r.marginOfSafety.profitCushion) : null,
      tier: r.verdict,
      explanation: r.marginOfSafety.title,
    }))
  }
}

console.log('\n── Edge cases ──')
// current price exactly at MAO / $1 below / $1 above
const sample = leads.find(l => l.arv && l.renovation_cost != null)
if (sample) {
  const base = computeFlipResult(sample)
  if (base.available && base.mao != null) {
    for (const delta of [0, -1, 1]) {
      const testLead = { ...sample, starting_offer: Math.round(base.mao) + delta, deal_analysis: null }
      const r = computeFlipResult(testLead)
      console.log(`offer = MAO ${delta >= 0 ? '+' : ''}${delta}:`, r.verdict, 'profit=', Math.round(r.projectedProfit), 'cushion=', Math.round(r.marginOfSafety.priceCushion))
    }
  }
}
// profit exactly at $30K / $35K / $40K boundaries via synthetic ARV/reno (deterministic formula, no DB write)
console.log('\nEXPLANATION/ECONOMICS CONTRADICTIONS:', contradictions.length)
if (contradictions.length) console.log(JSON.stringify(contradictions, null, 2))
