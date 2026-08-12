// scripts/cap15_2_shadow.mjs
// Capability #15.2 — larger real-lead V2 shadow validation, using the
// canonical property-decision-data resolver + canonical Buy Box (fixes
// the #15.1 root cause: reading enrichment_data.property_type, a field
// the live pipeline never writes). READ-ONLY. No writes. No BatchData calls.
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import { computeDecisionV2 } from '../src/lib/decisionEngineV2.js'
import { getPropertyDecisionData, mergePropertyFields } from '../src/lib/propertyDecisionData.js'

const envText = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
const env = Object.fromEntries(envText.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)] }))
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

async function main() {
  const { data: onMarket, error: onErr } = await supabase
    .from('leads').select('*')
    .not('ai_notes', 'is', null)
    .order('created_at', { ascending: false })
    .limit(80)
  if (onErr) throw onErr

  const { data: offMarket, error: offErr } = await supabase
    .from('leads').select('*')
    .eq('is_distressed', true)
    .order('created_at', { ascending: false })
    .limit(30)
  if (offErr) throw offErr

  const onPicks = onMarket.slice(0, 50)
  const offPicks = offMarket.slice(0, Math.min(30, offMarket.length)) // fewer than 50 exist — use max available, per mission's own allowance

  const results = []
  const buyBoxConflicts = { total: 0, legacyNotFit: 0, agree: 0, disagree: 0, causes: {} }
  const decisionCounts = { FIT: 0, POSSIBLE_FIT: 0, NOT_FIT: 0, INSUFFICIENT_DATA: 0, ACT_NOW: 0, REVIEW_TODAY: 0, RESEARCH: 0, FOLLOW_UP: 0, MONITOR: 0, PASS: 0 }

  for (const lead of [...onPicks.map(l => ({ l, mt: 'on_market' })), ...offPicks.map(l => ({ l, mt: 'off_market' }))]) {
    const { l: lead2, mt: marketType } = lead
    const v2 = computeDecisionV2(lead2, marketType, { trigger: 'MANUAL_RECALCULATION' })
    decisionCounts[v2.fit.status] = (decisionCounts[v2.fit.status] || 0) + 1
    decisionCounts[v2.recommendation] = (decisionCounts[v2.recommendation] || 0) + 1

    if (v2.legacy_ingestion_buy_box_status) {
      buyBoxConflicts.total++
      buyBoxConflicts.legacyNotFit++
      if (v2.buy_box_conflict) {
        buyBoxConflicts.disagree++
        const cause = v2.buy_box_conflict_reason?.includes('missing data') ? 'MISSING_DATA_AT_INGESTION_TIME'
          : v2.buy_box_conflict_reason?.includes('stale') ? 'STALE_INGESTION_OR_DATA_DRIFT'
          : 'OTHER'
        buyBoxConflicts.causes[cause] = (buyBoxConflicts.causes[cause] || 0) + 1
      } else {
        buyBoxConflicts.agree++
      }
    }

    results.push({
      address: lead2.address, marketType, status: lead2.status,
      fit: v2.fit.status, legacy: v2.legacy_ingestion_buy_box_status, conflict: v2.buy_box_conflict,
      opportunity: v2.opportunity.score, confidence: v2.confidence.score, urgency: v2.urgency.level,
      recommendation: v2.recommendation, next_action: v2.next_best_action, strategy: v2.strategy,
      data_conflicts: v2.data_conflicts,
    })
  }

  // ── Repeatability check (Section 22) — run one real lead twice ─────────
  const repeatTarget = onPicks[0]
  const run1 = computeDecisionV2(repeatTarget, 'on_market')
  const run2 = computeDecisionV2(repeatTarget, 'on_market')
  const repeatable = JSON.stringify({ ...run1, calculated_at: null }) === JSON.stringify({ ...run2, calculated_at: null })

  // ── Known-data preservation check (Section 23) — simulate a null-property_type
  // re-enrichment against a lead that has a known property_type, verify merge
  // semantics protect it. No live BatchData call — synthetic incoming payload only. ──
  const knownTypeLead = onPicks.find(l => l.property_type) || { property_type: 'single_family' }
  const { merged, conflicts: mergeConflicts } = mergePropertyFields(
    { property_type: knownTypeLead.property_type, bedrooms: knownTypeLead.bedrooms },
    { property_type: null, bedrooms: null }, // simulates a failed re-enrichment returning nulls
    { source: 'batchdata_resimulated' }
  )
  const preservationPass = merged.property_type === knownTypeLead.property_type

  console.log('=== CAP 15.2 SHADOW SUMMARY ===')
  console.log('On-market:', onPicks.length, '| Off-market:', offPicks.length, '| Total:', onPicks.length + offPicks.length)
  console.log('Buy Box conflict audit:', JSON.stringify(buyBoxConflicts, null, 2))
  console.log('Decision counts:', JSON.stringify(decisionCounts, null, 2))
  console.log('Repeatability PASS:', repeatable)
  console.log('Known-data preservation PASS:', preservationPass, '(merge conflicts recorded:', mergeConflicts.length, ')')

  fs.writeFileSync(new URL('./cap15_2_shadow_results.json', import.meta.url), JSON.stringify({
    counts: { onMarket: onPicks.length, offMarket: offPicks.length, total: onPicks.length + offPicks.length },
    buyBoxConflicts, decisionCounts, repeatable, preservationPass, mergeConflicts, results,
  }, null, 2))
  console.log('\nWritten to scripts/cap15_2_shadow_results.json')
}

main().catch(e => { console.error(e); process.exit(1) })
