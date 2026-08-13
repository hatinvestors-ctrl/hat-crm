// scripts/cap19_1_validate.mjs — Capability #19.1 real-lead validation (read-only).
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import { calculateFlipMAO, calculateBrrrrMAO, computeFlipBreakdown, computeBrrrrBreakdown, FLIP_MIN_PROFIT_TARGET, BRRRR_MAX_CASH_LEFT_IN } from '../src/lib/calculations.js'

const envText = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
const env = Object.fromEntries(envText.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)] }))
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

async function main() {
  const wsId = 'd854b1e3-b174-45f7-b11d-1b92d8e7b87d'
  const { data: leads } = await supabase.from('leads').select('id,address,arv,renovation_cost,rent_estimate,asking_price,mao')
    .eq('workspace_id', wsId).not('arv', 'is', null).limit(80)

  console.log('=== FLIP MAO — 5+ real leads ===')
  let flipTested = 0
  for (const l of leads) {
    if (l.renovation_cost == null) continue
    const arv = Number(l.arv), reno = Number(l.renovation_cost), hold = 6
    const oldMao = arv * 0.75 - reno - 2450
    const flipMao = calculateFlipMAO(arv, reno, hold)
    const profitAtFlipMao = computeFlipBreakdown(flipMao, arv, reno, hold).totalProfit
    console.log(`${l.address} | ASK ${l.asking_price ?? '—'} | ARV ${arv} | REHAB ${reno} | OLD_MAO ${Math.round(oldMao)} | FLIP_MAO ${Math.round(flipMao)} | PROFIT@FLIP_MAO ${Math.round(profitAtFlipMao)} (target ${FLIP_MIN_PROFIT_TARGET})`)
    flipTested++
    if (flipTested >= 8) break
  }

  console.log('\n=== BRRRR MAO — 5+ real leads ===')
  let brrrrTested = 0
  for (const l of leads) {
    if (l.renovation_cost == null) continue
    const arv = Number(l.arv), reno = Number(l.renovation_cost), hold = 6
    const rent = l.rent_estimate != null ? Number(l.rent_estimate) : null
    const result = calculateBrrrrMAO(arv, reno, rent, hold)
    if (result.mao == null) {
      console.log(`${l.address} | RENT ${rent ?? 'MISSING'} | BRRRR_MAO NOT READY — ${result.reason}`)
    } else {
      console.log(`${l.address} | ARV ${arv} | REHAB ${reno} | RENT ${rent} | BRRRR_MAO ${Math.round(result.mao)} | LIMITING ${result.limitingFactor} | CashLeftIn@MAO ${result.cashLeftInAtMao} (<${BRRRR_MAX_CASH_LEFT_IN}? ${result.cashLeftInAtMao < BRRRR_MAX_CASH_LEFT_IN}) | CashFlow@MAO ${result.cashFlowAtMao} (>0? ${result.cashFlowAtMao > 0})`)
    }
    brrrrTested++
    if (brrrrTested >= 8) break
  }

  console.log('\n=== SENSITIVITY — 3 real properties ===')
  const sens = leads.filter(l => l.renovation_cost != null).slice(0, 3)
  for (const l of sens) {
    const arv = Number(l.arv), reno = Number(l.renovation_cost), hold = 6
    const mao30 = calculateFlipMAO(arv, reno, hold, 30000)
    const mao40 = calculateFlipMAO(arv, reno, hold, 40000)
    console.log(`FLIP ${l.address}: target 30K -> MAO ${Math.round(mao30)} | target 40K -> MAO ${Math.round(mao40)} (lower? ${mao40 < mao30})`)
    const rent = l.rent_estimate != null ? Number(l.rent_estimate) : null
    if (rent) {
      const b30 = calculateBrrrrMAO(arv, reno, rent, hold, 30000)
      const b20 = calculateBrrrrMAO(arv, reno, rent, hold, 20000)
      console.log(`BRRRR ${l.address}: maxCashLeftIn 30K -> MAO ${b30.mao != null ? Math.round(b30.mao) : 'N/A'} | maxCashLeftIn 20K -> MAO ${b20.mao != null ? Math.round(b20.mao) : 'N/A'} (lower/equal? ${b20.mao != null && b30.mao != null ? b20.mao <= b30.mao : 'n/a'})`)
    } else {
      console.log(`BRRRR ${l.address}: no rent estimate — sensitivity skipped (NOT READY, correctly)`)
    }
  }
}
main().catch(e => { console.error(e); process.exit(1) })
