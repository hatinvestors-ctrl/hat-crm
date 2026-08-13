import { useState } from 'react'
import { useLeadUpdate } from '../../hooks/useLeadUpdate'
import { logOutcome } from '../../lib/activityLogger'
import { supabase } from '../../lib/supabase'

// Capability #17, Section 4 — Fast Outcome Capture. Opens from an Action
// Center card (never navigates away), target <15s for the common case
// (pick outcome → tap Save). Writes through the SAME useLeadUpdate hook
// every other edit in the app uses, so V2 recalculation (#15.5.1) and
// activity logging stay automatic and consistent — no parallel write path.
const OUTCOMES = [
  { key: 'no_answer',        label: 'No Answer',            status: null,                    needsFollowUp: true,  defaultDays: 2 },
  { key: 'spoke_follow_up',  label: 'Spoke — Follow Up',     status: 'follow_up',             needsFollowUp: true,  defaultDays: 3 },
  { key: 'offer_sent',       label: 'Offer Sent',            status: 'offer_sent',            needsFollowUp: true,  defaultDays: 3, needsOffer: true },
  { key: 'offer_rejected',   label: 'Offer Rejected',        status: 'rejected_not_accepted', needsFollowUp: false },
  { key: 'counter_received', label: 'Counter Received',      status: 'negotiating',           needsFollowUp: true,  defaultDays: 1, needsCounter: true },
  { key: 'need_more_info',   label: 'Need More Information', status: 'follow_up',             needsFollowUp: true,  defaultDays: 5 },
  { key: 'not_interested',   label: 'Not Interested',        status: 'rejected_not_accepted', needsFollowUp: false },
  { key: 'dead_lead',        label: 'Dead Lead',             status: 'dead_lead',             needsFollowUp: false },
]

function addDays(n) {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

export default function LogOutcomeModal({ lead, userId, members, onClose, onSaved }) {
  const [outcomeKey, setOutcomeKey] = useState(null)
  const [note, setNote] = useState('')
  const [followUpDate, setFollowUpDate] = useState('')
  const [sellerExpectation, setSellerExpectation] = useState('')
  const [offerAmount, setOfferAmount] = useState('')
  const [counterAmount, setCounterAmount] = useState('')
  const [saving, setSaving] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [suggestError, setSuggestError] = useState(null)

  const update = useLeadUpdate(lead, userId, members, onSaved)
  const outcome = OUTCOMES.find(o => o.key === outcomeKey)

  function pickOutcome(o) {
    setOutcomeKey(o.key)
    setFollowUpDate(o.needsFollowUp ? addDays(o.defaultDays) : '')
  }

  // Capability #17, Section 5 — Kevin types a note first, taps "Suggest",
  // and the AI's guesses land in the SAME form fields he'd fill manually.
  // Nothing is saved until he presses the normal Save button below, so
  // every suggestion is implicitly reviewed/confirmed before it persists.
  async function suggestFromNote() {
    if (!note.trim() || suggesting) return
    setSuggesting(true)
    setSuggestError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/.netlify/functions/extract-outcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
        body: JSON.stringify({ note }),
      })
      const body = await res.json()
      if (!res.ok || !body.ok) throw new Error(body.error || 'Suggestion failed')
      const s = body.suggestion
      if (s.outcome) pickOutcome(OUTCOMES.find(o => o.key === s.outcome) || OUTCOMES[0])
      if (s.follow_up_days != null) setFollowUpDate(addDays(s.follow_up_days))
      if (s.seller_expectation != null) setSellerExpectation(String(s.seller_expectation))
      if (s.offer_amount != null) setOfferAmount(String(s.offer_amount))
      if (s.counter_amount != null) setCounterAmount(String(s.counter_amount))
    } catch (err) {
      setSuggestError(err.message || 'Could not get suggestions')
    } finally {
      setSuggesting(false)
    }
  }

  async function handleSave() {
    if (!outcome || saving) return
    setSaving(true)
    try {
      const patch = {}
      if (outcome.status) patch.status = outcome.status
      // Terminal outcomes (offer_rejected/not_interested/dead_lead) auto-clear
      // follow_up_date inside useLeadUpdate — no need to set it here.
      if (outcome.needsFollowUp && followUpDate) patch.follow_up_date = followUpDate
      if (outcome.needsOffer && offerAmount) patch.offer_price = Number(offerAmount)

      const updated = Object.keys(patch).length ? await update(patch) : lead

      // Capability #18, Section 4 — snapshot what V2 believed AT THIS
      // MOMENT (pre-patch `lead`, not `updated`) alongside the outcome, so
      // later analysis isn't corrupted by V2 re-scoring the lead after.
      await logOutcome(lead.id, userId, {
        outcome: outcome.key,
        note,
        lead,
        followUpDate: outcome.needsFollowUp ? (followUpDate || null) : null,
        sellerExpectation: sellerExpectation ? Number(sellerExpectation) : null,
        offerAmount: outcome.needsOffer && offerAmount ? Number(offerAmount) : null,
        counterAmount: outcome.needsCounter && counterAmount ? Number(counterAmount) : null,
      }).catch(() => {})

      onSaved?.(updated || lead)
      onClose()
    } catch (err) {
      console.error('[LogOutcomeModal] save failed', err)
      alert('Could not save outcome. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-md rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-bg)] shadow-xl p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="text-[13px] font-bold text-[color:var(--color-text)]">Log Outcome</div>
            <div className="text-[11.5px] text-[color:var(--color-text-dim)] truncate max-w-[280px]">{lead.address}</div>
          </div>
          <button type="button" onClick={onClose} className="text-[color:var(--color-text-dim)] hover:text-[color:var(--color-text)] text-[18px] leading-none">×</button>
        </div>

        <div className="mb-3">
          <label className="text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Note (optional — type first, then Suggest)</label>
          <div className="flex gap-1.5 mt-1">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="What happened / what changed…"
              className="flex-1 text-[12.5px] px-2 py-1.5 rounded-md border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] text-[color:var(--color-text)] resize-none"
            />
            <button
              type="button"
              onClick={suggestFromNote}
              disabled={!note.trim() || suggesting}
              className="shrink-0 text-[11px] font-semibold px-2.5 rounded-md border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] disabled:opacity-50"
            >
              {suggesting ? '…' : 'Suggest'}
            </button>
          </div>
          {suggestError && <div className="text-[10.5px] text-[color:var(--color-danger-text)] mt-1">{suggestError}</div>}
        </div>

        <div className="grid grid-cols-2 gap-1.5 mb-3">
          {OUTCOMES.map(o => (
            <button
              key={o.key}
              type="button"
              onClick={() => pickOutcome(o)}
              className={`text-[11.5px] font-semibold px-2 py-1.5 rounded-md border text-left transition-colors ${
                outcomeKey === o.key
                  ? 'bg-[color:var(--color-accent)] border-[color:var(--color-accent)] text-white'
                  : 'bg-[color:var(--color-bg-elev)] border-[color:var(--color-line)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>

        {outcome && (
          <div className="space-y-2.5 mb-3">
            {outcome.needsFollowUp && (
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Next Follow-Up</label>
                <input
                  type="date"
                  value={followUpDate}
                  onChange={(e) => setFollowUpDate(e.target.value)}
                  className="mt-1 w-full text-[12.5px] px-2 py-1.5 rounded-md border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] text-[color:var(--color-text)]"
                />
              </div>
            )}
            {outcome.needsOffer && (
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Offer Amount</label>
                <input
                  type="number"
                  value={offerAmount}
                  onChange={(e) => setOfferAmount(e.target.value)}
                  placeholder="$"
                  className="mt-1 w-full text-[12.5px] px-2 py-1.5 rounded-md border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] text-[color:var(--color-text)]"
                />
              </div>
            )}
            {outcome.needsCounter && (
              <div>
                <label className="text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Counter Amount</label>
                <input
                  type="number"
                  value={counterAmount}
                  onChange={(e) => setCounterAmount(e.target.value)}
                  placeholder="$"
                  className="mt-1 w-full text-[12.5px] px-2 py-1.5 rounded-md border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] text-[color:var(--color-text)]"
                />
              </div>
            )}
            <div>
              <label className="text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Seller / Agent Price Expectation (optional)</label>
              <input
                type="number"
                value={sellerExpectation}
                onChange={(e) => setSellerExpectation(e.target.value)}
                placeholder="$"
                className="mt-1 w-full text-[12.5px] px-2 py-1.5 rounded-md border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] text-[color:var(--color-text)]"
              />
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="text-[11.5px] font-semibold px-3 py-1.5 rounded-md border border-[color:var(--color-line)] text-[color:var(--color-text-muted)]">Cancel</button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!outcome || saving}
            className="text-[11.5px] font-semibold px-3 py-1.5 rounded-md bg-[color:var(--color-accent)] text-white disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
