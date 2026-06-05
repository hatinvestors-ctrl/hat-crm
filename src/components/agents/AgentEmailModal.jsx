// src/components/agents/AgentEmailModal.jsx
import { useState } from 'react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import Input from '../ui/Input'

const TEMPLATES = {
  introduction: {
    label: 'Introduction',
    defaultSubject: 'Cash Buyer Looking for Properties in Jacksonville',
    preview: `Hi [Agent Name],\n\nMy name is Tomer with HAT Investors. We're active cash buyers in Jacksonville looking for investment properties. If you have any listings that aren't moving or off-market opportunities, we'd love to connect.\n\nWe close fast with no contingencies — usually within 2 weeks.\n\nWould love to hear from you if anything comes up.\n\nBest,\nHAT Investors`,
  },
  follow_up: {
    label: 'Follow-Up',
    defaultSubject: 'Following Up — Cash Buyer in Jacksonville',
    preview: `Hi [Agent Name],\n\nJust following up on my previous message. We're still actively buying in Jacksonville — if anything has come up that might be a fit, I'd love to hear about it.\n\nHappy to hop on a quick call anytime.\n\nBest,\nHAT Investors`,
  },
}

export default function AgentEmailModal({ open, onClose, agentCount, onSend }) {
  const [template, setTemplate] = useState('introduction')
  const [subject, setSubject] = useState(TEMPLATES.introduction.defaultSubject)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)

  const handleTemplateChange = (t) => {
    setTemplate(t)
    setSubject(TEMPLATES[t].defaultSubject)
  }

  const handleSend = async () => {
    setSending(true)
    setError(null)
    try {
      await onSend({ template, subject })
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Send Email to ${agentCount} Agent${agentCount === 1 ? '' : 's'}`}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={sending}>Cancel</Button>
          <Button onClick={handleSend} loading={sending}>
            Send to {agentCount} agent{agentCount === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <div className="text-[11px] uppercase tracking-wider font-medium text-[color:var(--color-text-muted)] mb-2">Template</div>
          <div className="flex gap-2">
            {Object.entries(TEMPLATES).map(([key, tmpl]) => (
              <button
                key={key}
                onClick={() => handleTemplateChange(key)}
                className={`px-3 h-8 text-[12px] font-medium rounded-md border transition-all ${
                  template === key
                    ? 'border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)]'
                    : 'border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]'
                }`}
              >
                {tmpl.label}
              </button>
            ))}
          </div>
        </div>

        <Input
          label="Subject"
          value={subject}
          onChange={e => setSubject(e.target.value)}
        />

        <div>
          <div className="text-[11px] uppercase tracking-wider font-medium text-[color:var(--color-text-muted)] mb-2">Preview</div>
          <pre className="text-[12px] text-[color:var(--color-text-muted)] bg-[color:var(--color-bg-elev-2)] border border-[color:var(--color-line)] rounded-lg p-3 whitespace-pre-wrap leading-relaxed font-sans">
            {TEMPLATES[template].preview}
          </pre>
        </div>

        {error && (
          <div className="text-[12px] text-[color:var(--color-danger-text)] bg-[color:var(--color-danger-soft)] px-3 py-2 rounded">
            {error}
          </div>
        )}
      </div>
    </Modal>
  )
}
