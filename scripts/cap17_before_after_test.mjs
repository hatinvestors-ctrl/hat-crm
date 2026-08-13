// scripts/cap17_before_after_test.mjs
// Capability #17, Section 16 — real before/after Action Center counts
// against the actual production leads table. Read-only (no writes).
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'

const envText = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8')
const env = Object.fromEntries(envText.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)] }))
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const TERMINAL_STATUSES = ['sold', 'flip_sold', 'dead_lead', 'rejected_not_accepted', 'not_in_buy_box', 'sequence_completed']
const FOLLOW_UP_STATUSES = ['follow_up', 'offer_sent', 'negotiating', 'offer_pending_hat_signing', 'offer_signed']

function isToday(iso) {
  if (!iso) return false
  return new Date(iso).toDateString() === new Date().toDateString()
}
function todayStr() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
}
function classifyFollowUpDate(d) {
  if (!d) return 'UNSCHEDULED'
  const today = todayStr()
  const s = String(d).slice(0, 10)
  if (s < today) return 'OVERDUE'
  if (s === today) return 'TODAY'
  return 'UPCOMING'
}

const V2_RECOMMENDATION_TO_CATEGORY = {
  BUY_NOW: 'ACT_NOW', MAKE_OFFER: 'ACT_NOW', FOLLOW_UP: 'FOLLOW_UP', MONITOR: 'REVIEW_TODAY', PASS: null,
}

async function main() {
  const { data: leads } = await supabase
    .from('leads')
    .select('id, address, status, follow_up_date, updated_at, decision_v2')
    .not('status', 'in', `(${TERMINAL_STATUSES.map(s => `"${s}"`).join(',')})`)

  console.log(`Total active leads scanned: ${leads.length}`)

  // ── BEFORE (pre-#17 logic): FOLLOW_UP status leads all bucket together
  // as "Follow Up" the instant updated_at isn't today — no OVERDUE/TODAY/
  // UPCOMING split at all. ──────────────────────────────────────────────
  let beforeTotalCards = 0
  let beforeFollowUpCards = 0
  let beforeFutureShownAsToday = 0
  for (const lead of leads) {
    const d = lead.decision_v2
    if (!d) continue
    const isFollowUpStatus = FOLLOW_UP_STATUSES.includes(lead.status)
    if (isFollowUpStatus) {
      if (isToday(lead.updated_at)) continue
      beforeTotalCards++
      beforeFollowUpCards++
      if (classifyFollowUpDate(lead.follow_up_date) === 'UPCOMING') beforeFutureShownAsToday++
      continue
    }
    const cat = V2_RECOMMENDATION_TO_CATEGORY[d.recommendation]
    if (cat) beforeTotalCards++
  }

  // ── AFTER (#17 logic): OVERDUE/RE_ENGAGE/ACT_NOW/FOLLOW_UP_TODAY/
  // REVIEW_TODAY split, UPCOMING suppressed from Today. ─────────────────
  let afterToday = 0, afterOverdue = 0, afterFollowUpToday = 0, afterReEngage = 0, afterUpcoming = 0, afterSuppressedFuture = 0
  for (const lead of leads) {
    const d = lead.decision_v2
    if (!d) continue
    const isFollowUpStatus = FOLLOW_UP_STATUSES.includes(lead.status)

    const hasGenuineReEngageSignal = d.urgency?.level === 'HIGH' && (d.urgency?.reasons || []).some(r => r !== 'Follow-up overdue')
    if (isFollowUpStatus && hasGenuineReEngageSignal && d.next_best_action !== 'HUMAN_OVERRIDE' && lead.status !== 'dead_lead') {
      afterReEngage++; afterToday++
      continue
    }

    const base = V2_RECOMMENDATION_TO_CATEGORY[d.recommendation]
    if (!base) continue
    if (base === 'FOLLOW_UP') {
      const due = classifyFollowUpDate(lead.follow_up_date)
      if (due === 'OVERDUE') { afterOverdue++; afterToday++ }
      else if (due === 'TODAY') { afterFollowUpToday++; afterToday++ }
      else { afterUpcoming++; afterSuppressedFuture++ }
      continue
    }
    afterToday++
  }

  console.log('\n=== BEFORE (pre-#17) ===')
  console.log('Total Action Center cards:', beforeTotalCards)
  console.log('FOLLOW_UP cards shown (undifferentiated):', beforeFollowUpCards)
  console.log('Future follow-ups incorrectly shown as today\'s work:', beforeFutureShownAsToday)

  console.log('\n=== AFTER (#17) ===')
  console.log('Today Actions:', afterToday)
  console.log('  Overdue:', afterOverdue)
  console.log('  Follow Up Today:', afterFollowUpToday)
  console.log('  Re-Engage:', afterReEngage)
  console.log('Upcoming (suppressed from Today):', afterUpcoming)
  console.log('Suppressed future follow-ups:', afterSuppressedFuture)

  fs.writeFileSync(new URL('./cap17_before_after_results.json', import.meta.url), JSON.stringify({
    before: { totalCards: beforeTotalCards, followUpCards: beforeFollowUpCards, futureShownAsToday: beforeFutureShownAsToday },
    after: { today: afterToday, overdue: afterOverdue, followUpToday: afterFollowUpToday, reEngage: afterReEngage, upcoming: afterUpcoming, suppressedFuture: afterSuppressedFuture },
  }, null, 2))
}
main().catch(e => { console.error(e); process.exit(1) })
