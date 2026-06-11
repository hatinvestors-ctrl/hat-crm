// src/components/lead-detail/AgentNegotiationModal.jsx
//
// Full AI negotiation modal — generates initial outreach emails and counter-replies
// using psychology/negotiation techniques. Opened from DealAnalysisPanel, ContactInfoSection,
// and ListingAgentCard — the single place to email agents.

import { useState, useEffect, useRef } from 'react'
import Modal from '../ui/Modal'
import Textarea from '../ui/Textarea'

// ── Situation tabs for Initial mode ────────────────────────────────────────────
const INITIAL_TABS = [
  {
    id: 'initial',
    icon: '📋',
    label: 'Initial Offer',
    desc: 'First contact. Present the offer and establish your buyer profile.',
    psychology: 'Authority · Social proof · Certainty of close',
  },
  {
    id: 'counter',
    icon: '💬',
    label: 'Counter / Negotiate',
    desc: 'Seller pushed back. Acknowledge, re-anchor with deal math, find the path to close.',
    psychology: 'Validation + reframe · Loss aversion · Small-concession framing',
  },
  {
    id: 'competing',
    icon: '🏆',
    label: 'Beat Other Offers',
    desc: 'Multiple offers. Win on certainty, not price. Expose risks of financed buyers.',
    psychology: 'Risk framing · Contrast effect · Urgency',
  },
  {
    id: 'motivated',
    icon: '🤝',
    label: 'Motivated Seller',
    desc: 'Distressed / estate / tired landlord. Lead with empathy and speed, not numbers.',
    psychology: 'Empathy first · Relief framing · Simplicity',
  },
  {
    id: 'followup',
    icon: '⏰',
    label: 'Follow-Up',
    desc: 'No response. Re-engage with a new angle — never repeat the same pitch.',
    psychology: 'Scarcity · Controlled urgency · Open question',
  },
]

// ── Situation chips for Reply mode ─────────────────────────────────────────────
const REPLY_SITUATIONS = [
  { id: 'countered_higher',   label: 'Countered higher' },
  { id: 'high_counter',       label: 'Far above our number' },
  { id: 'not_interested',     label: 'Said not interested' },
  { id: 'competing_offers',   label: 'Has competing offers' },
  { id: 'proof_of_funds',     label: 'Asked for proof of funds' },
  { id: 'no_response',        label: 'No response / ghosted' },
  { id: 'wants_leaseback',    label: 'Wants leaseback / more time' },
  { id: 'wants_faster_close', label: 'Wants faster close' },
  { id: 'open_to_deal',       label: 'Open to deal, wants concession' },
]

// ── Desired response tone chips ────────────────────────────────────────────────
const REPLY_TONES = [
  { id: 'hold_firm',        label: '🪨 Hold firm on price' },
  { id: 'small_concession', label: '🤏 Small concession' },
  { id: 'meet_in_middle',   label: '↔ Meet in the middle' },
  { id: 'urgency',          label: '⚡ Create urgency' },
  { id: 'walkaway_signal',  label: '🚪 Walk-away signal' },
  { id: 'build_rapport',    label: '🤝 Build rapport / stay warm' },
]

function CopyBtn({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setDone(true)
      setTimeout(() => setDone(false), 1800)
    })
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="text-[11.5px] px-2.5 py-1 rounded bg-[color:var(--color-bg-elev-2)] border border-[color:var(--color-line)] hover:bg-[color:var(--color-accent-soft)] hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-accent-text)] text-[color:var(--color-text-muted)] transition-colors"
    >
      {done ? '✅ Copied' : label}
    </button>
  )
}

function Chip({ label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-[11.5px] font-medium border transition-colors ${
        active
          ? 'bg-[color:var(--color-accent)] text-white border-[color:var(--color-accent)]'
          : 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-muted)] border-[color:var(--color-line)] hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-text)]'
      }`}
    >
      {label}
    </button>
  )
}

function EmailOutput({ subject, body, loading, error, toEmail }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-[13px] text-[color:var(--color-text-muted)]">
        <svg className="animate-spin mr-2 h-4 w-4 text-[color:var(--color-accent)]" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
        </svg>
        Generating…
      </div>
    )
  }
  if (error) {
    return (
      <div className="px-3 py-2 rounded-md bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-text)] text-[12px]">
        {error}
      </div>
    )
  }
  if (!body) return null

  const gmailParams = new URLSearchParams({ view: 'cm', fs: '1' })
  if (toEmail) gmailParams.set('to', toEmail)
  if (subject) gmailParams.set('su', subject)
  if (body)    gmailParams.set('body', body)

  return (
    <div className="space-y-2">
      {subject && (
        <div className="flex items-start gap-2">
          <div className="flex-1 bg-[color:var(--color-bg-elev-2)] border border-[color:var(--color-line)] rounded-md px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1">Subject</div>
            <div className="text-[13px] font-medium text-[color:var(--color-text)]">{subject}</div>
          </div>
          <CopyBtn text={subject} label="Copy Subject" />
        </div>
      )}
      <div className="bg-[color:var(--color-bg-elev-2)] border border-[color:var(--color-line)] rounded-md px-3 py-3">
        <div className="text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-2">Email Body</div>
        <pre className="text-[12.5px] text-[color:var(--color-text-muted)] leading-relaxed whitespace-pre-wrap font-[inherit]">{body}</pre>
      </div>
      <div className="flex gap-1.5 flex-wrap">
        <CopyBtn text={body} label="Copy Body" />
        <CopyBtn text={subject ? `Subject: ${subject}\n\n${body}` : body} label="Copy All" />
        <a
          href={`https://mail.google.com/mail/?${gmailParams.toString()}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11.5px] px-2.5 py-1 rounded bg-[color:var(--color-accent-soft)] border border-[color:var(--color-accent)] text-[color:var(--color-accent-text)] hover:bg-[color:var(--color-accent)] hover:text-white transition-colors"
        >
          Open in Gmail ↗
        </a>
      </div>
    </div>
  )
}

function gapLabel(lead) {
  const offer  = Number(lead.offer_price || lead.mao) || null
  const asking = Number(lead.asking_price) || null
  if (!offer || !asking) return null
  const gap = (asking - offer) / asking
  if (gap < 0.05)  return { label: 'Near Ask',    color: 'text-[color:var(--color-success-text)]' }
  if (gap <= 0.20) return { label: 'Moderate Gap', color: 'text-[color:var(--color-warn-text)]' }
  return               { label: 'Large Gap',     color: 'text-[color:var(--color-danger-text)]' }
}

// recipientEmail: optional override — use when opening from Contact section
//                 (may be a different email than listing_agent_email)
export default function AgentNegotiationModal({ open, onClose, lead, recipientEmail }) {
  const toEmail = recipientEmail || lead.listing_agent_email || ''

  const [activeTab,      setActiveTab]      = useState('initial')
  const [initialSubject, setInitialSubject] = useState('')
  const [initialBody,    setInitialBody]    = useState('')
  const [initialLoading, setInitialLoading] = useState(false)
  const [initialError,   setInitialError]   = useState(null)

  const [replyExpanded, setReplyExpanded]  = useState(false)
  const [theirReply,    setTheirReply]     = useState('')
  const [situations,    setSituations]     = useState([])
  const [tones,         setTones]          = useState([])
  const [replySubject,  setReplySubject]   = useState('')
  const [replyBody,     setReplyBody]      = useState('')
  const [replyLoading,  setReplyLoading]   = useState(false)
  const [replyError,    setReplyError]     = useState(null)

  const prevTab = useRef(null)

  useEffect(() => {
    if (!open) return
    setActiveTab('initial')
    setInitialSubject(''); setInitialBody(''); setInitialLoading(false); setInitialError(null)
    setReplyExpanded(false); setTheirReply(''); setSituations([]); setTones([])
    setReplySubject(''); setReplyBody(''); setReplyLoading(false); setReplyError(null)
    prevTab.current = null
  }, [open])

  useEffect(() => {
    if (!open) return
    if (prevTab.current === activeTab) return
    prevTab.current = activeTab
    generateInitial(activeTab)
  }, [open, activeTab]) // eslint-disable-line react-hooks/exhaustive-deps

  async function callApi(payload) {
    const res = await fetch('/.netlify/functions/generate-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        lead: {
          address:            lead.address,
          city:               lead.city,
          state:              lead.state,
          property_type:      lead.property_type,
          bedrooms:           lead.bedrooms,
          bathrooms:          lead.bathrooms,
          sqft:               lead.sqft,
          year_built:         lead.year_built,
          asking_price:       lead.asking_price,
          offer_price:        lead.offer_price,
          arv:                lead.arv,
          renovation_cost:    lead.renovation_cost,
          mao:                lead.mao,
          rent_estimate:      lead.rent_estimate,
          mls_status:         lead.mls_status,
          listing_agent_name: lead.listing_agent_name,
        },
      }),
    })
    const data = await res.json()
    if (!res.ok || !data.ok) throw new Error(data.error || 'Generation failed.')
    return data
  }

  async function generateInitial(tab) {
    setInitialLoading(true); setInitialError(null)
    setInitialSubject(''); setInitialBody('')
    try {
      const data = await callApi({ mode: 'initial', situation_type: tab })
      setInitialSubject(data.subject || '')
      setInitialBody(data.body || '')
    } catch (err) {
      setInitialError(err.message || 'Could not generate email.')
    } finally {
      setInitialLoading(false)
    }
  }

  async function generateReply() {
    setReplyLoading(true); setReplyError(null)
    setReplySubject(''); setReplyBody('')
    try {
      const data = await callApi({
        mode: 'reply',
        situation: [...situations, ...tones.map(t => `DESIRED TONE: ${t}`)],
        their_reply: theirReply,
      })
      setReplySubject(data.subject || '')
      setReplyBody(data.body || '')
    } catch (err) {
      setReplyError(err.message || 'Could not generate reply.')
    } finally {
      setReplyLoading(false)
    }
  }

  const toggle = (arr, setArr, id) =>
    setArr(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

  const gap = gapLabel(lead)
  const currentTab = INITIAL_TABS.find(t => t.id === activeTab)

  return (
    <Modal open={open} onClose={onClose} title="Generate Agent Email" size="lg">
      <div className="space-y-4">

        {/* Lead + recipient strip */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 rounded-md bg-[color:var(--color-bg-elev-2)] border border-[color:var(--color-line)]">
          <span className="text-[12px] font-medium text-[color:var(--color-text)]">
            {lead.address}{lead.city ? `, ${lead.city}` : ''}
          </span>
          {lead.listing_agent_name && (
            <span className="text-[11.5px] text-[color:var(--color-text-muted)]">
              Agent: {lead.listing_agent_name}
            </span>
          )}
          {toEmail && (
            <span className="text-[11px] text-[color:var(--color-text-dim)]">→ {toEmail}</span>
          )}
          {gap && (
            <span className={`text-[11px] font-semibold uppercase tracking-wide ${gap.color}`}>
              {gap.label}
            </span>
          )}
        </div>

        {/* Strategy tabs */}
        <div className="space-y-2">
          <div className="text-[10.5px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)]">Email Strategy</div>
          <div className="flex flex-wrap gap-1.5">
            {INITIAL_TABS.map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => { if (tab.id !== activeTab) { setInitialSubject(''); setInitialBody(''); setActiveTab(tab.id) } }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium border transition-colors ${
                  activeTab === tab.id
                    ? 'bg-[color:var(--color-accent)] text-white border-[color:var(--color-accent)]'
                    : 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-muted)] border-[color:var(--color-line)] hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-text)]'
                }`}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          {currentTab && (
            <div className="px-3 py-2 rounded-md bg-[color:var(--color-bg-elev-2)] border border-[color:var(--color-line)] space-y-1">
              <div className="text-[12px] text-[color:var(--color-text-muted)]">{currentTab.desc}</div>
              <div className="text-[11px] text-[color:var(--color-accent-text)] font-medium">
                Psychology: {currentTab.psychology}
              </div>
            </div>
          )}
        </div>

        {/* Regenerate */}
        <button
          type="button"
          onClick={() => generateInitial(activeTab)}
          disabled={initialLoading}
          className="flex items-center gap-2 text-[12.5px] font-semibold px-3 py-1.5 rounded-md bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)] border border-[color:var(--color-accent)] hover:bg-[color:var(--color-accent)] hover:text-white disabled:opacity-50 transition-colors"
        >
          {initialLoading ? '…' : '✦'} {initialLoading ? 'Generating…' : 'Regenerate'}
        </button>

        <EmailOutput
          subject={initialSubject}
          body={initialBody}
          loading={initialLoading}
          error={initialError}
          toEmail={toEmail}
        />

        {/* ── Reply section ──────────────────────────────────────────────────── */}
        <div className="border-t border-[color:var(--color-line)] pt-3">
          <button
            type="button"
            onClick={() => setReplyExpanded(v => !v)}
            className="flex items-center gap-2 text-[12.5px] font-semibold text-[color:var(--color-text)] hover:text-[color:var(--color-accent-text)] transition-colors"
          >
            <span className="text-[color:var(--color-accent)]">{replyExpanded ? '▾' : '▸'}</span>
            Agent Replied? Generate Counter-Response
          </button>

          {replyExpanded && (
            <div className="mt-3 space-y-3">
              <Textarea
                label="Paste agent's reply (optional)"
                value={theirReply}
                onChange={e => setTheirReply(e.target.value)}
                rows={4}
                placeholder="Paste the email they sent back…"
              />

              <div>
                <div className="text-[10.5px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)] mb-1.5">
                  What did they say?
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {REPLY_SITUATIONS.map(opt => (
                    <Chip
                      key={opt.id}
                      label={opt.label}
                      active={situations.includes(opt.id)}
                      onClick={() => toggle(situations, setSituations, opt.id)}
                    />
                  ))}
                </div>
              </div>

              <div>
                <div className="text-[10.5px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)] mb-1.5">
                  Desired response tone
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {REPLY_TONES.map(opt => (
                    <Chip
                      key={opt.id}
                      label={opt.label}
                      active={tones.includes(opt.id)}
                      onClick={() => toggle(tones, setTones, opt.id)}
                    />
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={generateReply}
                disabled={replyLoading}
                className="flex items-center gap-2 text-[12.5px] font-semibold px-3 py-1.5 rounded-md bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)] border border-[color:var(--color-accent)] hover:bg-[color:var(--color-accent)] hover:text-white disabled:opacity-50 transition-colors"
              >
                {replyLoading ? '…' : '✦'} {replyLoading ? 'Generating…' : 'Generate Counter-Response'}
              </button>

              <EmailOutput
                subject={replySubject}
                body={replyBody}
                loading={replyLoading}
                error={replyError}
                toEmail={toEmail}
              />
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
