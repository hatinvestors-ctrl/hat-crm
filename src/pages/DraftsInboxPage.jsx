import { useEffect, useState, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Button from '../components/ui/Button'

const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'

export default function DraftsInboxPage() {
  const { workspaceId, userId } = useOutletContext()
  const [drafts, setDrafts] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [skipping, setSkipping] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('message_drafts')
      .select(`
        *,
        agent:agents(id, name, email, brokerage, relationship_status),
        scheduled_message:scheduled_messages(id, scheduled_for, status, step_id)
      `)
      .eq('workspace_id', workspaceId)
      .is('approved_at', null)
      .order('created_at', { ascending: true })
    const filtered = (data || []).filter(d => d.scheduled_message?.status === 'draft_created')
    setDrafts(filtered)
    setLoading(false)
  }, [workspaceId])

  useEffect(() => { load() }, [load])

  const select = (draft) => {
    setSelected(draft)
    setSubject(draft.edited_subject || draft.subject)
    setBody(draft.edited_body || draft.body)
    setError(null)
    setSuccess(null)
  }

  const handleApprove = async () => {
    if (!selected) return
    setSending(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch('/.netlify/functions/send-approved-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          user_id: userId,
          draft_id: selected.id,
          subject_override: subject !== selected.subject ? subject : undefined,
          body_override: body !== selected.body ? body : undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Send failed')
      setSuccess(`Sent to ${json.sent_to}`)
      setDrafts(prev => prev.filter(d => d.id !== selected.id))
      setSelected(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  const handleSkip = async () => {
    if (!selected) return
    setSkipping(true)
    await supabase
      .from('scheduled_messages')
      .update({ status: 'skipped', skip_reason: 'manually_skipped', updated_at: new Date().toISOString() })
      .eq('id', selected.scheduled_message?.id)
    setDrafts(prev => prev.filter(d => d.id !== selected.id))
    setSelected(null)
    setSkipping(false)
  }

  const handleRegenerate = async () => {
    if (!selected) return
    setRegenerating(true)
    setError(null)
    try {
      const res = await fetch('/.netlify/functions/generate-agent-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: workspaceId,
          agent_id: selected.agent_id,
          scenario_type: selected.generation_context?.scenario_type || 'check_in',
          sender: 'kevin',
          context: { agent_name: selected.agent?.name, brokerage: selected.agent?.brokerage, relationship_status: selected.agent?.relationship_status },
        }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error || 'Generation failed')
      setSubject(json.subject || subject)
      setBody(json.body || body)
      await supabase.from('message_drafts').update({ subject: json.subject, body: json.body, generated_by: 'ai', edited_subject: null, edited_body: null }).eq('id', selected.id)
    } catch (err) {
      setError(err.message)
    } finally {
      setRegenerating(false)
    }
  }

  const handleMarkReplied = async () => {
    if (!selected) return
    await supabase.from('agents').update({ last_replied_at: new Date().toISOString() }).eq('id', selected.agent_id)
    await handleSkip()
  }

  const inputCls = 'w-full text-[13px] px-2 h-8 bg-[color:var(--color-bg)] border border-[color:var(--color-line)] rounded text-[color:var(--color-text)] focus:outline-none focus:border-[color:var(--color-accent)]'
  const labelCls = 'text-[10.5px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)]'

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* Left panel — draft list */}
      <div className="w-72 shrink-0 border-r border-[color:var(--color-line)] flex flex-col bg-[color:var(--color-bg-sidebar)]">
        <div className="px-4 py-3 border-b border-[color:var(--color-line)]">
          <h2 className="text-[14px] font-semibold text-[color:var(--color-text)]">Drafts Inbox</h2>
          <p className="text-[11.5px] text-[color:var(--color-text-dim)] mt-0.5">{loading ? '…' : `${drafts.length} awaiting review`}</p>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-[13px] text-[color:var(--color-text-dim)]">Loading…</div>
          ) : drafts.length === 0 ? (
            <div className="p-6 text-center text-[12.5px] text-[color:var(--color-text-dim)]">No drafts pending review.</div>
          ) : (
            drafts.map(d => (
              <button
                key={d.id}
                onClick={() => select(d)}
                className={`w-full text-left px-4 py-3 border-b border-[color:var(--color-line)] hover:bg-[color:var(--color-bg-elev)] transition-colors ${selected?.id === d.id ? 'bg-[color:var(--color-bg-elev)]' : ''}`}
              >
                <div className="text-[12.5px] font-medium text-[color:var(--color-text)] truncate">{d.agent?.name || '—'}</div>
                <div className="text-[11.5px] text-[color:var(--color-text-dim)] truncate mt-0.5">{d.subject}</div>
                <div className="text-[11px] text-[color:var(--color-text-faint)] mt-1">Due {formatDate(d.scheduled_message?.scheduled_for)}</div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right panel — review */}
      <div className="flex-1 overflow-y-auto bg-[color:var(--color-bg)]">
        {!selected ? (
          <div className="flex items-center justify-center h-full text-[13px] text-[color:var(--color-text-dim)]">
            Select a draft to review
          </div>
        ) : (
          <div className="p-6 max-w-2xl mx-auto space-y-5">
            {/* Agent card */}
            <div className="flex items-center gap-3 p-3 border border-[color:var(--color-line)] rounded-lg bg-[color:var(--color-bg-elev)]">
              <div>
                <div className="text-[13.5px] font-semibold text-[color:var(--color-text)]">{selected.agent?.name}</div>
                <div className="text-[12px] text-[color:var(--color-text-dim)]">{selected.agent?.brokerage || '—'} · {selected.agent?.email}</div>
              </div>
              <div className="ml-auto">
                <button
                  onClick={handleMarkReplied}
                  className="text-[11.5px] px-2.5 py-1 rounded border border-[color:var(--color-line)] text-[color:var(--color-text-dim)] hover:bg-[color:var(--color-bg-elev-2)] transition-colors"
                >
                  Mark as replied
                </button>
              </div>
            </div>

            {/* Subject */}
            <div>
              <label className={labelCls}>Subject</label>
              <input className={inputCls + ' mt-1'} value={subject} onChange={e => setSubject(e.target.value)} />
            </div>

            {/* Body */}
            <div>
              <label className={labelCls}>Body</label>
              <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                rows={14}
                className="w-full mt-1 text-[13px] px-2 py-2 bg-[color:var(--color-bg)] border border-[color:var(--color-line)] rounded text-[color:var(--color-text)] focus:outline-none focus:border-[color:var(--color-accent)] resize-y leading-relaxed font-mono"
              />
            </div>

            {/* Error / Success */}
            {error && <div className="text-[12px] text-[color:var(--color-danger-text)] bg-[color:var(--color-danger-soft)] px-3 py-2 rounded">{error}</div>}
            {success && <div className="text-[12px] text-[color:var(--color-success-text)] bg-[color:var(--color-success-soft)] px-3 py-2 rounded">{success}</div>}

            {/* Actions */}
            <div className="flex items-center gap-3 pt-1">
              <Button onClick={handleApprove} loading={sending} disabled={skipping || regenerating}>
                Approve & Send
              </Button>
              <Button variant="secondary" onClick={handleRegenerate} loading={regenerating} disabled={sending || skipping}>
                Regenerate
              </Button>
              <Button variant="ghost" onClick={handleSkip} loading={skipping} disabled={sending || regenerating}>
                Skip
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
