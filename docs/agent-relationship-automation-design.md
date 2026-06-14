# Agent Relationship Automation — Product & Technical Design

**Project:** HatCRM — Agent Relationship CRM Module
**Team:** HAT Investors (Jacksonville, FL)
**Date:** June 2026
**Status:** Design — Ready for Implementation

---

## Table of Contents

1. [Overview](#1-overview)
2. [User Personas and Daily Workflows](#2-user-personas-and-daily-workflows)
3. [Data Model](#3-data-model)
4. [AI Email Generation](#4-ai-email-generation)
5. [Outreach Scenarios (Phase 2)](#5-outreach-scenarios-phase-2)
6. [Automation Engine (Phase 2)](#6-automation-engine-phase-2)
7. [UI Architecture](#7-ui-architecture)
8. [Integration with hat-ai-agents](#8-integration-with-hat-ai-agents)
9. [Implementation Roadmap](#9-implementation-roadmap)
10. [Open Questions Resolved](#10-open-questions-resolved)

---

## 1. Overview

### What We're Building

A CRM module for managing long-term relationships with real estate agents, wholesalers, lenders, and partners — the people who send or may send deals to HAT Investors.

The module lives inside HatCRM (not a separate app) and adds structured relationship tracking, AI-assisted email generation, and a multi-step outreach sequencing engine on top of the existing agents table.

### Why It's Needed

HAT Investors has an existing `agents` table with basic contact info and outreach history, but no structured way to:

- Track relationship status and deal history per agent
- Run multi-step outreach sequences automatically
- Ensure emails always go out with review before sending
- See at a glance which relationships are going cold

Without this, warm relationships quietly go dormant. Agents who sent a deal 6 months ago get forgotten. There's no systematic way to stay in front of the people most likely to send future deals.

### Why It Lives Inside HatCRM

Building inside HatCRM (rather than a separate module or third-party tool) is the right call for several reasons:

- Auth, workspace, RLS, and SMTP settings already exist and work
- The `agents` table already exists and is already being populated via `syncAgentsFromLeads()`
- The shared design system means new UI looks native from day one — no jarring transitions
- The Netlify function pattern and Claude AI generation pattern are already proven in production
- Data stays in the same Supabase instance — no cross-system sync headaches

---

## 2. User Personas and Daily Workflows

### The Users

**Tomer** — primary operator. Manages relationships, reviews and approves email drafts, makes strategic calls on which agents to prioritize.

**Hemi** — secondary operator. Reviews drafts, handles day-to-day outreach, can enroll agents in scenarios.

Both users operate from the same workspace. Neither wants to spend more than 10 minutes a day on relationship maintenance — the system should surface exactly what needs attention and get out of the way.

### Daily Workflow — Morning (5 Minutes)

1. Open Drafts Inbox → see pending relationship emails queued by overnight automation
2. Review each draft → edit subject/body if needed → click "Approve & Send"
3. OR skip the message with a brief reason
4. Check Dashboard "At Risk" widget → any high-value agent going cold?

The morning review is the primary daily touchpoint. Everything else is exception handling.

### Weekly Workflow (10 Minutes)

1. Review agents due for follow-up (30+ days since last contact)
2. Enroll new agents in intro scenarios
3. Check scenario pipeline for stuck enrollments (drafts sitting unapproved)

### Post-Deal Workflow (Ad Hoc)

These are the highest-ROI touchpoints and happen at specific deal milestones:

- **Deal closes** → enroll the listing agent in "Post-Closing Thank You" scenario
- **Deal passes (dead lead)** → enroll listing agent in "Passed Deal Follow-Up" scenario
- **Offer rejected** → enroll listing agent in "Offer Rejected Follow-Up" scenario

Post-deal workflows are manually triggered in Phase 1 and can be auto-triggered in Phase 2 based on lead status changes.

---

## 3. Data Model

### Extended `agents` Table — New Columns

The existing `agents` table already has contact fields, notes, last_contacted_at, and outreach counts. These columns extend it with relationship management fields:

| Column | Type | Purpose |
|--------|------|---------|
| agent_type | TEXT | realtor / wholesaler / lender / title / insurance / contractor / property_manager |
| relationship_status | TEXT | new / contacted / active / warm / high_value / dormant / do_not_contact |
| source | TEXT | How we found them (Redfin, referral, cold outreach, etc.) |
| preferred_contact | TEXT | email / text / call / linkedin |
| market_areas | TEXT[] | ZIP codes or neighborhoods they work |
| deal_types_sent | TEXT[] | Types of deals they've referred (flip, rental, wholesale, etc.) |
| is_strategic | BOOLEAN | Star flag for priority relationships — highest-touch cadence |
| tags | TEXT[] | Free-form tags for filtering |
| last_replied_at | TIMESTAMPTZ | Last time they replied to us (drives reply-detection logic) |
| do_not_contact_reason | TEXT | Reason for DNC status, if applicable |
| linkedin_url | TEXT | LinkedIn profile URL |

The `relationship_status` field is the single most important addition. It drives filtering, dashboard widgets, and scenario auto-enrollment triggers.

### `agent_leads` Table (New)

Links agents to deals with a named role. This is separate from the existing `leads.listing_agent_email` field — that field is a string on the lead record. `agent_leads` is a proper join table that captures all relationship types across a deal's lifecycle and can hold multiple agents per deal.

**Columns:** id, workspace_id, agent_id (FK → agents), lead_id (FK → leads), role, notes, created_at

**Role values:** listing_agent / referral_source / wholesaler / buyer_agent / co_agent

A single deal can have multiple `agent_leads` rows — for example, a listing agent and a referral source who brought us to the property.

### `agent_deal_metrics` View (New)

A SQL view derived from `agent_leads` joined to `leads`. Shows per-agent aggregate metrics:

- deals_linked — total deals ever associated with this agent
- offers_made — deals that reached offer stage
- contracts_signed — deals under contract
- closings — deals closed
- last_deal_date — most recent deal association date

Because it's a view (not a materialized table), it's never stale. The UI queries it on demand and displays the metrics in the agent drawer.

### Phase 2 Tables — Scenario Automation

These tables power the sequencing engine. They are not needed in Phase 1.

**`outreach_scenarios`** — Scenario definitions. Columns: id, workspace_id, name, scenario_type (intro / check_in / reactivation / post_close / passed_deal / high_value_touch), description, is_active, created_at.

**`scenario_steps`** — Ordered steps within a scenario. Columns: id, scenario_id, step_number, day_offset (relative to prior step actual send date), channel (email / task / call), ai_scenario_type, subject_template, body_template, requires_approval (default true), auto_send (default false), min_days_since_last_contact, stop_on_reply (default true).

**`scenario_enrollments`** — One active enrollment per agent per scenario at a time. Columns: id, workspace_id, agent_id, scenario_id, current_step, status (active / paused / completed / cancelled), enrolled_at, enrolled_by, completed_at, cancel_reason.

**`scheduled_messages`** — Messages the cron engine has queued for processing. Columns: id, workspace_id, enrollment_id, step_id, agent_id, scheduled_for, status (pending / draft_created / sent / skipped / deferred), skip_reason, created_at.

**`message_drafts`** — Generated email content awaiting user approval. Columns: id, workspace_id, scheduled_message_id, agent_id, to_email, subject, body, generated_by (ai / template), status (pending / approved / rejected / sent), reviewed_by, reviewed_at, sent_at, idempotency_key.

**`send_log`** — Full audit trail of every send. Immutable append-only table. Columns: id, workspace_id, agent_id, draft_id, to_email, subject, sent_at, sent_by, sender_persona.

**`opt_outs`** — Unsubscribe registry. Columns: id, workspace_id, email, opted_out_at, reason. Checked before every send — no exceptions.

---

## 4. AI Email Generation

### New Netlify Function: `generate-agent-email.mjs`

Similar in structure to the existing `generate-email.mjs` function (which generates property negotiation emails), but purpose-built for relationship building with agents and partners.

### Sender Personas

Emails can be sent from two personas, configurable per scenario:

**Kevin Bachman (Bachman Property Brokers)** — The existing HAT Investors outreach persona. Used for formal, first-touch outreach where a professional brokerage identity is appropriate.

**HAT Investors team directly (Tomer or Hemi)** — Used for personal relationship emails where authenticity matters more than formality — post-close thank yous, reactivation messages, high-value agent touches.

The persona is set on the scenario definition and can be overridden per message draft in the UI.

### Scenario Types

The function accepts a `scenario_type` parameter that shapes the AI prompt:

- **intro** — First contact with a new agent. Establishes who HAT Investors is and what we're looking for.
- **check_in** — Ongoing relationship maintenance. Low-pressure, genuine, brief.
- **reactivation** — Re-engage after 90+ days of silence. Acknowledge the gap without being awkward.
- **post_close** — Thank the agent after a deal closes. This is the highest-ROI touchpoint.
- **passed_deal** — Keep the relationship alive after we pass on a deal. Don't burn the bridge.

### Context Used for Generation

The function receives:

- Agent name, brokerage, relationship_status, market_areas
- Last contacted date, last deal address and status (if any)
- Days since last contact
- Optional user-provided context hint (e.g., "mention we're looking for more in Arlington")

The richer the context, the better the output. The function uses all available fields and produces a personalized email that sounds like it was written by a human who actually knows the agent.

### Safety Fallback

If context is too sparse (new agent, no deal history, no market areas), the function returns a hardcoded template with `generated_by: 'template'` in the response. The UI shows a "template used" warning so the user knows to personalize before sending. No empty-feeling AI emails go out.

### Model

`claude-haiku-4-5-20251001` — same model used by existing HatCRM AI functions. Fast, low-cost, good enough for relationship emails with a structured prompt.

---

## 5. Outreach Scenarios (Phase 2)

### 8 Built-In Scenario Templates

These are seeded into the database on setup. Users can edit them or add custom scenarios.

**1. New Realtor Intro**
4 steps over ~30 days. Cadence: Day 0 intro email → Day 7 follow-up email → Day 14 call task → Day 30 final email. Goal: establish contact and get on their radar.

**2. Wholesaler Intro**
3 steps over ~10 days. Faster cadence, more deal-focused. Wholesalers move fast and appreciate directness. Day 0 email → Day 3 follow-up → Day 10 final email.

**3. Active Buyer Weekly Check-In**
Recurring monthly. For top-producing agents who are actively sending deals. One email per month, lightweight, keeps HAT Investors top of mind.

**4. Dormant Agent Reactivation**
3 steps over ~21 days. Triggered when an agent goes 90+ days without contact. Re-engage without being pushy. Day 0 reactivation email → Day 10 follow-up → Day 21 final attempt.

**5. Post-Closing Thank You**
3 steps over ~45 days. The highest-ROI scenario. Day 0 personal thank you → Day 14 check-in (how's the buyer doing?) → Day 45 "any new listings?" touchpoint.

**6. Passed Deal Follow-Up**
2 steps over ~21 days. Keep the relationship alive after we pass on a deal. Day 0 "thank you for thinking of us, here's why it didn't fit" → Day 21 "what else are you seeing?".

**7. Offer Rejected Follow-Up**
2 steps over ~14 days. Don't burn the agent after they reject our offer. Day 0 gracious response → Day 14 gentle re-engagement.

**8. High-Value Agent Monthly Touch**
Recurring monthly. Automatically enrolled when `is_strategic` is flagged. Personalized monthly email. Never auto-sends — always goes to Drafts Inbox for review.

### Enrollment Triggers

**Phase 1 — Manual Only**
Users enroll agents from the AgentScenarioPanel in the agent drawer. No automatic enrollment.

**Phase 2 — Automatic Triggers**

| Event | Scenario Enrolled |
|-------|-----------------|
| Agent created (type = realtor) | New Realtor Intro |
| Agent created (type = wholesaler) | Wholesaler Intro |
| Lead status → dead_lead (agent linked) | Passed Deal Follow-Up |
| Lead status → sold / flip_sold (agent linked) | Post-Closing Thank You |
| Agent relationship_status → dormant | Dormant Agent Reactivation |
| Agent is_strategic → true | High-Value Agent Monthly Touch |

Automatic enrollment creates the enrollment record but still goes through the full safety gauntlet before generating any draft.

---

## 6. Automation Engine (Phase 2)

### Daily Cron: `process-agent-sequences.mjs`

Runs at 8 AM EST every day via scheduled Netlify function. Processes all `scheduled_messages` with status = 'pending' and `scheduled_for` ≤ today.

For each pending message, the engine runs through a safety gauntlet before generating a draft.

### Safety Gauntlet (Ordered Checks)

Every message candidate passes through these checks in order. Any hard stop exits immediately. Defers reschedule for tomorrow.

1. **DNC block** — `relationship_status = 'do_not_contact'` → Hard skip, cancel enrollment
2. **Opt-out block** — Agent email in `opt_outs` table → Hard skip, cancel enrollment
3. **Reply detected** — Agent replied since this step was created AND `stop_on_reply = true` → Skip + cancel enrollment
4. **Daily contact limit** — Agent already received a message today → Defer to tomorrow
5. **Min days check** — Days since last contact < `step.min_days_since_last_contact` → Defer to tomorrow
6. **Duplicate template check** — Same template already sent to this agent (same scenario type + step number) → Skip with reason
7. **Global daily cap** — Workspace send count for today ≥ 20 → Stop processing loop entirely

If all checks pass, the engine calls `generate-agent-email.mjs`, creates a `message_drafts` record, and sets `scheduled_messages.status = 'draft_created'`.

### Default Behavior: Draft-Only

The engine **never sends email directly**. It creates drafts. A human reviews and approves in the Drafts Inbox.

The `auto_send` flag on `scenario_steps` exists in the schema for future use, but the workspace default is OFF. Auto-send will not be enabled until Phase 2 is fully stable and trusted.

### Step Timing Logic

`day_offset` for step N is calculated from the **actual send date of step N-1**, not the enrollment date. This prevents timing drift when drafts sit in the inbox unapproved for several days.

Example: If step 1 is scheduled for Day 7 but the user approves it on Day 10, step 2 is scheduled for Day 10 + step_2.day_offset — not Day 7 + step_2.day_offset.

### Safe Sending Rules Summary

| Rule | Overridable? |
|------|-------------|
| DNC block | Never |
| Opt-out block | Never |
| 1 message per agent per day | Never |
| Draft-only default | Yes (workspace setting, future) |
| Min days between contacts | Yes (configurable per step) |
| Global daily cap (20 max) | No |

### Reply Detection (Phase 2)

No Gmail API integration in Phase 2. Reply detection is manual: in the Drafts Inbox, users can mark "Agent replied" on any draft or past send. This sets `agents.last_replied_at` and cancels the active enrollment for that agent.

Gmail auto-detection (polling for replies to sent messages) is planned for Phase 3.

### Idempotency

Each `message_drafts` record has an `idempotency_key` (composed of agent_id + step_id + scheduled_date). The approval endpoint checks this key before sending — if a draft was already sent (by a double-click or network retry), the second call is a no-op that returns the original send result.

---

## 7. UI Architecture

### New Routes

The agent relationship module extends the existing agents area with new sub-pages. Navigation uses the same tab pattern as SettingsPage.

```
/w/:workspaceId/agents                    AgentsPage (existing — extended with new filters)
/w/:workspaceId/agents/scenarios          ScenariosPage (new — Phase 2)
/w/:workspaceId/agents/pipeline           ScenarioPipelinePage (new — Phase 3)
/w/:workspaceId/agents/drafts             DraftsInboxPage (new — Phase 2)
/w/:workspaceId/agents/relationship       AgentRelationshipDashboard (new — Phase 3)
```

### Extended `AgentTable` (Phase 1)

New columns added to the existing agents table view:

- **Type** — agent_type badge (color-coded by type)
- **Status** — relationship_status badge
- **Strategic** — star icon if is_strategic = true
- **Deals** — count from agent_deal_metrics view
- **Last Contact** — last_contacted_at with relative time

New filter controls in AgentsPage header: filter by agent_type, relationship_status, is_strategic, market_area tag.

### Extended `AgentDetailDrawer`

New sections added below existing contact/notes sections:

**AgentProfileSection (Phase 1)**
Fields: agent_type (select), relationship_status (select), source (text), preferred_contact (select), is_strategic toggle, tags (multi-select), market_areas (ZIP code chips), linkedin_url (text). Inline-edit pattern matching existing drawer fields. No separate save button — auto-saves on blur.

**AgentDealsSection (Phase 1)**
Table of linked deals: address, agent role, lead status, date linked. Below the table: "+ Link Deal" button opens a SearchableSelect of workspace leads. Metrics row above the table: Deals Sent / Offers Made / Contracts / Closings (from agent_deal_metrics view).

**AgentScenarioPanel (Phase 2)**
Shows active enrollment if one exists: scenario name, current step, next message scheduled date. Buttons: Enroll in Scenario (opens scenario picker), Pause, Cancel. If no active enrollment, shows "Not enrolled" with an Enroll button.

### Extended `AgentEmailModal`

The existing "Send Email" flow in the agent drawer gains an AI generation option.

"Generate with AI" button calls `generate-agent-email.mjs` with the current agent's context. Shows a spinner while generating (typically 2–4 seconds). Populates subject and body fields on success. User edits before sending — the generated content is a starting point, not a final product.

If the context was sparse and a template was used instead of AI generation, shows a yellow "template used — please personalize" warning banner above the body field.

### Drafts Inbox (Phase 2)

Split-pane layout:

**Left pane (35%)** — Draft list, most urgent first. Each row shows: agent name, scenario name · step number, scheduled date, subject line preview. Color-coded by urgency: red if overdue, yellow if due today, normal if upcoming.

**Right pane (65%)** — Draft review panel. Agent mini-card at top (name, brokerage, relationship_status, last contact). Editable subject field. Editable body textarea. Three action buttons: "Approve & Send" (primary), "Regenerate" (re-calls the AI), "Skip" (prompts for a reason). Skip reason is stored in `scheduled_messages.skip_reason`.

Approved drafts send immediately via `send-approved-draft.mjs` (Netlify function with idempotency check). The list auto-advances to the next draft.

### Agent Relationship Dashboard (Phase 3)

Top-level dashboard accessible from the agents sub-nav. Replaces the need to manually hunt for issues.

Widgets:

- **Drafts Pending** — count of message_drafts awaiting approval, with link to Drafts Inbox
- **Due For Contact** — agents with last_contacted_at > 30 days and relationship_status not dormant/DNC
- **At Risk** — agents with relationship_status = 'warm' or 'high_value' AND last_contacted_at > 60 days
- **Recent Sends** — last 10 messages sent, with agent name and subject
- **Upcoming** — next 7 days of scheduled messages

### Sidebar Badge

A small badge on the "Agents" sidebar link shows the count of pending drafts. Matches the pattern used for lead counts elsewhere in the app. Disappears when the inbox is clear.

---

## 8. Integration with hat-ai-agents

The `hat-ai-agents` system is a separate Claude Code operator console that queries HatCRM's Supabase database directly. Because the new tables and columns live in the same Supabase instance, no API contract changes are needed — new data is immediately queryable from agents.

### Agents That Benefit

**Realtor Agent** — Can query `scenario_enrollments` and the new `agents` fields (relationship_status, last_replied_at, deal metrics) to understand relationship context before drafting outreach suggestions. This makes its recommendations more accurate: it won't suggest a reactivation email for an agent who just replied last week.

**Follow-Up Agent** — Can surface `scheduled_messages` alongside lead follow-ups in the daily review. A single morning briefing can cover both "here are your lead follow-ups" and "here are your agent relationship drafts to review."

**Email Writer Agent** — Can call `generate-agent-email.mjs` when asked to draft relationship emails. Same function, same quality, available both from the HatCRM UI and from the agent console.

---

## 9. Implementation Roadmap

### Phase 1 — Immediate Value (No Automation Risk)

Goal: Deliver structured relationship tracking and AI email drafting with zero automation risk. No cron, no auto-scheduling.

**Database:**
- Extend `agents` table with new relationship columns (migration)
- Create `agent_leads` table
- Create `agent_deal_metrics` view

**Netlify Functions:**
- `generate-agent-email.mjs` — AI email generation with persona support and template fallback

**UI:**
- AgentProfileSection in AgentDetailDrawer
- AgentDealsSection in AgentDetailDrawer (with deal linking)
- "Generate with AI" button in AgentEmailModal
- New columns in AgentTable (type, status, strategic, deals)
- New filter controls in AgentsPage

**Deliverable:** Users can categorize agents, link deals, see deal metrics, and generate AI draft emails. All sends are still fully manual.

### Phase 2 — Scenario Automation

Goal: Automated outreach sequencing with human review gate on every message.

**Database:**
- outreach_scenarios, scenario_steps tables + seed data (8 built-in scenarios)
- scenario_enrollments, scheduled_messages, message_drafts, send_log, opt_outs tables

**Netlify Functions:**
- `process-agent-sequences.mjs` — daily cron with full safety gauntlet
- `send-approved-draft.mjs` — approval endpoint with idempotency guard

**UI:**
- DraftsInboxPage (split-pane review experience)
- ScenariosPage (list and edit scenario definitions)
- AgentScenarioPanel in AgentDetailDrawer
- Sidebar badge for pending draft count

**Deliverable:** Automation queues messages daily. Users spend 5 minutes in the morning reviewing and approving. No email leaves without human eyes.

### Phase 3 — Dashboard and Pipeline

Goal: Visibility into relationship health across the full agent network.

**UI:**
- AgentRelationshipDashboard with all widgets
- ScenarioPipelinePage (kanban or table view of all active enrollments)
- Optional: Gmail integration for automatic reply detection

**Deliverable:** Tomer and Hemi can see the health of the full agent network at a glance. At-risk relationships surface automatically.

### Phase 4 — Analytics

Goal: Understand which agents and scenarios actually drive deals.

- Relationship scoring (combines recency, frequency, deal contribution)
- Agent ROI metrics (deals closed attributed to relationship effort)
- Scenario performance analytics (open rates, reply rates, deal outcomes)
- Advanced filtering and export

---

## 10. Open Questions Resolved

**1. Reply detection approach for Phase 2**
Decision: Manual flag in Drafts Inbox UI. Users mark "Agent replied" on any draft or send record. This sets `agents.last_replied_at` and cancels the active enrollment. Gmail API polling for auto-detection is planned for Phase 3 but not required to make the system useful.

**2. Auto-send vs. always require approval**
Decision: Draft-only mode is the workspace default and will remain so through at least Phase 2. The `auto_send` column exists in the schema for future flexibility, but no scenario will use it until the system has been running reliably for several months.

**3. Which sender persona for which scenarios**
Decision: Configurable per scenario. Kevin Bachman (Bachman Property Brokers) for formal first-touch outreach where a professional persona is appropriate. HAT Investors team directly (Tomer or Hemi) for personal relationship emails — post-close thank yous, reactivation messages, high-value agent check-ins. Users can override per draft in the UI.

**4. Holiday and market update broadcast emails**
Decision: Out of scope for this module. Broadcast emails (one message to many agents, not personalized per enrollment) are a different product feature. Planned for Phase 4 as a separate "broadcast" tool, not per-agent enrollment.

**5. Auto-populating agent_leads from existing lead history**
Decision: Not done automatically. Historical linking is manual — users can link past deals from the AgentDealsSection on an ad hoc basis. The `leads.listing_agent_email` field is not reliable enough for automated backfill (inconsistent formatting, not always present). Clean data going forward is more valuable than imperfect historical backfill.
