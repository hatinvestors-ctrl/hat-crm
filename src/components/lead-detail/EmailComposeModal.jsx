import { useState, useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'
import Modal from '../ui/Modal'
import Input from '../ui/Input'
import Textarea from '../ui/Textarea'
import Button from '../ui/Button'
import { logEmailSent } from '../../lib/activityLogger'

function buildDefaultBody(recipientName, lead, senderName) {
  const firstName = recipientName ? recipientName.split(' ')[0] : null
  const greeting = firstName ? `Hi ${firstName},` : 'Hi there,'
  const addr = [lead.address, lead.city, lead.state].filter(Boolean).join(', ')
  const price = lead.list_price ? ` listed at $${Number(lead.list_price).toLocaleString()}` : ''

  return [
    greeting,
    '',
    `My name is ${senderName || 'your name'} with HAT Investors — we're a local real estate company based in Jacksonville. We buy and renovate a high volume of properties across Jacksonville and are very active in the market.`,
    '',
    `I came across ${addr}${price} and wanted to reach out directly. We're cash buyers with the ability to close in 14–21 days, no financing contingency.`,
    '',
    `A few quick questions:`,
    `- Is the seller open to offers below list?`,
    `- Any known issues with the property?`,
    `- How long has it been on market?`,
    '',
    `Happy to schedule a walk at your convenience. Look forward to connecting.`,
    '',
    `Best,`,
    senderName || '',
    `HAT Investors`,
  ].join('\n')
}

// recipientEmail / recipientName override the listing-agent defaults when
// opening from a different contact (e.g. the seller/agent in ContactInfoSection).
export default function EmailComposeModal({ open, onClose, lead, onSent, recipientEmail, recipientName }) {
  const { user, profile, workspaceId } = useOutletContext()
  const [to, setTo]         = useState('')
  const [cc, setCc]         = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody]     = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError]   = useState(null)

  useEffect(() => {
    if (!open) return
    const city = lead.city ? `, ${lead.city}` : ''
    const toEmail    = recipientEmail ?? lead.listing_agent_email ?? ''
    const toName     = recipientName  ?? lead.listing_agent_name  ?? ''
    setTo(toEmail)
    setCc('')
    setSubject(`Inquiry about ${lead.address || ''}${city}`)
    setBody(buildDefaultBody(toName, lead, profile?.full_name))
    setError(null)
    setSending(false)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Opens Gmail's compose window in a new tab, pre-filled with To/CC/Subject/Body.
  // Sends from whatever Gmail account the user is currently logged in as
  // (e.g. hatinvestors.automation@gmail.com). The user reviews in Gmail and
  // clicks Send — we log the activity here when they hit our button.
  async function handleSend() {
    if (!to.trim()) { setError('A "To" email address is required.'); return }
    setSending(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        view: 'cm',           // compose mode
        fs:   '1',            // full screen
        to:   to.trim(),
        su:   subject || '',  // subject
        body: body || '',
      })
      if (cc.trim()) params.set('cc', cc.trim())
      const url = `https://mail.google.com/mail/?${params.toString()}`
      // Open compose tab. Browsers will block popups only if not triggered by a
      // user click — this is in a click handler, so it works.
      window.open(url, '_blank', 'noopener,noreferrer')

      // Log the send-attempt as an activity. The user still has to click Send
      // in Gmail, but logging here matches how most CRMs work.
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
          <Button variant="primary" onClick={handleSend} loading={sending} disabled={!to.trim() || sending}>
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
        <Input
          label="To"
          required
          value={to}
          onChange={e => setTo(e.target.value)}
          placeholder="agent@brokerage.com"
          type="email"
        />
        <Input
          label="CC"
          value={cc}
          onChange={e => setCc(e.target.value)}
          placeholder="optional"
          type="email"
        />
        <Input
          label="Subject"
          value={subject}
          onChange={e => setSubject(e.target.value)}
          placeholder="Email subject"
        />
        <Textarea
          label="Body"
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={9}
        />
      </div>
    </Modal>
  )
}
