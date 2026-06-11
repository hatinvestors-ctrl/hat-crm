// src/components/lead-detail/AgentPhoneScriptModal.jsx
//
// AI phone script generator — word-for-word call scripts for Kevin Bachman
// (buyer's agent) calling the listing agent. Uses deal numbers, psychology,
// and negotiation techniques adapted to the exact deal situation.

import { useState, useEffect, useRef } from 'react'
import Modal from '../ui/Modal'

// ── Call stage tabs ────────────────────────────────────────────────────────────
const STAGES = [
  {
    id: 'first_contact',
    icon: '📋',
    label: 'First Contact',
    desc: 'Initial call — introduce yourself, qualify the deal, plant the seed before submitting.',
    goal: 'Be the agent they want to work with before price is even on the table.',
  },
  {
    id: 'after_offer',
    icon: '📬',
    label: 'After Offer Sent',
    desc: "Offer is in, no response yet. Find out where things stand and re-anchor HAT's advantages.",
    goal: 'Get a reaction. Re-confirm terms. Ask for a counter or a decision timeline.',
  },
  {
    id: 'negotiate',
    icon: '💬',
    label: 'Negotiate on the Call',
    desc: 'Seller pushed back or countered. Hold the number. Find creative paths to close.',
    goal: 'Justify your number with math, not opinion. Offer term flexibility before price flexibility.',
  },
  {
    id: 'competing',
    icon: '🏆',
    label: 'Competing Offers',
    desc: 'Multiple offers on the table. Win on certainty and net proceeds — not list price.',
    goal: 'Make financed buyers look risky. HAT\'s clean close is the safer bet for the seller.',
  },
  {
    id: 'followup',
    icon: '⏰',
    label: 'Follow-Up',
    desc: 'Gone dark after offer or prior call. Re-engage with controlled urgency, no desperation.',
    goal: 'Get an answer: yes, no, or counter. Give them an easy face-saving out.',
  },
]

// ── Call tone options ──────────────────────────────────────────────────────────
const TONES = [
  {
    id: 'warm',
    icon: '😊',
    label: 'Warm & Friendly',
    desc: 'Build rapport first. Smile comes through in the voice. Prioritize liking and trust.',
  },
  {
    id: 'confident',
    icon: '💼',
    label: 'Confident & Professional',
    desc: 'Calm authority. Measured pace. No hedging. Sounds like 20 deals a year.',
  },
  {
    id: 'assertive',
    icon: '💪',
    label: 'Assertive',
    desc: 'Direct, no fluff. Respectful but firm. Offer is solid — not moving much.',
  },
  {
    id: 'urgent',
    icon: '⚡',
    label: 'Urgent',
    desc: 'Real time pressure. Two other deals active this week. Needs an answer.',
  },
  {
    id: 'empathetic',
    icon: '🤝',
    label: 'Empathetic',
    desc: 'Best for distressed/estate sellers. Lead with understanding. Listen more than talk.',
  },
]

// ── Render the script with visual formatting ───────────────────────────────────
function ScriptRenderer({ text }) {
  if (!text) return null

  // Split by lines and apply styling
  const lines = text.split('\n')
  return (
    <div className="space-y-0.5 font-mono text-[12.5px] leading-relaxed">
      {lines.map((line, i) => {
        const trimmed = line.trim()

        if (/^\[PAUSE/i.test(trimmed)) {
          return (
            <div key={i} className="my-2 px-3 py-1.5 rounded bg-[color:var(--color-accent-soft)] border-l-4 border-[color:var(--color-accent)] text-[color:var(--color-accent-text)] text-[11.5px] font-semibold">
              {trimmed}
            </div>
          )
        }
        if (/^\[IF THEY SAY/i.test(trimmed)) {
          return (
            <div key={i} className="mt-3 mb-1 text-[11px] font-bold uppercase tracking-wider text-[color:var(--color-warn-text)]">
              {trimmed}
            </div>
          )
        }
        if (/^\[GOAL CHECK/i.test(trimmed)) {
          return (
            <div key={i} className="my-2 px-3 py-1.5 rounded bg-[color:var(--color-success-soft)] border-l-4 border-[color:var(--color-success)] text-[color:var(--color-success-text)] text-[11.5px] italic">
              {trimmed}
            </div>
          )
        }
        if (trimmed === '') {
          return <div key={i} className="h-2" />
        }

        // Render **bold** markers
        const parts = trimmed.split(/(\*\*[^*]+\*\*)/g)
        return (
          <div key={i} className={`text-[color:var(--color-text-muted)] ${trimmed.startsWith('  ') || trimmed.startsWith('\t') ? 'ml-6 text-[color:var(--color-text-dim)]' : ''}`}>
            {parts.map((part, j) =>
              part.startsWith('**') && part.endsWith('**')
                ? <strong key={j} className="text-[color:var(--color-text)] font-semibold">{part.slice(2, -2)}</strong>
                : part
            )}
          </div>
        )
      })}
    </div>
  )
}

function gapLabel(lead) {
  const offer  = Number(lead.offer_price || lead.mao) || null
  const asking = Number(lead.asking_price) || null
  if (!offer || !asking) return null
  const gap = (asking - offer) / asking
  if (gap < 0.02)  return { label: 'At/Above Ask',  color: 'text-[color:var(--color-success-text)]' }
  if (gap < 0.05)  return { label: 'Near Ask',       color: 'text-[color:var(--color-success-text)]' }
  if (gap <= 0.20) return { label: 'Moderate Gap',   color: 'text-[color:var(--color-warn-text)]' }
  return               { label: 'Large Gap',        color: 'text-[color:var(--color-danger-text)]' }
}

export default function AgentPhoneScriptModal({ open, onClose, lead }) {
  const [stage,         setStage]         = useState('first_contact')
  const [tone,          setTone]          = useState('confident')
  const [context,       setContext]       = useState('')
  const [script,        setScript]        = useState('')
  const [loading,       setLoading]       = useState(false)
  const [error,         setError]         = useState(null)
  const [copied,        setCopied]        = useState(false)

  const prevKey = useRef(null)

  useEffect(() => {
    if (!open) return
    setStage('first_contact'); setTone('confident')
    setContext(''); setScript(''); setLoading(false); setError(null)
    prevKey.current = null
  }, [open])

  // Auto-generate when stage or tone changes
  useEffect(() => {
    if (!open) return
    const key = `${stage}:${tone}`
    if (prevKey.current === key) return
    prevKey.current = key
    generate(stage, tone)
  }, [open, stage, tone]) // eslint-disable-line react-hooks/exhaustive-deps

  async function generate(s, t) {
    setLoading(true); setError(null); setContext(''); setScript('')
    try {
      const res = await fetch('/.netlify/functions/generate-phone-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stage: s,
          tone: t,
          lead: {
            address:         lead.address,
            city:            lead.city,
            state:           lead.state,
            property_type:   lead.property_type,
            bedrooms:        lead.bedrooms,
            bathrooms:       lead.bathrooms,
            sqft:            lead.sqft,
            year_built:      lead.year_built,
            asking_price:    lead.asking_price,
            offer_price:     lead.offer_price,
            arv:             lead.arv,
            renovation_cost: lead.renovation_cost,
            mao:             lead.mao,
            rent_estimate:   lead.rent_estimate,
            mls_status:      lead.mls_status,
            listing_agent_name: lead.listing_agent_name,
          },
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || 'Generation failed.')
      setContext(data.context || '')
      setScript(data.script || '')
    } catch (err) {
      setError(err.message || 'Could not generate script.')
    } finally {
      setLoading(false)
    }
  }

  function copyScript() {
    const text = (context ? `SITUATION:\n${context}\n\n---\n\n` : '') + script
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }

  const gap          = gapLabel(lead)
  const currentStage = STAGES.find(s => s.id === stage)
  const currentTone  = TONES.find(t => t.id === tone)

  return (
    <Modal open={open} onClose={onClose} title="Generate Phone Script" size="lg">
      <div className="space-y-4">

        {/* Lead strip */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 rounded-md bg-[color:var(--color-bg-elev-2)] border border-[color:var(--color-line)]">
          <span className="text-[12px] font-medium text-[color:var(--color-text)]">
            {lead.address}{lead.city ? `, ${lead.city}` : ''}
          </span>
          {lead.listing_agent_name && (
            <span className="text-[11.5px] text-[color:var(--color-text-muted)]">
              Calling: {lead.listing_agent_name}
            </span>
          )}
          {lead.listing_agent_phone && (
            <a
              href={`tel:${lead.listing_agent_phone}`}
              className="text-[11.5px] text-[color:var(--color-accent-text)] hover:underline"
            >
              {lead.listing_agent_phone}
            </a>
          )}
          {gap && (
            <span className={`text-[11px] font-semibold uppercase tracking-wide ${gap.color}`}>
              {gap.label}
            </span>
          )}
        </div>

        {/* Stage tabs */}
        <div className="space-y-2">
          <div className="text-[10.5px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)]">
            Call Stage
          </div>
          <div className="flex flex-wrap gap-1.5">
            {STAGES.map(s => (
              <button
                key={s.id}
                type="button"
                onClick={() => { if (s.id !== stage) setStage(s.id) }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium border transition-colors ${
                  stage === s.id
                    ? 'bg-[color:var(--color-accent)] text-white border-[color:var(--color-accent)]'
                    : 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-muted)] border-[color:var(--color-line)] hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-text)]'
                }`}
              >
                <span>{s.icon}</span>
                <span>{s.label}</span>
              </button>
            ))}
          </div>
          {currentStage && (
            <div className="px-3 py-2 rounded-md bg-[color:var(--color-bg-elev-2)] border border-[color:var(--color-line)] space-y-0.5">
              <div className="text-[12px] text-[color:var(--color-text-muted)]">{currentStage.desc}</div>
              <div className="text-[11px] text-[color:var(--color-accent-text)] font-medium">
                Goal: {currentStage.goal}
              </div>
            </div>
          )}
        </div>

        {/* Tone selection */}
        <div className="space-y-2">
          <div className="text-[10.5px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)]">
            Call Tone
          </div>
          <div className="flex flex-wrap gap-1.5">
            {TONES.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => { if (t.id !== tone) setTone(t.id) }}
                title={t.desc}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium border transition-colors ${
                  tone === t.id
                    ? 'bg-[color:var(--color-warn)] text-[#1a1a1a] border-[color:var(--color-warn)]'
                    : 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-muted)] border-[color:var(--color-line)] hover:border-[color:var(--color-warn)] hover:text-[color:var(--color-text)]'
                }`}
              >
                <span>{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>
          {currentTone && (
            <div className="text-[11.5px] text-[color:var(--color-text-dim)] px-1">{currentTone.desc}</div>
          )}
        </div>

        {/* Regenerate */}
        <button
          type="button"
          onClick={() => { prevKey.current = null; generate(stage, tone) }}
          disabled={loading}
          className="flex items-center gap-2 text-[12.5px] font-semibold px-3 py-1.5 rounded-md bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)] border border-[color:var(--color-accent)] hover:bg-[color:var(--color-accent)] hover:text-white disabled:opacity-50 transition-colors"
        >
          {loading ? '…' : '✦'} {loading ? 'Generating…' : 'Regenerate Script'}
        </button>

        {/* Error */}
        {error && (
          <div className="px-3 py-2 rounded-md bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-text)] text-[12px]">
            {error}
          </div>
        )}

        {/* Loading spinner */}
        {loading && (
          <div className="flex items-center justify-center py-10 text-[13px] text-[color:var(--color-text-muted)]">
            <svg className="animate-spin mr-2 h-5 w-5 text-[color:var(--color-accent)]" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
            </svg>
            Generating script…
          </div>
        )}

        {/* Context box */}
        {!loading && context && (
          <div className="px-4 py-3 rounded-md border border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)]">
            <div className="text-[10px] uppercase tracking-wider font-bold text-[color:var(--color-accent-text)] mb-1.5">
              📌 Situation Analysis
            </div>
            <p className="text-[12.5px] text-[color:var(--color-text)] leading-relaxed">{context}</p>
          </div>
        )}

        {/* Script */}
        {!loading && script && (
          <div className="rounded-md border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[color:var(--color-line)]">
              <div className="text-[10px] uppercase tracking-wider font-bold text-[color:var(--color-text-dim)]">
                Word-for-Word Script
              </div>
              <div className="flex gap-1.5 items-center text-[10px] text-[color:var(--color-text-dim)]">
                <span className="px-1.5 py-0.5 rounded bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)] font-semibold">Blue = pause</span>
                <span className="px-1.5 py-0.5 rounded bg-[color:var(--color-warn-soft)] text-[color:var(--color-warn-text)] font-semibold">Orange = objection</span>
                <span className="px-1.5 py-0.5 rounded bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)] font-semibold">Green = coaching</span>
              </div>
            </div>
            <div className="px-4 py-4 max-h-[420px] overflow-y-auto">
              <ScriptRenderer text={script} />
            </div>
          </div>
        )}

        {/* Copy button */}
        {!loading && script && (
          <button
            type="button"
            onClick={copyScript}
            className="flex items-center gap-2 text-[12.5px] font-semibold px-3 py-1.5 rounded-md bg-[color:var(--color-bg-elev-2)] border border-[color:var(--color-line)] hover:bg-[color:var(--color-accent-soft)] hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-accent-text)] text-[color:var(--color-text-muted)] transition-colors"
          >
            {copied ? '✅ Copied!' : '📋 Copy Script'}
          </button>
        )}
      </div>
    </Modal>
  )
}
