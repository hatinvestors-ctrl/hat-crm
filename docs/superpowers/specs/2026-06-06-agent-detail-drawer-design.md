# Agent Detail Drawer — Design Spec
**Date:** 2026-06-06

## Overview

When a user clicks an agent row in the Agents page, a wide right-side drawer slides in (~70% screen width). The drawer shows the agent's full details, notes, communication history, and a comments feed — without navigating away from the agents table.

---

## Layout

**Wide Drawer** using the existing `Drawer` component with `width` set to ~70% of viewport (min 600px, max 900px).

### Header (full width)
- Agent name (large) + last-contacted badge (green/amber/red based on recency)
- Brokerage name + "N leads ↗" link (opens agents table pre-filtered by this agent's email)
- Action buttons: **Send Email**, **Edit**, **Close (✕)**

### Body (2-column grid, 50/50)

**Left column — scrollable**
1. **Contact Info card** — email, phone, brokerage (read-only display)
2. **Notes card** — free-text notes with inline Edit/Save (same pattern as `NotesSection` on leads). Saves to `agents.notes`.

**Right column — flex column, fixed height**
1. **Section header** — "History & Comments" label + **`+ Log interaction`** button
2. **Inline log form** (hidden by default, expands when `+ Log interaction` is clicked):
   - Type picker: Call / Meeting / Text / Other (pill buttons, single select)
   - Short note textarea
   - Optional date picker (collapsed by default, revealed by "📅 Add date" toggle — defaults to today)
   - Cancel / Save buttons
3. **Scrollable feed** (flex: 1, overflow-y: auto):
   - Communication history entries (newest first), color-coded by type:
     - 📧 Email sent — blue left border (auto-logged by send-agent-emails function)
     - 📞 Call — green left border
     - 🤝 Meeting — amber left border
     - 💬 Text — purple left border
     - • Other — grey left border
   - Horizontal "Comments" divider
   - Comment entries (author name + timestamp + text)
4. **Pinned comment input** (flex-shrink: 0, always visible at bottom):
   - Textarea + Post button
   - Posts to `agent_comments` table

---

## Data Model

### New table: `agent_activities`
Stores all communication history entries — both auto-logged (email sends) and manually logged interactions.

```sql
CREATE TABLE public.agent_activities (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id     UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL,
  type         TEXT NOT NULL,         -- 'email_sent' | 'call' | 'meeting' | 'text' | 'other'
  note         TEXT,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

RLS: workspace members can read/write their own workspace's rows.

### New table: `agent_comments`
Stores free-text comments posted by team members on an agent record.

```sql
CREATE TABLE public.agent_comments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id     UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL,
  body         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

RLS: workspace members can read/write their own workspace's rows.

### Modified: `agent_outreach` → auto-log to `agent_activities`
When `send-agent-emails` Netlify function successfully sends an email, it inserts a row into `agent_activities` with `type = 'email_sent'` and `note = subject`. This replaces the need for a separate audit trail.

### `agents.notes` (existing column)
Already exists in the schema. No migration needed for notes.

---

## New Components

| Component | Location | Purpose |
|---|---|---|
| `AgentDetailDrawer` | `src/components/agents/AgentDetailDrawer.jsx` | Root drawer — fetches agent, owns state |
| `AgentNotesSection` | `src/components/agents/AgentNotesSection.jsx` | Inline-edit notes (mirrors `NotesSection`) |
| `AgentActivityFeed` | `src/components/agents/AgentActivityFeed.jsx` | Scrollable history + comments feed |
| `AgentLogForm` | `src/components/agents/AgentLogForm.jsx` | Inline expand form for manual interaction logging |

---

## Modified Files

| File | Change |
|---|---|
| `src/pages/AgentsPage.jsx` | Add `selectedAgentId` state; pass to `AgentDetailDrawer`; wire row click in table |
| `src/components/agents/AgentTable.jsx` | Make rows clickable (call `onRowClick(agent.id)`); keep checkbox click separate (stopPropagation) |
| `netlify/functions/send-agent-emails.mjs` | After sending, insert row into `agent_activities` with `type='email_sent'` |

---

## Migration

One new migration file: `supabase/migrations/20260606000003_agent_activities_comments.sql`
- Creates `agent_activities` table with RLS
- Creates `agent_comments` table with RLS

---

## Behaviour Details

- **Opening the drawer:** clicking any row (outside the checkbox) opens the drawer for that agent. Checkbox clicks select the row for bulk email — they do not open the drawer.
- **`+ Log interaction` form:** expands inline below the section header. Submitting inserts to `agent_activities` and refreshes the feed. Cancelling collapses without saving.
- **Date field:** hidden by default. Clicking "📅 Add date" reveals a date input pre-filled with today. When provided, `occurred_at` is set to the chosen date (midnight local time). When omitted, defaults to `NOW()`.
- **Feed order:** newest `occurred_at` first for both history entries and comments, interleaved in a single chronological list separated by the "Comments" divider (history above, comments below).
- **Email auto-log:** `send-agent-emails` function inserts into `agent_activities` after a successful send. Subject line becomes the note. If insert fails, the email send is not rolled back — log failure is non-blocking.
- **Edit agent:** the Edit button opens the existing `AddAgentModal` in edit mode (reuse pattern).
- **Notes save:** patches `agents.notes` via Supabase client. Optimistic update.

---

## Out of Scope
- Deleting individual activity entries or comments
- Attachments on agent records
- @mentions in comments
- Email reply tracking
