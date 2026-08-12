// scripts/cap15_5_1_backfill_decision_v2.mjs
// One-time backfill: compute decision_v2 for every active (non-terminal)
// lead so the newly-activated V2 Action Center has data to read on day
// one, instead of appearing empty for every pre-existing lead. Purely
// additive — writes ONLY decision_v2/decision_v2_updated_at, never
// touches any V1 field. No LLM calls.
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import { computeDecisionV2 } from '../src/lib/decisionEngineV2.js'

const envText = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
const env = Object.fromEntries(envText.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)] }))
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const TERMINAL_STATUSES = ['sold', 'dead_lead', 'rejected_not_accepted', 'sequence_completed']

async function main() {
  const { data: leads, error } = await supabase
    .from('leads')
    .select('*')
    .not('status', 'in', `(${TERMINAL_STATUSES.map(s => `"${s}"`).join(',')})`)
  if (error) throw error

  let written = 0, skipped = 0, failed = 0
  for (const lead of leads) {
    try {
      const marketType = lead.is_distressed ? 'off_market' : 'on_market'
      const decision = computeDecisionV2(lead, marketType, { trigger: 'MANUAL_RECALCULATION' })
      const { error: updErr } = await supabase.from('leads').update({ decision_v2: decision, decision_v2_updated_at: decision.calculated_at }).eq('id', lead.id)
      if (updErr) { failed++; console.warn(lead.address, updErr.message) } else written++
    } catch (err) {
      failed++
      console.warn(lead.address, 'compute failed:', err.message)
    }
  }
  console.log(`Backfill complete: ${written} written, ${skipped} skipped, ${failed} failed (of ${leads.length} active leads)`)
}
main().catch(e => { console.error(e); process.exit(1) })
