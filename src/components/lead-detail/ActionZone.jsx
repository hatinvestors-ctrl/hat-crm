import { useState } from 'react'
import Modal from '../ui/Modal'
import Input from '../ui/Input'
import Button from '../ui/Button'
import { useLeadUpdate } from '../../hooks/useLeadUpdate'

const PLAYBOOKS = {
  triage: {
    hint: 'Auto-imported lead — decide whether to bring it into the pipeline.',
    actions: [
      { label: 'Promote to New Lead', emoji: '✓', variant: 'success', patch: { status: 'new_lead' } },
      { label: 'Not In Buy Box',      emoji: '📦', variant: 'secondary', patch: { status: 'not_in_buy_box' } },
      { label: 'Dismiss',             emoji: '✗', variant: 'danger', patch: { status: 'dead_lead' } },
    ],
  },
  new_lead: {
    hint: 'Enter renovation cost in Financials, then run AI Analysis to get MAO and a starting offer.',
    actions: [
      { label: 'Calculate MAO',         emoji: '🧮', variant: 'primary',   patch: { status: 'mao_calculated' } },
      { label: 'Schedule Follow-Up',    emoji: '📅', variant: 'secondary', patch: { status: 'follow_up' }, requiresDate: 'follow_up_date' },
      { label: 'Not In Buy Box',        emoji: '📦', variant: 'ghost',     patch: { status: 'not_in_buy_box' } },
      { label: 'Dismiss',               emoji: '✗',  variant: 'ghost',     patch: { status: 'dead_lead' } },
    ],
  },
  mao_calculated: {
    hint: 'Draft an offer, or follow up with the seller first.',
    actions: [
      { label: 'Mark Offer Pending HAT',  emoji: '📝', variant: 'primary',   patch: { status: 'offer_pending_hat_signing' } },
      { label: 'Schedule Follow-Up',      emoji: '📅', variant: 'secondary', patch: { status: 'follow_up' }, requiresDate: 'follow_up_date' },
      { label: 'Dismiss',                 emoji: '✗',  variant: 'ghost',     patch: { status: 'dead_lead' } },
    ],
  },
  offer_pending_hat_signing: {
    hint: 'Get HAT to sign, then send to seller.',
    actions: [
      { label: 'Mark Signed',          emoji: '✍',  variant: 'primary',   patch: { status: 'offer_signed' }, requiresDate: 'contract_signed_date' },
      { label: 'Chase HAT (Follow-Up)',emoji: '📅', variant: 'secondary', patch: { status: 'follow_up' }, requiresDate: 'follow_up_date' },
      { label: 'Cancel',               emoji: '✗',  variant: 'ghost',     patch: { status: 'dead_lead' } },
    ],
  },
  offer_signed: {
    hint: 'Send the signed offer to the seller.',
    actions: [
      { label: 'Mark Offer Sent',      emoji: '📨', variant: 'primary',   patch: { status: 'offer_sent' } },
      { label: 'Schedule Follow-Up',   emoji: '📅', variant: 'secondary', patch: { status: 'follow_up' }, requiresDate: 'follow_up_date' },
    ],
  },
  offer_sent: {
    hint: 'Awaiting seller response — chase or move forward.',
    actions: [
      { label: 'Mark Accepted',        emoji: '🎉', variant: 'success',   patch: { status: 'offer_accepted' } },
      { label: 'Start Negotiating',    emoji: '🤝', variant: 'primary',   patch: { status: 'negotiating' } },
      { label: 'Schedule Follow-Up',   emoji: '📅', variant: 'secondary', patch: { status: 'follow_up' }, requiresDate: 'follow_up_date' },
      { label: 'Rejected',             emoji: '✗',  variant: 'danger',    patch: { status: 'rejected_not_accepted' } },
    ],
  },
  negotiating: {
    hint: 'Push to close or walk away.',
    actions: [
      { label: 'Mark Accepted',        emoji: '🎉', variant: 'success', patch: { status: 'offer_accepted' } },
      { label: 'Schedule Follow-Up',   emoji: '📅', variant: 'secondary', patch: { status: 'follow_up' }, requiresDate: 'follow_up_date' },
      { label: 'Rejected',             emoji: '✗',  variant: 'danger',  patch: { status: 'rejected_not_accepted' } },
    ],
  },
  follow_up: {
    hint: 'You scheduled a follow-up — log the outcome.',
    actions: [
      { label: 'I called — back to New Lead', emoji: '📞', variant: 'primary',   patch: { status: 'new_lead' } },
      { label: 'Push date',                    emoji: '📅', variant: 'secondary', patch: { status: 'follow_up' }, requiresDate: 'follow_up_date' },
      { label: 'Dismiss',                      emoji: '✗',  variant: 'ghost',     patch: { status: 'dead_lead' } },
    ],
  },
  offer_accepted: {
    hint: 'Track to closing — once funds are exchanged, mark Sold.',
    actions: [
      { label: 'Mark Sold',            emoji: '🏁', variant: 'success',   patch: { status: 'sold' } },
      { label: 'Fell Through',         emoji: '✗',  variant: 'danger',    patch: { status: 'dead_lead' } },
    ],
  },
  rejected_not_accepted: {
    hint: 'Offer was rejected. Counter, archive, or revive.',
    actions: [
      { label: 'Counter (Negotiate)',  emoji: '🤝', variant: 'primary', patch: { status: 'negotiating' } },
      { label: 'Reopen as New Lead',   emoji: '↺',  variant: 'secondary', patch: { status: 'new_lead' } },
      { label: 'Archive',              emoji: '✗',  variant: 'ghost',     patch: { status: 'dead_lead' } },
    ],
  },
  sold: {
    hint: 'Closed deal. Done.',
    actions: [
      { label: 'Reopen',               emoji: '↺',  variant: 'secondary', patch: { status: 'new_lead' } },
    ],
  },
  dead_lead: {
    hint: 'Archived. Reopen if circumstances change.',
    actions: [
      { label: 'Reopen as New Lead',   emoji: '↺',  variant: 'primary', patch: { status: 'new_lead' } },
    ],
  },
  not_in_buy_box: {
    hint: 'Outside investment criteria. Reopen if criteria change.',
    actions: [
      { label: 'Reopen as New Lead',   emoji: '↺',  variant: 'primary', patch: { status: 'new_lead' } },
    ],
  },
}

const DEFAULT_PLAYBOOK = {
  hint: 'Use the status grid below to move this lead forward.',
  actions: [
    { label: 'Schedule Follow-Up', emoji: '📅', variant: 'secondary', patch: { status: 'follow_up' }, requiresDate: 'follow_up_date' },
  ],
}

const fmtK  = (n) => n >= 1000 ? `$${(n / 1000).toFixed(0)}K` : `$${Math.round(n)}`
const fmtFull = (n) => `$${Math.round(n).toLocaleString()}`

function computeProfit(lead) {
  const arv  = Number(lead.arv || 0)
  const reno = Number(lead.renovation_cost || 0)
  const mao  = Number(lead.mao || 0)
  const pp   = mao || Number(lead.asking_price || 0)
  if (!arv || !pp) return null
  const hml         = pp * 0.9 + reno
  const cashToClose = pp * 0.10 + hml * 0.02 + 2450
  const holding     = (hml * 0.01 + 208 + 100) * 3
  return Math.round(arv * 0.93 - hml - holding - cashToClose)
}

// Determine accent color based on deal state
function accentColor(lead) {
  const verdict = lead.deal_analysis?.verdict
  if (verdict === 'BUY') return 'green'
  const gap = Number(lead.asking_price || 0) - Number(lead.mao || 0)
  if (verdict === 'REJECT' || gap > 20000) return 'red'
  if (verdict === 'CONDITIONAL' || (gap > 0 && gap <= 20000)) return 'amber'
  return 'blue'
}

const ACCENT = {
  green: { border: 'border-l-green-500',  bg: 'bg-green-500/5',  badge: 'bg-green-500/15 text-green-400 border-green-500/30' },
  amber: { border: 'border-l-amber-500',  bg: 'bg-amber-500/5',  badge: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  red:   { border: 'border-l-red-500',    bg: 'bg-red-500/5',    badge: 'bg-red-500/15   text-red-400   border-red-500/30'   },
  blue:  { border: 'border-l-blue-500',   bg: 'bg-blue-500/5',   badge: 'bg-blue-500/15  text-blue-400  border-blue-500/30'  },
}

function smartActions(lead, staticActions) {
  if (lead.status !== 'new_lead') return staticActions

  const hasArv      = !!lead.arv
  const hasReno     = !!lead.renovation_cost
  const hasAnalysis = !!lead.deal_analysis?.verdict
  const gap         = Number(lead.asking_price || 0) - Number(lead.mao || 0)

  // After analysis: primary action depends on gap
  if (hasAnalysis && hasArv && hasReno) {
    if (gap <= 0) {
      return [
        { label: 'Draft Offer',         emoji: '📝', variant: 'primary',   patch: { status: 'mao_calculated' } },
        { label: 'Schedule Follow-Up',  emoji: '📅', variant: 'secondary', patch: { status: 'follow_up' }, requiresDate: 'follow_up_date' },
        { label: 'Not In Buy Box',      emoji: '📦', variant: 'ghost',     patch: { status: 'not_in_buy_box' } },
        { label: 'Dismiss',             emoji: '✗',  variant: 'ghost',     patch: { status: 'dead_lead' } },
      ]
    }
    return [
      { label: 'Schedule Follow-Up',   emoji: '📅', variant: 'primary',   patch: { status: 'follow_up' }, requiresDate: 'follow_up_date' },
      { label: 'Start Negotiating',    emoji: '🤝', variant: 'secondary', patch: { status: 'negotiating' } },
      { label: 'Not In Buy Box',       emoji: '📦', variant: 'ghost',     patch: { status: 'not_in_buy_box' } },
      { label: 'Dismiss',              emoji: '✗',  variant: 'ghost',     patch: { status: 'dead_lead' } },
    ]
  }

  return staticActions
}

function smartHint(lead, staticHint) {
  if (lead.status !== 'new_lead') return staticHint
  const hasArv      = !!lead.arv
  const hasReno     = !!lead.renovation_cost
  const hasAnalysis = !!lead.deal_analysis?.verdict

  if (!hasArv && !hasReno) return 'Start by entering the ARV and renovation cost — those two numbers drive everything.'
  if (!hasArv)             return 'Enter the After-Repair Value (ARV) so we can calculate MAO and check if this deal works.'
  if (!hasReno)            return 'Add the estimated renovation cost, then run AI Analysis to get your MAO and starting offer.'
  if (!hasAnalysis)        return "Numbers look ready — run AI Analysis to get the verdict, MAO, and Kevin's take on this deal."
  const gap = Number(lead.asking_price || 0) - Number(lead.mao || 0)
  if (gap > 0) return `Seller is ${fmtFull(gap)} above MAO. Decide: negotiate, schedule a follow-up, or move on.`
  return 'Numbers check out — ready to draft an offer or schedule a follow-up call with the seller.'
}

const todayISO = () => new Date().toISOString().slice(0, 10)

export default function ActionZone({ lead, userId, members, canEdit, onUpdated }) {
  const update = useLeadUpdate(lead, userId, members, onUpdated)
  const [dateModal, setDateModal] = useState(null)
  const [dateValue, setDateValue] = useState('')
  const [saving, setSaving]       = useState(false)

  if (!canEdit) return null

  const playbook = PLAYBOOKS[lead.status] || DEFAULT_PLAYBOOK
  const hint     = smartHint(lead, playbook.hint)
  const actions  = smartActions(lead, playbook.actions)
  const color    = accentColor(lead)
  const accent   = ACCENT[color]
  const verdict  = lead.deal_analysis?.verdict
  const profit   = computeProfit(lead)

  const arv    = Number(lead.arv || 0)
  const reno   = Number(lead.renovation_cost || 0)
  const mao    = Number(lead.mao || 0)
  const asking = Number(lead.asking_price || 0)
  const gap    = mao && asking ? asking - mao : null

  const runAction = async (action) => {
    if (action.requiresDate) {
      const existing = lead[action.requiresDate] ||
        (action.requiresDate === 'contract_signed_date' ? todayISO() : '')
      setDateValue(existing)
      setDateModal({ action })
      return
    }
    setSaving(true)
    try { await update(action.patch) } finally { setSaving(false) }
  }

  const commitDate = async () => {
    if (!dateValue || !dateModal) return
    setSaving(true)
    try {
      await update({ ...dateModal.action.patch, [dateModal.action.requiresDate]: dateValue })
      setDateModal(null)
    } finally { setSaving(false) }
  }

  return (
    <div className={`${accent.bg} border border-[color:var(--color-line)] border-l-4 ${accent.border} rounded-lg p-4`}>

      {/* Capability #19 — this card's job is ONE thing: "what do I click
          next?" The verdict badge and its own independently-recomputed
          ARV/Reno/MAO/Profit snapshot were removed here — that exact
          information (from the one authoritative source, decision_v2) now
          lives once, above, in the primary Acquisition Copilot decision
          header. Showing it twice, computed two different ways, is the
          "competing decision" problem the mission called out. The left
          border keeps a quiet color cue from the same verdict, without
          restating it as text/numbers. */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10.5px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)]">
          What now?
        </span>
      </div>

      {/* Action hint — the key message, bigger and bolder */}
      <p className="text-[14px] font-medium text-[color:var(--color-text)] mb-4 leading-snug">
        {hint}
      </p>

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        {actions.map((action, idx) => (
          <Button
            key={idx}
            variant={action.variant}
            size="md"
            onClick={() => runAction(action)}
            loading={saving}
          >
            <span>{action.emoji}</span>
            <span>{action.label}</span>
          </Button>
        ))}
      </div>

      <Modal
        open={!!dateModal}
        onClose={() => setDateModal(null)}
        title={dateModal?.action.requiresDate === 'contract_signed_date' ? 'Contract Sign Date' : 'Follow-Up Date'}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDateModal(null)} disabled={saving}>Cancel</Button>
            <Button onClick={commitDate} loading={saving} disabled={!dateValue}>Save</Button>
          </>
        }
      >
        {dateModal && (
          <Input
            label={dateModal.action.requiresDate === 'contract_signed_date' ? 'When was the contract signed?' : 'When should you follow up?'}
            type="date"
            value={dateValue}
            onChange={e => setDateValue(e.target.value)}
            required
            autoFocus
          />
        )}
      </Modal>
    </div>
  )
}
