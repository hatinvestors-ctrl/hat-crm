# Agent Editable Contact Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the read-only Contact Info card in the Agent Detail Drawer with inline-editable scalar fields (name, brokerage, address) and managed multi-entry lists for phones and emails with labels, add/delete, and primary email sync.

**Architecture:** New `agent_contacts` table stores multiple phones/emails with labels. Three new components (`AgentInlineField`, `AgentContactList`, `AgentContactsSection`) replace the static Card in the left column of `AgentDetailDrawer`. Primary email is kept in sync with `agents.email` so outreach and deduplication continue working unchanged.

**Tech Stack:** React 18, Supabase JS client, Tailwind CSS with CSS variable tokens, existing `Card`/`Button` UI primitives

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `supabase/migrations/20260606000004_agent_contacts.sql` | Add `address` to agents, create `agent_contacts` table + RLS |
| Create | `src/components/agents/AgentInlineField.jsx` | Click-to-edit scalar field (text or textarea) |
| Create | `src/components/agents/AgentContactList.jsx` | Multi-entry list for phones or emails with label/value/delete/primary |
| Create | `src/components/agents/AgentContactsSection.jsx` | Assembles all editable fields; fetches contacts; handles legacy seed |
| Modify | `src/components/agents/AgentDetailDrawer.jsx` | Replace Contact Info Card + remove Card import; add AgentContactsSection |

---

## Task 1: Database migration — `agent_contacts` table + `address` column

**Files:**
- Create: `supabase/migrations/20260606000004_agent_contacts.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20260606000004_agent_contacts.sql

-- Add address field to agents
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS address TEXT;

-- Multi-entry contacts: phones and emails with labels
CREATE TABLE IF NOT EXISTS public.agent_contacts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id     UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN ('phone', 'email')),
  value        TEXT NOT NULL,
  label        TEXT NOT NULL DEFAULT '',
  is_primary   BOOLEAN NOT NULL DEFAULT false,
  sort_order   INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_contacts_agent_idx
  ON public.agent_contacts (agent_id, type, sort_order);

ALTER TABLE public.agent_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members can manage agent_contacts"
  ON public.agent_contacts FOR ALL
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  );
```

- [ ] **Step 2: Apply migration**

Run in Supabase SQL editor (cannot run `npx supabase db push` against the remote project directly). Verify in Table Editor that `agent_contacts` exists and `agents` has an `address` column.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260606000004_agent_contacts.sql
git commit -m "feat: add agent_contacts table and address column"
```

---

## Task 2: `AgentInlineField` — click-to-edit scalar field

**Files:**
- Create: `src/components/agents/AgentInlineField.jsx`

This is a pure UI component — no Supabase calls. The parent owns saving.

- [ ] **Step 1: Create the component**

```jsx
// src/components/agents/AgentInlineField.jsx
import { useState, useRef, useEffect } from 'react'

export default function AgentInlineField({ value, onSave, placeholder, multiline = false, label, canEdit = true }) {
  const [editing, setEditing]   = useState(false)
  const [draft, setDraft]       = useState(value || '')
  const inputRef                = useRef(null)

  useEffect(() => { setDraft(value || '') }, [value])

  const startEdit = () => {
    if (!canEdit) return
    setDraft(value || '')
    setEditing(true)
  }

  const commit = () => {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed !== (value || '').trim()) onSave(trimmed)
  }

  const cancel = () => {
    setDraft(value || '')
    setEditing(false)
  }

  const handleKeyDown = (e) => {
    if (!multiline && e.key === 'Enter') { e.preventDefault(); commit() }
    if (e.key === 'Escape') cancel()
  }

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const inputCls = 'w-full px-2 py-0.5 text-[12px] rounded bg-[color:var(--color-bg-input)] text-[color:var(--color-text)] border border-[color:var(--color-accent)] focus:outline-none focus:ring-1 focus:ring-[color:var(--color-accent)]'

  return (
    <div className="group">
      {label && (
        <div className="text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1">{label}</div>
      )}
      {editing ? (
        multiline ? (
          <textarea
            ref={inputRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={handleKeyDown}
            rows={3}
            className={`${inputCls} resize-y leading-relaxed`}
          />
        ) : (
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={handleKeyDown}
            className={inputCls}
          />
        )
      ) : (
        <div
          onClick={startEdit}
          className={`text-[12px] leading-snug min-h-[20px] rounded px-2 py-0.5 -mx-2 flex items-center justify-between gap-1 ${canEdit ? 'cursor-pointer hover:bg-[color:var(--color-bg-elev-2)]' : ''} transition-colors`}
        >
          {value ? (
            <span className="text-[color:var(--color-text)] whitespace-pre-wrap break-words">{value}</span>
          ) : (
            <span className="text-[color:var(--color-text-faint)] italic">{placeholder}</span>
          )}
          {canEdit && (
            <svg className="opacity-0 group-hover:opacity-40 shrink-0" viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M11.5 2.5a1.414 1.414 0 0 1 2 2L5 13H3v-2L11.5 2.5z"/>
            </svg>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/agents/AgentInlineField.jsx
git commit -m "feat: add AgentInlineField component"
```

---

## Task 3: `AgentContactList` — multi-entry list with add/edit/delete/primary

**Files:**
- Create: `src/components/agents/AgentContactList.jsx`

Receives `contacts` array from parent (no fetching). Calls `onChanged()` after any mutation so parent re-fetches.

Primary email sync: when `type === 'email'` and a primary changes, this component calls `onPrimaryEmailChanged(newEmail)` so `AgentContactsSection` can patch `agents.email`.

- [ ] **Step 1: Create the component**

```jsx
// src/components/agents/AgentContactList.jsx
import { useState, useRef, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

const LABEL_SUGGESTIONS = ['Work', 'Personal', 'Cell', 'Office', 'Mobile', 'Home']

function ContactRow({ contact, showPrimary, onDelete, onUpdateLabel, onUpdateValue, onMakePrimary, canEdit }) {
  const [editingLabel, setEditingLabel] = useState(false)
  const [editingValue, setEditingValue] = useState(false)
  const [labelDraft, setLabelDraft]     = useState(contact.label)
  const [valueDraft, setValueDraft]     = useState(contact.value)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const labelRef = useRef(null)
  const valueRef = useRef(null)

  useEffect(() => { if (editingLabel) labelRef.current?.focus() }, [editingLabel])
  useEffect(() => { if (editingValue) valueRef.current?.focus() }, [editingValue])

  const commitLabel = () => {
    setEditingLabel(false)
    setShowSuggestions(false)
    if (labelDraft.trim() !== contact.label) onUpdateLabel(contact.id, labelDraft.trim())
  }
  const commitValue = () => {
    setEditingValue(false)
    if (valueDraft.trim() !== contact.value && valueDraft.trim()) onUpdateValue(contact.id, valueDraft.trim())
    else setValueDraft(contact.value)
  }
  const cancelLabel = () => { setLabelDraft(contact.label); setEditingLabel(false); setShowSuggestions(false) }
  const cancelValue = () => { setValueDraft(contact.value); setEditingValue(false) }

  const inputCls = 'px-1.5 py-0.5 text-[11px] rounded bg-[color:var(--color-bg-input)] text-[color:var(--color-text)] border border-[color:var(--color-accent)] focus:outline-none focus:ring-1 focus:ring-[color:var(--color-accent)]'

  return (
    <div className="group flex items-center gap-1.5 py-1">
      {/* Primary star (email only) */}
      {showPrimary && (
        <button
          onClick={() => !contact.is_primary && onMakePrimary(contact.id)}
          className={`text-[13px] shrink-0 transition-colors ${contact.is_primary ? 'text-amber-400' : 'text-[color:var(--color-text-dim)] opacity-0 group-hover:opacity-60 hover:text-amber-300'}`}
          title={contact.is_primary ? 'Primary email' : 'Make primary'}
        >
          ★
        </button>
      )}

      {/* Label */}
      {editingLabel ? (
        <div className="relative">
          <input
            ref={labelRef}
            value={labelDraft}
            onChange={e => setLabelDraft(e.target.value)}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(commitLabel, 150)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); setEditingLabel(false); setShowSuggestions(false); setEditingValue(true) } if (e.key === 'Escape') cancelLabel() }}
            className={`${inputCls} w-20`}
            placeholder="Label"
          />
          {showSuggestions && (
            <div className="absolute top-full left-0 mt-0.5 bg-[color:var(--color-bg-elev-2)] border border-[color:var(--color-line)] rounded shadow-lg z-10 min-w-[100px]">
              {LABEL_SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onMouseDown={() => { setLabelDraft(s); setShowSuggestions(false); setEditingLabel(false); setEditingValue(true) }}
                  className="block w-full text-left px-3 py-1 text-[11px] text-[color:var(--color-text)] hover:bg-[color:var(--color-bg-elev)] transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <span
          onClick={() => canEdit && setEditingLabel(true)}
          className={`text-[11px] text-[color:var(--color-text-dim)] shrink-0 ${canEdit ? 'cursor-pointer hover:text-[color:var(--color-text)]' : ''} transition-colors`}
        >
          {contact.label || '—'}
        </span>
      )}

      <span className="text-[color:var(--color-text-dim)] text-[10px] shrink-0">·</span>

      {/* Value */}
      {editingValue ? (
        <input
          ref={valueRef}
          value={valueDraft}
          onChange={e => setValueDraft(e.target.value)}
          onBlur={commitValue}
          onKeyDown={e => { if (e.key === 'Enter') commitValue(); if (e.key === 'Escape') cancelValue() }}
          className={`${inputCls} flex-1 min-w-0`}
        />
      ) : (
        <span
          onClick={() => canEdit && setEditingValue(true)}
          className={`text-[12px] text-[color:var(--color-text)] flex-1 min-w-0 break-all ${canEdit ? 'cursor-pointer hover:text-[color:var(--color-accent)]' : ''} transition-colors`}
        >
          {contact.value}
        </span>
      )}

      {/* Delete */}
      {canEdit && (
        <button
          onClick={() => onDelete(contact.id)}
          className="opacity-0 group-hover:opacity-60 hover:opacity-100 text-[color:var(--color-text-dim)] hover:text-[color:var(--color-danger-text)] shrink-0 transition-opacity text-[12px] leading-none"
          title="Remove"
        >
          ×
        </button>
      )}
    </div>
  )
}

function NewContactRow({ type, workspaceId, agentId, nextSortOrder, onSaved, onCancel }) {
  const [label, setLabel]               = useState('')
  const [value, setValue]               = useState('')
  const [saving, setSaving]             = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const labelRef = useRef(null)

  useEffect(() => { labelRef.current?.focus() }, [])

  const save = async () => {
    if (!value.trim()) { onCancel(); return }
    setSaving(true)
    const { error } = await supabase.from('agent_contacts').insert({
      workspace_id: workspaceId,
      agent_id:     agentId,
      type,
      value:        value.trim(),
      label:        label.trim(),
      is_primary:   false,
      sort_order:   nextSortOrder,
    })
    setSaving(false)
    if (error) { onCancel(); return }
    onSaved()
  }

  const inputCls = 'px-1.5 py-0.5 text-[11px] rounded bg-[color:var(--color-bg-input)] text-[color:var(--color-text)] border border-[color:var(--color-accent)] focus:outline-none focus:ring-1 focus:ring-[color:var(--color-accent)]'

  return (
    <div className="flex items-center gap-1.5 py-1">
      <div className="relative">
        <input
          ref={labelRef}
          value={label}
          onChange={e => setLabel(e.target.value)}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          onKeyDown={e => { if (e.key === 'Escape') onCancel() }}
          className={`${inputCls} w-20`}
          placeholder="Label"
          disabled={saving}
        />
        {showSuggestions && (
          <div className="absolute top-full left-0 mt-0.5 bg-[color:var(--color-bg-elev-2)] border border-[color:var(--color-line)] rounded shadow-lg z-10 min-w-[100px]">
            {LABEL_SUGGESTIONS.map(s => (
              <button
                key={s}
                onMouseDown={() => { setLabel(s); setShowSuggestions(false) }}
                className="block w-full text-left px-3 py-1 text-[11px] text-[color:var(--color-text)] hover:bg-[color:var(--color-bg-elev)] transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
      <span className="text-[color:var(--color-text-dim)] text-[10px] shrink-0">·</span>
      <input
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') onCancel() }}
        className={`${inputCls} flex-1 min-w-0`}
        placeholder={type === 'email' ? 'email@example.com' : '(555) 000-0000'}
        disabled={saving}
      />
      <button onClick={onCancel} className="text-[color:var(--color-text-dim)] text-[12px] opacity-60 hover:opacity-100">×</button>
    </div>
  )
}

export default function AgentContactList({ agentId, workspaceId, type, contacts, onChanged, onPrimaryEmailChanged, showPrimary = false, canEdit = true }) {
  const [adding, setAdding] = useState(false)
  const [error, setError]   = useState(null)

  const updateField = async (id, field, val) => {
    setError(null)
    const { error: err } = await supabase.from('agent_contacts').update({ [field]: val }).eq('id', id)
    if (err) { setError(err.message); return }
    onChanged()
  }

  const deleteContact = async (id) => {
    setError(null)
    const target = contacts.find(c => c.id === id)
    const { error: err } = await supabase.from('agent_contacts').delete().eq('id', id)
    if (err) { setError(err.message); return }

    if (target?.is_primary && type === 'email') {
      const remaining = contacts.filter(c => c.id !== id)
      if (remaining.length > 0) {
        const next = remaining.sort((a, b) => a.sort_order - b.sort_order)[0]
        await supabase.from('agent_contacts').update({ is_primary: true }).eq('id', next.id)
        onPrimaryEmailChanged?.(next.value)
      } else {
        onPrimaryEmailChanged?.(null)
      }
    }
    onChanged()
  }

  const makePrimary = async (id) => {
    setError(null)
    const current = contacts.find(c => c.is_primary)
    if (current) await supabase.from('agent_contacts').update({ is_primary: false }).eq('id', current.id)
    const { error: err } = await supabase.from('agent_contacts').update({ is_primary: true }).eq('id', id)
    if (err) { setError(err.message); return }
    const target = contacts.find(c => c.id === id)
    onPrimaryEmailChanged?.(target?.value)
    onChanged()
  }

  const nextSortOrder = contacts.length > 0 ? Math.max(...contacts.map(c => c.sort_order)) + 1 : 0

  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1">
        {type === 'phone' ? 'Phones' : 'Emails'}
      </div>

      {contacts.map(c => (
        <ContactRow
          key={c.id}
          contact={c}
          showPrimary={showPrimary}
          canEdit={canEdit}
          onDelete={deleteContact}
          onUpdateLabel={(id, val) => updateField(id, 'label', val)}
          onUpdateValue={(id, val) => updateField(id, 'value', val)}
          onMakePrimary={makePrimary}
        />
      ))}

      {adding && (
        <NewContactRow
          type={type}
          workspaceId={workspaceId}
          agentId={agentId}
          nextSortOrder={nextSortOrder}
          onSaved={() => { setAdding(false); onChanged() }}
          onCancel={() => setAdding(false)}
        />
      )}

      {canEdit && !adding && (
        <button
          onClick={() => setAdding(true)}
          className="text-[11px] text-[color:var(--color-text-dim)] hover:text-[color:var(--color-accent)] transition-colors mt-0.5"
        >
          + Add {type}
        </button>
      )}

      {error && (
        <div className="text-[11px] text-[color:var(--color-danger-text)] mt-1">{error}</div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/agents/AgentContactList.jsx
git commit -m "feat: add AgentContactList component"
```

---

## Task 4: `AgentContactsSection` — assembles all editable fields

**Files:**
- Create: `src/components/agents/AgentContactsSection.jsx`

Fetches `agent_contacts`, handles legacy seed, assembles `AgentInlineField` × 3 + `AgentContactList` × 2.

- [ ] **Step 1: Create the component**

```jsx
// src/components/agents/AgentContactsSection.jsx
import { useState, useEffect } from 'react'
import Card from '../ui/Card'
import AgentInlineField from './AgentInlineField'
import AgentContactList from './AgentContactList'
import { supabase } from '../../lib/supabase'

async function seedLegacyContacts(agent, workspaceId) {
  const rows = []
  if (agent.phone) {
    rows.push({ workspace_id: workspaceId, agent_id: agent.id, type: 'phone', value: agent.phone, label: 'Phone', is_primary: false, sort_order: 0 })
  }
  if (agent.email) {
    rows.push({ workspace_id: workspaceId, agent_id: agent.id, type: 'email', value: agent.email, label: 'Work', is_primary: true, sort_order: 0 })
  }
  if (rows.length) await supabase.from('agent_contacts').insert(rows)
}

export default function AgentContactsSection({ agent, workspaceId, canEdit, onAgentUpdated }) {
  const [contacts, setContacts] = useState([])
  const [loading, setLoading]   = useState(true)
  const [seeded, setSeeded]     = useState(false)

  const fetchContacts = async () => {
    const { data } = await supabase
      .from('agent_contacts')
      .select('*')
      .eq('agent_id', agent.id)
      .order('sort_order', { ascending: true })
    setContacts(data || [])
    setLoading(false)
    return data || []
  }

  useEffect(() => {
    if (!agent?.id) return
    setLoading(true)
    fetchContacts()
    setSeeded(false)
  }, [agent.id])

  const phones = contacts.filter(c => c.type === 'phone')
  const emails = contacts.filter(c => c.type === 'email')

  const handleContactsChanged = async () => {
    await fetchContacts()
  }

  const handleBeforeAdd = async () => {
    if (seeded) return
    const existing = await fetchContacts()
    if (existing.length === 0) {
      await seedLegacyContacts(agent, workspaceId)
      await fetchContacts()
    }
    setSeeded(true)
  }

  const handlePrimaryEmailChanged = async (newEmail) => {
    const { data } = await supabase
      .from('agents')
      .update({ email: newEmail, updated_at: new Date().toISOString() })
      .eq('id', agent.id)
      .select()
      .single()
    if (data) onAgentUpdated?.(data)
  }

  const saveScalar = async (field, value) => {
    const { data } = await supabase
      .from('agents')
      .update({ [field]: value || null, updated_at: new Date().toISOString() })
      .eq('id', agent.id)
      .select()
      .single()
    if (data) onAgentUpdated?.(data)
  }

  const handleNewContact = async () => {
    await handleBeforeAdd()
    await fetchContacts()
  }

  return (
    <Card title="Contact Info">
      <div className="flex flex-col gap-4">

        {/* Scalar fields */}
        <AgentInlineField
          label="Name"
          value={agent.name}
          placeholder="Add name…"
          canEdit={canEdit}
          onSave={v => saveScalar('name', v)}
        />
        <AgentInlineField
          label="Brokerage"
          value={agent.brokerage}
          placeholder="Add brokerage…"
          canEdit={canEdit}
          onSave={v => saveScalar('brokerage', v)}
        />
        <AgentInlineField
          label="Address"
          value={agent.address}
          placeholder="Add address…"
          multiline
          canEdit={canEdit}
          onSave={v => saveScalar('address', v)}
        />

        {/* Contact lists */}
        {!loading && (
          <>
            <AgentContactList
              agentId={agent.id}
              workspaceId={workspaceId}
              type="phone"
              contacts={phones}
              canEdit={canEdit}
              showPrimary={false}
              onChanged={async () => {
                await handleNewContact()
                await handleContactsChanged()
              }}
            />
            <AgentContactList
              agentId={agent.id}
              workspaceId={workspaceId}
              type="email"
              contacts={emails}
              canEdit={canEdit}
              showPrimary={true}
              onChanged={async () => {
                await handleNewContact()
                await handleContactsChanged()
              }}
              onPrimaryEmailChanged={handlePrimaryEmailChanged}
            />
          </>
        )}
      </div>
    </Card>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/agents/AgentContactsSection.jsx
git commit -m "feat: add AgentContactsSection component"
```

---

## Task 5: Wire `AgentContactsSection` into `AgentDetailDrawer`

**Files:**
- Modify: `src/components/agents/AgentDetailDrawer.jsx`

Replace the static Contact Info `Card` block with `AgentContactsSection`. Remove the `Card` import if it's no longer used.

- [ ] **Step 1: Read the current file**

Read `src/components/agents/AgentDetailDrawer.jsx` to confirm current structure before editing.

- [ ] **Step 2: Add the import**

Add this import after the `AddAgentModal` import line:

```jsx
import AgentContactsSection from './AgentContactsSection'
```

- [ ] **Step 3: Replace the Contact Info Card**

Find this block in the left column (around lines 117–131):

```jsx
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
```

Replace with:

```jsx
                {/* Contact Info — editable */}
                <AgentContactsSection
                  agent={agent}
                  workspaceId={workspaceId}
                  canEdit={canEdit}
                  onAgentUpdated={handleAgentUpdated}
                />
```

- [ ] **Step 4: Remove unused `Card` import**

Check if `Card` is still used anywhere else in the file. If not (it was only used for Contact Info), remove the import line:
```jsx
import Card from '../ui/Card'
```

- [ ] **Step 5: Commit**

```bash
git add src/components/agents/AgentDetailDrawer.jsx
git commit -m "feat: replace static Contact Info card with AgentContactsSection"
```

---

## Task 6: Fix legacy seed race condition in `AgentContactsSection`

The current `AgentContactsSection` calls `handleBeforeAdd` inside `onChanged` which is called after a new entry is saved — but the seed needs to happen *before* the first `NewContactRow` insert, not after. The `NewContactRow` in `AgentContactList` inserts directly to Supabase without going through the section. The seed needs to be triggered when `+ Add phone/email` is clicked, not after saving.

**Files:**
- Modify: `src/components/agents/AgentContactsSection.jsx`
- Modify: `src/components/agents/AgentContactList.jsx`

The fix: expose an `onBeforeAdd` prop on `AgentContactList` that `AgentContactsSection` uses to run the seed before the new row appears.

- [ ] **Step 1: Add `onBeforeAdd` prop to `AgentContactList`**

In `AgentContactList`, find the `+ Add phone/email` button:

```jsx
      {canEdit && !adding && (
        <button
          onClick={() => setAdding(true)}
```

Replace with:

```jsx
      {canEdit && !adding && (
        <button
          onClick={async () => { await onBeforeAdd?.(); setAdding(true) }}
```

Also add `onBeforeAdd` to the props destructure:

```jsx
export default function AgentContactList({ agentId, workspaceId, type, contacts, onChanged, onPrimaryEmailChanged, showPrimary = false, canEdit = true, onBeforeAdd }) {
```

- [ ] **Step 2: Pass `onBeforeAdd` from `AgentContactsSection`**

In `AgentContactsSection`, update both `AgentContactList` usages to pass `onBeforeAdd` and simplify `onChanged` (remove the `handleNewContact` wrapper since seeding now happens before add):

Replace the phones `AgentContactList`:
```jsx
            <AgentContactList
              agentId={agent.id}
              workspaceId={workspaceId}
              type="phone"
              contacts={phones}
              canEdit={canEdit}
              showPrimary={false}
              onBeforeAdd={handleBeforeAdd}
              onChanged={handleContactsChanged}
            />
```

Replace the emails `AgentContactList`:
```jsx
            <AgentContactList
              agentId={agent.id}
              workspaceId={workspaceId}
              type="email"
              contacts={emails}
              canEdit={canEdit}
              showPrimary={true}
              onBeforeAdd={handleBeforeAdd}
              onChanged={handleContactsChanged}
              onPrimaryEmailChanged={handlePrimaryEmailChanged}
            />
```

Also remove the `handleNewContact` function from `AgentContactsSection` — it's no longer needed.

- [ ] **Step 3: Commit**

```bash
git add src/components/agents/AgentContactsSection.jsx src/components/agents/AgentContactList.jsx
git commit -m "fix: seed legacy contacts before first add, not after"
```

---

## Task 7: Smoke test the full flow

Manual verification — no automated tests are practical for this Supabase + browser UI feature.

- [ ] **Step 1: Apply migration and start dev server**

Apply migration in Supabase SQL editor (contents of `supabase/migrations/20260606000004_agent_contacts.sql`), then:

```bash
npm run dev
```

- [ ] **Step 2: Verify inline edit — scalar fields**

1. Open any agent drawer
2. Hover over Name → pencil icon appears
3. Click Name → input appears with current value focused
4. Type a new name, press Enter → input closes, new name shows, header updates
5. Click Brokerage → change it, press Escape → original value restored, no save
6. Click Address → textarea appears, type multi-line text, click away → saved

- [ ] **Step 3: Verify legacy seed**

1. Open an agent that has an existing phone/email in the database but no `agent_contacts` rows
2. Click `+ Add phone` → legacy phone/email should seed into the list before the new row appears
3. Verify the seeded entry shows with label "Phone" / "Work"

- [ ] **Step 4: Verify add phone/email**

1. Click `+ Add phone` → label input focused, suggestions dropdown appears
2. Click "Cell" → label fills, value input focused
3. Type a phone number, press Enter → entry saved, appears in list
4. Click `+ Add email` → add a second email
5. Verify the first email has `★` filled (primary), second has `★` outline

- [ ] **Step 5: Verify primary email promotion**

1. Add two emails
2. Click `★` on the non-primary email
3. Verify star fills on clicked one, empties on the other
4. Verify `agents.email` updated (check Supabase table or check the leads link URL in drawer header)

- [ ] **Step 6: Verify delete**

1. Delete a non-primary email → entry disappears
2. Delete the primary email when another exists → next email becomes primary automatically
3. Delete the last email → list shows empty, `+ Add email` button visible

- [ ] **Step 7: Verify inline edit on existing contact**

1. Click a contact's label → edit in place, Enter to save
2. Click a contact's value → edit in place, Escape to cancel

- [ ] **Step 8: Final commit if fixes needed**

```bash
git add -A
git commit -m "fix: smoke test corrections for agent editable contacts"
```
