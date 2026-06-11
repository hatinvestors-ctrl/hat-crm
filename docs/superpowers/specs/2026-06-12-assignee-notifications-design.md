# Assignee Notifications Design

## Goal

Send email notifications to the workspace member assigned to a lead whenever specific events occur on that lead. An admin can enable or disable each notification type per user from a central settings grid.

## Architecture

Event fires in React → POST to `notify-lead-event` Netlify function → function checks assignee's `notification_prefs` in `workspace_members` → renders email with lead summary + activity history → sends via workspace SMTP.

**Tech Stack:** Supabase (JSONB column on `workspace_members`), React settings grid, existing `notify-lead-event.mjs` Netlify function (extended), nodemailer (existing).

---

## Data Layer

### Migration

```sql
ALTER TABLE workspace_members
  ADD COLUMN IF NOT EXISTS notification_prefs JSONB NOT NULL DEFAULT '{}';
```

### Preference Keys

All default to `true` when the key is absent (opt-in by default).

| Key | Label |
|---|---|
| `assigned` | Lead Assigned to You |
| `status_change` | Any Status Change |
| `offer_signed` | Contract Signed *(existing)* |
| `closed` | Lead Closed / Won |
| `dead` | Lead Marked Dead |
| `comment` | New Comment Posted |
| `file_attached` | File Attached |
| `deal_analysis` | Deal Analysis Run |
| `offer_price` | Offer Price Updated |
| `follow_up_date` | Follow-up Date Changed |
| `enriched` | Lead Enriched (MLS/RentCast) |

Preferences are stored as:
```json
{ "assigned": true, "status_change": true, "comment": false, ... }
```

---

## Settings UI

### Location
Settings page → new tab **"Assignee Notifications"** (alongside existing Mail Server / Notifications tabs).

### Component: `AssigneeNotificationsForm`

- Renders a grid: **rows = workspace members** (name + avatar), **columns = 11 notification types**
- Each cell is a checkbox
- Column headers are short labels (e.g. "Assigned", "Status", "Comment", "File", "Analysis", "Offer Price", "Follow-up", "Enriched", "Signed", "Closed", "Dead")
- "Save" button per row (or global save — per row preferred so saving one user doesn't require saving all)
- Reads: `workspace_members` with `notification_prefs` and `profiles(full_name, avatar_url)`
- Writes: `UPDATE workspace_members SET notification_prefs = $1 WHERE user_id = $2 AND workspace_id = $3`
- Admin-only (role = 'admin')

---

## Trigger Points

Each trigger calls `fireLeadNotification(event, leadId, workspaceId, actorUserId)` — a thin wrapper that POSTs to `/.netlify/functions/notify-lead-event`.

| Event key | Where to add trigger | Condition |
|---|---|---|
| `assigned` | `useLeadUpdate` / LeadDetailPage when `assigned_to` field saves | `newValue !== oldValue` |
| `status_change` | Existing `fireLeadNotifications` call in LeadDetailPage | Any status transition (not just offer_signed) |
| `offer_signed` | Already exists — no change needed | status → `offer_signed` |
| `closed` | Status change handler | status → `closed` or `flip_sold` or `wholesale_sold` |
| `dead` | Status change handler | status → `dead` |
| `comment` | `CommentBox.jsx` after `logComment()` resolves | Always |
| `file_attached` | File upload success handler | Always |
| `deal_analysis` | `FinancialSection.jsx` after `analyze-deal` returns ok | Always |
| `offer_price` | `useLeadUpdate` when `offer_price` saves | Always |
| `follow_up_date` | `useLeadUpdate` when `follow_up_date` saves | Always |
| `enriched` | Enrichment handler after RentCast completes | Always |

`closed` and `dead` are fired in addition to `status_change` (they are independent toggles).

---

## Netlify Function: `notify-lead-event.mjs` (extended)

### Request body additions
```json
{
  "event": "comment",
  "lead_id": "uuid",
  "workspace_id": "uuid",
  "actor_user_id": "uuid",
  "extra": {
    "comment_text": "Talked to agent, quick close possible",
    "old_value": "triage",
    "new_value": "under_contract",
    "field_label": "Offer Price",
    "old_formatted": "$130,000",
    "new_formatted": "$142,000"
  }
}
```

### Preference check
```js
const member = await supabase
  .from('workspace_members')
  .select('notification_prefs, profiles(email)')
  .eq('workspace_id', workspace_id)
  .eq('user_id', lead.assigned_to)
  .single()

const prefs = member.notification_prefs ?? {}
const enabled = prefs[event] !== false  // default true when key absent
if (!enabled) return { ok: true, skipped: 'disabled' }
```

### Actor name resolution
Fetch actor's `profiles.full_name` by `actor_user_id` to show "Changed by: Tomer Carmelli" in the email.

### Activity history
Fetch last 5 `lead_activities` rows for the lead (with `profiles.full_name` join), formatted as plain-text lines.

---

## Email Format

All emails share the same 3-section plain-text structure:

```
Subject: [Event Label] — {address}, {city} {state}

── LEAD SUMMARY ──────────────────────────────
Address:      {address}, {city}, {state}
Status:       {status_label}
Offer Price:  {offer_price | MAO if no offer}
ARV:          {arv}
Assigned to:  {assignee name}

── {EVENT SECTION TITLE} ─────────────────────
{event-specific content — see below}

── RECENT ACTIVITY ───────────────────────────
{last 5 activity items, one per line}
{date} · {user} · {content}
```

### Event-specific content per type

| Event | Section title | Content |
|---|---|---|
| `assigned` | "Lead Assigned" | "Assigned to you by {actor}" |
| `status_change` | "Status Changed" | "{old_label} → {new_label}\nChanged by: {actor}" |
| `offer_signed` | "Contract Signed" | "HAT signed — send offer to listing agent ASAP.\nListing agent: {agent_name} {agent_phone}" |
| `closed` | "Lead Closed" | "Marked closed by {actor}" |
| `dead` | "Lead Dead" | "Marked dead by {actor}" |
| `comment` | "New Comment" | Full comment text in a box, posted by {actor} |
| `file_attached` | "File Attached" | "File '{filename}' attached by {actor}" |
| `deal_analysis` | "Deal Analysis" | "Verdict: {verdict} · Score: {score}\nEst. Profit: {profit} · ROI: {roi}%\nCash Needed: {cash}" |
| `offer_price` | "Offer Price Updated" | "{old_value} → {new_value}\nUpdated by: {actor}" |
| `follow_up_date` | "Follow-up Date" | "Set to {new_date} by {actor}" |
| `enriched` | "Lead Enriched" | "MLS data updated: {summary of changed fields}" |

---

## Migration Strategy

1. Run the `ALTER TABLE` migration in Supabase (SQL provided above).
2. Existing `offer_signed` notification continues to work — the function checks `prefs['offer_signed'] !== false`, which defaults to `true` for all users with no prefs set yet.
3. The existing workspace-level `settings.notifications.offer_signed` toggle in `NotificationTriggersForm` remains as a workspace-wide master switch; per-user prefs layer on top of it.

---

## Files to Create / Modify

| File | Action |
|---|---|
| `supabase/migrations/20260612000000_member_notification_prefs.sql` | Create — ALTER TABLE migration |
| `src/components/settings/AssigneeNotificationsForm.jsx` | Create — settings grid component |
| `src/pages/SettingsPage.jsx` | Modify — add new tab and render AssigneeNotificationsForm |
| `src/lib/leadNotifications.js` | Modify — add all new event keys, extend fireLeadNotification to accept extra payload |
| `netlify/functions/notify-lead-event.mjs` | Modify — per-user pref check, actor resolution, activity history, all new templates |
| `src/components/lead-detail/CommentBox.jsx` | Modify — fire `comment` notification after post |
| `src/components/lead-detail/FinancialSection.jsx` | Modify — fire `deal_analysis` notification after analyze |
| `src/components/leads/LeadForm.jsx` | Modify — fire `enriched` notification after enrichment |
| `src/hooks/useLeadUpdate.js` | Modify — fire `assigned`, `offer_price`, `follow_up_date` on field save |
| `src/pages/LeadDetailPage.jsx` | Modify — extend status change handler for `closed`, `dead`, `status_change` |
