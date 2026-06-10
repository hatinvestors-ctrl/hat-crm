import { useState, useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'
import Modal from '../ui/Modal'
import Input from '../ui/Input'
import Textarea from '../ui/Textarea'
import Button from '../ui/Button'
import { logEmailSent } from '../../lib/activityLogger'

const SITUATION_OPTIONS = [
  { id: 'countered_higher',     label: 'Countered higher' },
  { id: 'asked_proof_of_funds', label: 'Asked for proof of funds' },
  { id: 'said_not_interested',  label: 'Said not interested' },
  { id: 'no_response_ghosted',  label: 'No response / ghosted' },
  { id: 'wants_faster_close',   label: 'Wants faster close' },
  { id: 'wants_leaseback',      label: 'Wants leaseback / stay longer' },
]

// recipientEmail / recipientName override the listing-agent defaults when
// opening from a different contact (e.g. the seller/agent in ContactInfoSection).
export default function EmailComposeModal({ open, onClose, lead, onSent, recipientEmail }) {
  const { user, workspaceId } = useOutletContext()
  const [activeTab,  setActiveTab]  = useState('initial')
  const [to,         setTo]         = useState('')
  const [cc,         setCc]         = useState('')
  const [subject,    setSubject]    = useState('')
  const [body,       setBody]       = useState('')
  const [sending,    setSending]    = useState(false)
  const [generating, setGenerating] = useState(false)
  const [genError,   setGenError]   = useState(null)
  const [error,      setError]      = useState(null)
  const [situations, setSituations] = useState([])
  const [theirReply, setTheirReply] = useState('')

  useEffect(() => {
    if (!open) return
    const city    = lead.city ? `, ${lead.city}` : ''
    const toEmail = recipientEmail ?? lead.listing_agent_email ?? ''
    setTo(toEmail)
    setCc('')
    setSubject(`Inquiry about ${lead.address || ''}${city}`)
    setBody('')
    setActiveTab('initial')
    setSituations([])
    setTheirReply('')
    setGenError(null)
    setError(null)
    setSending(false)
    setGenerating(false)
  }, [open, lead, recipientEmail]) // reset fields whenever modal opens or lead changes while open

  const toggleSituation = (id) =>
    setSituations(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id])

  async function handleGenerate(mode) {
    setGenerating(true)
    setGenError(null)
    try {
      const res = await fetch('/.netlify/functions/generate-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
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
          situation:   mode === 'reply' ? situations : [],
          their_reply: mode === 'reply' ? theirReply : '',
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || 'Generation failed.')
      setBody(data.body)
    } catch (err) {
      setGenError(err.message || 'Could not generate email.')
    } finally {
      setGenerating(false)
    }
  }

  async function handleSend() {
    if (!to.trim()) { setError('A "To" email address is required.'); return }
    setSending(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        view: 'cm',
        fs:   '1',
        to:   to.trim(),
        su:   subject || '',
        body: body || '',
      })
      if (cc.trim()) params.set('cc', cc.trim())
      const url = `https://mail.google.com/mail/?${params.toString()}`
      const win = window.open(url, '_blank', 'noopener,noreferrer')
      if (!win) {
        setError('Pop-up blocked — allow pop-ups for this site and try again.')
        return
      }
      await logEmailSent(lead.id, user.id, { to: to.trim(), cc: cc.trim(), subject })
      onSent?.()
      onClose()
    } catch (err) {
      setError(err.message || 'Could not open Gmail. Check that pop-ups are allowed.')
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={sending ? undefined : onClose}
      title="Compose Email"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={sending}>Cancel</Button>
          <Button variant="primary" onClick={handleSend} loading={sending} disabled={!to.trim() || sending || generating}>
            Open in Gmail ↗
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="px-3 py-2 rounded-md bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-muted)] text-[11.5px] leading-relaxed">
          Opens Gmail compose in a new tab pre-filled with these fields. Sends from the Gmail account you're currently signed in to (<span className="font-medium text-[color:var(--color-text)]">hatinvestors.automation@gmail.com</span> if you're signed in there). Review in Gmail and click Send — no SMTP setup required.
        </div>

        {error && (
          <div className="px-3 py-2 rounded-md bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-text)] text-[12.5px]">
            {error}
          </div>
        )}

        <Input label="To" required value={to} onChange={e => setTo(e.target.value)} placeholder="agent@brokerage.com" type="email" />
        <Input label="CC" value={cc} onChange={e => setCc(e.target.value)} placeholder="optional" type="email" />
        <Input label="Subject" value={subject} onChange={e => setSubject(e.target.value)} placeholder="Email subject" />

        {/* Tabs */}
        <div className="border-b border-[color:var(--color-line)] flex gap-0">
          {[
            { id: 'initial', label: 'Initial Outreach' },
            { id: 'reply',   label: 'Reply / Follow-up' },
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-[12px] font-medium border-b-2 -mb-px transition-colors ${
                activeTab === tab.id
                  ? 'border-[color:var(--color-accent)] text-[color:var(--color-accent)]'
                  : 'border-transparent text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Reply tab inputs */}
        {activeTab === 'reply' && (
          <div className="space-y-3">
            <div>
              <div className="text-[11px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)] mb-1.5">Situation</div>
              <div className="flex flex-wrap gap-1.5">
                {SITUATION_OPTIONS.map(opt => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => toggleSituation(opt.id)}
                    className={`px-2.5 py-1 rounded-full text-[11.5px] font-medium border transition-colors ${
                      situations.includes(opt.id)
                        ? 'bg-[color:var(--color-accent)] text-white border-[color:var(--color-accent)]'
                        : 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-muted)] border-[color:var(--color-line)] hover:border-[color:var(--color-accent)] hover:text-[color:var(--color-text)]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <Textarea
              label="Paste their reply (optional)"
              value={theirReply}
              onChange={e => setTheirReply(e.target.value)}
              rows={4}
              placeholder="Paste the email they sent back…"
            />
          </div>
        )}

        {genError && (
          <div className="px-3 py-2 rounded-md bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-text)] text-[12px]">
            {genError}
          </div>
        )}

        <button
          type="button"
          onClick={() => handleGenerate(activeTab)}
          disabled={generating}
          className="w-full h-9 flex items-center justify-center gap-2 rounded-md bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)] border border-[color:var(--color-accent)] text-[12.5px] font-semibold hover:bg-[color:var(--color-accent)] hover:text-white disabled:opacity-50 transition-colors"
        >
          {generating ? 'Generating…' : activeTab === 'initial' ? '✦ Generate Email' : '✦ Generate Reply'}
        </button>

        <Textarea
          label="Body"
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={10}
        />
      </div>
    </Modal>
  )
}
