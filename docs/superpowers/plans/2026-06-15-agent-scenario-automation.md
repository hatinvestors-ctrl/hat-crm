# Agent Scenario Automation — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a scenario-driven outreach automation system where a daily cron creates email drafts, and humans approve each draft before it sends — no auto-send by default.

**Architecture:** Four new DB tables (outreach_scenarios, scenario_steps, scenario_enrollments, scheduled_messages + message_drafts + send_log + opt_outs). A daily Netlify cron at 8 AM EST creates drafts. An HTTP function handles approve-and-send with idempotency. Two new pages: ScenariosPage (builder) and DraftsInboxPage (review). Sidebar gets a pending-drafts badge.

**Tech Stack:** Supabase PostgreSQL, Netlify Functions (ESBuild, cron), React 18 + Tailwind CSS, Nodemailer, Anthropic Claude (already wired in generate-agent-email.mjs)

---

## Files

| File | Action |
|------|--------|
| `supabase/migrations/20260615000002_outreach_scenarios.sql` | CREATE |
| `supabase/migrations/20260615000003_scheduled_messages.sql` | CREATE |
| `netlify/functions/process-agent-sequences.mjs` | CREATE |
| `netlify/functions/send-approved-draft.mjs` | CREATE |
| `netlify.toml` | MODIFY — add cron schedule |
| `src/pages/ScenariosPage.jsx` | CREATE |
| `src/pages/DraftsInboxPage.jsx` | CREATE |
| `src/App.jsx` | MODIFY — add routes |
| `src/components/Sidebar.jsx` | MODIFY — add drafts badge |
| `src/components/agents/AgentScenarioPanel.jsx` | CREATE |
| `src/components/agents/AgentDetailDrawer.jsx` | MODIFY — add AgentScenarioPanel |

---

### Task 1: DB Migration — outreach_scenarios, scenario_steps, scenario_enrollments

**Files:**
- Create: `supabase/migrations/20260615000002_outreach_scenarios.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- outreach_scenarios: scenario definitions
CREATE TABLE IF NOT EXISTS public.outreach_scenarios (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  type         TEXT NOT NULL DEFAULT 'introduction'
    CHECK (type IN ('introduction','reactivation','post_close','check_in','custom')),
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_by   UUID NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- scenario_steps: ordered steps within a scenario
CREATE TABLE IF NOT EXISTS public.scenario_steps (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id                 UUID NOT NULL REFERENCES public.outreach_scenarios(id) ON DELETE CASCADE,
  workspace_id                UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  step_number                 INT NOT NULL,
  day_offset                  INT NOT NULL DEFAULT 0,
  channel                     TEXT NOT NULL DEFAULT 'email'
    CHECK (channel IN ('email','task','note')),
  ai_scenario_type            TEXT,
  subject_override            TEXT,
  body_override               TEXT,
  use_ai                      BOOLEAN NOT NULL DEFAULT true,
  requires_approval           BOOLEAN NOT NULL DEFAULT true,
  auto_send                   BOOLEAN NOT NULL DEFAULT false,
  min_days_since_last_contact INT NOT NULL DEFAULT 7,
  stop_on_reply               BOOLEAN NOT NULL DEFAULT true,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (scenario_id, step_number)
);

CREATE INDEX IF NOT EXISTS scenario_steps_scenario_idx ON public.scenario_steps (scenario_id, step_number);

-- scenario_enrollments: one active enrollment per agent per scenario
CREATE TABLE IF NOT EXISTS public.scenario_enrollments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id      UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  scenario_id   UUID NOT NULL REFERENCES public.outreach_scenarios(id) ON DELETE CASCADE,
  enrolled_by   UUID NOT NULL,
  enrolled_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_step  INT NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','paused','completed','cancelled','stopped_reply')),
  completed_at  TIMESTAMPTZ,
  cancelled_at  TIMESTAMPTZ,
  cancel_reason TEXT
);

-- Only one ACTIVE enrollment per agent per scenario
CREATE UNIQUE INDEX scenario_enrollments_active_idx
  ON public.scenario_enrollments (agent_id, scenario_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS scenario_enrollments_workspace_idx ON public.scenario_enrollments (workspace_id, status);
CREATE INDEX IF NOT EXISTS scenario_enrollments_agent_idx     ON public.scenario_enrollments (agent_id);

-- RLS
ALTER TABLE public.outreach_scenarios   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scenario_steps       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scenario_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members can manage outreach_scenarios"
  ON public.outreach_scenarios FOR ALL
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

CREATE POLICY "workspace members can manage scenario_steps"
  ON public.scenario_steps FOR ALL
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

CREATE POLICY "workspace members can manage scenario_enrollments"
  ON public.scenario_enrollments FOR ALL
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
```

- [ ] **Step 2: Apply in Supabase dashboard**

Go to Supabase → SQL Editor → paste and run the file. Confirm: tables `outreach_scenarios`, `scenario_steps`, `scenario_enrollments` created.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260615000002_outreach_scenarios.sql
git commit -m "feat: add outreach_scenarios, scenario_steps, scenario_enrollments tables"
```

---

### Task 2: DB Migration — scheduled_messages, message_drafts, send_log, opt_outs

**Files:**
- Create: `supabase/migrations/20260615000003_scheduled_messages.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- scheduled_messages: queue of messages the cron engine manages
CREATE TABLE IF NOT EXISTS public.scheduled_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id      UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  enrollment_id UUID REFERENCES public.scenario_enrollments(id) ON DELETE SET NULL,
  step_id       UUID REFERENCES public.scenario_steps(id) ON DELETE SET NULL,
  scheduled_for DATE NOT NULL,
  channel       TEXT NOT NULL DEFAULT 'email',
  status        TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','draft_created','approved','sent','skipped','cancelled','failed')),
  skip_reason   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS scheduled_messages_due_idx
  ON public.scheduled_messages (workspace_id, scheduled_for, status)
  WHERE status IN ('pending','draft_created');

-- message_drafts: generated email content awaiting approval
CREATE TABLE IF NOT EXISTS public.message_drafts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  scheduled_message_id UUID REFERENCES public.scheduled_messages(id) ON DELETE CASCADE,
  agent_id             UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  subject              TEXT NOT NULL,
  body                 TEXT NOT NULL,
  generated_by         TEXT NOT NULL DEFAULT 'ai',
  generation_context   JSONB,
  approved_by          UUID,
  approved_at          TIMESTAMPTZ,
  edited_subject       TEXT,
  edited_body          TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS message_drafts_workspace_idx    ON public.message_drafts (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS message_drafts_scheduled_idx    ON public.message_drafts (scheduled_message_id);

-- send_log: full audit trail of all sends
CREATE TABLE IF NOT EXISTS public.send_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id        UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  draft_id        UUID REFERENCES public.message_drafts(id) ON DELETE SET NULL,
  sent_by         UUID,
  subject         TEXT NOT NULL,
  body            TEXT NOT NULL,
  to_email        TEXT NOT NULL,
  channel         TEXT NOT NULL DEFAULT 'email',
  scenario_id     UUID REFERENCES public.outreach_scenarios(id) ON DELETE SET NULL,
  step_id         UUID REFERENCES public.scenario_steps(id) ON DELETE SET NULL,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  smtp_message_id TEXT,
  error           TEXT
);

CREATE INDEX IF NOT EXISTS send_log_agent_idx     ON public.send_log (agent_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS send_log_workspace_idx ON public.send_log (workspace_id, sent_at DESC);

-- opt_outs: unsubscribe registry
CREATE TABLE IF NOT EXISTS public.opt_outs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  agent_id     UUID REFERENCES public.agents(id) ON DELETE SET NULL,
  reason       TEXT,
  opted_out_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, email)
);

-- RLS
ALTER TABLE public.scheduled_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_drafts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.send_log           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opt_outs           ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members can manage scheduled_messages"
  ON public.scheduled_messages FOR ALL
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

CREATE POLICY "workspace members can manage message_drafts"
  ON public.message_drafts FOR ALL
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

CREATE POLICY "workspace members can view send_log"
  ON public.send_log FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

CREATE POLICY "workspace members can manage opt_outs"
  ON public.opt_outs FOR ALL
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
```

- [ ] **Step 2: Apply in Supabase dashboard**

Go to Supabase → SQL Editor → paste and run. Confirm: `scheduled_messages`, `message_drafts`, `send_log`, `opt_outs` tables created.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260615000003_scheduled_messages.sql
git commit -m "feat: add scheduled_messages, message_drafts, send_log, opt_outs tables"
```

---

### Task 3: Netlify Function — `process-agent-sequences.mjs` (daily cron)

**Files:**
- Create: `netlify/functions/process-agent-sequences.mjs`
- Modify: `netlify.toml`

- [ ] **Step 1: Create `netlify/functions/process-agent-sequences.mjs`**

```js
// Daily cron at 8 AM EST (13:00 UTC). Creates message_drafts for due steps.
// Never auto-sends unless step.auto_send=true (which we don't use by default).
// Safety gauntlet: DNC → opt_out → replied → daily cap → min days → deferred.

import nodemailer from 'nodemailer'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
const NETLIFY_URL  = process.env.URL || 'https://gilded-elf-31457a.netlify.app'
const DAILY_HARD_CAP = 20

function sbHeaders() {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Accept: 'application/json', 'Content-Type': 'application/json' }
}

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: sbHeaders() })
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`)
  return res.json()
}

async function sbPost(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: { ...sbHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`POST ${path} failed: ${res.status} ${text}`)
  }
}

async function sbPatch(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: { ...sbHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`PATCH ${path} failed: ${res.status}`)
}

async function generateDraft(workspaceId, agentId, scenarioType, agentData) {
  const res = await fetch(`${NETLIFY_URL}/.netlify/functions/generate-agent-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspace_id: workspaceId,
      agent_id: agentId,
      scenario_type: scenarioType || 'check_in',
      sender: 'kevin',
      context: {
        agent_name: agentData.name,
        brokerage: agentData.brokerage,
        relationship_status: agentData.relationship_status,
        last_contacted_at: agentData.last_contacted_at,
        market_areas: agentData.market_areas,
      },
    }),
  })
  if (!res.ok) throw new Error(`generate-agent-email failed: ${res.status}`)
  return res.json()
}

export default async () => {
  const today = new Date().toISOString().slice(0, 10)
  let processed = 0
  let errors = []

  try {
    // Load all workspaces that have active enrollments with due messages
    const dueMessages = await sbGet(
      `scheduled_messages?status=eq.pending&scheduled_for=lte.${today}&select=id,workspace_id,agent_id,enrollment_id,step_id,channel&order=scheduled_for.asc&limit=100`
    )

    // Load opt_out emails per workspace (build set for fast lookup)
    const optOutSets = {}

    for (const msg of dueMessages) {
      if (processed >= DAILY_HARD_CAP) break

      try {
        const { id: msgId, workspace_id, agent_id, enrollment_id, step_id, channel } = msg

        // Load opt_outs for this workspace (cache per workspace)
        if (!optOutSets[workspace_id]) {
          const outs = await sbGet(`opt_outs?workspace_id=eq.${workspace_id}&select=email`)
          optOutSets[workspace_id] = new Set(outs.map(o => o.email.toLowerCase()))
        }

        // Load agent
        const agents = await sbGet(`agents?id=eq.${agent_id}&select=*&limit=1`)
        const agent = agents[0]
        if (!agent) {
          await sbPatch(`scheduled_messages?id=eq.${msgId}`, { status: 'skipped', skip_reason: 'agent_not_found', updated_at: new Date().toISOString() })
          continue
        }

        // Safety 1: DNC
        if (agent.relationship_status === 'do_not_contact') {
          await sbPatch(`scheduled_messages?id=eq.${msgId}`, { status: 'skipped', skip_reason: 'do_not_contact', updated_at: new Date().toISOString() })
          continue
        }

        // Safety 2: opt_out
        if (agent.email && optOutSets[workspace_id].has(agent.email.toLowerCase())) {
          await sbPatch(`scheduled_messages?id=eq.${msgId}`, { status: 'skipped', skip_reason: 'opted_out', updated_at: new Date().toISOString() })
          continue
        }

        // Load enrollment + step
        const enrollments = await sbGet(`scenario_enrollments?id=eq.${enrollment_id}&select=*&limit=1`)
        const enrollment = enrollments[0]
        if (!enrollment || enrollment.status !== 'active') {
          await sbPatch(`scheduled_messages?id=eq.${msgId}`, { status: 'cancelled', skip_reason: 'enrollment_not_active', updated_at: new Date().toISOString() })
          continue
        }

        const steps = step_id ? await sbGet(`scenario_steps?id=eq.${step_id}&select=*&limit=1`) : []
        const step = steps[0]

        // Safety 3: replied (if stop_on_reply)
        if (step?.stop_on_reply && agent.last_replied_at) {
          // If agent replied after enrollment, stop
          const repliedAt = new Date(agent.last_replied_at)
          const enrolledAt = new Date(enrollment.enrolled_at)
          if (repliedAt > enrolledAt) {
            await sbPatch(`scheduled_messages?id=eq.${msgId}`, { status: 'skipped', skip_reason: 'agent_replied', updated_at: new Date().toISOString() })
            await sbPatch(`scenario_enrollments?id=eq.${enrollment_id}`, { status: 'stopped_reply', cancelled_at: new Date().toISOString(), cancel_reason: 'agent_replied' })
            continue
          }
        }

        // Safety 4: already contacted today
        const todayLog = await sbGet(`send_log?agent_id=eq.${agent_id}&sent_at=gte.${today}T00:00:00Z&select=id&limit=1`)
        if (todayLog.length > 0) {
          // Defer to tomorrow
          const tomorrow = new Date()
          tomorrow.setDate(tomorrow.getDate() + 1)
          await sbPatch(`scheduled_messages?id=eq.${msgId}`, { scheduled_for: tomorrow.toISOString().slice(0, 10), updated_at: new Date().toISOString() })
          continue
        }

        // Safety 5: min days since last contact
        if (step?.min_days_since_last_contact && agent.last_contacted_at) {
          const lastContact = new Date(agent.last_contacted_at)
          const daysSince = Math.floor((Date.now() - lastContact.getTime()) / 86400000)
          if (daysSince < step.min_days_since_last_contact) {
            const deferUntil = new Date(lastContact)
            deferUntil.setDate(deferUntil.getDate() + step.min_days_since_last_contact)
            await sbPatch(`scheduled_messages?id=eq.${msgId}`, { scheduled_for: deferUntil.toISOString().slice(0, 10), updated_at: new Date().toISOString() })
            continue
          }
        }

        // Generate draft
        const generated = await generateDraft(workspace_id, agent_id, step?.ai_scenario_type, agent)

        const subject = step?.subject_override || generated.subject || 'Checking in'
        const body = step?.body_override || generated.body || ''

        // Insert message_draft
        const draftId = crypto.randomUUID()
        await sbPost('message_drafts', {
          id: draftId,
          workspace_id,
          scheduled_message_id: msgId,
          agent_id,
          subject,
          body,
          generated_by: generated.generated_by || 'ai',
          generation_context: { scenario_type: step?.ai_scenario_type, agent_name: agent.name },
        })

        // Update scheduled_message to draft_created
        await sbPatch(`scheduled_messages?id=eq.${msgId}`, { status: 'draft_created', updated_at: new Date().toISOString() })

        processed++
      } catch (err) {
        errors.push({ msg_id: msg.id, error: err.message })
        console.error('[process-agent-sequences] message error:', msg.id, err.message)
      }
    }

    console.log(`[process-agent-sequences] Done. processed=${processed}, errors=${errors.length}`)
  } catch (err) {
    console.error('[process-agent-sequences] Fatal:', err.message)
  }
}

export const config = { schedule: '0 13 * * *' }
```

- [ ] **Step 2: Add cron schedule to `netlify.toml`**

Add this block before the `[[redirects]]` line in `netlify.toml`:

```toml
[functions."process-agent-sequences"]
  schedule = "0 13 * * *"
```

- [ ] **Step 3: Commit**

```bash
git add netlify/functions/process-agent-sequences.mjs netlify.toml
git commit -m "feat: add process-agent-sequences daily cron (draft-only mode)"
```

---

### Task 4: Netlify Function — `send-approved-draft.mjs`

**Files:**
- Create: `netlify/functions/send-approved-draft.mjs`

- [ ] **Step 1: Create the file**

```js
// POST { workspace_id, user_id, draft_id, subject_override?, body_override? }
// Approve-and-send with atomic idempotency guard. Advances enrollment to next step.

import nodemailer from 'nodemailer'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

const HEADERS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST,OPTIONS',
}

function sbHeaders() {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Accept: 'application/json', 'Content-Type': 'application/json' }
}

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: sbHeaders() })
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`)
  return res.json()
}

async function sbPost(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: { ...sbHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`POST ${path} failed: ${res.status} ${text}`)
  }
}

async function sbPatch(path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: { ...sbHeaders(), Prefer: 'count=exact,return=minimal' },
    body: JSON.stringify(body),
  })
  // Return number of rows updated from Content-Range header
  const range = res.headers.get('Content-Range') || ''
  // "0-0/1" → 1 row; "*/0" → 0 rows
  const match = range.match(/\/(\d+)$/)
  return { ok: res.ok, rowsAffected: match ? parseInt(match[1], 10) : (res.ok ? 1 : 0) }
}

function createTransport(settings) {
  const host   = settings.mail_smtp_host
  const port   = Number(settings.mail_smtp_port) || 587
  const user   = settings.mail_smtp_user
  const pass   = settings.mail_smtp_password
  const secure = settings.mail_smtp_secure === true
  if (!host || !user || !pass) throw new Error('SMTP not configured')
  return nodemailer.createTransport({
    host, port, secure,
    auth: { user, pass },
    ...((!secure) ? { requireTLS: true } : {}),
  })
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS })
  if (req.method !== 'POST') return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), { status: 405, headers: HEADERS })

  try {
    const { workspace_id, user_id, draft_id, subject_override, body_override } = await req.json().catch(() => ({}))
    if (!workspace_id || !user_id || !draft_id) {
      return new Response(JSON.stringify({ ok: false, error: 'workspace_id, user_id, draft_id required' }), { status: 400, headers: HEADERS })
    }

    // Verify workspace member
    const members = await sbGet(`workspace_members?workspace_id=eq.${workspace_id}&user_id=eq.${user_id}&select=id&limit=1`)
    if (!members.length) return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 403, headers: HEADERS })

    // Load draft
    const drafts = await sbGet(`message_drafts?id=eq.${draft_id}&select=*&limit=1`)
    const draft = drafts[0]
    if (!draft) return new Response(JSON.stringify({ ok: false, error: 'Draft not found' }), { status: 404, headers: HEADERS })

    // Atomic idempotency: set status=approved only if currently draft_created
    const { rowsAffected } = await sbPatch(`scheduled_messages?id=eq.${draft.scheduled_message_id}&status=eq.draft_created`, {
      status: 'approved',
      updated_at: new Date().toISOString(),
    })
    if (rowsAffected === 0) {
      return new Response(JSON.stringify({ ok: false, error: 'Already approved or not in draft state' }), { status: 409, headers: HEADERS })
    }

    // Load agent
    const agents = await sbGet(`agents?id=eq.${draft.agent_id}&select=*&limit=1`)
    const agent = agents[0]
    if (!agent || !agent.email) {
      await sbPatch(`scheduled_messages?id=eq.${draft.scheduled_message_id}`, { status: 'failed', skip_reason: 'no_agent_email', updated_at: new Date().toISOString() })
      return new Response(JSON.stringify({ ok: false, error: 'Agent has no email' }), { status: 422, headers: HEADERS })
    }

    // Re-check DNC at send time
    if (agent.relationship_status === 'do_not_contact') {
      await sbPatch(`scheduled_messages?id=eq.${draft.scheduled_message_id}`, { status: 'skipped', skip_reason: 'do_not_contact', updated_at: new Date().toISOString() })
      return new Response(JSON.stringify({ ok: false, error: 'Agent is do_not_contact' }), { status: 422, headers: HEADERS })
    }

    // Re-check opt_out
    const optOuts = await sbGet(`opt_outs?workspace_id=eq.${workspace_id}&email=eq.${encodeURIComponent(agent.email)}&select=id&limit=1`)
    if (optOuts.length > 0) {
      await sbPatch(`scheduled_messages?id=eq.${draft.scheduled_message_id}`, { status: 'skipped', skip_reason: 'opted_out', updated_at: new Date().toISOString() })
      return new Response(JSON.stringify({ ok: false, error: 'Agent has opted out' }), { status: 422, headers: HEADERS })
    }

    // Load workspace settings for SMTP
    const workspaces = await sbGet(`workspaces?id=eq.${workspace_id}&select=settings&limit=1`)
    const settings = workspaces[0]?.settings || {}

    const finalSubject = subject_override || draft.edited_subject || draft.subject
    const finalBody    = body_override    || draft.edited_body    || draft.body

    // Send
    const transport = createTransport(settings)
    const fromName  = settings.mail_from_name?.trim()
    const fromEmail = settings.mail_from_email?.trim() || settings.mail_smtp_user
    const from      = fromName ? `"${fromName}" <${fromEmail}>` : fromEmail
    const info      = await transport.sendMail({ from, to: agent.email, subject: finalSubject, text: finalBody })

    const now = new Date().toISOString()

    // Load scheduled_message to get enrollment/step
    const msgs = await sbGet(`scheduled_messages?id=eq.${draft.scheduled_message_id}&select=*&limit=1`)
    const msg = msgs[0]

    // Insert send_log
    await sbPost('send_log', {
      workspace_id,
      agent_id: draft.agent_id,
      draft_id,
      sent_by: user_id,
      subject: finalSubject,
      body: finalBody,
      to_email: agent.email,
      channel: 'email',
      scenario_id: msg?.enrollment_id ? (await sbGet(`scenario_enrollments?id=eq.${msg.enrollment_id}&select=scenario_id&limit=1`))[0]?.scenario_id : null,
      step_id: msg?.step_id,
      smtp_message_id: info?.messageId,
    })

    // Update draft (approved_by, approved_at, edited fields)
    await sbPatch(`message_drafts?id=eq.${draft_id}`, {
      approved_by: user_id,
      approved_at: now,
      ...(subject_override ? { edited_subject: subject_override } : {}),
      ...(body_override    ? { edited_body: body_override }       : {}),
    })

    // Update agent last_contacted_at
    await sbPatch(`agents?id=eq.${draft.agent_id}`, { last_contacted_at: now })

    // Mark scheduled_message sent
    await sbPatch(`scheduled_messages?id=eq.${draft.scheduled_message_id}`, { status: 'sent', updated_at: now })

    // Advance enrollment to next step
    if (msg?.enrollment_id && msg?.step_id) {
      const enrollment = (await sbGet(`scenario_enrollments?id=eq.${msg.enrollment_id}&select=*&limit=1`))[0]
      const currentStep = (await sbGet(`scenario_steps?id=eq.${msg.step_id}&select=*&limit=1`))[0]

      if (enrollment && currentStep) {
        const nextSteps = await sbGet(
          `scenario_steps?scenario_id=eq.${currentStep.scenario_id}&step_number=gt.${currentStep.step_number}&order=step_number.asc&limit=1`
        )
        const nextStep = nextSteps[0]

        if (nextStep) {
          // Schedule next step based on actual send date
          const nextDate = new Date()
          nextDate.setDate(nextDate.getDate() + nextStep.day_offset)
          await sbPost('scheduled_messages', {
            workspace_id,
            agent_id: draft.agent_id,
            enrollment_id: msg.enrollment_id,
            step_id: nextStep.id,
            scheduled_for: nextDate.toISOString().slice(0, 10),
            channel: nextStep.channel,
            status: 'pending',
          })
          await sbPatch(`scenario_enrollments?id=eq.${msg.enrollment_id}`, { current_step: nextStep.step_number })
        } else {
          // No more steps — complete enrollment
          await sbPatch(`scenario_enrollments?id=eq.${msg.enrollment_id}`, { status: 'completed', completed_at: now })
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, sent_to: agent.email }), { status: 200, headers: HEADERS })
  } catch (err) {
    console.error('[send-approved-draft]', err.message)
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: HEADERS })
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add netlify/functions/send-approved-draft.mjs
git commit -m "feat: add send-approved-draft netlify function with idempotency guard"
```

---

### Task 5: ScenariosPage — scenario list + step builder

**Files:**
- Create: `src/pages/ScenariosPage.jsx`

- [ ] **Step 1: Create the file**

```jsx
import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'

const SCENARIO_TYPES = [
  { value: 'introduction', label: 'Introduction' },
  { value: 'reactivation', label: 'Reactivation' },
  { value: 'post_close',   label: 'Post-Close' },
  { value: 'check_in',     label: 'Check-In' },
  { value: 'custom',       label: 'Custom' },
]

const AI_SCENARIO_TYPES = [
  { value: 'intro',       label: 'Intro' },
  { value: 'check_in',    label: 'Check-In' },
  { value: 'reactivation',label: 'Reactivation' },
  { value: 'post_close',  label: 'Post-Close' },
  { value: 'passed_deal', label: 'Passed Deal' },
]

const inputCls = 'w-full text-[13px] px-2 h-8 bg-[color:var(--color-bg)] border border-[color:var(--color-line)] rounded text-[color:var(--color-text)] focus:outline-none focus:border-[color:var(--color-accent)] disabled:opacity-50'

function emptyStep(n) {
  return { step_number: n, day_offset: n === 1 ? 0 : 7, channel: 'email', ai_scenario_type: 'check_in', use_ai: true, requires_approval: true, auto_send: false, min_days_since_last_contact: 7, stop_on_reply: true, subject_override: '', body_override: '' }
}

export default function ScenariosPage() {
  const { workspaceId, userId } = useOutletContext()
  const [scenarios, setScenarios] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null) // null = new, object = edit
  const [form, setForm] = useState({ name: '', description: '', type: 'introduction' })
  const [steps, setSteps] = useState([emptyStep(1)])
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState(null)
  const [scenarioSteps, setScenarioSteps] = useState({})

  const load = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('outreach_scenarios')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
    setScenarios(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [workspaceId])

  const loadSteps = async (scenarioId) => {
    const { data } = await supabase
      .from('scenario_steps')
      .select('*')
      .eq('scenario_id', scenarioId)
      .order('step_number')
    setScenarioSteps(prev => ({ ...prev, [scenarioId]: data || [] }))
  }

  const openNew = () => {
    setEditing(null)
    setForm({ name: '', description: '', type: 'introduction' })
    setSteps([emptyStep(1)])
    setModalOpen(true)
  }

  const openEdit = async (scenario) => {
    setEditing(scenario)
    setForm({ name: scenario.name, description: scenario.description || '', type: scenario.type })
    const { data } = await supabase.from('scenario_steps').select('*').eq('scenario_id', scenario.id).order('step_number')
    setSteps(data?.length ? data.map(s => ({ ...s, subject_override: s.subject_override || '', body_override: s.body_override || '' })) : [emptyStep(1)])
    setModalOpen(true)
  }

  const save = async () => {
    if (!form.name.trim()) return
    setSaving(true)
    try {
      let scenarioId = editing?.id
      if (!scenarioId) {
        const { data } = await supabase.from('outreach_scenarios').insert({ workspace_id: workspaceId, created_by: userId, ...form }).select('id').single()
        scenarioId = data.id
      } else {
        await supabase.from('outreach_scenarios').update({ ...form, updated_at: new Date().toISOString() }).eq('id', scenarioId)
        await supabase.from('scenario_steps').delete().eq('scenario_id', scenarioId)
      }
      for (const step of steps) {
        await supabase.from('scenario_steps').insert({
          scenario_id: scenarioId,
          workspace_id: workspaceId,
          step_number: step.step_number,
          day_offset: Number(step.day_offset) || 0,
          channel: step.channel,
          ai_scenario_type: step.ai_scenario_type || null,
          subject_override: step.subject_override || null,
          body_override: step.body_override || null,
          use_ai: step.use_ai,
          requires_approval: step.requires_approval,
          auto_send: false, // always false in UI
          min_days_since_last_contact: Number(step.min_days_since_last_contact) || 7,
          stop_on_reply: step.stop_on_reply,
        })
      }
      setModalOpen(false)
      load()
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (scenario) => {
    await supabase.from('outreach_scenarios').update({ is_active: !scenario.is_active }).eq('id', scenario.id)
    setScenarios(prev => prev.map(s => s.id === scenario.id ? { ...s, is_active: !s.is_active } : s))
  }

  const toggleExpand = async (id) => {
    if (expandedId === id) { setExpandedId(null); return }
    setExpandedId(id)
    if (!scenarioSteps[id]) await loadSteps(id)
  }

  const addStep = () => setSteps(prev => [...prev, emptyStep(prev.length + 1)])
  const removeStep = (i) => setSteps(prev => prev.filter((_, idx) => idx !== i).map((s, idx) => ({ ...s, step_number: idx + 1 })))
  const patchStep = (i, changes) => setSteps(prev => prev.map((s, idx) => idx === i ? { ...s, ...changes } : s))

  const labelCls = 'text-[10.5px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)]'

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[17px] font-semibold text-[color:var(--color-text)]">Outreach Scenarios</h1>
          <p className="text-[12.5px] text-[color:var(--color-text-dim)] mt-0.5">Define multi-step email sequences. Enroll agents from their profile.</p>
        </div>
        <Button size="sm" onClick={openNew}>+ New Scenario</Button>
      </div>

      {loading ? (
        <div className="text-[13px] text-[color:var(--color-text-dim)] py-8 text-center">Loading…</div>
      ) : scenarios.length === 0 ? (
        <div className="border border-dashed border-[color:var(--color-line)] rounded-lg p-10 text-center text-[13px] text-[color:var(--color-text-dim)]">
          No scenarios yet. Create one to start automating agent outreach.
        </div>
      ) : (
        <div className="space-y-2">
          {scenarios.map(s => (
            <div key={s.id} className="border border-[color:var(--color-line)] rounded-lg bg-[color:var(--color-bg-elev)]">
              <div className="flex items-center gap-3 px-4 py-3">
                <button onClick={() => toggleExpand(s.id)} className="flex-1 text-left">
                  <span className="text-[13.5px] font-medium text-[color:var(--color-text)]">{s.name}</span>
                  <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-muted)]">
                    {SCENARIO_TYPES.find(t => t.value === s.type)?.label || s.type}
                  </span>
                </button>
                <button
                  onClick={() => toggleActive(s)}
                  className={`text-[11px] px-2 py-1 rounded font-medium transition-colors ${s.is_active ? 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)]' : 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-dim)]'}`}
                >
                  {s.is_active ? 'Active' : 'Paused'}
                </button>
                <Button variant="ghost" size="sm" onClick={() => openEdit(s)}>Edit</Button>
              </div>
              {expandedId === s.id && (
                <div className="px-4 pb-3 border-t border-[color:var(--color-line)] pt-3 space-y-1.5">
                  {(scenarioSteps[s.id] || []).map(step => (
                    <div key={step.id} className="flex items-center gap-3 text-[12.5px] text-[color:var(--color-text-muted)]">
                      <span className="w-6 h-6 rounded-full bg-[color:var(--color-bg-elev-2)] flex items-center justify-center text-[11px] font-semibold text-[color:var(--color-text-dim)] shrink-0">{step.step_number}</span>
                      <span>Day +{step.day_offset}</span>
                      <span className="capitalize">{step.channel}</span>
                      {step.ai_scenario_type && <span className="text-[color:var(--color-accent-text)]">AI: {step.ai_scenario_type}</span>}
                      {step.requires_approval && <span className="text-[color:var(--color-warn-text)]">Requires approval</span>}
                    </div>
                  ))}
                  {(scenarioSteps[s.id] || []).length === 0 && <div className="text-[12px] text-[color:var(--color-text-dim)]">No steps</div>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit: ${editing.name}` : 'New Scenario'}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={save} loading={saving} disabled={!form.name.trim()}>Save Scenario</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className={labelCls}>Name</label>
            <input className={inputCls + ' mt-1'} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. New Realtor Intro" />
          </div>
          <div>
            <label className={labelCls}>Type</label>
            <select className={inputCls + ' mt-1'} value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
              {SCENARIO_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Description (optional)</label>
            <input className={inputCls + ' mt-1'} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="What this scenario is for" />
          </div>

          <div className="border-t border-[color:var(--color-line)] pt-4">
            <div className="flex items-center justify-between mb-3">
              <span className={labelCls}>Steps ({steps.length})</span>
              <Button variant="ghost" size="sm" onClick={addStep}>+ Add Step</Button>
            </div>
            <div className="space-y-4">
              {steps.map((step, i) => (
                <div key={i} className="border border-[color:var(--color-line)] rounded-lg p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[12.5px] font-semibold text-[color:var(--color-text)]">Step {step.step_number}</span>
                    {steps.length > 1 && <Button variant="ghost" size="sm" onClick={() => removeStep(i)}>Remove</Button>}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className={labelCls}>Day Offset</label>
                      <input type="number" min="0" className={inputCls + ' mt-1'} value={step.day_offset} onChange={e => patchStep(i, { day_offset: e.target.value })} />
                    </div>
                    <div>
                      <label className={labelCls}>Channel</label>
                      <select className={inputCls + ' mt-1'} value={step.channel} onChange={e => patchStep(i, { channel: e.target.value })}>
                        <option value="email">Email</option>
                        <option value="task">Task</option>
                        <option value="note">Note</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>AI Type</label>
                      <select className={inputCls + ' mt-1'} value={step.ai_scenario_type || ''} onChange={e => patchStep(i, { ai_scenario_type: e.target.value || null })}>
                        <option value="">— None —</option>
                        {AI_SCENARIO_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className={labelCls}>Min Days Since Last Contact</label>
                      <input type="number" min="0" className={inputCls + ' mt-1'} value={step.min_days_since_last_contact} onChange={e => patchStep(i, { min_days_since_last_contact: e.target.value })} />
                    </div>
                    <div className="flex items-end gap-3 pb-1">
                      <label className="flex items-center gap-1.5 text-[12.5px] text-[color:var(--color-text-muted)] cursor-pointer">
                        <input type="checkbox" checked={step.requires_approval} onChange={e => patchStep(i, { requires_approval: e.target.checked })} />
                        Requires approval
                      </label>
                      <label className="flex items-center gap-1.5 text-[12.5px] text-[color:var(--color-text-muted)] cursor-pointer">
                        <input type="checkbox" checked={step.stop_on_reply} onChange={e => patchStep(i, { stop_on_reply: e.target.checked })} />
                        Stop on reply
                      </label>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/ScenariosPage.jsx
git commit -m "feat: add ScenariosPage with scenario list and step builder"
```

---

### Task 6: DraftsInboxPage — split-pane draft review

**Files:**
- Create: `src/pages/DraftsInboxPage.jsx`

- [ ] **Step 1: Create the file**

```jsx
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
    // Load drafts with their message + agent info
    const { data } = await supabase
      .from('message_drafts')
      .select(`
        *,
        agent:agents(id, name, email, brokerage, relationship_status),
        scheduled_message:scheduled_messages(id, scheduled_for, status, step_id)
      `)
      .eq('workspace_id', workspaceId)
      .is('approved_at', null)
      // Only show drafts whose scheduled_message is still in draft_created state
      .order('created_at', { ascending: true })
    // Filter to only draft_created ones
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
      // Save regenerated draft to DB
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

  const labelCls = 'text-[10.5px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)]'
  const inputCls = 'w-full text-[13px] px-2 h-8 bg-[color:var(--color-bg)] border border-[color:var(--color-line)] rounded text-[color:var(--color-text)] focus:outline-none focus:border-[color:var(--color-accent)]'

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
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/DraftsInboxPage.jsx
git commit -m "feat: add DraftsInboxPage with split-pane draft review, approve/regenerate/skip"
```

---

### Task 7: AgentScenarioPanel — enrollment display + actions

**Files:**
- Create: `src/components/agents/AgentScenarioPanel.jsx`

- [ ] **Step 1: Create the file**

```jsx
import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import SearchableSelect from '../ui/SearchableSelect'

export default function AgentScenarioPanel({ agent, workspaceId, userId, canEdit }) {
  const [enrollments, setEnrollments] = useState([])
  const [scenarios, setScenarios] = useState([])
  const [loading, setLoading] = useState(true)
  const [enrollOpen, setEnrollOpen] = useState(false)
  const [selectedScenario, setSelectedScenario] = useState('')
  const [enrolling, setEnrolling] = useState(false)

  const load = async () => {
    setLoading(true)
    const [{ data: enr }, { data: scen }] = await Promise.all([
      supabase
        .from('scenario_enrollments')
        .select('*, scenario:outreach_scenarios(name, type)')
        .eq('agent_id', agent.id)
        .order('enrolled_at', { ascending: false })
        .limit(5),
      supabase
        .from('outreach_scenarios')
        .select('id, name, type')
        .eq('workspace_id', workspaceId)
        .eq('is_active', true)
        .order('name'),
    ])
    setEnrollments(enr || [])
    setScenarios(scen || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [agent.id])

  const handleEnroll = async () => {
    if (!selectedScenario) return
    setEnrolling(true)
    // Get step 1 of the scenario
    const { data: steps } = await supabase
      .from('scenario_steps')
      .select('*')
      .eq('scenario_id', selectedScenario)
      .order('step_number')
      .limit(1)
    const step1 = steps?.[0]

    // Insert enrollment
    const { data: enrollment } = await supabase
      .from('scenario_enrollments')
      .insert({ workspace_id: workspaceId, agent_id: agent.id, scenario_id: selectedScenario, enrolled_by: userId })
      .select('id')
      .single()

    // Schedule first message
    if (enrollment && step1) {
      const scheduledFor = new Date()
      scheduledFor.setDate(scheduledFor.getDate() + (step1.day_offset || 0))
      await supabase.from('scheduled_messages').insert({
        workspace_id: workspaceId,
        agent_id: agent.id,
        enrollment_id: enrollment.id,
        step_id: step1.id,
        scheduled_for: scheduledFor.toISOString().slice(0, 10),
        channel: step1.channel || 'email',
        status: 'pending',
      })
    }

    setEnrollOpen(false)
    setSelectedScenario('')
    setEnrolling(false)
    load()
  }

  const handleCancel = async (enrollmentId) => {
    await supabase
      .from('scenario_enrollments')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_reason: 'manually_cancelled' })
      .eq('id', enrollmentId)
    load()
  }

  const STATUS_COLORS = {
    active:        'text-[color:var(--color-success-text)] bg-[color:var(--color-success-soft)]',
    paused:        'text-[color:var(--color-warn-text)] bg-[color:var(--color-warn-soft)]',
    completed:     'text-[color:var(--color-text-dim)] bg-[color:var(--color-bg-elev-2)]',
    cancelled:     'text-[color:var(--color-danger-text)] bg-[color:var(--color-danger-soft)]',
    stopped_reply: 'text-[color:var(--color-text-muted)] bg-[color:var(--color-bg-elev-2)]',
  }

  const active = enrollments.filter(e => e.status === 'active')
  const past   = enrollments.filter(e => e.status !== 'active')

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10.5px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)]">Scenario Enrollments</span>
        {canEdit && scenarios.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setEnrollOpen(true)}>+ Enroll</Button>
        )}
      </div>

      {loading ? (
        <div className="text-[12px] text-[color:var(--color-text-dim)]">Loading…</div>
      ) : enrollments.length === 0 ? (
        <div className="text-[12.5px] text-[color:var(--color-text-dim)]">Not enrolled in any scenarios.</div>
      ) : (
        <div className="space-y-1.5">
          {[...active, ...past].map(e => (
            <div key={e.id} className="flex items-center gap-2 text-[12.5px]">
              <span className={`px-1.5 py-0.5 rounded text-[10.5px] font-medium ${STATUS_COLORS[e.status] || ''}`}>{e.status}</span>
              <span className="text-[color:var(--color-text)]">{e.scenario?.name || '—'}</span>
              <span className="text-[color:var(--color-text-dim)]">step {e.current_step}</span>
              {e.status === 'active' && canEdit && (
                <button onClick={() => handleCancel(e.id)} className="ml-auto text-[11px] text-[color:var(--color-text-dim)] hover:text-[color:var(--color-danger-text)] transition-colors">Cancel</button>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal
        open={enrollOpen}
        onClose={() => setEnrollOpen(false)}
        title="Enroll in Scenario"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEnrollOpen(false)}>Cancel</Button>
            <Button onClick={handleEnroll} loading={enrolling} disabled={!selectedScenario}>Enroll</Button>
          </>
        }
      >
        <SearchableSelect
          value={selectedScenario}
          onChange={setSelectedScenario}
          options={scenarios.map(s => ({ value: s.id, label: s.name }))}
          placeholder="Select a scenario…"
        />
      </Modal>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/agents/AgentScenarioPanel.jsx
git commit -m "feat: add AgentScenarioPanel with enrollment display and enroll/cancel actions"
```

---

### Task 8: Wire AgentScenarioPanel into AgentDetailDrawer

**Files:**
- Modify: `src/components/agents/AgentDetailDrawer.jsx`

- [ ] **Step 1: Read the current file to find where AgentDealsSection ends**

Read `src/components/agents/AgentDetailDrawer.jsx` and find the import block and where `<AgentDealsSection>` is rendered.

- [ ] **Step 2: Add the import**

After the existing `AgentDealsSection` import line, add:

```js
import AgentScenarioPanel from './AgentScenarioPanel'
```

- [ ] **Step 3: Add the panel in the JSX after `<AgentDealsSection>`**

Find the `<AgentDealsSection ... />` render call and add immediately after it:

```jsx
<div className="pt-3 border-t border-[color:var(--color-line)]">
  <AgentScenarioPanel
    agent={agent}
    workspaceId={workspaceId}
    userId={userId}
    canEdit={canEdit}
  />
</div>
```

Note: `AgentDetailDrawer` must already receive `userId` as a prop — check the existing prop list. If it does not, add it and pass it from `AgentsPage`.

- [ ] **Step 4: Commit**

```bash
git add src/components/agents/AgentDetailDrawer.jsx
git commit -m "feat: add AgentScenarioPanel to AgentDetailDrawer"
```

---

### Task 9: Add routes to App.jsx and pages to Sidebar

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/components/Sidebar.jsx`

- [ ] **Step 1: Add imports to `App.jsx`**

After the `AgentsPage` import line, add:

```js
import ScenariosPage from './pages/ScenariosPage'
import DraftsInboxPage from './pages/DraftsInboxPage'
```

- [ ] **Step 2: Add routes to `App.jsx`**

Find the `<Route path="agents" element={<AgentsPage />} />` line and replace with:

```jsx
<Route path="agents" element={<AgentsPage />} />
<Route path="agents/scenarios" element={<ScenariosPage />} />
<Route path="agents/drafts" element={<DraftsInboxPage />} />
```

- [ ] **Step 3: Add drafts pending badge to Sidebar**

In `src/components/Sidebar.jsx`, add a new `useEffect` to load `draftsPendingCount` after the existing `myOpenTaskCount` useEffect:

```js
const [draftsPendingCount, setDraftsPendingCount] = useState(0)
```

Add state declaration near the top with the other `useState` calls.

Then add a new `useEffect` after the `myOpenTaskCount` one:

```js
useEffect(() => {
  if (!workspaceId) return
  let cancel = false
  supabase
    .from('scheduled_messages')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('status', 'draft_created')
    .then(({ count }) => {
      if (!cancel) setDraftsPendingCount(count || 0)
    })
  return () => { cancel = true }
}, [workspaceId])
```

Then find the Agents nav item:

```jsx
<NavLink to={`${base}/agents`} className={navItemClasses}>
  <span className="text-[color:var(--color-text-dim)]">{ICONS.agents}</span>
  <span className="flex-1">Agents</span>
</NavLink>
```

Replace with:

```jsx
<NavLink to={`${base}/agents`} className={navItemClasses}>
  <span className="text-[color:var(--color-text-dim)]">{ICONS.agents}</span>
  <span className="flex-1">Agents</span>
  {draftsPendingCount > 0 && (
    <span
      title={`${draftsPendingCount} draft${draftsPendingCount === 1 ? '' : 's'} pending review`}
      className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold bg-[color:var(--color-accent)] text-white tabular-nums"
    >
      {draftsPendingCount}
    </span>
  )}
</NavLink>
```

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx src/components/Sidebar.jsx
git commit -m "feat: add agents/scenarios and agents/drafts routes; sidebar drafts pending badge"
```

---

### Task 10: Deploy and smoke test

- [ ] **Step 1: Push to trigger Netlify deploy**

```bash
git push origin main
```

Wait for Netlify build to complete.

- [ ] **Step 2: Verify migrations applied**

In Supabase dashboard, confirm these tables exist:
- `outreach_scenarios`
- `scenario_steps`
- `scenario_enrollments`
- `scheduled_messages`
- `message_drafts`
- `send_log`
- `opt_outs`

- [ ] **Step 3: Create a test scenario**

Go to `/agents/scenarios` → click "+ New Scenario" → create "Test Intro" with type Introduction and 2 steps (day 0 check_in email, day 5 check_in email).

- [ ] **Step 4: Enroll an agent**

Open any agent in AgentDetailDrawer → scroll to Scenario Enrollments → click "+ Enroll" → pick "Test Intro". Confirm `scenario_enrollments` row created and `scheduled_messages` row with `scheduled_for = today` and `status = pending`.

- [ ] **Step 5: Manually trigger the cron**

Call the function directly in the Netlify dashboard (Functions tab → `process-agent-sequences` → Test function). Confirm a `message_drafts` row is created and `scheduled_messages.status = 'draft_created'`.

- [ ] **Step 6: Review and approve the draft**

Go to `/agents/drafts`. Confirm the draft appears. Click "Approve & Send". Confirm:
- Email sent to agent
- `send_log` row inserted
- `agent.last_contacted_at` updated
- Next `scheduled_messages` row created for step 2
- Draft disappears from list

- [ ] **Step 7: Double-click guard test**

Click "Approve & Send" a second time immediately. Confirm 409 response and no duplicate email.

---

## Self-Review: Spec Coverage

- [x] DB tables: outreach_scenarios, scenario_steps, scenario_enrollments (Task 1)
- [x] DB tables: scheduled_messages, message_drafts, send_log, opt_outs (Task 2)
- [x] Daily cron: process-agent-sequences.mjs with safety gauntlet (Task 3)
- [x] Approve-and-send with idempotency: send-approved-draft.mjs (Task 4)
- [x] Scenario builder UI: ScenariosPage (Task 5)
- [x] Drafts Inbox UI: DraftsInboxPage with approve/regenerate/skip (Task 6)
- [x] Enrollment panel in agent drawer: AgentScenarioPanel (Task 7)
- [x] Wire panel into AgentDetailDrawer (Task 8)
- [x] Routes + sidebar badge (Task 9)
- [x] Step timing from actual send date (handled in send-approved-draft: `today + nextStep.day_offset`)
- [x] Manual reply flag: "Mark as replied" button in DraftsInboxPage sets `agents.last_replied_at` and skips
- [x] Safety gauntlet: DNC, opt_out, replied, daily-cap-deferred, min-days-deferred
- [x] DAILY_HARD_CAP = 20
- [x] Draft-only mode: `auto_send` always false in UI; function checks it but never true
