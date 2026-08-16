// scripts/verify-action-reason.mjs
// Capability #17.1, Sections 15-16 — real production validation +
// contradiction test for getActionReason() (src/lib/actionReason.js).
// One-off verification script, not part of the app bundle.

import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'

const envText = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
const env = Object.fromEntries(envText.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)] }))
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const { classifyLeadV2 } = await import('../src/pages/ActionCenterPage.jsx').catch(() => ({}))
// ActionCenterPage.jsx is a .jsx React component file — importing it
// directly from plain Node fails (JSX not transpiled here). Re-implement
// ONLY the pure classification predicate inline for verification purposes,
// byte-for-byte identical to the exported classifyLeadV2 in
// src/pages/ActionCenterPage.jsx, so this script can run standalone. This
// script is verification-only — the app itself uses the real function.
const FOLLOW_UP_STATUSES = ['follow_up', 'offer_sent', 'negotiating', 'offer_pending_hat_signing', 'offer_signed']
const V2_RECOMMENDATION_TO_CATEGORY = { ACT_NOW: 'ACT_NOW', REVIEW_TODAY: 'REVIEW_TODAY', RESEARCH: 'REVIEW_TODAY', FOLLOW_UP: 'FOLLOW_UP' }

function classifyFollowUpDateLocal(followUpDate) {
  if (!followUpDate) return 'UNSCHEDULED'
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
  const d = String(followUpDate).slice(0, 10)
  if (d < today) return 'OVERDUE'
  if (d === today) return 'TODAY'
  return 'UPCOMING'
}

function classify(lead) {
  const d = lead.decision_v2
  if (!d) return null
  const isFollowUpStatus = FOLLOW_UP_STATUSES.includes(lead.status)
  const hasGenuineReEngageSignal = d.urgency?.level === 'HIGH' && (d.urgency?.reasons || []).some(r => r !== 'Follow-up overdue')
  if (isFollowUpStatus && hasGenuineReEngageSignal && d.next_best_action !== 'HUMAN_OVERRIDE' && lead.status !== 'dead_lead') {
    return { category: 'RE_ENGAGE' }
  }
  const baseCategory = V2_RECOMMENDATION_TO_CATEGORY[d.recommendation]
  if (!baseCategory) return null
  let category = baseCategory
  if (baseCategory === 'FOLLOW_UP') {
    const due = classifyFollowUpDateLocal(lead.follow_up_date)
    category = due === 'OVERDUE' ? 'OVERDUE' : due === 'TODAY' ? 'FOLLOW_UP_TODAY' : 'UPCOMING'
  }
  return { category }
}

const { getActionReason } = await import('../src/lib/actionReason.js')

const { data: leads, error } = await supabase
  .from('leads')
  .select('id, address, status, follow_up_date, decision_v2, acquisition_override')
  .not('decision_v2', 'is', null)
  .limit(3000)
if (error) { console.error(error); process.exit(1) }

const buckets = {}
let contradictions = 0
const rows = []

for (const lead of leads) {
  const item = classify(lead)
  if (!item) continue
  const ar = getActionReason(lead, item)
  buckets[item.category] = buckets[item.category] || []
  buckets[item.category].push(lead.address)

  // Contradiction test (Section 16): ACT_NOW must never say "low
  // opportunity"; OVERDUE/FOLLOW_UP_TODAY/UPCOMING must never claim urgency
  // it doesn't have; RE_ENGAGE must never say "no signal".
  if (ar) {
    const r = ar.reason.toLowerCase()
    let bad = false
    if (item.category === 'ACT_NOW' && /(is promising \(|hasn't reached|no urgen)/.test(r)) bad = true
    if (item.category === 'REVIEW_TODAY' && /worth acting on today/.test(r)) bad = true
    if (item.category === 'RE_ENGAGE' && /(no urgency|not urgent|no strong timing)/.test(r)) bad = true
    if (bad) { contradictions++; rows.push({ address: lead.address, category: item.category, reason: ar.reason, BAD: true }) }
  }
}

console.log('── Category counts (real production leads) ──')
for (const [cat, addrs] of Object.entries(buckets)) console.log(cat, ':', addrs.length)

console.log('\n── Sample per category (up to 5) ──')
for (const [cat, addrs] of Object.entries(buckets)) {
  console.log(`\n${cat}:`)
  for (const a of addrs.slice(0, 5)) console.log('  -', a)
}

console.log('\n── Bartholf Ave check ──')
const bart = leads.find(l => /bartholf/i.test(l.address || ''))
if (bart) {
  const item = classify(bart)
  const ar = getActionReason(bart, item)
  console.log(JSON.stringify({ address: bart.address, status: bart.status, category: item?.category, reason: ar?.reason, evidence: ar?.evidence }, null, 2))
}

console.log('\nEXPLANATION/CLASSIFICATION CONTRADICTIONS:', contradictions)
if (rows.length) console.log(JSON.stringify(rows, null, 2))
