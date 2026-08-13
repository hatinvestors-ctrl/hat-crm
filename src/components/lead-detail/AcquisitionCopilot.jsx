// src/components/lead-detail/AcquisitionCopilot.jsx
// Capability #16 — AI Acquisition Copilot / Deal Brief.
//
// UI/UX contract (mission's explicit "no information overload" rules):
//   1. ONE compact decision header (Recommendation/Next Action/
//      Opportunity/Confidence/Urgency) — nothing else repeats it.
//   2. Deal Brief is collapsed by default — one-line AI summary + "Open
//      Playbook" toggle. Sub-sections inside are compact bullets, not
//      paragraphs.
//   3. Never re-displays Property/Financial/Owner data already shown
//      elsewhere on Lead Detail (PropertyInfoSection/FinancialSection/
//      DistressBanner) — only references values contextually via AI text.
//   4. Generation is ALWAYS manual (a click), never automatic — satisfies
//      Section 9 for every recommendation tier; ACT_NOW/REVIEW_TODAY just
//      get the button surfaced immediately instead of behind one extra click.
//   5. Messages (SMS/email) are hidden until explicitly requested, with Copy.

import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { computeDealBriefInputHash } from '../../lib/dealBriefInputs'

const REC_THEME = {
  ACT_NOW: { icon: '🔥', bg: 'var(--color-danger-soft)', border: 'var(--color-danger)', text: 'var(--color-danger-text)' },
  REVIEW_TODAY: { icon: '🟠', bg: 'var(--color-warn-soft)', border: 'var(--color-warn)', text: 'var(--color-warn-text)' },
  RESEARCH: { icon: '🔍', bg: 'var(--color-bg-elev-2)', border: 'var(--color-line)', text: 'var(--color-text)' },
  FOLLOW_UP: { icon: '🟡', bg: 'var(--color-accent-soft)', border: 'var(--color-accent)', text: 'var(--color-accent-text)' },
  MONITOR: { icon: '⚪', bg: 'var(--color-bg-elev-2)', border: 'var(--color-line)', text: 'var(--color-text-dim)' },
  PASS: { icon: '⬜', bg: 'var(--color-bg-elev-2)', border: 'var(--color-line)', text: 'var(--color-text-dim)' },
}
const NEXT_ACTION_LABELS = {
  SEND_OFFER: 'Send Offer', CALL_AGENT: 'Call Agent', CONTACT_OWNER: 'Contact Owner',
  VERIFY_ARV: 'Verify ARV', VERIFY_CONDITION: 'Verify Condition', RESEARCH_OWNER: 'Research Owner',
  VERIFY_OWNER: 'Verify Owner', FOLLOW_UP: 'Follow Up', WAIT_FOR_PRICE_DROP: 'Wait for Price Drop',
  MONITOR_PROPERTY: 'Monitor Property', VERIFY_FLOOD_RISK: 'Verify Flood Risk', VERIFY_TITLE: 'Verify Title',
  HUMAN_OVERRIDE: 'Human Override — Do Not Pursue', PASS: 'Pass',
}
const EASY_GENERATE = ['ACT_NOW', 'REVIEW_TODAY'] // Section 9 — everyone else still gets a manual button, just one click further

function Chip({ label, value }) {
  return <span className="text-[11px] text-[color:var(--color-text-dim)]">{label} <b className="text-[color:var(--color-text)]">{value ?? '—'}</b></span>
}

function CopyButton({ text, label }) {
  const [copied, setCopied] = useState(false)
  if (!text) return null
  return (
    <button
      type="button"
      onClick={(e) => { e.preventDefault(); navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
      className="text-[10.5px] font-bold uppercase tracking-wide px-2 py-1 rounded border border-[color:var(--color-line)] hover:bg-[color:var(--color-bg-elev-2)]"
    >
      {copied ? 'Copied ✓' : label}
    </button>
  )
}

function Bullets({ items, icon }) {
  if (!items?.length) return null
  return (
    <ul className="space-y-0.5">
      {items.map((it, i) => <li key={i} className="text-[12px] text-[color:var(--color-text-dim)]">{icon ? `${icon} ` : '• '}{it}</li>)}
    </ul>
  )
}

// Compact expandable sub-section — collapsed by default (Section: progressive disclosure).
function SubSection({ title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-t border-[color:var(--color-line)] pt-2 mt-2 first:border-t-0 first:pt-0 first:mt-0">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between text-left">
        <span className="text-[10px] uppercase tracking-wider font-bold text-[color:var(--color-text-dim)]">{title}</span>
        <span className="text-[11px] text-[color:var(--color-text-faint)]">{open ? '−' : '+'}</span>
      </button>
      {open && <div className="mt-1.5">{children}</div>}
    </div>
  )
}

export default function AcquisitionCopilot({ lead, onUpdated }) {
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState(null)
  const [playbookOpen, setPlaybookOpen] = useState(false)
  const [showSms, setShowSms] = useState(false)
  const [showEmail, setShowEmail] = useState(false)

  const d = lead.decision_v2
  if (!d) return null // nothing to show until V2 has scored this lead at all

  const theme = REC_THEME[d.recommendation] || REC_THEME.MONITOR
  const nextActionLabel = NEXT_ACTION_LABELS[d.next_best_action] || d.next_best_action
  const isOverridden = d.next_best_action === 'HUMAN_OVERRIDE'

  const currentHash = computeDealBriefInputHash(lead)
  const brief = lead.deal_brief
  const isStale = brief && brief.input_hash !== currentHash
  const canEasyGenerate = EASY_GENERATE.includes(d.recommendation)

  async function generate() {
    setGenerating(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/.netlify/functions/generate-deal-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
        body: JSON.stringify({ lead_id: lead.id }),
      })
      const body = await res.json()
      if (!res.ok || !body.ok) throw new Error(body.error || 'Failed to generate deal brief')
      onUpdated?.({ ...lead, deal_brief: body.brief, deal_brief_updated_at: body.brief.generated_at })
      setPlaybookOpen(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="rounded-lg border overflow-hidden" style={{ borderColor: theme.border, background: theme.bg }}>
      {/* ── ONE decision header — Recommendation/Next Action/Opportunity/Confidence/Urgency, nothing else repeated. ── */}
      <div className="px-3.5 py-2.5 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[15px] font-extrabold" style={{ color: theme.text }}>
            {theme.icon} {isOverridden ? 'PASS — Human Override' : d.recommendation.replace(/_/g, ' ')}
          </div>
          <div className="text-[12px] font-semibold text-[color:var(--color-text)]">{nextActionLabel}</div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Chip label="Opportunity" value={d.opportunity?.score} />
          <Chip label="Confidence" value={d.confidence?.score} />
          <Chip label="Urgency" value={d.urgency?.level} />
        </div>
      </div>

      {isOverridden && d.human_override?.reason && (
        <div className="px-3.5 pb-2 text-[11.5px] text-[color:var(--color-text-dim)]">⚠ {d.human_override.reason}</div>
      )}

      {/* ── Collapsed AI summary + Open Playbook ── */}
      <div className="px-3.5 py-2.5 border-t" style={{ borderColor: theme.border }}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-wide text-[color:var(--color-text-dim)] mb-0.5">✨ AI Acquisition Copilot</div>
            {brief ? (
              <div className="text-[12.5px] text-[color:var(--color-text)]">
                {brief.summary}
                {isStale && <span className="ml-1.5 text-[10px] font-bold text-[color:var(--color-warn-text)]">STALE — data changed</span>}
              </div>
            ) : (
              <div className="text-[12px] text-[color:var(--color-text-faint)] italic">No brief generated yet.</div>
            )}
          </div>
          <div className="shrink-0 flex flex-col items-end gap-1">
            {(!brief || isStale) && (canEasyGenerate || playbookOpen) && (
              <button type="button" disabled={generating} onClick={generate}
                className="text-[11px] font-bold px-2.5 py-1.5 rounded-md text-white disabled:opacity-60"
                style={{ background: 'var(--color-accent)' }}>
                {generating ? 'Generating…' : brief ? 'Refresh Brief' : 'Generate Deal Brief'}
              </button>
            )}
            {brief && (
              <button type="button" onClick={() => setPlaybookOpen(o => !o)} className="text-[11px] font-semibold underline text-[color:var(--color-text-dim)]">
                {playbookOpen ? 'Hide Playbook' : 'Open Playbook'}
              </button>
            )}
          </div>
        </div>
        {error && <div className="text-[11px] text-[color:var(--color-danger-text)] mt-1">⚠ {error}</div>}
        {!brief && !canEasyGenerate && !playbookOpen && (
          <button type="button" onClick={() => setPlaybookOpen(true)} className="mt-1 text-[10.5px] underline text-[color:var(--color-text-faint)]">Show generate option</button>
        )}
      </div>

      {/* ── Playbook — everything below is collapsed sub-sections, opened on demand. ── */}
      {playbookOpen && brief && (
        <div className="px-3.5 py-2.5 border-t space-y-0" style={{ borderColor: theme.border }}>
          <SubSection title="Why This Deal" defaultOpen><Bullets items={brief.why} icon="✓" /></SubSection>
          <SubSection title="⚠ Verify / Missing"><Bullets items={[...brief.missing, ...brief.risk_notes]} /></SubSection>
          <SubSection title="Questions to Ask"><Bullets items={brief.questions} /></SubSection>

          {brief.price_guidance && (
            <SubSection title="Price Guidance">
              {brief.price_guidance.ready ? (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
                  <Chip label="Ask" value={brief.price_guidance.ask ? `$${brief.price_guidance.ask.toLocaleString()}` : NA} />
                  <Chip label="Opening" value={`$${brief.price_guidance.opening.toLocaleString()}`} />
                  <Chip label="Target/Ceiling" value={`$${brief.price_guidance.target.toLocaleString()}`} />
                </div>
              ) : (
                <div className="text-[12px] text-[color:var(--color-text-dim)]">
                  <span className="font-bold">OFFER GUIDANCE: NOT READY</span> — missing {brief.price_guidance.missing.join(', ')}
                </div>
              )}
            </SubSection>
          )}

          {(brief.message_sms || brief.message_email) && (
            <SubSection title="Message">
              <div className="space-y-2">
                {brief.message_sms && (
                  <div>
                    <div className="flex items-center justify-between">
                      <button type="button" onClick={() => setShowSms(s => !s)} className="text-[11px] font-semibold text-[color:var(--color-text)]">💬 Draft SMS {showSms ? '▲' : '▼'}</button>
                      {showSms && <CopyButton text={brief.message_sms} label="Copy SMS" />}
                    </div>
                    {showSms && <div className="mt-1 text-[12px] p-2 rounded bg-[color:var(--color-bg-elev)] text-[color:var(--color-text)]">{brief.message_sms}</div>}
                  </div>
                )}
                {brief.message_email && (
                  <div>
                    <div className="flex items-center justify-between">
                      <button type="button" onClick={() => setShowEmail(s => !s)} className="text-[11px] font-semibold text-[color:var(--color-text)]">✉ Draft Email {showEmail ? '▲' : '▼'}</button>
                      {showEmail && <CopyButton text={brief.message_email} label="Copy Email" />}
                    </div>
                    {showEmail && <div className="mt-1 text-[12px] p-2 rounded bg-[color:var(--color-bg-elev)] text-[color:var(--color-text)] whitespace-pre-wrap">{brief.message_email}</div>}
                  </div>
                )}
                {!brief.message_sms && !brief.message_email && (
                  <div className="text-[11.5px] text-[color:var(--color-text-faint)] italic">Contact not ready yet — research owner/agent first.</div>
                )}
              </div>
            </SubSection>
          )}
        </div>
      )}
    </div>
  )
}

const NA = 'Not available'
