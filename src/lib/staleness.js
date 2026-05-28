// Action-needed rules for the Today view.
// Thresholds (`days`) and enabled state are configurable per-workspace
// via Settings → Action Triggers. Defaults live here.

const MS_PER_DAY = 24 * 60 * 60 * 1000

function daysSince(iso) {
  if (!iso) return Infinity
  return Math.floor((Date.now() - new Date(iso).getTime()) / MS_PER_DAY)
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

// Each bucket has:
//   id, label, description, tone, priority
//   configurable: boolean — true means it has a `days` threshold the user can change
//   defaultDays  — fallback if no setting is saved
//   matcher(lead, days) — boolean
//   action(lead, days) — string shown next to the lead
export const BUCKETS = [
  // Date-based rules — not configurable (they depend on actual dates, not idle time)
  {
    id: 'overdue_follow_up',
    label: 'Overdue Follow-Up',
    description: 'Follow-up date has passed and the lead is still untouched.',
    tone: 'danger',
    priority: 1,
    configurable: false,
    matcher: (l) => l.status === 'follow_up'
      && l.follow_up_date && l.follow_up_date < todayISO(),
    action: (l) => {
      const d = Math.max(1, Math.floor((Date.now() - new Date(l.follow_up_date).getTime()) / MS_PER_DAY))
      return `${d} day${d === 1 ? '' : 's'} overdue — follow up now`
    },
  },
  {
    id: 'follow_up_today',
    label: 'Follow-Up Today',
    description: 'Scheduled follow-ups due today.',
    tone: 'warn',
    priority: 2,
    configurable: false,
    matcher: (l) => l.status === 'follow_up' && l.follow_up_date === todayISO(),
    action: () => 'Follow up with seller today',
  },

  // Idle-time rules — configurable
  {
    id: 'signed_not_sent',
    label: 'Signed — Send Offer to Seller',
    description: 'HAT signed but the offer has not been sent yet.',
    tone: 'accent',
    priority: 3,
    configurable: true,
    defaultDays: 1,
    matcher: (l, days) => l.status === 'offer_signed' && daysSince(l.updated_at) > days,
    action: (l) => `Signed ${daysSince(l.contract_signed_date || l.updated_at)} day(s) ago — send to seller`,
  },
  {
    id: 'awaiting_response',
    label: 'Awaiting Seller Response',
    description: 'Offer sent but no response or status change in N days.',
    tone: 'warn',
    priority: 4,
    configurable: true,
    defaultDays: 2,
    matcher: (l, days) => l.status === 'offer_sent' && daysSince(l.updated_at) > days,
    action: (l) => `${daysSince(l.updated_at)} day(s) since offer sent — check status`,
  },
  {
    id: 'awaiting_signature',
    label: 'Awaiting HAT Signature',
    description: 'Offer pending HAT signature for too long.',
    tone: 'accent',
    priority: 5,
    configurable: true,
    defaultDays: 2,
    matcher: (l, days) => l.status === 'offer_pending_hat_signing' && daysSince(l.updated_at) > days,
    action: (l) => `${daysSince(l.updated_at)} day(s) waiting on HAT signature — chase it`,
  },
  {
    id: 'stalled_negotiating',
    label: 'Stalled Negotiation',
    description: 'In negotiation but no movement for too long.',
    tone: 'warn',
    priority: 6,
    configurable: true,
    defaultDays: 3,
    matcher: (l, days) => l.status === 'negotiating' && daysSince(l.updated_at) > days,
    action: (l) => `${daysSince(l.updated_at)} day(s) quiet — push forward or close`,
  },
  {
    id: 'mao_no_action',
    label: 'MAO Calculated — Decide Next Step',
    description: 'MAO has been run but no offer drafted.',
    tone: 'neutral',
    priority: 7,
    configurable: true,
    defaultDays: 2,
    matcher: (l, days) => l.status === 'mao_calculated' && daysSince(l.updated_at) > days,
    action: (l) => `${daysSince(l.updated_at)} day(s) sitting on MAO — draft offer or pass`,
  },
  {
    id: 'new_untouched',
    label: 'New Lead Untouched',
    description: 'New leads that have not been worked.',
    tone: 'neutral',
    priority: 8,
    configurable: true,
    defaultDays: 1,
    matcher: (l, days) => l.status === 'new_lead' && daysSince(l.created_at) > days,
    action: (l) => `${daysSince(l.created_at)} day(s) old — qualify and calculate MAO`,
  },
  {
    id: 'offer_accepted_idle',
    label: 'Offer Accepted — Idle',
    description: 'Deal accepted but nothing updated in a while.',
    tone: 'neutral',
    priority: 9,
    configurable: true,
    defaultDays: 7,
    matcher: (l, days) => l.status === 'offer_accepted' && daysSince(l.updated_at) > days,
    action: (l) => `${daysSince(l.updated_at)} day(s) without update — check closing progress`,
  },
]

// Returns the effective config for each bucket, given a workspace settings object.
// Shape: { [bucketId]: { enabled: boolean, days: number } }
export function effectiveBucketConfig(workspaceSettings = {}) {
  const overrides = workspaceSettings?.today_thresholds || {}
  const result = {}
  for (const b of BUCKETS) {
    if (!b.configurable) {
      result[b.id] = { enabled: true, days: null, configurable: false }
      continue
    }
    const o = overrides[b.id] || {}
    result[b.id] = {
      enabled: o.enabled !== false, // default ON
      days: typeof o.days === 'number' && o.days >= 0 ? o.days : b.defaultDays,
      configurable: true,
      defaultDays: b.defaultDays,
    }
  }
  return result
}

// Categorize leads into action buckets, respecting workspace config.
// Snoozed leads (snooze_until > now) are skipped — they reappear after the snooze expires.
export function categorizeLeads(leads, workspaceSettings = {}) {
  const cfg = effectiveBucketConfig(workspaceSettings)
  const byBucket = []
  const assigned = new Set()
  const now = Date.now()

  // Filter out snoozed leads first
  const active = (leads || []).filter(l => {
    if (!l.snooze_until) return true
    return new Date(l.snooze_until).getTime() <= now
  })

  for (const bucket of BUCKETS) {
    const bucketCfg = cfg[bucket.id]
    if (!bucketCfg.enabled) continue

    const matches = active.filter(l =>
      !assigned.has(l.id) && bucket.matcher(l, bucketCfg.days)
    )
    if (matches.length) {
      matches.forEach(l => assigned.add(l.id))
      byBucket.push({ bucket, leads: matches, days: bucketCfg.days })
    }
  }
  return { byBucket, totalCount: assigned.size }
}
