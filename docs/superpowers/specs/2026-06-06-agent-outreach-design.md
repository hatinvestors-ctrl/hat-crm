# Agent Outreach System — Design Spec

**Date:** 2026-06-06  
**Status:** Approved  
**Scope:** Build a dedicated agent contact management and bulk email outreach system on top of HatCRM's existing leads and email infrastructure.

---

## Problem

HAT Investors accumulates listing agent contacts through their lead pipeline (via RentCast enrichment). Currently there is no way to manage these agents as contacts, track outreach history, or send bulk emails to agents asking about available properties. All outreach is manual and one-off.

---

## Solution Overview

A dedicated **Agents** section in the CRM with:
1. An `agents` table that deduplicates agents across all leads
2. Auto-population from existing lead data
3. An Agents page with filtering, bulk select, and email send
4. Two built-in email templates (intro + follow-up)
5. Outreach history tracking per agent

---

## Data Model

### `agents` table

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `workspace_id` | UUID | Foreign key to workspaces |
| `name` | text | Agent full name |
| `email` | text | Unique per workspace — dedup key |
| `phone` | text | Optional |
| `brokerage` | text | Optional |
| `notes` | text | Manual notes |
| `last_contacted_at` | timestamptz | Updated on every email send |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

**Unique constraint:** `(workspace_id, LOWER(email))` — prevents duplicate agents per workspace.

### `agent_outreach` table

Tracks every email sent to an agent.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `workspace_id` | UUID | |
| `agent_id` | UUID | Foreign key to agents |
| `user_id` | UUID | Who sent it |
| `template` | text | `'introduction'` or `'follow_up'` |
| `subject` | text | Final subject line sent |
| `sent_at` | timestamptz | |

### `agents` ↔ `leads` relationship

No join table. The link is implicit: a lead's `listing_agent_email` matches an agent's `email` within the same workspace. The Agents page computes `lead_count` by counting matching leads.

---

## Agent Population

Agents are populated two ways:

1. **Auto-extract from leads:** When a lead has `listing_agent_email` filled in, upsert into `agents` by `(workspace_id, LOWER(email))`. Run this:
   - On-demand via a "Sync agents from leads" button on the Agents page
   - Automatically when a lead is enriched via RentCast lookup

2. **Manual add:** An "Add Agent" button on the Agents page lets users enter an agent manually.

---

## Agents Page UI

**Location:** New sidebar nav item "Agents" under Leads.

**List view columns:**
- Name + Brokerage (subtext)
- Email
- # Leads (count of leads with this agent)
- Last Contacted (date or "Never")
- Status badge: `Never contacted` / `Contacted` / `Due for follow-up` (>30 days since last contact)

**Filter bar:**
- "Not contacted in 30 days" toggle
- "Never contacted" toggle
- Brokerage text filter

**Actions:**
- Checkbox per row → bulk select
- "Send Email" button (enabled when ≥1 selected)
- "Add Agent" button
- "Sync from leads" button

---

## Email Send Flow

When user clicks **Send Email** with agents selected:

1. Modal opens with:
   - Template picker: **Introduction** or **Follow-Up**
   - Live preview with `{agent_name}` and `{brokerage}` substituted
   - Editable subject line (pre-filled from template)
   - "Send to X agents" confirm button

2. On confirm: loop through selected agents, send one email each via existing `send-email` Netlify function (SMTP)

3. On success per agent:
   - Insert row into `agent_outreach`
   - Update `agents.last_contacted_at`

4. Result summary shown: "Sent to 12 agents. 1 failed (no email address)."

---

## Email Templates

Templates are stored in `workspace.settings.agent_templates` as JSON. Defaults applied on first use.

**Introduction template:**

> Subject: Cash Buyer Looking for Properties in Jacksonville
>
> Hi {agent_name},
>
> My name is Tomer with HAT Investors. We're active cash buyers in Jacksonville looking for investment properties. If you have any listings that aren't moving or off-market opportunities, we'd love to connect.
>
> We close fast with no contingencies — usually within 2 weeks.
>
> Would love to hear from you if anything comes up.
>
> Best,  
> HAT Investors

**Follow-Up template:**

> Subject: Following Up — Cash Buyer in Jacksonville
>
> Hi {agent_name},
>
> Just following up on my previous message. We're still actively buying in Jacksonville — if anything has come up that might be a fit, I'd love to hear about it.
>
> Happy to hop on a quick call anytime.
>
> Best,  
> HAT Investors

Both templates support `{agent_name}` and `{brokerage}` placeholders. Templates are editable in Settings → Notifications (or a new Agent Templates settings tab).

---

## Files Affected

| File | Action | Purpose |
|---|---|---|
| `supabase/migrations/20260606000000_agents.sql` | Create | agents + agent_outreach tables |
| `src/pages/AgentsPage.jsx` | Create | Main agents list page |
| `src/components/agents/AgentTable.jsx` | Create | Table with checkboxes, filter, status badges |
| `src/components/agents/AgentEmailModal.jsx` | Create | Template picker + preview + send modal |
| `src/components/agents/AddAgentModal.jsx` | Create | Manual agent add form |
| `src/lib/agentOutreach.js` | Create | syncAgentsFromLeads(), sendAgentEmails() |
| `netlify/functions/send-agent-emails.mjs` | Create | Bulk send function (loops agents, sends each, logs outreach) |
| `src/pages/LeadDetailPage.jsx` | Modify | Auto-upsert agent when lead is enriched |
| `src/components/Sidebar.jsx` (or nav) | Modify | Add Agents nav item |

---

## Success Criteria

- All agents from leads with `listing_agent_email` can be synced into the agents table in one click
- Agents page shows all agents with last contacted date and status
- Admin can filter by "never contacted" or "not contacted in 30 days"
- Bulk email sends introduction or follow-up template to selected agents
- Each send is logged and `last_contacted_at` is updated
- Manual agent add works
- Templates are editable

---

## Out of Scope

- Automated scheduled sending (manual trigger only for now)
- SMS/phone outreach
- Agent response tracking (tracking if agent replied)
- More than 2 templates
- Full template editor UI (templates editable via settings JSON for now)
