// scripts/cap15_5_qualitative_demo.mjs
// Capability #15.5 — live demonstration of the Qualitative Intelligence
// layer against the exact real example named in the mission (1735 Ribault
// Scenic Dr). ONE real LLM call, not a batch run (Section 9 — do not call
// the LLM every time / across every lead). Read-only, no writes.
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import { computeDecisionV2 } from '../src/lib/decisionEngineV2.js'
import { applyQualitativeSignals } from '../src/lib/decisionEngineV2.js'
import { analyzeQualitativeSignals, getQualitativeCacheKey } from '../src/lib/qualitativeIntelligence.js'

const envText = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
const env = Object.fromEntries(envText.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)] }))
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

async function main() {
  const { data } = await supabase.from('leads').select('*').ilike('address', '%Ribault Scenic%')
  const lead = data[0]
  if (!lead) throw new Error('Lead not found')

  const v2Before = computeDecisionV2(lead, 'on_market')
  console.log('=== V2 DETERMINISTIC ONLY (before qualitative) ===')
  console.log(JSON.stringify({ opportunity: v2Before.opportunity.score, confidence: v2Before.confidence.score, recommendation: v2Before.recommendation, next_action: v2Before.next_best_action, why: v2Before.why, risks: v2Before.risks_missing }, null, 1))

  const cacheKey = getQualitativeCacheKey(lead)
  console.log('\nCache key (would skip LLM call if unchanged since last analysis):', cacheKey)

  const qualitative = await analyzeQualitativeSignals(lead, { apiKey: env.ANTHROPIC_API_KEY })
  console.log('\n=== QUALITATIVE AI OUTPUT ===')
  console.log(JSON.stringify(qualitative, null, 1))

  const v2After = applyQualitativeSignals(v2Before, qualitative)
  console.log('\n=== V2 AFTER QUALITATIVE SIGNALS APPLIED ===')
  console.log(JSON.stringify({ opportunity: v2After.opportunity.score, confidence: v2After.confidence.score, recommendation: v2After.recommendation, next_action: v2After.next_best_action, why: v2After.why, risks: v2After.risks_missing }, null, 1))

  console.log('\n=== GUARDRAIL CHECK ===')
  console.log('Opportunity unchanged by qualitative layer:', v2Before.opportunity.score === v2After.opportunity.score)
  console.log('Fit unchanged by qualitative layer:', v2Before.fit.status === v2After.fit.status)
}
main().catch(e => { console.error(e); process.exit(1) })
