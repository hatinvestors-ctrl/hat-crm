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

const AI_SCENARIO_OPTIONS = [
  { value: 'intro',        label: 'Introduction' },
  { value: 'check_in',     label: 'Check-In' },
  { value: 'reactivation', label: 'Reactivation' },
  { value: 'post_close',   label: 'Post-Close Thank You' },
  { value: 'passed_deal',  label: 'Passed Deal Follow-Up' },
]

export default function AgentEmailModal({ open, onClose, agentCount = 1, agent, workspaceId, onSend }) {
  const [template, setTemplate] = useState('introduction')
  const [subject, setSubject] = useState(TEMPLATES.introduction.defaultSubject)
  const [body, setBody] = useState('')
  const [useCustomBody, setUseCustomBody] = useState(false)
  const [sending, setSending] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [aiScenario, setAiScenario] = useState('intro')
  const [aiSender, setAiSender] = useState('hat_team')
  const [customNote, setCustomNote] = useState('')
  const [generatedBy, setGeneratedBy] = useState(null)
  const [error, setError] = useState(null)

  const handleTemplateChange = (t) => {
    setTemplate(t)
    setSubject(TEMPLATES[t].defaultSubject)
    setUseCustomBody(false)
    setGeneratedBy(null)
  }

  const handleGenerate = async () => {
    if (!agent) return
    setGenerating(true)
    setError(null)
    try {
      const res = await fetch('/.netlify/functions/generate-agent-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          agent_id: agent.id,
          scenario_type: aiScenario,
          sender: aiSender,
          context: {
            agent_name: agent.name,
            brokerage: agent.brokerage,
            relationship_status: agent.relationship_status,
            market_areas: agent.market_areas,
            last_contacted_at: agent.last_contacted_at,
            custom_note: customNote.trim() || undefined,
          },
        }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || 'Generation failed')
      setSubject(data.subject || subject)
      setBody(data.body || '')
      setUseCustomBody(true)
      setGeneratedBy(data.generated_by)
    } catch (e) {
      setError(e.message)
    } finally {
      setGenerating(false)
    }
  }

  const handleSend = async () => {
    setSending(true)
    setError(null)
    try {
      await onSend({ template, subject, body: useCustomBody ? body : undefined })
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }

  const canGenerate = Boolean(agent)

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
        {/* AI Generation (single agent only) */}
        {canGenerate && (
          <div className="bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] rounded-lg p-3 space-y-2">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)]">Generate with AI</div>
            <div className="flex gap-2 flex-wrap">
              <select
                value={aiScenario}
                onChange={e => setAiScenario(e.target.value)}
                className="text-[12px] px-2 h-8 bg-[color:var(--color-bg)] border border-[color:var(--color-line)] rounded text-[color:var(--color-text)] focus:outline-none"
              >
                {AI_SCENARIO_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <select
                value={aiSender}
                onChange={e => setAiSender(e.target.value)}
                className="text-[12px] px-2 h-8 bg-[color:var(--color-bg)] border border-[color:var(--color-line)] rounded text-[color:var(--color-text)] focus:outline-none"
              >
                <option value="hat_team">From: HAT Investors team</option>
                <option value="kevin">From: Kevin Bachman</option>
              </select>
              <Button size="sm" variant="secondary" onClick={handleGenerate} loading={generating}>
                Generate
              </Button>
            </div>
            <input
              type="text"
              value={customNote}
              onChange={e => setCustomNote(e.target.value)}
              placeholder="Optional context hint (e.g. 'we met at the JREP event')"
              className="w-full text-[12px] px-2 h-7 bg-[color:var(--color-bg)] border border-[color:var(--color-line)] rounded text-[color:var(--color-text)] placeholder:text-[color:var(--color-text-faint)] focus:outline-none"
            />
            {generatedBy === 'template' && (
              <div className="text-[11px] text-[color:var(--color-warn-text)]">
                Not enough context for AI — using a template instead.
              </div>
            )}
          </div>
        )}

        {/* Template picker (shown when no AI body generated) */}
        {!useCustomBody && (
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
        )}

        <Input
          label="Subject"
          value={subject}
          onChange={e => setSubject(e.target.value)}
        />

        {/* Body — editable AI output or template preview */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] uppercase tracking-wider font-medium text-[color:var(--color-text-muted)]">
              {useCustomBody ? 'Email Body' : 'Preview'}
            </div>
            {useCustomBody && (
              <button
                type="button"
                onClick={() => { setUseCustomBody(false); setGeneratedBy(null) }}
                className="text-[11px] text-[color:var(--color-accent)] hover:underline"
              >
                Use template instead
              </button>
            )}
          </div>
          {useCustomBody ? (
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={10}
              className="w-full text-[12px] px-3 py-2 bg-[color:var(--color-bg-elev-2)] border border-[color:var(--color-line)] rounded-lg text-[color:var(--color-text)] focus:outline-none focus:border-[color:var(--color-accent)] resize-y leading-relaxed font-sans"
            />
          ) : (
            <pre className="text-[12px] text-[color:var(--color-text-muted)] bg-[color:var(--color-bg-elev-2)] border border-[color:var(--color-line)] rounded-lg p-3 whitespace-pre-wrap leading-relaxed font-sans">
              {TEMPLATES[template].preview}
            </pre>
          )}
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
