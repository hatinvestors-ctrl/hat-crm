# Agent Outreach System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dedicated Agents page that extracts listing agents from leads, tracks outreach history, and sends bulk templated emails to agents asking about available properties.

**Architecture:** A new `agents` table deduplicates agents from leads by email. A `send-agent-emails` Netlify function sends bulk emails via existing SMTP and logs to a new `agent_outreach` table. The frontend Agents page provides filtering, bulk select, and a send modal with two built-in templates.

**Tech Stack:** React, Supabase (Postgres), Netlify Functions, nodemailer (already installed), React Router

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `supabase/migrations/20260606000000_agents.sql` | Create | agents + agent_outreach tables |
| `netlify/functions/send-agent-emails.mjs` | Create | Bulk send Netlify function |
| `src/lib/agentOutreach.js` | Create | syncAgentsFromLeads(), client helpers |
| `src/components/agents/AgentTable.jsx` | Create | Agent list with checkboxes + status badges |
| `src/components/agents/AgentEmailModal.jsx` | Create | Template picker + preview + send modal |
| `src/components/agents/AddAgentModal.jsx` | Create | Manual agent add form |
| `src/pages/AgentsPage.jsx` | Create | Main agents page |
| `src/App.jsx` | Modify | Add /agents route |
| `src/components/Sidebar.jsx` | Modify | Add Agents nav item |
| `src/lib/enrichment.js` | Modify | Auto-upsert agent after RentCast lookup |

---

## Task 1: Database migration — agents and agent_outreach tables

**Files:**
- Create: `supabase/migrations/20260606000000_agents.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/20260606000000_agents.sql
-- Agents table: deduplicates listing agents from leads per workspace.
-- agent_outreach table: tracks every email sent to an agent.

CREATE TABLE IF NOT EXISTS public.agents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name            TEXT,
  email           TEXT,
  phone           TEXT,
  brokerage       TEXT,
  notes           TEXT,
  last_contacted_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique agent per workspace by email (case-insensitive)
CREATE UNIQUE INDEX agents_workspace_email_idx
  ON public.agents (workspace_id, LOWER(email))
  WHERE email IS NOT NULL AND email <> '';

-- RLS: workspace members can read/write their workspace agents
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members can manage agents"
  ON public.agents
  FOR ALL
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  );

CREATE TABLE IF NOT EXISTS public.agent_outreach (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id     UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL,
  template     TEXT NOT NULL,
  subject      TEXT NOT NULL,
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.agent_outreach ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members can manage agent_outreach"
  ON public.agent_outreach
  FOR ALL
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  );
```

- [ ] **Step 2: Apply migration in Supabase SQL Editor**

Paste the SQL above into Supabase Dashboard → SQL Editor and run it.

Expected: no errors, two new tables appear in the Table Editor.

- [ ] **Step 3: Verify tables exist**

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('agents', 'agent_outreach');
```

Expected: 2 rows returned.

- [ ] **Step 4: Commit the migration file**

```bash
git add supabase/migrations/20260606000000_agents.sql
git commit -m "feat: add agents and agent_outreach tables"
```

---

## Task 2: Netlify function — send-agent-emails

**Files:**
- Create: `netlify/functions/send-agent-emails.mjs`

- [ ] **Step 1: Create the function**

```js
// netlify/functions/send-agent-emails.mjs
// Sends bulk emails to agents using workspace SMTP settings.
// POST body: { workspace_id, user_id, agent_ids: string[], template: 'introduction'|'follow_up', subject: string }
// Loops agents, substitutes {agent_name}/{brokerage}, sends via nodemailer, logs to agent_outreach.

import nodemailer from 'nodemailer'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const APP_URL      = process.env.URL || 'https://hatcrm.netlify.app'

const HEADERS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST,OPTIONS',
}

function sbHeaders() {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Accept: 'application/json', 'Content-Type': 'application/json' }
}

async function fetchWorkspaceSettings(workspaceId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/workspaces?id=eq.${workspaceId}&select=settings`, { headers: sbHeaders() })
  if (!res.ok) throw new Error(`Failed to fetch workspace: HTTP ${res.status}`)
  const rows = await res.json()
  if (!rows?.length) throw new Error('Workspace not found.')
  return rows[0].settings || {}
}

async function fetchAgents(agentIds) {
  const ids = agentIds.map(id => `"${id}"`).join(',')
  const res = await fetch(`${SUPABASE_URL}/rest/v1/agents?id=in.(${ids})&select=id,name,email,brokerage`, { headers: sbHeaders() })
  if (!res.ok) throw new Error(`Failed to fetch agents: HTTP ${res.status}`)
  return await res.json()
}

async function logOutreach(workspaceId, agentId, userId, template, subject) {
  await fetch(`${SUPABASE_URL}/rest/v1/agent_outreach`, {
    method: 'POST',
    headers: { ...sbHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify({ workspace_id: workspaceId, agent_id: agentId, user_id: userId, template, subject }),
  })
}

async function updateLastContacted(agentId) {
  await fetch(`${SUPABASE_URL}/rest/v1/agents?id=eq.${agentId}`, {
    method: 'PATCH',
    headers: { ...sbHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify({ last_contacted_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
  })
}

function createTransport(settings) {
  const host     = settings.mail_smtp_host
  const port     = Number(settings.mail_smtp_port) || 587
  const user     = settings.mail_smtp_user
  const pass     = settings.mail_smtp_password
  const secure   = settings.mail_smtp_secure === true
  const starttls = settings.mail_smtp_starttls !== false && !secure
  if (!host || !user || !pass) throw new Error('SMTP not configured. Go to Settings → Mail Server.')
  return nodemailer.createTransport({ host, port, secure, auth: { user, pass }, ...(starttls ? { requireTLS: true } : {}) })
}

const DEFAULT_TEMPLATES = {
  introduction: {
    subject: 'Cash Buyer Looking for Properties in Jacksonville',
    body: `Hi {agent_name},

My name is Tomer with HAT Investors. We're active cash buyers in Jacksonville looking for investment properties. If you have any listings that aren't moving or off-market opportunities, we'd love to connect.

We close fast with no contingencies — usually within 2 weeks.

Would love to hear from you if anything comes up.

Best,
HAT Investors`,
  },
  follow_up: {
    subject: 'Following Up — Cash Buyer in Jacksonville',
    body: `Hi {agent_name},

Just following up on my previous message. We're still actively buying in Jacksonville — if anything has come up that might be a fit, I'd love to hear about it.

Happy to hop on a quick call anytime.

Best,
HAT Investors`,
  },
}

function renderTemplate(templateBody, agent) {
  const name = agent.name?.split(' ')[0] || agent.name || 'there'
  const brokerage = agent.brokerage || ''
  return templateBody
    .replace(/\{agent_name\}/g, name)
    .replace(/\{brokerage\}/g, brokerage)
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), { status: 405, headers: HEADERS })
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return new Response(JSON.stringify({ ok: false, error: 'Server misconfigured.' }), { status: 500, headers: HEADERS })
  }

  try {
    const { workspace_id, user_id, agent_ids, template, subject } = await req.json().catch(() => ({}))

    if (!workspace_id || !user_id || !agent_ids?.length || !template) {
      return new Response(JSON.stringify({ ok: false, error: 'workspace_id, user_id, agent_ids, template required.' }), { status: 400, headers: HEADERS })
    }

    if (!DEFAULT_TEMPLATES[template]) {
      return new Response(JSON.stringify({ ok: false, error: `Unknown template: ${template}` }), { status: 400, headers: HEADERS })
    }

    const settings = await fetchWorkspaceSettings(workspace_id)
    const agents   = await fetchAgents(agent_ids)
    const transport = createTransport(settings)

    const fromName  = settings.mail_from_name?.trim()
    const fromEmail = settings.mail_from_email?.trim() || settings.mail_smtp_user
    const from      = fromName ? `"${fromName}" <${fromEmail}>` : fromEmail
    const cc        = settings.notification_cc || undefined

    const templateDef = DEFAULT_TEMPLATES[template]
    const finalSubject = subject || templateDef.subject

    const results = { sent: 0, failed: 0, skipped: 0 }

    for (const agent of agents) {
      if (!agent.email) { results.skipped++; continue }
      try {
        const body = renderTemplate(templateDef.body, agent)
        await transport.sendMail({ from, to: agent.email, cc, subject: finalSubject, text: body })
        await logOutreach(workspace_id, agent.id, user_id, template, finalSubject)
        await updateLastContacted(agent.id)
        results.sent++
      } catch (err) {
        console.error('[send-agent-emails] failed for', agent.email, err.message)
        results.failed++
      }
    }

    return new Response(JSON.stringify({ ok: true, ...results }), { status: 200, headers: HEADERS })
  } catch (err) {
    console.error('[send-agent-emails]', err.message)
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: HEADERS })
  }
}
```

- [ ] **Step 2: Verify file exists**

```bash
ls netlify/functions/send-agent-emails.mjs
```

- [ ] **Step 3: Commit**

```bash
git add netlify/functions/send-agent-emails.mjs
git commit -m "feat: add send-agent-emails Netlify function"
```

---

## Task 3: Client library — agentOutreach.js

**Files:**
- Create: `src/lib/agentOutreach.js`

- [ ] **Step 1: Create the file**

```js
// src/lib/agentOutreach.js
// Client-side helpers for the agent outreach system.

import { supabase } from './supabase'

// Upsert a single agent from a lead's enrichment data.
// Called after RentCast lookup fills in listing_agent_* fields.
export async function upsertAgentFromLead(workspaceId, { listing_agent_name, listing_agent_email, listing_agent_phone, listing_brokerage }) {
  if (!workspaceId || !listing_agent_email?.trim()) return
  await supabase.from('agents').upsert(
    {
      workspace_id: workspaceId,
      name:         listing_agent_name || null,
      email:        listing_agent_email.trim().toLowerCase(),
      phone:        listing_agent_phone || null,
      brokerage:    listing_brokerage  || null,
      updated_at:   new Date().toISOString(),
    },
    { onConflict: 'workspace_id,email', ignoreDuplicates: false }
  )
}

// Sync all agents from leads in this workspace.
// Upserts one agent per unique listing_agent_email found in leads.
export async function syncAgentsFromLeads(workspaceId) {
  if (!workspaceId) return { count: 0 }

  const { data: leads } = await supabase
    .from('leads')
    .select('listing_agent_name, listing_agent_email, listing_agent_phone, listing_brokerage')
    .eq('workspace_id', workspaceId)
    .not('listing_agent_email', 'is', null)
    .neq('listing_agent_email', '')

  if (!leads?.length) return { count: 0 }

  // Deduplicate by lowercased email
  const seen = new Set()
  const unique = leads.filter(l => {
    const key = l.listing_agent_email.trim().toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const rows = unique.map(l => ({
    workspace_id: workspaceId,
    name:         l.listing_agent_name  || null,
    email:        l.listing_agent_email.trim().toLowerCase(),
    phone:        l.listing_agent_phone || null,
    brokerage:    l.listing_brokerage   || null,
    updated_at:   new Date().toISOString(),
  }))

  const { error } = await supabase
    .from('agents')
    .upsert(rows, { onConflict: 'workspace_id,email', ignoreDuplicates: false })

  if (error) throw error
  return { count: rows.length }
}

// Send bulk emails to selected agents via Netlify function.
export async function sendAgentEmails({ workspaceId, userId, agentIds, template, subject }) {
  const res = await fetch('/.netlify/functions/send-agent-emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspace_id: workspaceId, user_id: userId, agent_ids: agentIds, template, subject }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/agentOutreach.js
git commit -m "feat: add agentOutreach client library"
```

---

## Task 4: AgentTable component

**Files:**
- Create: `src/components/agents/AgentTable.jsx`

- [ ] **Step 1: Create the file**

```jsx
// src/components/agents/AgentTable.jsx
// Agent list table with checkboxes, status badges, and filter bar.

import { formatDate } from '../../lib/calculations'

const STATUS_DAYS = 30

function contactStatus(lastContactedAt) {
  if (!lastContactedAt) return { label: 'Never contacted', cls: 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-dim)]' }
  const days = Math.floor((Date.now() - new Date(lastContactedAt)) / 86400000)
  if (days > STATUS_DAYS) return { label: `${days}d ago`, cls: 'bg-[color:var(--color-warn-soft)] text-[color:var(--color-warn-text)]' }
  return { label: `${days}d ago`, cls: 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)]' }
}

export default function AgentTable({ agents, selected, onToggle, onToggleAll, leadCounts }) {
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
                className="border-t border-[color:var(--color-line)] hover:bg-[color:var(--color-bg-elev)] transition-colors"
              >
                <td className="px-3 py-2.5">
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
git commit -m "feat: add AgentTable component"
```

---

## Task 5: AgentEmailModal component

**Files:**
- Create: `src/components/agents/AgentEmailModal.jsx`

- [ ] **Step 1: Create the file**

```jsx
// src/components/agents/AgentEmailModal.jsx
// Template picker + preview + send modal for bulk agent email.

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
```

- [ ] **Step 2: Commit**

```bash
git add src/components/agents/AgentEmailModal.jsx
git commit -m "feat: add AgentEmailModal component"
```

---

## Task 6: AddAgentModal component

**Files:**
- Create: `src/components/agents/AddAgentModal.jsx`

- [ ] **Step 1: Create the file**

```jsx
// src/components/agents/AddAgentModal.jsx
// Manual agent add form.

import { useState } from 'react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import Input from '../ui/Input'
import { supabase } from '../../lib/supabase'

export default function AddAgentModal({ open, onClose, workspaceId, onAdded }) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', brokerage: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const update = patch => setForm(prev => ({ ...prev, ...patch }))

  const handleSave = async () => {
    if (!form.email?.trim()) { setError('Email is required.'); return }
    setSaving(true)
    setError(null)
    try {
      const { data, error: err } = await supabase
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
        .single()
      if (err) throw err
      onAdded?.(data)
      setForm({ name: '', email: '', phone: '', brokerage: '' })
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
      title="Add Agent"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} loading={saving}>Add Agent</Button>
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
git commit -m "feat: add AddAgentModal component"
```

---

## Task 7: AgentsPage

**Files:**
- Create: `src/pages/AgentsPage.jsx`

- [ ] **Step 1: Create the file**

```jsx
// src/pages/AgentsPage.jsx
// Main agents page: list, filter, bulk select, sync, send email.

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

const FILTER_OPTIONS = [
  { value: 'all',    label: 'All agents' },
  { value: 'never',  label: 'Never contacted' },
  { value: 'due',    label: 'Due for follow-up (30+ days)' },
]

export default function AgentsPage() {
  const { workspace, workspaceId, user } = useOutletContext()
  const [agents, setAgents] = useState([])
  const [leadCounts, setLeadCounts] = useState({})
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [filter, setFilter] = useState('all')
  const [brokFilter, setBrokFilter] = useState('')
  const [emailModal, setEmailModal] = useState(false)
  const [addModal, setAddModal] = useState(false)
  const [toast, setToast] = useState(null)

  const load = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('agents')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('name', { ascending: true })
    setAgents(data || [])

    // Count leads per agent by matching listing_agent_email
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
        if (!a.last_contacted_at) return true
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

  const selectedCount = [...selected].filter(id => filtered.some(a => a.id === id)).length

  return (
    <>
      <Topbar
        title="Agents"
        breadcrumbs={[{ label: workspace.name, to: `/w/${workspaceId}` }, { label: 'Agents' }]}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={handleSync} loading={syncing}>
              Sync from leads
            </Button>
            <Button size="sm" onClick={() => setAddModal(true)}>
              + Add Agent
            </Button>
          </div>
        }
      />

      <div className="px-6 py-4 space-y-4">
        {/* Filter bar */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex gap-1">
            {FILTER_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setFilter(opt.value)}
                className={`px-3 h-7 text-[12px] font-medium rounded-md transition-colors ${
                  filter === opt.value
                    ? 'bg-[color:var(--color-accent)] text-white'
                    : 'bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="Filter by name or brokerage…"
            value={brokFilter}
            onChange={e => setBrokFilter(e.target.value)}
            className="h-7 px-3 text-[12.5px] rounded-md border border-[color:var(--color-line)] bg-[color:var(--color-bg)] text-[color:var(--color-text)] placeholder:text-[color:var(--color-text-dim)] outline-none focus:ring-1 focus:ring-[color:var(--color-accent)]"
          />
          {selectedCount > 0 && (
            <Button size="sm" onClick={() => setEmailModal(true)}>
              Send Email ({selectedCount})
            </Button>
          )}
        </div>

        {/* Toast */}
        {toast && (
          <div className="p-2.5 bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)] text-[12px] rounded">
            {toast}
          </div>
        )}

        {/* Table */}
        {loading ? (
          <LoadingSpinner />
        ) : (
          <AgentTable
            agents={filtered}
            selected={selected}
            onToggle={toggleAgent}
            onToggleAll={toggleAll}
            leadCounts={leadCounts}
          />
        )}

        <div className="text-[11px] text-[color:var(--color-text-dim)]">
          {filtered.length} agent{filtered.length === 1 ? '' : 's'}
          {filter !== 'all' && ` (filtered from ${agents.length} total)`}
        </div>
      </div>

      <AgentEmailModal
        open={emailModal}
        onClose={() => setEmailModal(false)}
        agentCount={selectedCount}
        onSend={handleSend}
      />

      <AddAgentModal
        open={addModal}
        onClose={() => setAddModal(false)}
        workspaceId={workspaceId}
        onAdded={() => load()}
      />
    </>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/AgentsPage.jsx
git commit -m "feat: add AgentsPage"
```

---

## Task 8: Wire up route and sidebar nav

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/components/Sidebar.jsx`

- [ ] **Step 1: Add route to App.jsx**

Read the current `src/App.jsx`. Find the import section and add:

```jsx
import AgentsPage from './pages/AgentsPage'
```

Find the route for `leads/:leadId` and add the agents route after it:

```jsx
<Route path="agents" element={<AgentsPage />} />
```

- [ ] **Step 2: Add nav item to Sidebar.jsx**

Read `src/components/Sidebar.jsx`. Find the `ICONS` object and add an agents icon:

```jsx
agents: (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
    <circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>
),
```

Find the NavLink for leads and add an Agents nav link after it:

```jsx
<NavLink to={`${base}/agents`} className={navItemClasses}>
  <span className="text-[color:var(--color-text-dim)]">{ICONS.agents}</span>
  <span className="flex-1">Agents</span>
</NavLink>
```

- [ ] **Step 3: Commit**

```bash
git add src/App.jsx src/components/Sidebar.jsx
git commit -m "feat: add Agents route and sidebar nav item"
```

---

## Task 9: Auto-upsert agent after RentCast enrichment

When a user clicks "Look up" on a lead and RentCast returns agent data, automatically add the agent to the agents table.

**Files:**
- Modify: `src/components/leads/LeadForm.jsx`

- [ ] **Step 1: Add import to LeadForm.jsx**

At the top of `src/components/leads/LeadForm.jsx`, add:

```jsx
import { upsertAgentFromLead } from '../../lib/agentOutreach'
```

- [ ] **Step 2: Hook into the lookup result**

In `LeadForm.jsx`, find the `runLookup` function. After `setForm(prev => ({ ...prev, ...patch }))` and before the `setLookupNotice({...})` call, add:

```jsx
      // Auto-upsert agent into agents table if email was returned
      if (r.listing_agent_email) {
        upsertAgentFromLead(workspaceId, {
          listing_agent_name:  r.listing_agent_name,
          listing_agent_email: r.listing_agent_email,
          listing_agent_phone: r.listing_agent_phone,
          listing_brokerage:   r.listing_brokerage,
        }).catch(() => {})
      }
```

- [ ] **Step 3: Commit**

```bash
git add src/components/leads/LeadForm.jsx
git commit -m "feat: auto-upsert agent from RentCast enrichment"
```

---

## Task 10: Manual verification

- [ ] **Step 1: Deploy**

```bash
git push origin main
```

- [ ] **Step 2: Verify Agents page appears in sidebar**

Open the live app. Confirm "Agents" appears in the left sidebar.

- [ ] **Step 3: Sync agents from leads**

Go to Agents page, click "Sync from leads". Confirm a toast appears with the count and agents appear in the table.

- [ ] **Step 4: Test bulk email**

Select 1-2 agents, click "Send Email", choose Introduction template, click Send. Confirm toast shows "Sent to X agents." Check the CC inbox (tom@hatinvestors.com) to verify the email arrived.

- [ ] **Step 5: Test manual add**

Click "+ Add Agent", enter an email, save. Confirm the agent appears in the table.

- [ ] **Step 6: Test filter**

Click "Never contacted" filter — only agents with no outreach history should show. Click "Due for follow-up" — only agents contacted 30+ days ago should show.
