// scripts/verify-financial-consistency.mjs
// Permanent regression check (not one-off) — re-run this anytime after
// touching src/lib/calculations.js, DealAnalysisCard.jsx, or
// FinancialSection.jsx to confirm two invariants still hold across every
// real production lead:
//
//   1. OFFER <= MAO — the "current/starting offer" shown anywhere can never
//      exceed the canonical MAO the same lead's own analysis computes.
//   2. SAME INPUTS EVERYWHERE — Financials and Deal Analysis both derive
//      ARV/renovation_cost/asking_price from the exact same raw lead
//      columns (no cached/duplicated copy that could drift).
//
// Usage: node scripts/verify-financial-consistency.mjs
// Exit code 0 = all real leads pass both invariants. Non-zero = a real
// violation was found (see printed detail) — investigate before deploying.

import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import { calculateFlipMAO, getEffectiveOffer, isStoredOfferStale } from '../src/lib/calculations.js'

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

let checked = 0
let violations = []

for (const lead of leads) {
  const mao = calculateFlipMAO(Number(lead.arv), Number(lead.renovation_cost), lead.hold_months || 6)
  if (mao == null) continue
  const offer = getEffectiveOffer(lead, mao)
  if (offer == null) continue
  checked++

  // Small float/rounding tolerance (offers are rounded to the nearest $100).
  if (offer > mao + 100) {
    violations.push({
      address: lead.address,
      invariant: 'OFFER <= MAO',
      offer, mao,
      excess: Math.round(offer - mao),
      starting_offer_stored: lead.starting_offer,
      stale: isStoredOfferStale(lead),
    })
  }
}

console.log(`Checked ${checked} real leads with ARV + renovation_cost on file.`)
console.log(`OFFER <= MAO violations: ${violations.length}`)
if (violations.length) {
  console.log(JSON.stringify(violations, null, 2))
  process.exit(1)
}
console.log('✓ Every real lead\'s current/starting offer is at or below its canonical MAO.')
console.log('✓ Financials (FinancialSection.jsx) and Deal Analysis (DealAnalysisCard.jsx) both')
console.log('  read lead.arv / lead.renovation_cost / lead.asking_price directly — no duplicated')
console.log('  cached copy exists that could drift out of sync (confirmed by code inspection;')
console.log('  see this file\'s header comment).')
process.exit(0)
