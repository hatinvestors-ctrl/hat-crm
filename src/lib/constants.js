export const DEFAULT_CLOSING_COSTS = 5000
export const DEFAULT_TARGET_PROFIT = 30000

// Statuses matching the existing Podio workflow, plus a Triage state for
// auto-imported leads that haven't been reviewed by a human yet.
// `category` groups statuses in the picker grid.
// `tone` controls badge/highlight color.
export const LEAD_STATUSES = [
  // ── Triage (auto-imported, awaiting human review) ───────────────
  { value: 'triage',                     label: '🤖 Triage',             category: 'Triage',    tone: 'warn'    },

  // ── Active pipeline ─────────────────────────────────────────────
  { value: 'new_lead',                   label: 'New Lead',              category: 'Pipeline',  tone: 'neutral' },
  { value: 'mao_calculated',             label: 'MAO Calculated',        category: 'Pipeline',  tone: 'neutral' },
  { value: 'offer_pending_hat_signing',  label: 'Offer Pending HAT Signing', category: 'Pipeline', tone: 'accent' },
  { value: 'offer_signed',               label: 'Offer Signed',          category: 'Pipeline',  tone: 'accent'  },
  { value: 'offer_sent',                 label: 'Offer Sent',            category: 'Pipeline',  tone: 'accent'  },
  { value: 'negotiating',                label: 'Negotiating',           category: 'Pipeline',  tone: 'warn'    },

  // ── Follow-up tracking ──────────────────────────────────────────
  { value: 'follow_up',                  label: 'Follow Up',             category: 'Follow-Up', tone: 'warn'    },

  // ── Outcomes ────────────────────────────────────────────────────
  { value: 'offer_accepted',             label: 'Offer Accepted',        category: 'Outcome',   tone: 'success' },
  { value: 'rejected_not_accepted',      label: 'Rejected / Not Accepted', category: 'Outcome', tone: 'danger'  },
  { value: 'sold',                       label: 'Sold (Wholesale)',       category: 'Outcome',   tone: 'success' },
  { value: 'flip_sold',                  label: 'Flip Sold ✓',           category: 'Project Result', tone: 'success' },
  { value: 'dead_lead',                  label: 'Dead Lead',             category: 'Outcome',   tone: 'danger'  },

  // ── Process / automation ────────────────────────────────────────
  { value: 'move_to_sequence',           label: 'MoveToSequence',        category: 'Process',   tone: 'neutral' },
  { value: 'sequence_completed',         label: 'Sequence Completed',    category: 'Process',   tone: 'neutral' },
  { value: 'working_project',            label: 'Working Project',       category: 'Process',   tone: 'accent'  },
  { value: 'automated_offers',           label: 'AutomatedOffers',       category: 'Process',   tone: 'accent'  },

  // ── Source / classification ─────────────────────────────────────
  { value: 'not_in_buy_box',             label: 'Not In Our Buy BOX',    category: 'Other',     tone: 'neutral' },
  { value: 'agent_rel',                  label: 'AgentRel',              category: 'Other',     tone: 'neutral' },
  { value: 'imported',                   label: 'Imported',              category: 'Other',     tone: 'neutral' },
]

export const STATUS_MAP = Object.fromEntries(LEAD_STATUSES.map(s => [s.value, s]))

// MLS listing statuses (live status on the listing from RentCast).
// Stored on leads.mls_status. Tone drives the pill color in the UI.
export const MLS_STATUSES = [
  { value: 'active',      label: 'Active',         tone: 'success', pursuable: true,  hint: 'Currently listed — pursuable' },
  { value: 'pending',     label: 'Pending Sale',   tone: 'warn',    pursuable: true,  hint: 'Under contract — try as backup' },
  { value: 'contingent',  label: 'Contingent',     tone: 'warn',    pursuable: true,  hint: 'Contingent — may fall through' },
  { value: 'sold',        label: 'Sold',           tone: 'danger',  pursuable: false, hint: 'Already sold — not pursuable' },
  { value: 'withdrawn',   label: 'Withdrawn',      tone: 'neutral', pursuable: false, hint: 'Withdrawn from market' },
  { value: 'expired',     label: 'Expired',        tone: 'accent',  pursuable: true,  hint: 'Expired listing — direct seller opportunity' },
  { value: 'off_market',  label: 'Off Market',     tone: 'neutral', pursuable: false, hint: 'Not currently listed' },
]
export const MLS_STATUS_MAP = Object.fromEntries(MLS_STATUSES.map(s => [s.value, s]))

// Normalize a RentCast `status` string to one of our MLS_STATUSES values.
export function normalizeMlsStatus(raw) {
  if (!raw) return null
  const s = String(raw).toLowerCase().replace(/[-_\s]+/g, '_')
  if (s.includes('active')) return 'active'
  if (s.includes('pend')) return 'pending'
  if (s.includes('conting')) return 'contingent'
  if (s.includes('sold') || s.includes('closed')) return 'sold'
  if (s.includes('withdraw') || s.includes('cancel')) return 'withdrawn'
  if (s.includes('expire')) return 'expired'
  if (s.includes('off')) return 'off_market'
  return null
}

// Statuses that mean the deal is fully closed (won or lost or filed-away).
// Used by Sidebar/Dashboard/Today to filter out non-active leads.
export const TERMINAL_STATUSES = [
  'sold', 'flip_sold', 'dead_lead', 'rejected_not_accepted', 'not_in_buy_box', 'sequence_completed',
]

// Statuses that imply HAT has signed the contract (so the date field should show).
export const SIGNED_STATUSES = [
  'offer_signed','offer_sent','negotiating','follow_up','offer_accepted','sold','flip_sold','rejected_not_accepted',
]

// Group statuses by category for the picker grid.
export const STATUS_CATEGORIES = ['Triage','Pipeline','Follow-Up','Outcome','Project Result','Process','Other'].map(cat => ({
  name: cat,
  statuses: LEAD_STATUSES.filter(s => s.category === cat),
}))

export const LEAD_SOURCES = [
  { value: 'direct_mail', label: 'Direct Mail' },
  { value: 'cold_call', label: 'Cold Call' },
  { value: 'mls', label: 'MLS' },
  { value: 'wholesaler', label: 'Wholesaler' },
  { value: 'referral', label: 'Referral' },
  { value: 'driving_for_dollars', label: 'Driving for Dollars' },
  { value: 'web', label: 'Web / Online' },
  { value: 'imported', label: 'Imported (Podio)' },
  { value: 'redfin_auto', label: '🤖 Redfin (Auto)' },
  { value: 'other', label: 'Other' },
]

// Redfin trigger types — sub-categorization for auto-imported Redfin leads.
export const REDFIN_TRIGGER_TYPES = [
  { value: 'price_drop',     label: '💸 Price Drop',     tone: 'warn'    },
  { value: 'new_listing',    label: '🆕 New Listing',    tone: 'accent'  },
  { value: 'back_on_market', label: '🔄 Back on Market', tone: 'danger'  },
  { value: 'stale_listing',  label: '⏰ Stale 100+ days',tone: 'warn'    },
  { value: 'open_house',     label: '🏠 Open House',     tone: 'accent'  },
  { value: 'coming_soon',    label: '🔮 Coming Soon',    tone: 'neutral' },
  { value: 'generic_alert',  label: '📨 Redfin Alert',   tone: 'neutral' },
]
export const REDFIN_TRIGGER_MAP = Object.fromEntries(REDFIN_TRIGGER_TYPES.map(t => [t.value, t]))

export const PROPERTY_TYPES = [
  { value: 'single_family', label: 'Single Family' },
  { value: 'multi_family', label: 'Multi-Family' },
  { value: 'condo', label: 'Condo' },
  { value: 'townhouse', label: 'Townhouse' },
  { value: 'land', label: 'Land' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'other', label: 'Other' },
]

export const USER_ROLES = [
  { value: 'admin', label: 'Admin', description: 'Full access — manage users, settings, all leads' },
  { value: 'regular', label: 'Regular', description: 'Create, edit, and manage leads' },
  { value: 'readonly', label: 'Read-only', description: 'View leads only — cannot edit or delete' },
]

export const ROLE_MAP = Object.fromEntries(USER_ROLES.map(r => [r.value, r]))

// System views — auto-generated from statuses + special composites.
export const SYSTEM_VIEWS = [
  { id: 'all',         name: 'All Leads',         filters: {} },
  { id: 'hot',         name: '🔥 Hot Leads',      filters: { is_hot: true } },
  { id: 'mine',        name: 'My Assigned Leads', filters: { assigned_to: 'me' } },

  // Special date-based follow-up views
  { id: 'follow_today',  name: 'Follow-Up Today',   filters: { status: 'follow_up', follow_up_date: 'today' } },
  { id: 'follow_week',   name: 'Follow-Up This Week', filters: { status: 'follow_up', follow_up_date: 'this_week' } },
  { id: 'follow_past',   name: 'Past Follow-Ups',   filters: { status: 'follow_up', follow_up_date: 'past' } },
  { id: 'follow_future', name: 'Future Follow-Ups', filters: { status: 'follow_up', follow_up_date: 'future' } },

  // Note: Redfin auto-imports live at the top-level "Inbox" page (/inbox),
  // not in this sidebar. The triage workflow happens there. Once a lead
  // is promoted from triage it shows up under its actual status below.

  // One view per status — auto-generated, grouped by section in the sidebar
  ...LEAD_STATUSES.map(s => ({
    id: `status_${s.value}`,
    name: s.label,
    section: s.category,
    filters: { status: s.value },
  })),

  // Date-bucketed sub-views for New Lead (expandable in the sidebar)
  { id: 'status_new_lead_today',     name: 'Today',         section: 'Pipeline', parent: 'status_new_lead', filters: { status: 'new_lead', created_at: 'today' } },
  { id: 'status_new_lead_yesterday', name: 'Yesterday',     section: 'Pipeline', parent: 'status_new_lead', filters: { status: 'new_lead', created_at: 'yesterday' } },
  { id: 'status_new_lead_last7',     name: 'Last 7 days',   section: 'Pipeline', parent: 'status_new_lead', filters: { status: 'new_lead', created_at: 'last_7' } },
  { id: 'status_new_lead_thismonth', name: 'This month',    section: 'Pipeline', parent: 'status_new_lead', filters: { status: 'new_lead', created_at: 'this_month' } },
  { id: 'status_new_lead_older',     name: 'Older',         section: 'Pipeline', parent: 'status_new_lead', filters: { status: 'new_lead', created_at: 'older' } },
]

// ── Task Board ──────────────────────────────────────────────────
export const TASK_STATUSES = [
  { value: 'todo',         label: 'To Do',       tone: 'neutral' },
  { value: 'in_progress',  label: 'In Progress', tone: 'accent'  },
  { value: 'blocked',      label: 'Blocked',     tone: 'danger'  },
  { value: 'done',         label: 'Done',        tone: 'success' },
]
export const TASK_STATUS_MAP = Object.fromEntries(TASK_STATUSES.map(s => [s.value, s]))

export const TASK_PRIORITIES = [
  { value: 'low',     label: 'Low',     color: 'oklch(0.65 0.05 250)' },
  { value: 'medium',  label: 'Medium',  color: 'oklch(0.70 0.12 230)' },
  { value: 'high',    label: 'High',    color: 'oklch(0.70 0.18 75)'  },
  { value: 'urgent',  label: 'Urgent',  color: 'oklch(0.65 0.22 25)'  },
]
export const TASK_PRIORITY_MAP = Object.fromEntries(TASK_PRIORITIES.map(p => [p.value, p]))

// Statuses that mean a lead is a real "project" — used as project options for tasks.
export const PROJECT_STATUSES = ['sold', 'flip_sold', 'working_project', 'offer_accepted']

export const ACTIVITY_TRACKED_FIELDS = [
  'status',
  'assigned_to',
  'offer_price',
  'mao',
  'follow_up_date',
  'contract_signed_date',
]
