// scripts/cap15_1_shadow.mjs
// Capability #15.1 — Decision Engine V2 SHADOW MODE comparison. READ-ONLY:
// pulls real leads, computes V2 via src/lib/decisionEngineV2.js, parses the
// existing V1 decision from stored data (same parsers V1 itself uses —
// leadPriority.js / distressInfo.js), and reports agreement/disagreement.
// No writes. No BatchData calls. No production behavior changed.
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import { computeDecisionV2 } from '../src/lib/decisionEngineV2.js'
import { derivePriority, PRIORITY_DISPLAY } from '../src/lib/leadPriority.js'
import { getDistressInfo, getOpportunityInfo } from '../src/lib/distressInfo.js'

const envText = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
const env = Object.fromEntries(envText.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)] }))
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

function classifyDisagreement(v1, v2) {
  const v1ActNow = v1.priority === 'HOT' || v1.priority === 'HIGH_PRIORITY'
  const v2ActNow = v2.recommendation === 'ACT_NOW'
  if (v1ActNow && v2.fit.status === 'NOT_FIT') return 'V2_CORRECTS_FALSE_POSITIVE'
  if (!v1ActNow && v2ActNow && v2.fit.status !== 'NOT_FIT' && v2.opportunity.score >= 65) return 'V2_CORRECTS_FALSE_NEGATIVE'
  if (v1.priority === v2.recommendation) return 'NO_MEANINGFUL_CHANGE'
  if (v2.confidence.score < 55 && (v1ActNow === v2ActNow)) return 'V2_IMPROVES_CONFIDENCE'
  return 'V2_IMPROVES_ACTION'
}

async function main() {
  const { data: onMarket, error: onErr } = await supabase
    .from('leads')
    .select('id,address,zip_code,property_type,bedrooms,bathrooms,sqft,lead_source,status,asking_price,arv,renovation_cost,mao,rent_estimate,list_price,days_on_market,notes,ai_notes,deal_analysis,follow_up_date,created_at')
    .not('ai_notes', 'is', null)
    .order('created_at', { ascending: false })
    .limit(80)
  if (onErr) throw onErr

  const { data: offMarket, error: offErr } = await supabase
    .from('leads')
    .select('id,address,zip_code,status,owner_name,notes,distress_data,is_distressed,enrichment_data,phone,email,created_at')
    .eq('is_distressed', true)
    .order('created_at', { ascending: false })
    .limit(30)
  if (offErr) throw offErr

  // Balanced 20-lead on-market sample: spread across score bands + not_in_buy_box representation.
  const onParsed = onMarket
    .map(l => ({ lead: l, priorityInfo: derivePriority(l.ai_notes) }))
    .filter(x => x.priorityInfo?.confidence != null)
  onParsed.sort((a, b) => b.priorityInfo.confidence - a.priorityInfo.confidence)
  const onPicks = []
  const step = Math.max(1, Math.floor(onParsed.length / 20))
  for (let i = 0; i < onParsed.length && onPicks.length < 20; i += step) onPicks.push(onParsed[i])

  const offPicks = offMarket.slice(0, 20)

  const results = []

  for (const { lead, priorityInfo } of onPicks) {
    const v2 = computeDecisionV2(lead, 'on_market')
    const v1 = {
      score: priorityInfo.confidence,
      verdict: priorityInfo.verdict,
      priority: priorityInfo.priority,
      priorityDisplay: PRIORITY_DISPLAY[priorityInfo.priority] || priorityInfo.priority,
      nextAction: priorityInfo.nextAction,
    }
    const disagreementType = v1.priorityDisplay === v2.recommendation.replace('_', ' ') || (v1.priority === 'HOT' && v2.recommendation === 'ACT_NOW') || (v1.priority === 'IGNORE' && v2.recommendation === 'PASS')
      ? 'NO_MEANINGFUL_CHANGE'
      : classifyDisagreement(v1, v2)
    results.push({
      address: lead.address, source: lead.lead_source, marketType: 'ON_MARKET', status: lead.status,
      v1, v2, disagreementType,
      agree: disagreementType === 'NO_MEANINGFUL_CHANGE',
    })
  }

  for (const lead of offPicks) {
    const v2 = computeDecisionV2(lead, 'off_market')
    const dd = getDistressInfo(lead) || {}
    const opp = getOpportunityInfo(lead)
    const v1 = {
      score: opp?.opportunity_score ?? null,
      priority: opp?.opportunity_priority?.key ?? null,
      priorityDisplay: opp?.opportunity_priority?.label ?? 'UNSCORED',
      buyBoxFit: opp?.buy_box_fit ?? null,
      nextAction: null,
    }
    const disagreementType = classifyDisagreement({ priority: v1.priority }, v2)
    results.push({
      address: lead.address, source: dd.distress_source || 'unknown', marketType: 'OFF_MARKET', status: lead.status,
      v1, v2, disagreementType,
      agree: disagreementType === 'NO_MEANINGFUL_CHANGE',
    })
  }

  const counts = {}
  for (const r of results) counts[r.disagreementType] = (counts[r.disagreementType] || 0) + 1

  console.log('=== SHADOW SUMMARY ===')
  console.log('On-market sampled:', onPicks.length, '| Off-market sampled:', offPicks.length)
  console.log('Agree:', results.filter(r => r.agree).length, '| Disagree:', results.filter(r => !r.agree).length)
  console.log(JSON.stringify(counts, null, 2))

  fs.writeFileSync(new URL('./cap15_1_shadow_results.json', import.meta.url), JSON.stringify({ counts, results }, null, 2))
  console.log('\nWritten to scripts/cap15_1_shadow_results.json')
}

main().catch(e => { console.error(e); process.exit(1) })
