// scripts/cap18_validate.mjs
// Capability #18, Section 18 — real data validation. Loads the SAME
// tables the dashboard loads (leads/lead_activities/deal_financials, All
// Time range, single workspace) and runs the exact acquisitionMetrics.js
// functions the UI uses, then cross-checks canonical counts against
// direct, independent DB queries.
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import {
  indexActivitiesByLead, classifyLeadFunnel, computeFunnel, computeSideBuckets,
  computeSourcePerformance, computeFollowUpPerformance, computeDataQuality,
} from '../src/lib/acquisitionMetrics.js'

const envText = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
const env = Object.fromEntries(envText.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)] }))
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

async function main() {
  const { data: allWs } = await supabase.from('workspaces').select('id, name')
  const wsCounts = await Promise.all(allWs.map(async w => ({ ...w, n: (await supabase.from('leads').select('id', { count: 'exact', head: true }).eq('workspace_id', w.id)).count })))
  const workspaces = [wsCounts.sort((a, b) => b.n - a.n)[0]]
  const workspaceId = workspaces[0].id
  console.log('Workspace:', workspaces[0].name, workspaceId)

  const { data: leads } = await supabase
    .from('leads')
    .select('id, address, status, lead_source, created_at, decision_v2, offer_price, asking_price, mao, contract_signed_date, follow_up_date, deal_analysis')
    .eq('workspace_id', workspaceId)
  const leadIds = leads.map(l => l.id)
  const { data: activities } = await supabase.from('lead_activities').select('lead_id, type, metadata, created_at').in('lead_id', leadIds)
  const { data: dealFinancials } = await supabase.from('deal_financials').select('lead_id, purchase_date, sold_date, actual_sale_price, purchase_price_actual').eq('workspace_id', workspaceId)

  const activitiesByLead = indexActivitiesByLead(activities)
  const dfByLead = new Map(dealFinancials.map(df => [df.lead_id, df]))
  const facts = leads.map(l => classifyLeadFunnel(l, activitiesByLead, dfByLead))

  const funnel = computeFunnel(facts)
  const sideBuckets = computeSideBuckets(facts)
  const sourcePerf = computeSourcePerformance(facts)
  const followUp = computeFollowUpPerformance(facts)
  const dataQuality = computeDataQuality(facts)

  console.log('\n=== DASHBOARD-COMPUTED (All Time) ===')
  for (const s of funnel) console.log(`${s.label}: ${s.count}`)
  console.log('Dead:', sideBuckets.dead, '| Lost:', sideBuckets.lost, '| Not Fit:', sideBuckets.notFit, '| Pass:', sideBuckets.pass)
  console.log('Follow-ups scheduled:', followUp.scheduled, '| overdue:', followUp.overdue, '| re-engage opportunities:', followUp.reEngageOpportunities)
  console.log('Sources:', sourcePerf.map(s => `${s.source}=${s.leads}`).join(', '))

  console.log('\n=== DIRECT DB CROSS-CHECK ===')
  const { count: leadCount } = await supabase.from('leads').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId)
  console.log('Leads Received (direct count):', leadCount, leadCount === funnel[0].count ? 'MATCH' : 'MISMATCH')

  const { count: deadCount } = await supabase.from('leads').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('status', 'dead_lead')
  console.log('Dead Leads (direct count):', deadCount, deadCount === sideBuckets.dead ? 'MATCH' : 'MISMATCH')

  const { count: fudCount } = await supabase.from('leads').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).not('follow_up_date', 'is', null)
  console.log('Leads with follow_up_date set (direct count):', fudCount, fudCount === followUp.scheduled ? 'MATCH' : 'MISMATCH')

  const { count: offerCount } = await supabase.from('leads').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).not('offer_price', 'is', null)
  console.log('Leads with offer_price set (direct count):', offerCount, '| funnel Offers Sent (evidence-based, includes status history):', funnel[5].count)

  const { count: contractCount } = await supabase.from('leads').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).not('contract_signed_date', 'is', null)
  console.log('Leads with contract_signed_date set (direct count):', contractCount, '| funnel Under Contract (evidence-based):', funnel[7].count)

  const bySourceDirect = {}
  for (const l of leads) { const s = l.lead_source || 'null'; bySourceDirect[s] = (bySourceDirect[s] || 0) + 1 }
  console.log('Sources (direct tally):', JSON.stringify(bySourceDirect))

  console.log('\nData quality coverage:', (dataQuality.coveragePct * 100).toFixed(1) + '%')
}
main().catch(e => { console.error(e); process.exit(1) })
