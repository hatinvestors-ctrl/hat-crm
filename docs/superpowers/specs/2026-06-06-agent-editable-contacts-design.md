# Agent Editable Contact Fields — Design Spec
**Date:** 2026-06-06

## Overview

Replace the read-only Contact Info card in the Agent Detail Drawer's left column with a fully editable section. Scalar fields (name, brokerage, address) use click-to-edit in place. Phones and emails each become a managed list supporting multiple entries with labels, inline editing, and add/delete. One email is always designated primary and is kept in sync with `agents.email` for outreach.

---

## Data Model

### Migration: `supabase/migrations/20260606000004_agent_contacts.sql`

**1. Add `address` column to `agents`:**
```sql
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS address TEXT;
```

**2. New `agent_contacts` table:**
```sql
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

### Primary email sync rule
- When an email entry's `is_primary = true`, its `value` is written to `agents.email`.
- When the first email is added, it is automatically marked `is_primary = true`.
- When the primary email is deleted, the next email in `sort_order` becomes primary and `agents.email` is updated.
- When all emails are deleted, `agents.email` is set to `null`.
- `agents.phone` (legacy column) is NOT synced — existing single-phone data is migrated into `agent_contacts` on first edit.

### Legacy data migration (soft)
On first save of any phone/email in the drawer, if `agents.phone` / `agents.email` exist and no `agent_contacts` rows exist yet for that agent, the existing values are seeded into `agent_contacts` (phone with label "Phone", email with label "Work", `is_primary=true`). This happens client-side before the first insert, not via a bulk migration.

---

## Components

| Component | File | Responsibility |
|---|---|---|
| `AgentContactsSection` | `src/components/agents/AgentContactsSection.jsx` | Root of the left-column editable area — assembles all fields |
| `AgentInlineField` | `src/components/agents/AgentInlineField.jsx` | Single click-to-edit scalar field (text input or textarea) |
| `AgentContactList` | `src/components/agents/AgentContactList.jsx` | Managed list of phone or email entries with add/edit/delete/primary |

### Modified files

| File | Change |
|---|---|
| `src/components/agents/AgentDetailDrawer.jsx` | Replace Contact Info `Card` with `AgentContactsSection`; pass `onAgentUpdated` down |

---

## `AgentInlineField`

**Props:** `value`, `onSave(newValue)`, `placeholder`, `multiline` (boolean, for address), `label` (display label above field)

**Behaviour:**
- Renders value as plain text with a subtle pencil icon visible on hover
- Click → replaces text with `<input>` (or `<textarea>` if `multiline`); autofocus
- **Enter** (single-line) or **blur** → calls `onSave(trimmedValue)`; reverts to display mode
- **Escape** → cancels, restores original value without saving
- If value is empty, shows dim placeholder text (e.g. "Add address…")
- `onSave` patches the `agents` table via Supabase client; on error, restores the previous value

---

## `AgentContactList`

**Props:** `agentId`, `workspaceId`, `type` (`'phone'` | `'email'`), `contacts` (array), `onChanged()`, `showPrimary` (boolean — true for email list only)

**Behaviour:**

### Display
Each entry shows: `[label] · [value]` with:
- A `★` badge (email only) — filled if `is_primary`, outline if not
- An edit pencil icon (on hover)
- A `×` delete button (on hover)

### Inline edit
Clicking label or value opens that field inline (same `AgentInlineField` pattern). Saves on blur/Enter. Cancels on Escape.

### Add entry
`+ Add phone` / `+ Add email` button appends a blank row in edit mode:
- Label field focused first; label suggestions shown in a small dropdown on focus: **Work, Personal, Cell, Office, Mobile, Home** (freetext allowed)
- Tab or Enter moves focus to the value field
- Blur or Enter on value field saves the entry
- Escape cancels and removes the blank row

### Delete
Clicking `×` deletes the entry. If the deleted entry was the primary email, the next entry (by `sort_order`) becomes primary and `agents.email` is updated.

### Primary promotion
Clicking `★` on a non-primary email:
1. Sets `is_primary = false` on the current primary
2. Sets `is_primary = true` on the clicked entry
3. Patches `agents.email` with the new primary value

---

## `AgentContactsSection`

Assembles all editable fields for the left column in the drawer. Fetches `agent_contacts` for the current agent on mount. Handles the legacy seed on first contact add.

**Layout (top to bottom):**
1. `AgentInlineField` — Name
2. `AgentInlineField` — Brokerage
3. `AgentInlineField` — Address (multiline)
4. `AgentContactList` — Phones (`type='phone'`, `showPrimary=false`)
5. `AgentContactList` — Emails (`type='email'`, `showPrimary=true`)

**Scalar field saves** patch `agents` via Supabase and call `onAgentUpdated(updatedAgent)` so the drawer header (which shows name and brokerage) refreshes.

---

## Drawer changes

In `AgentDetailDrawer`, the left column currently renders:
```jsx
<Card title="Contact Info">…</Card>
<AgentNotesSection … />
```

This becomes:
```jsx
<AgentContactsSection agent={agent} workspaceId={workspaceId} canEdit={canEdit} onAgentUpdated={handleAgentUpdated} />
<AgentNotesSection … />
```

---

## Error handling
- Inline field save failure: silently restore previous value (no error toast — user can retry by clicking again)
- Contact add/delete failure: show a small inline error message below the list, keep the UI state as-is

---

## Out of Scope
- Sorting / reordering contacts by drag-and-drop
- Marking a phone as primary
- Bulk import of contacts
- Validating email format or phone format
