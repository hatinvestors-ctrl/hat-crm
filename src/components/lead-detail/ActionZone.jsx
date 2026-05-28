import { useState } from 'react'
import Modal from '../ui/Modal'
import Input from '../ui/Input'
import Button from '../ui/Button'
import { useLeadUpdate } from '../../hooks/useLeadUpdate'

// Action playbooks: keyed by current status.
// Each playbook has:
//   hint: 1-line suggested next step shown above the buttons
//   actions: 1-4 action buttons. Each action has:
//     label, emoji, variant ('primary'|'success'|'danger'|'secondary'|'ghost'),
//     and either:
//       patch: object to merge into the UPDATE payload
//       OR
//       requiresDate: 'follow_up_date'|'contract_signed_date' (opens a date prompt)
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
    hint: 'Calculate MAO or schedule a follow-up call.',
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

// Default playbook for statuses without an explicit one
const DEFAULT_PLAYBOOK = {
  hint: 'Use the status grid below to move this lead forward.',
  actions: [
    { label: 'Schedule Follow-Up', emoji: '📅', variant: 'secondary', patch: { status: 'follow_up' }, requiresDate: 'follow_up_date' },
  ],
}

const todayISO = () => new Date().toISOString().slice(0, 10)

export default function ActionZone({ lead, userId, members, canEdit, onUpdated }) {
  const update = useLeadUpdate(lead, userId, members, onUpdated)
  const [dateModal, setDateModal] = useState(null) // { action }
  const [dateValue, setDateValue] = useState('')
  const [saving, setSaving] = useState(false)

  if (!canEdit) return null

  const playbook = PLAYBOOKS[lead.status] || DEFAULT_PLAYBOOK

  const runAction = async (action) => {
    if (action.requiresDate) {
      const existing = lead[action.requiresDate] ||
        (action.requiresDate === 'contract_signed_date' ? todayISO() : '')
      setDateValue(existing)
      setDateModal({ action })
      return
    }
    setSaving(true)
    try {
      await update(action.patch)
    } finally {
      setSaving(false)
    }
  }

  const commitDate = async () => {
    if (!dateValue || !dateModal) return
    setSaving(true)
    try {
      await update({ ...dateModal.action.patch, [dateModal.action.requiresDate]: dateValue })
      setDateModal(null)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] rounded-lg p-4">
      <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
        <div>
          <div className="text-[10.5px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)]">
            What now?
          </div>
          <p className="text-[13px] text-[color:var(--color-text)] mt-0.5 leading-relaxed">
            {playbook.hint}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {playbook.actions.map((action, idx) => (
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
          <>
            <Input
              label={dateModal.action.requiresDate === 'contract_signed_date' ? 'When was the contract signed?' : 'When should you follow up?'}
              type="date"
              value={dateValue}
              onChange={e => setDateValue(e.target.value)}
              required
              autoFocus
            />
          </>
        )}
      </Modal>
    </div>
  )
}
