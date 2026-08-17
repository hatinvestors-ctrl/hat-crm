import { useState } from 'react'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import Input from '../ui/Input'
import { supabase } from '../../lib/supabase'
import { logChanges } from '../../lib/activityLogger'
import { formatDate } from '../../lib/calculations'
import { STATUS_CATEGORIES, STATUS_MAP } from '../../lib/constants'
import { fireLeadNotifications } from '../../lib/leadNotifications'

const TONE_ACTIVE = {
  neutral: 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text)] ring-[color:var(--color-text-dim)]',
  accent:  'bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)] ring-[color:var(--color-accent)]',
  warn:    'bg-[color:var(--color-warn-soft)] text-[color:var(--color-warn-text)] ring-[color:var(--color-warn)]',
  success: 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)] ring-[color:var(--color-success)]',
  danger:  'bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-text)] ring-[color:var(--color-danger)]',
}

const TONE_DOT = {
  neutral: 'bg-[color:var(--color-text-dim)]',
  accent:  'bg-[color:var(--color-accent)]',
  warn:    'bg-[color:var(--color-warn)]',
  success: 'bg-[color:var(--color-success)]',
  danger:  'bg-[color:var(--color-danger)]',
}

// Statuses that require an extra date input before applying.
const DATE_REQUIRED = {
  follow_up: {
    field: 'follow_up_date',
    title: 'Set Follow-Up Date',
    label: 'When should you follow up?',
    helper: 'The lead will show up in Follow-Up Today and Past Follow-Ups views on/after that date.',
    defaultToToday: false,
  },
}

// Statuses that auto-set a date field to today without prompting.
const AUTO_DATE_TODAY = {
  offer_signed: 'contract_signed_date',
}

const todayISO = () => new Date().toISOString().slice(0, 10)

export default function LeadStatusPipeline({ lead, members, userId, workspaceId, canEdit, onUpdated }) {
  const [dateModal, setDateModal] = useState(null)
  const [dateValue, setDateValue] = useState('')
  const [saving, setSaving] = useState(false)

  const userLookup = Object.fromEntries((members || []).map(m => [m.user_id, m.profiles]))
  const current = STATUS_MAP[lead.status]

  const apply = async (newStatus, extra = {}) => {
    if (!canEdit || newStatus === lead.status) return
    setSaving(true)
    const patch = { status: newStatus, ...extra }
    const { data: updated } = await supabase.from('leads').update(patch).eq('id', lead.id).select().single()
    if (updated) {
      await logChanges(lead.id, userId, lead, updated, userLookup)
      fireLeadNotifications(lead, updated, workspaceId, userId).catch(() => {})
      onUpdated?.(updated)
    }
    setSaving(false)
    setDateModal(null)
  }

  const onPick = (newStatus) => {
    if (newStatus === lead.status) return
    const autoField = AUTO_DATE_TODAY[newStatus]
    if (autoField) {
      apply(newStatus, { [autoField]: lead[autoField] || todayISO() })
      return
    }
    const cfg = DATE_REQUIRED[newStatus]
    if (cfg) {
      const existing = lead[cfg.field] || (cfg.defaultToToday ? todayISO() : '')
      setDateValue(existing)
      setDateModal({ status: newStatus, config: cfg })
    } else {
      apply(newStatus)
    }
  }

  // Phase 2.1, Section 4E — Overview should show "Current Stage: X [Change
  // status]" compactly by default; the full grid (unchanged below) still
  // opens on demand. Every status and status-changing action is preserved
  // — only the default open/closed state changed.
  const [gridOpen, setGridOpen] = useState(false)

  return (
    <div className="bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] rounded-lg px-4 py-3">
      {/* Always-visible compact header row */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10.5px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)]">
            Status
          </span>
          {current && (
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ring-1 ${TONE_ACTIVE[current.tone]}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${TONE_DOT[current.tone]}`} />
              {current.label}
            </span>
          )}
          {lead.contract_signed_date && (
            <span className="text-[11.5px] text-[color:var(--color-accent-text)] bg-[color:var(--color-accent-soft)] px-2 py-1 rounded">
              Signed · {formatDate(lead.contract_signed_date)}
            </span>
          )}
          {lead.follow_up_date && (
            <span className="text-[11.5px] text-[color:var(--color-warn-text)] bg-[color:var(--color-warn-soft)] px-2 py-1 rounded">
              Follow-up · {formatDate(lead.follow_up_date)}
            </span>
          )}
        </div>
        {canEdit && (
          <button
            onClick={() => setGridOpen(v => !v)}
            className="text-[11px] text-[color:var(--color-accent-text)] hover:underline flex items-center gap-1"
          >
            {gridOpen ? '▲ Hide' : '▼ Change status'}
          </button>
        )}
      </div>

      {/* Expandable full status grid */}
      {gridOpen && (
        <div className="mt-3 pt-3 border-t border-[color:var(--color-line)] space-y-3">
          {STATUS_CATEGORIES.map(cat => (
            <div key={cat.name}>
              <div className="text-[10px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)] mb-1.5">
                {cat.name}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {cat.statuses.map(s => {
                  const active = lead.status === s.value
                  return (
                    <button
                      key={s.value}
                      onClick={() => { onPick(s.value); if (active) setGridOpen(false) }}
                      disabled={!canEdit || saving}
                      className={`inline-flex items-center gap-1.5 px-2.5 h-7 rounded-md text-[12px] font-medium transition-all disabled:opacity-50 ${
                        active
                          ? `${TONE_ACTIVE[s.tone]} ring-1`
                          : 'bg-[color:var(--color-bg)] hover:bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] border border-[color:var(--color-line)]'
                      } ${canEdit ? 'cursor-pointer' : 'cursor-default'}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${active ? TONE_DOT[s.tone] : 'bg-[color:var(--color-text-faint)]'}`} />
                      {s.label}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={!!dateModal}
        onClose={() => setDateModal(null)}
        title={dateModal?.config.title || ''}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDateModal(null)}>Cancel</Button>
            <Button
              onClick={() => apply(dateModal.status, { [dateModal.config.field]: dateValue })}
              loading={saving}
              disabled={!dateValue}
            >
              Set & Update
            </Button>
          </>
        }
      >
        {dateModal && (
          <>
            <Input
              label={dateModal.config.label}
              type="date"
              value={dateValue}
              onChange={e => setDateValue(e.target.value)}
              required
              autoFocus
            />
            <p className="text-[11.5px] text-[color:var(--color-text-dim)] mt-2 leading-relaxed">
              {dateModal.config.helper}
            </p>
          </>
        )}
      </Modal>
    </div>
  )
}
