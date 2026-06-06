// src/components/tasks/TaskCalendarInviteModal.jsx
import { useState, useEffect } from 'react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import Input from '../ui/Input'

const REMINDER_OPTIONS = [
  { value: 1, label: '1 day before' },
  { value: 2, label: '2 days before' },
  { value: 3, label: '3 days before' },
  { value: 7, label: '1 week before' },
]

function toDateTimeLocal(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  // datetime-local expects "YYYY-MM-DDTHH:MM"
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function defaultDateTime(task) {
  if (task?.due_date) {
    // due_date is a date (no time) — set to 10 AM
    const d = new Date(task.due_date + 'T10:00:00')
    if (!isNaN(d.getTime())) return toDateTimeLocal(d.toISOString())
  }
  // default: tomorrow at 10 AM
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(10, 0, 0, 0)
  return toDateTimeLocal(tomorrow.toISOString())
}

export default function TaskCalendarInviteModal({ open, onClose, task, members, workspaceId, userId }) {
  const [title, setTitle]               = useState('')
  const [eventDate, setEventDate]       = useState('')
  const [description, setDescription]   = useState('')
  const [inviteeIds, setInviteeIds]     = useState([])
  const [reminderDays, setReminderDays] = useState(1)
  const [sending, setSending]           = useState(false)
  const [error, setError]               = useState(null)
  const [success, setSuccess]           = useState(false)

  // Pre-fill from task whenever modal opens
  useEffect(() => {
    if (!open || !task) return
    setTitle(task.title || '')
    setEventDate(defaultDateTime(task))
    setDescription(task.description || '')
    setInviteeIds(task.assignee_ids || [])
    setReminderDays(1)
    setError(null)
    setSuccess(false)
  }, [open, task?.id])

  const toggleInvitee = (userId) => {
    setInviteeIds(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    )
  }

  const handleSend = async () => {
    if (!eventDate) { setError('Event date is required.'); return }
    if (!inviteeIds.length) { setError('Select at least one invitee.'); return }
    setSending(true)
    setError(null)
    try {
      const res = await fetch('/.netlify/functions/send-task-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id:        workspaceId,
          task_id:             task.id,
          event_title:         title.trim(),
          event_description:   description.trim() || null,
          event_date:          new Date(eventDate).toISOString(),
          invitee_ids:         inviteeIds,
          reminder_days_before: reminderDays,
          created_by:          userId,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setSuccess(true)
      setTimeout(() => { onClose(); setSuccess(false) }, 1500)
    } catch (e) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }

  if (!task) return null

  const inputCls = 'w-full px-2.5 py-1.5 text-[13px] rounded-md bg-[color:var(--color-bg-input)] text-[color:var(--color-text)] border border-[color:var(--color-line)] focus:outline-none focus:border-[color:var(--color-accent)] focus:ring-1 focus:ring-[color:var(--color-accent)] transition-colors'
  const labelCls = 'text-[11px] font-medium uppercase tracking-wide text-[color:var(--color-text-muted)] mb-1 block'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="📅 Send Calendar Invite"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={sending}>Cancel</Button>
          <Button onClick={handleSend} loading={sending} disabled={success}>
            {success ? '✓ Sent!' : 'Send Invite'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="text-[12px] text-[color:var(--color-danger-text)] bg-[color:var(--color-danger-soft)] px-3 py-2 rounded">
            {error}
          </div>
        )}

        {success && (
          <div className="text-[12px] text-[color:var(--color-success-text)] bg-[color:var(--color-success-soft)] px-3 py-2 rounded">
            Invite sent! Closing…
          </div>
        )}

        {/* Event title */}
        <Input
          label="Event title"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="e.g. Final Walkthrough"
          required
        />

        {/* Date & time */}
        <div>
          <label className={labelCls}>Date & Time <span className="text-[color:var(--color-danger-text)]">*</span></label>
          <input
            type="datetime-local"
            value={eventDate}
            onChange={e => setEventDate(e.target.value)}
            className={inputCls}
          />
        </div>

        {/* Description */}
        <div>
          <label className={labelCls}>Description</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={3}
            placeholder="What's this event about?"
            className={`${inputCls} resize-y leading-relaxed`}
          />
        </div>

        {/* Invitees */}
        <div>
          <label className={labelCls}>Invite</label>
          {members.length === 0 ? (
            <p className="text-[12px] text-[color:var(--color-text-dim)] italic">No team members found.</p>
          ) : (
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {members.map(m => {
                const name = m.profiles?.full_name || m.user_id
                const checked = inviteeIds.includes(m.user_id)
                return (
                  <label
                    key={m.user_id}
                    className="flex items-center gap-2.5 px-2 py-1.5 rounded cursor-pointer hover:bg-[color:var(--color-bg-elev-2)] transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleInvitee(m.user_id)}
                      className="accent-[color:var(--color-accent)] h-3.5 w-3.5"
                    />
                    <span className="text-[13px] text-[color:var(--color-text)]">{name}</span>
                    {(task.assignee_ids || []).includes(m.user_id) && (
                      <span className="ml-auto text-[10px] text-[color:var(--color-text-dim)]">assignee</span>
                    )}
                  </label>
                )
              })}
            </div>
          )}
        </div>

        {/* Reminder */}
        <div>
          <label className={labelCls}>Email reminder</label>
          <select
            value={reminderDays}
            onChange={e => setReminderDays(Number(e.target.value))}
            className={inputCls}
          >
            {REMINDER_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <p className="text-[11px] text-[color:var(--color-text-dim)] mt-1">
            Invitees will also receive an automated reminder email {reminderDays} day{reminderDays === 1 ? '' : 's'} before the event.
          </p>
        </div>
      </div>
    </Modal>
  )
}
