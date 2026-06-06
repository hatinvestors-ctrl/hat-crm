# Agent Detail Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user clicks an agent row, a wide right-side drawer slides in showing contact info, notes, communication history with inline log form, and a pinned comments section.

**Architecture:** New `AgentDetailDrawer` component wraps the existing `Drawer` UI primitive at ~70% viewport width. Left column holds contact info + inline-editable notes. Right column is a flex column: section header + inline log form + scrollable history/comments feed + pinned comment input. Two new Supabase tables (`agent_activities`, `agent_comments`) back the feed. The `send-agent-emails` Netlify function auto-inserts an `agent_activities` row after each successful send.

**Tech Stack:** React 18, Supabase JS client, existing `Drawer`/`Button`/`Card`/`Input` UI primitives, Tailwind CSS with CSS variable tokens, Netlify Functions (ESM `.mjs`)

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `supabase/migrations/20260606000003_agent_activities_comments.sql` | Tables + RLS for `agent_activities` and `agent_comments` |
| Create | `src/components/agents/AgentNotesSection.jsx` | Inline-edit notes, saves to `agents.notes` |
| Create | `src/components/agents/AgentLogForm.jsx` | Inline expand form: type picker + note + optional date |
| Create | `src/components/agents/AgentActivityFeed.jsx` | Fetches + renders history feed, comments, pinned input |
| Create | `src/components/agents/AgentDetailDrawer.jsx` | Root drawer — fetches agent, assembles all sections |
| Modify | `src/components/agents/AgentTable.jsx` | Add `onRowClick` prop; row click opens drawer, checkbox click does not |
| Modify | `src/pages/AgentsPage.jsx` | Add `selectedAgentId` state; render `AgentDetailDrawer` |
| Modify | `netlify/functions/send-agent-emails.mjs` | After successful send, insert `agent_activities` row |

---

## Task 1: Database migration — `agent_activities` and `agent_comments`

**Files:**
- Create: `supabase/migrations/20260606000003_agent_activities_comments.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20260606000003_agent_activities_comments.sql

-- Communication history: auto-logged email sends + manually logged calls/meetings/texts
CREATE TABLE IF NOT EXISTS public.agent_activities (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id     UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL,
  type         TEXT NOT NULL,   -- 'email_sent' | 'call' | 'meeting' | 'text' | 'other'
  note         TEXT,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX agent_activities_agent_idx ON public.agent_activities (agent_id, occurred_at DESC);

ALTER TABLE public.agent_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members can manage agent_activities"
  ON public.agent_activities FOR ALL
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  );

-- Free-text comments from team members on an agent record
CREATE TABLE IF NOT EXISTS public.agent_comments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id     UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL,
  body         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX agent_comments_agent_idx ON public.agent_comments (agent_id, created_at DESC);

ALTER TABLE public.agent_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members can manage agent_comments"
  ON public.agent_comments FOR ALL
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  );
```

- [ ] **Step 2: Apply the migration**

Run in Supabase SQL editor, or via CLI:
```bash
npx supabase db push
```

Verify by checking the Supabase Table Editor — both `agent_activities` and `agent_comments` tables should exist with the correct columns.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260606000003_agent_activities_comments.sql
git commit -m "feat: add agent_activities and agent_comments tables"
```

---

## Task 2: `AgentNotesSection` — inline-edit notes

**Files:**
- Create: `src/components/agents/AgentNotesSection.jsx`

This component mirrors `src/components/lead-detail/NotesSection.jsx` exactly, but targets the `agents` table instead of `leads`.

- [ ] **Step 1: Create the component**

```jsx
// src/components/agents/AgentNotesSection.jsx
import { useState, useEffect } from 'react'
import Card from '../ui/Card'
import Button from '../ui/Button'
import { supabase } from '../../lib/supabase'

export default function AgentNotesSection({ agent, canEdit, onUpdated }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(agent.notes || '')
  const [saving, setSaving] = useState(false)

  useEffect(() => { setDraft(agent.notes || '') }, [agent.notes])

  const save = async () => {
    setSaving(true)
    const { data } = await supabase
      .from('agents')
      .update({ notes: draft.trim() || null, updated_at: new Date().toISOString() })
      .eq('id', agent.id)
      .select()
      .single()
    if (data) onUpdated?.(data)
    setSaving(false)
    setEditing(false)
  }

  const cancel = () => {
    setDraft(agent.notes || '')
    setEditing(false)
  }

  return (
    <Card
      title="Notes"
      action={canEdit && !editing && (
        <button
          onClick={() => setEditing(true)}
          className="text-[12px] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] transition-colors"
        >
          {agent.notes ? 'Edit' : '+ Add notes'}
        </button>
      )}
    >
      {editing ? (
        <div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={6}
            autoFocus
            placeholder="Notes about this agent — preferred contact method, relationship history, anything worth remembering…"
            className="w-full px-3 py-2 text-[13px] rounded-md bg-[color:var(--color-bg-input)] text-[color:var(--color-text)] placeholder:text-[color:var(--color-text-faint)] border border-[color:var(--color-line)] focus:outline-none focus:border-[color:var(--color-accent)] focus:ring-1 focus:ring-[color:var(--color-accent)] resize-y leading-relaxed"
          />
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="secondary" size="sm" onClick={cancel} disabled={saving}>Cancel</Button>
            <Button size="sm" onClick={save} loading={saving}>Save</Button>
          </div>
        </div>
      ) : agent.notes ? (
        <p className="text-[13px] text-[color:var(--color-text)] whitespace-pre-wrap leading-relaxed">{agent.notes}</p>
      ) : (
        <p className="text-[12.5px] text-[color:var(--color-text-dim)] italic">No notes yet.</p>
      )}
    </Card>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/agents/AgentNotesSection.jsx
git commit -m "feat: add AgentNotesSection component"
```

---

## Task 3: `AgentLogForm` — inline interaction log form

**Files:**
- Create: `src/components/agents/AgentLogForm.jsx`

Shown/hidden by the parent. When visible, user picks type, writes a note, optionally sets a date, then submits. Calls `onSaved()` on success.

- [ ] **Step 1: Create the component**

```jsx
// src/components/agents/AgentLogForm.jsx
import { useState } from 'react'
import Button from '../ui/Button'
import { supabase } from '../../lib/supabase'

const TYPES = [
  { value: 'call',    label: '📞 Call' },
  { value: 'meeting', label: '🤝 Meeting' },
  { value: 'text',    label: '💬 Text' },
  { value: 'other',   label: '• Other' },
]

export default function AgentLogForm({ agentId, workspaceId, userId, onSaved, onCancel }) {
  const [type, setType]         = useState('call')
  const [note, setNote]         = useState('')
  const [showDate, setShowDate] = useState(false)
  const [date, setDate]         = useState(new Date().toISOString().slice(0, 10))
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState(null)

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    const occurred_at = showDate
      ? new Date(date + 'T12:00:00').toISOString()
      : new Date().toISOString()

    const { error: err } = await supabase.from('agent_activities').insert({
      workspace_id: workspaceId,
      agent_id:     agentId,
      user_id:      userId,
      type,
      note:         note.trim() || null,
      occurred_at,
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    setNote('')
    setShowDate(false)
    setDate(new Date().toISOString().slice(0, 10))
    onSaved?.()
  }

  return (
    <div className="mx-3 mb-2 bg-[color:var(--color-bg-elev-2)] border border-[color:var(--color-accent-soft)] rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wider text-[color:var(--color-accent-text)] mb-2">Log an interaction</div>

      {/* Type picker */}
      <div className="flex flex-wrap gap-1.5 mb-2">
        {TYPES.map(t => (
          <button
            key={t.value}
            onClick={() => setType(t.value)}
            className={`px-2.5 py-0.5 rounded-full text-[11px] transition-colors ${
              type === t.value
                ? 'bg-[color:var(--color-accent)] text-white'
                : 'bg-[color:var(--color-bg-elev)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Note */}
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder="Short note about this interaction…"
        className="w-full px-2.5 py-1.5 text-[12px] rounded-md bg-[color:var(--color-bg-input)] text-[color:var(--color-text)] placeholder:text-[color:var(--color-text-faint)] border border-[color:var(--color-line)] focus:outline-none focus:border-[color:var(--color-accent)] focus:ring-1 focus:ring-[color:var(--color-accent)] resize-none mb-2"
      />

      {/* Optional date */}
      {showDate ? (
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="mb-2 px-2.5 py-1 text-[12px] rounded-md bg-[color:var(--color-bg-input)] text-[color:var(--color-text)] border border-[color:var(--color-line)] focus:outline-none focus:border-[color:var(--color-accent)]"
        />
      ) : (
        <button
          onClick={() => setShowDate(true)}
          className="text-[11px] text-[color:var(--color-text-dim)] hover:text-[color:var(--color-text)] mb-2 block"
        >
          📅 Add date (optional)
        </button>
      )}

      {error && (
        <div className="text-[11px] text-[color:var(--color-danger-text)] mb-2">{error}</div>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button size="sm" onClick={handleSave} loading={saving}>Save</Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/agents/AgentLogForm.jsx
git commit -m "feat: add AgentLogForm component"
```

---

## Task 4: `AgentActivityFeed` — scrollable history + comments + pinned input

**Files:**
- Create: `src/components/agents/AgentActivityFeed.jsx`

Fetches `agent_activities` (history) and `agent_comments` (comments with profile join) for the given `agentId`. Renders:
1. Section header with `+ Log interaction` button
2. Inline `AgentLogForm` (conditionally shown)
3. Scrollable feed: history entries → "Comments" divider → comment entries
4. Pinned comment input (always visible at bottom)

Color coding per activity type:
- `email_sent` → blue border `border-blue-600`
- `call` → green border `border-green-600`
- `meeting` → amber border `border-amber-600`
- `text` → purple border `border-purple-600`
- `other` → grey border `border-[color:var(--color-line)]`

- [ ] **Step 1: Create the component**

```jsx
// src/components/agents/AgentActivityFeed.jsx
import { useState, useEffect } from 'react'
import Button from '../ui/Button'
import AgentLogForm from './AgentLogForm'
import { supabase } from '../../lib/supabase'
import { formatDateTime } from '../../lib/calculations'

const TYPE_META = {
  email_sent: { icon: '📧', label: 'Email sent',  border: 'border-blue-600',   bg: 'bg-blue-950/40'   },
  call:       { icon: '📞', label: 'Call',         border: 'border-green-600',  bg: 'bg-green-950/40'  },
  meeting:    { icon: '🤝', label: 'Meeting',      border: 'border-amber-600',  bg: 'bg-amber-950/40'  },
  text:       { icon: '💬', label: 'Text',         border: 'border-purple-600', bg: 'bg-purple-950/40' },
  other:      { icon: '•',  label: 'Interaction',  border: 'border-[color:var(--color-line)]', bg: 'bg-[color:var(--color-bg-elev)]' },
}

export default function AgentActivityFeed({ agentId, workspaceId, userId }) {
  const [activities, setActivities]   = useState([])
  const [comments, setComments]       = useState([])
  const [loading, setLoading]         = useState(true)
  const [showLogForm, setShowLogForm] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [posting, setPosting]         = useState(false)
  const [refreshKey, setRefreshKey]   = useState(0)

  useEffect(() => {
    if (!agentId) return
    let cancelled = false
    setLoading(true)

    Promise.all([
      supabase
        .from('agent_activities')
        .select('*')
        .eq('agent_id', agentId)
        .order('occurred_at', { ascending: false })
        .limit(100),
      supabase
        .from('agent_comments')
        .select('*, profiles:user_id(full_name)')
        .eq('agent_id', agentId)
        .order('created_at', { ascending: false })
        .limit(100),
    ]).then(([{ data: acts }, { data: cmts }]) => {
      if (cancelled) return
      setActivities(acts || [])
      setComments(cmts || [])
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [agentId, refreshKey])

  const refresh = () => setRefreshKey(k => k + 1)

  const postComment = async () => {
    if (!commentText.trim()) return
    setPosting(true)
    await supabase.from('agent_comments').insert({
      workspace_id: workspaceId,
      agent_id:     agentId,
      user_id:      userId,
      body:         commentText.trim(),
    })
    setCommentText('')
    setPosting(false)
    refresh()
  }

  return (
    <div className="flex flex-col h-full min-h-0">

      {/* Section header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[color:var(--color-line)] shrink-0">
        <span className="text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)]">History & Comments</span>
        <button
          onClick={() => setShowLogForm(v => !v)}
          className="text-[11px] px-2 py-0.5 rounded bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] transition-colors"
        >
          {showLogForm ? 'Cancel' : '+ Log interaction'}
        </button>
      </div>

      {/* Inline log form */}
      {showLogForm && (
        <div className="shrink-0">
          <AgentLogForm
            agentId={agentId}
            workspaceId={workspaceId}
            userId={userId}
            onSaved={() => { setShowLogForm(false); refresh() }}
            onCancel={() => setShowLogForm(false)}
          />
        </div>
      )}

      {/* Scrollable feed */}
      <div className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-2 min-h-0">
        {loading ? (
          <div className="text-[12px] text-[color:var(--color-text-dim)] py-4 text-center">Loading…</div>
        ) : (
          <>
            {activities.length === 0 && (
              <div className="text-[12px] text-[color:var(--color-text-dim)] italic py-2">No interactions yet.</div>
            )}
            {activities.map(act => {
              const meta = TYPE_META[act.type] || TYPE_META.other
              return (
                <div key={act.id} className={`border-l-2 pl-3 py-1.5 rounded-r ${meta.border} ${meta.bg}`}>
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] text-[color:var(--color-text-muted)]">{meta.icon} {meta.label}</span>
                    <span className="text-[10px] text-[color:var(--color-text-dim)]">{formatDateTime(act.occurred_at)}</span>
                  </div>
                  {act.note && (
                    <div className="text-[11px] text-[color:var(--color-text-dim)] mt-0.5 leading-snug">{act.note}</div>
                  )}
                </div>
              )
            })}

            {/* Comments divider */}
            <div className="flex items-center gap-2 my-1">
              <div className="flex-1 h-px bg-[color:var(--color-line)]" />
              <span className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Comments</span>
              <div className="flex-1 h-px bg-[color:var(--color-line)]" />
            </div>

            {comments.length === 0 && (
              <div className="text-[12px] text-[color:var(--color-text-dim)] italic py-1">No comments yet.</div>
            )}
            {comments.map(c => (
              <div key={c.id} className="bg-[color:var(--color-bg-elev-2)] rounded-md px-3 py-2">
                <div className="flex justify-between items-center mb-0.5">
                  <span className="text-[11px] font-medium text-[color:var(--color-text-muted)]">
                    {c.profiles?.full_name || 'Team member'}
                  </span>
                  <span className="text-[10px] text-[color:var(--color-text-dim)]">{formatDateTime(c.created_at)}</span>
                </div>
                <div className="text-[12px] text-[color:var(--color-text)] leading-snug whitespace-pre-wrap">{c.body}</div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Pinned comment input */}
      <div className="shrink-0 px-3 py-2 border-t border-[color:var(--color-line)] bg-[color:var(--color-bg)]">
        <div className="bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] rounded-lg px-3 py-2 focus-within:border-[color:var(--color-accent)] focus-within:ring-1 focus-within:ring-[color:var(--color-accent)] transition-colors">
          <textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Leave a comment…"
            rows={2}
            className="w-full text-[12px] text-[color:var(--color-text)] bg-transparent placeholder:text-[color:var(--color-text-faint)] resize-none focus:outline-none leading-relaxed"
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={postComment} loading={posting} disabled={!commentText.trim()}>Post</Button>
          </div>
        </div>
      </div>

    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/agents/AgentActivityFeed.jsx
git commit -m "feat: add AgentActivityFeed component"
```

---

## Task 5: `AgentDetailDrawer` — root drawer, assembles all sections

**Files:**
- Create: `src/components/agents/AgentDetailDrawer.jsx`

Fetches the full agent record when `agentId` changes. Renders a wide `Drawer` with:
- **Header:** name + last-contacted badge + brokerage + leads link + Send Email / Edit / Close
- **Left column:** Contact Info card + `AgentNotesSection`
- **Right column:** `AgentActivityFeed`

The "Edit" button re-uses `AddAgentModal` in edit mode (prefill form, update on save).
The "Send Email" button calls the existing `setEmailModal(true)` passed from the parent.

Badge colour logic (matches AgentTable):
- No `last_contacted_at` → grey "Never contacted"
- ≤30 days → green `Nd ago`
- >30 days → amber/red `Nd ago`

- [ ] **Step 1: Create the component**

```jsx
// src/components/agents/AgentDetailDrawer.jsx
import { useEffect, useState } from 'react'
import Drawer from '../ui/Drawer'
import Button from '../ui/Button'
import Card from '../ui/Card'
import AgentNotesSection from './AgentNotesSection'
import AgentActivityFeed from './AgentActivityFeed'
import AddAgentModal from './AddAgentModal'
import { supabase } from '../../lib/supabase'

function lastContactedBadge(lastContactedAt) {
  if (!lastContactedAt) return { label: 'Never contacted', cls: 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-dim)]' }
  const days = Math.floor((Date.now() - new Date(lastContactedAt)) / 86400000)
  if (days > 30) return { label: `${days}d ago`, cls: 'bg-[color:var(--color-warn-soft)] text-[color:var(--color-warn-text)]' }
  return { label: `${days}d ago`, cls: 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)]' }
}

export default function AgentDetailDrawer({
  open,
  agentId,
  workspaceId,
  userId,
  userRole,
  leadCount,
  onClose,
  onSendEmail,
  onAgentUpdated,
}) {
  const [agent, setAgent]       = useState(null)
  const [loading, setLoading]   = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  const canEdit = userRole !== 'readonly'
  const drawerWidth = Math.min(900, Math.max(600, Math.round(window.innerWidth * 0.70)))

  useEffect(() => {
    if (!agentId || !open) { setAgent(null); return }
    let cancelled = false
    setLoading(true)
    supabase.from('agents').select('*').eq('id', agentId).single()
      .then(({ data }) => {
        if (cancelled) return
        setAgent(data)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [agentId, open])

  const handleAgentUpdated = (updated) => {
    setAgent(updated)
    onAgentUpdated?.(updated)
  }

  const badge = agent ? lastContactedBadge(agent.last_contacted_at) : null

  return (
    <>
      <Drawer open={open} onClose={onClose} title="" width={drawerWidth}>
        {loading || !agent ? (
          <div className="flex items-center justify-center h-32 text-[13px] text-[color:var(--color-text-dim)]">
            {loading ? 'Loading…' : ''}
          </div>
        ) : (
          <div className="flex flex-col h-full">

            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[color:var(--color-line)] shrink-0">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[15px] font-semibold text-[color:var(--color-text)]">{agent.name || agent.email}</span>
                  {badge && (
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>{badge.label}</span>
                  )}
                </div>
                <div className="text-[11px] text-[color:var(--color-text-dim)] mt-0.5">
                  {agent.brokerage && <span>{agent.brokerage}</span>}
                  {agent.brokerage && leadCount != null && <span className="mx-1.5">·</span>}
                  {leadCount != null && (
                    <a
                      href={`/w/${workspaceId}/leads?agent_email=${encodeURIComponent(agent.email || '')}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[color:var(--color-accent)] hover:underline"
                    >
                      {leadCount} lead{leadCount === 1 ? '' : 's'} ↗
                    </a>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {canEdit && (
                  <Button size="sm" onClick={() => onSendEmail?.()}>Send Email</Button>
                )}
                {canEdit && (
                  <Button size="sm" variant="secondary" onClick={() => setEditOpen(true)}>Edit</Button>
                )}
                <button
                  onClick={onClose}
                  className="text-[color:var(--color-text-dim)] hover:text-[color:var(--color-text)] w-6 h-6 rounded inline-flex items-center justify-center hover:bg-[color:var(--color-bg-elev-2)] transition-colors"
                  aria-label="Close"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6 6 18M6 6l12 12"/>
                  </svg>
                </button>
              </div>
            </div>

            {/* 2-column body */}
            <div className="flex flex-1 min-h-0">

              {/* Left column */}
              <div className="w-1/2 border-r border-[color:var(--color-line)] overflow-y-auto p-4 flex flex-col gap-4">
                {/* Contact Info */}
                <Card title="Contact Info">
                  <dl className="flex flex-col gap-2">
                    {[
                      { label: 'Email', value: agent.email },
                      { label: 'Phone', value: agent.phone },
                      { label: 'Brokerage', value: agent.brokerage },
                    ].map(({ label, value }) => value ? (
                      <div key={label} className="flex gap-3 items-start">
                        <dt className="text-[11px] text-[color:var(--color-text-dim)] w-16 shrink-0 pt-px">{label}</dt>
                        <dd className="text-[12px] text-[color:var(--color-text)] break-all">{value}</dd>
                      </div>
                    ) : null)}
                  </dl>
                </Card>

                {/* Notes */}
                <div className="flex-1">
                  <AgentNotesSection agent={agent} canEdit={canEdit} onUpdated={handleAgentUpdated} />
                </div>
              </div>

              {/* Right column */}
              <div className="w-1/2 flex flex-col min-h-0">
                <AgentActivityFeed
                  agentId={agent.id}
                  workspaceId={workspaceId}
                  userId={userId}
                />
              </div>

            </div>
          </div>
        )}
      </Drawer>

      {/* Edit modal — reuses AddAgentModal prefilled */}
      {editOpen && agent && (
        <AddAgentModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          workspaceId={workspaceId}
          initialValues={{ name: agent.name, email: agent.email, phone: agent.phone, brokerage: agent.brokerage }}
          agentId={agent.id}
          onAdded={handleAgentUpdated}
        />
      )}
    </>
  )
}
```

> **Note:** `AddAgentModal` currently doesn't accept `initialValues` or `agentId` props — Task 6 adds that support.

- [ ] **Step 2: Commit**

```bash
git add src/components/agents/AgentDetailDrawer.jsx
git commit -m "feat: add AgentDetailDrawer component"
```

---

## Task 6: Extend `AddAgentModal` to support edit mode

**Files:**
- Modify: `src/components/agents/AddAgentModal.jsx`

Add optional `initialValues` and `agentId` props. When `agentId` is provided the modal title becomes "Edit Agent" and the save operation does an `update` instead of `upsert`.

- [ ] **Step 1: Update AddAgentModal**

```jsx
// src/components/agents/AddAgentModal.jsx
import { useState, useEffect } from 'react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import Input from '../ui/Input'
import { supabase } from '../../lib/supabase'

export default function AddAgentModal({ open, onClose, workspaceId, onAdded, initialValues, agentId }) {
  const isEdit = Boolean(agentId)
  const [form, setForm] = useState({ name: '', email: '', phone: '', brokerage: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (open) {
      setForm({
        name:      initialValues?.name      || '',
        email:     initialValues?.email     || '',
        phone:     initialValues?.phone     || '',
        brokerage: initialValues?.brokerage || '',
      })
      setError(null)
    }
  }, [open, initialValues])

  const update = patch => setForm(prev => ({ ...prev, ...patch }))

  const handleSave = async () => {
    if (!form.email?.trim()) { setError('Email is required.'); return }
    setSaving(true)
    setError(null)
    try {
      let data, err
      if (isEdit) {
        ;({ data, error: err } = await supabase
          .from('agents')
          .update({
            name:       form.name.trim()      || null,
            email:      form.email.trim().toLowerCase(),
            phone:      form.phone.trim()     || null,
            brokerage:  form.brokerage.trim() || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', agentId)
          .select()
          .single())
      } else {
        ;({ data, error: err } = await supabase
          .from('agents')
          .upsert(
            {
              workspace_id: workspaceId,
              name:         form.name.trim()      || null,
              email:        form.email.trim().toLowerCase(),
              phone:        form.phone.trim()     || null,
              brokerage:    form.brokerage.trim() || null,
              updated_at:   new Date().toISOString(),
            },
            { onConflict: 'workspace_id,email' }
          )
          .select()
          .single())
      }
      if (err) throw err
      onAdded?.(data)
      if (!isEdit) setForm({ name: '', email: '', phone: '', brokerage: '' })
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Agent' : 'Add Agent'}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} loading={saving}>{isEdit ? 'Save' : 'Add Agent'}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input label="Email *" type="email" value={form.email} onChange={e => update({ email: e.target.value })} autoFocus />
        <Input label="Name" value={form.name} onChange={e => update({ name: e.target.value })} />
        <Input label="Brokerage" value={form.brokerage} onChange={e => update({ brokerage: e.target.value })} />
        <Input label="Phone" value={form.phone} onChange={e => update({ phone: e.target.value })} />
        {error && <div className="text-[12px] text-[color:var(--color-danger-text)] bg-[color:var(--color-danger-soft)] px-3 py-2 rounded">{error}</div>}
      </div>
    </Modal>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/agents/AddAgentModal.jsx
git commit -m "feat: extend AddAgentModal to support edit mode"
```

---

## Task 7: Make `AgentTable` rows clickable

**Files:**
- Modify: `src/components/agents/AgentTable.jsx`

Add `onRowClick` prop. Row `onClick` opens the drawer. Checkbox cell uses `e.stopPropagation()` so selecting a row doesn't open the drawer.

- [ ] **Step 1: Update AgentTable**

```jsx
// src/components/agents/AgentTable.jsx

const STATUS_DAYS = 30

function contactStatus(lastContactedAt) {
  if (!lastContactedAt) return { label: 'Never contacted', cls: 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-dim)]' }
  const days = Math.floor((Date.now() - new Date(lastContactedAt)) / 86400000)
  if (days > STATUS_DAYS) return { label: `${days}d ago`, cls: 'bg-[color:var(--color-warn-soft)] text-[color:var(--color-warn-text)]' }
  return { label: `${days}d ago`, cls: 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)]' }
}

export default function AgentTable({ agents, selected, onToggle, onToggleAll, leadCounts, onRowClick }) {
  const allSelected = agents.length > 0 && agents.every(a => selected.has(a.id))

  return (
    <div className="overflow-x-auto rounded-lg border border-[color:var(--color-line)]">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)]">
            <th className="px-3 py-2.5 w-8">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => onToggleAll()}
                className="accent-[color:var(--color-accent)]"
              />
            </th>
            <th className="px-3 py-2.5 text-left text-[10.5px] uppercase tracking-wider font-medium text-[color:var(--color-text-dim)]">Agent</th>
            <th className="px-3 py-2.5 text-left text-[10.5px] uppercase tracking-wider font-medium text-[color:var(--color-text-dim)]">Email</th>
            <th className="px-3 py-2.5 text-left text-[10.5px] uppercase tracking-wider font-medium text-[color:var(--color-text-dim)]">Leads</th>
            <th className="px-3 py-2.5 text-left text-[10.5px] uppercase tracking-wider font-medium text-[color:var(--color-text-dim)]">Last Contacted</th>
          </tr>
        </thead>
        <tbody>
          {agents.map(agent => {
            const status = contactStatus(agent.last_contacted_at)
            return (
              <tr
                key={agent.id}
                onClick={() => onRowClick?.(agent.id)}
                className="border-t border-[color:var(--color-line)] hover:bg-[color:var(--color-bg-elev)] transition-colors cursor-pointer"
              >
                <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selected.has(agent.id)}
                    onChange={() => onToggle(agent.id)}
                    className="accent-[color:var(--color-accent)]"
                  />
                </td>
                <td className="px-3 py-2.5">
                  <div className="font-medium text-[color:var(--color-text)]">{agent.name || '—'}</div>
                  {agent.brokerage && <div className="text-[11px] text-[color:var(--color-text-dim)]">{agent.brokerage}</div>}
                </td>
                <td className="px-3 py-2.5 text-[color:var(--color-text-muted)]">{agent.email || '—'}</td>
                <td className="px-3 py-2.5 text-center text-[color:var(--color-text-muted)]">{leadCounts?.[agent.id] ?? 0}</td>
                <td className="px-3 py-2.5">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${status.cls}`}>
                    {status.label}
                  </span>
                </td>
              </tr>
            )
          })}
          {agents.length === 0 && (
            <tr>
              <td colSpan={5} className="px-3 py-8 text-center text-[12px] text-[color:var(--color-text-dim)]">
                No agents yet. Click "Sync from leads" to extract agents from your leads.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/agents/AgentTable.jsx
git commit -m "feat: make agent table rows clickable"
```

---

## Task 8: Wire `AgentDetailDrawer` into `AgentsPage`

**Files:**
- Modify: `src/pages/AgentsPage.jsx`

Add `selectedAgentId` state. Pass `onRowClick` to `AgentTable`. Render `AgentDetailDrawer`. When the drawer's "Send Email" button is clicked, open the existing email modal with just that agent pre-selected.

- [ ] **Step 1: Update AgentsPage**

Replace the import block and add new state + drawer rendering. The key changes are:
1. Import `AgentDetailDrawer`
2. Add `const [selectedAgentId, setSelectedAgentId] = useState(null)`
3. Pass `onRowClick={id => setSelectedAgentId(id)}` to `AgentTable`
4. Render `<AgentDetailDrawer>` after the table

Full updated file:

```jsx
// src/pages/AgentsPage.jsx
import { useEffect, useState, useMemo } from 'react'
import { useOutletContext } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { syncAgentsFromLeads, sendAgentEmails } from '../lib/agentOutreach'
import Topbar from '../components/Topbar'
import Button from '../components/ui/Button'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import AgentTable from '../components/agents/AgentTable'
import AgentEmailModal from '../components/agents/AgentEmailModal'
import AddAgentModal from '../components/agents/AddAgentModal'
import AgentDetailDrawer from '../components/agents/AgentDetailDrawer'

const FILTER_OPTIONS = [
  { value: 'all',   label: 'All agents' },
  { value: 'never', label: 'Never contacted' },
  { value: 'due',   label: 'Due for follow-up (30+ days)' },
]

export default function AgentsPage() {
  const { workspace, workspaceId, user, userRole } = useOutletContext()
  const [agents, setAgents]               = useState([])
  const [leadCounts, setLeadCounts]       = useState({})
  const [loading, setLoading]             = useState(true)
  const [syncing, setSyncing]             = useState(false)
  const [selected, setSelected]           = useState(new Set())
  const [filter, setFilter]               = useState('all')
  const [brokFilter, setBrokFilter]       = useState('')
  const [emailModal, setEmailModal]       = useState(false)
  const [addModal, setAddModal]           = useState(false)
  const [selectedAgentId, setSelectedAgentId] = useState(null)
  const [toast, setToast]                 = useState(null)

  const load = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('agents')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('name', { ascending: true })
    setAgents(data || [])

    const { data: leads } = await supabase
      .from('leads')
      .select('listing_agent_email')
      .eq('workspace_id', workspaceId)
      .not('listing_agent_email', 'is', null)

    const counts = {}
    for (const agent of data || []) {
      counts[agent.id] = (leads || []).filter(l =>
        l.listing_agent_email?.toLowerCase() === agent.email?.toLowerCase()
      ).length
    }
    setLeadCounts(counts)
    setLoading(false)
  }

  useEffect(() => { load() }, [workspaceId])

  const filtered = useMemo(() => {
    let list = agents
    if (filter === 'never') list = list.filter(a => !a.last_contacted_at)
    if (filter === 'due') {
      list = list.filter(a => {
        if (!a.last_contacted_at) return false
        return Math.floor((Date.now() - new Date(a.last_contacted_at)) / 86400000) > 30
      })
    }
    if (brokFilter.trim()) {
      const q = brokFilter.toLowerCase()
      list = list.filter(a => a.brokerage?.toLowerCase().includes(q) || a.name?.toLowerCase().includes(q))
    }
    return list
  }, [agents, filter, brokFilter])

  const toggleAgent = id => setSelected(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const toggleAll = () => {
    if (filtered.every(a => selected.has(a.id))) {
      setSelected(prev => { const n = new Set(prev); filtered.forEach(a => n.delete(a.id)); return n })
    } else {
      setSelected(prev => { const n = new Set(prev); filtered.forEach(a => n.add(a.id)); return n })
    }
  }

  const handleSync = async () => {
    setSyncing(true)
    try {
      const { count } = await syncAgentsFromLeads(workspaceId)
      await load()
      setToast(`Synced ${count} agent${count === 1 ? '' : 's'} from leads.`)
    } catch (e) {
      setToast(`Sync failed: ${e.message}`)
    } finally {
      setSyncing(false)
      setTimeout(() => setToast(null), 4000)
    }
  }

  const handleSend = async ({ template, subject }) => {
    const agentIds = [...selected]
    const result = await sendAgentEmails({ workspaceId, userId: user.id, agentIds, template, subject })
    setSelected(new Set())
    await load()
    setToast(`Sent to ${result.sent} agent${result.sent === 1 ? '' : 's'}${result.failed ? `. ${result.failed} failed.` : '.'}`)
    setTimeout(() => setToast(null), 5000)
  }

  const handleAgentUpdated = (updated) => {
    setAgents(prev => prev.map(a => a.id === updated.id ? updated : a))
  }

  const selectedCount = [...selected].filter(id => filtered.some(a => a.id === id)).length
  const drawerAgent = selectedAgentId ? agents.find(a => a.id === selectedAgentId) : null

  return (
    <>
      <Topbar
        title="Agents"
        breadcrumbs={[{ label: workspace.name, to: `/w/${workspaceId}` }, { label: 'Agents' }]}
        actions={
          <div className="flex items-center gap-2">
            {selectedCount > 0 && (
              <Button size="sm" onClick={() => setEmailModal(true)}>
                Send Email ({selectedCount})
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => setAddModal(true)}>+ Add Agent</Button>
            <Button size="sm" variant="secondary" onClick={handleSync} loading={syncing}>Sync from leads</Button>
          </div>
        }
      />

      <div className="p-4 flex flex-col gap-4">
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {FILTER_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setFilter(opt.value)}
              className={`px-3 py-1 rounded-full text-[12px] font-medium transition-colors ${
                filter === opt.value
                  ? 'bg-[color:var(--color-accent)] text-white'
                  : 'bg-[color:var(--color-bg-elev)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]'
              }`}
            >
              {opt.label}
            </button>
          ))}
          <input
            type="text"
            value={brokFilter}
            onChange={e => setBrokFilter(e.target.value)}
            placeholder="Filter by name or brokerage"
            className="px-3 py-1 text-[12px] rounded-full bg-[color:var(--color-bg-elev)] text-[color:var(--color-text)] placeholder:text-[color:var(--color-text-faint)] border border-[color:var(--color-line)] focus:outline-none focus:border-[color:var(--color-accent)] w-44"
          />
        </div>

        {toast && (
          <div className={`text-[12px] px-3 py-2 rounded-md ${
            toast.startsWith('Sync failed') || toast.startsWith('Sent') && toast.includes('failed')
              ? 'bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-text)]'
              : 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)]'
          }`}>
            {toast}
          </div>
        )}

        {loading ? (
          <LoadingSpinner label="Loading agents…" />
        ) : (
          <AgentTable
            agents={filtered}
            selected={selected}
            onToggle={toggleAgent}
            onToggleAll={toggleAll}
            leadCounts={leadCounts}
            onRowClick={id => setSelectedAgentId(id)}
          />
        )}
      </div>

      <AgentEmailModal
        open={emailModal}
        onClose={() => setEmailModal(false)}
        onSend={handleSend}
      />

      <AddAgentModal
        open={addModal}
        onClose={() => setAddModal(false)}
        workspaceId={workspaceId}
        onAdded={(a) => { setAgents(prev => [...prev, a]); setAddModal(false) }}
      />

      <AgentDetailDrawer
        open={Boolean(selectedAgentId)}
        agentId={selectedAgentId}
        workspaceId={workspaceId}
        userId={user.id}
        userRole={userRole}
        leadCount={selectedAgentId ? (leadCounts[selectedAgentId] ?? 0) : null}
        onClose={() => setSelectedAgentId(null)}
        onSendEmail={() => {
          if (selectedAgentId) setSelected(new Set([selectedAgentId]))
          setSelectedAgentId(null)
          setEmailModal(true)
        }}
        onAgentUpdated={handleAgentUpdated}
      />
    </>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/AgentsPage.jsx
git commit -m "feat: wire AgentDetailDrawer into AgentsPage"
```

---

## Task 9: Auto-log email sends in `send-agent-emails.mjs`

**Files:**
- Modify: `netlify/functions/send-agent-emails.mjs`

Add a `logActivity` helper (mirrors `logOutreach`). Call it after each successful `sendMail`. Failure is non-blocking — a log error does not affect the email result counters.

- [ ] **Step 1: Add `logActivity` helper and call it after each send**

Add this function after the existing `logOutreach` function (around line 54):

```js
async function logActivity(workspaceId, agentId, userId, subject) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/agent_activities`, {
      method: 'POST',
      headers: { ...sbHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify({
        workspace_id: workspaceId,
        agent_id:     agentId,
        user_id:      userId,
        type:         'email_sent',
        note:         subject,
      }),
    })
  } catch (_) {
    // non-blocking — log failure does not affect email delivery
  }
}
```

Then in the per-agent loop (around line 153), add the call right after `logOutreach`:

```js
        await logOutreach(workspace_id, agent.id, user_id, template, finalSubject)
        await logActivity(workspace_id, agent.id, user_id, finalSubject)
        await updateLastContacted(agent.id)
```

- [ ] **Step 2: Commit**

```bash
git add netlify/functions/send-agent-emails.mjs
git commit -m "feat: auto-log email sends to agent_activities"
```

---

## Task 10: Smoke test the full flow

Manual verification steps — no automated tests are practical here (Supabase + Netlify function integration).

- [ ] **Step 1: Apply migration and start dev server**

```bash
# Apply migration via Supabase SQL editor or CLI
npx supabase db push

# Start dev server
npm run dev
```

- [ ] **Step 2: Verify drawer opens on row click**

1. Navigate to Agents page
2. Click any agent row (not the checkbox)
3. Confirm the drawer slides in from the right at ~70% width
4. Confirm clicking the checkbox does NOT open the drawer

- [ ] **Step 3: Verify notes**

1. Open an agent drawer
2. Click "+ Add notes", type some text, click Save
3. Confirm the notes appear in the left column
4. Click Edit, change the text, Save again — confirm update

- [ ] **Step 4: Verify manual activity log**

1. Click "+ Log interaction" in the right column
2. Select "Call", type a note, click Save
3. Confirm the entry appears in the history feed with a green left border

- [ ] **Step 5: Verify date picker on log form**

1. Click "+ Log interaction"
2. Click "📅 Add date (optional)"
3. Change the date to yesterday, save
4. Confirm the `occurred_at` timestamp in the feed shows yesterday's date

- [ ] **Step 6: Verify comment input is always visible**

1. Open an agent with several existing activities
2. Scroll the right column feed
3. Confirm the "Leave a comment…" input stays pinned at the bottom regardless of scroll position

- [ ] **Step 7: Verify comment posting**

1. Type in the comment box and click Post
2. Confirm comment appears in the feed below the "Comments" divider

- [ ] **Step 8: Verify email auto-log**

1. Select an agent via checkbox, click "Send Email", send an email
2. Re-open that agent's drawer
3. Confirm a "📧 Email sent" entry appears in the history feed with the email subject as the note

- [ ] **Step 9: Verify Edit modal**

1. Open an agent drawer, click "Edit"
2. Confirm the AddAgentModal opens pre-filled with the agent's current data
3. Change the brokerage, save — confirm the drawer header updates

- [ ] **Step 10: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: smoke test corrections for agent detail drawer"
```
