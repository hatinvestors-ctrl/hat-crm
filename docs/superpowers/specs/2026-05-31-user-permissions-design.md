# User Permissions & Role-Based Access Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enforce role-based access so non-admin users see only their own leads, get a personal dashboard, and are blocked from admin-only pages.

**Architecture:** Roles already exist in `workspace_members.role` (admin/member/readonly). Add `visible_to_all` boolean to `leads` for shared leads. Filter leads queries client-side based on role. Branch Dashboard into admin view (existing) vs personal view (new component). Hide nav items and redirect protected routes based on role.

**Tech Stack:** React 18, Supabase (client-side filtering + one migration), React Router v6 (redirect guards), Tailwind CSS v4.

---

## Role Definitions

| Role | Description |
|------|-------------|
| `admin` | Full access — all leads, all pages, team dashboard |
| `member` | Restricted — own/shared leads only, personal dashboard, no Tasks/Import/Settings |
| `readonly` | Same as member but cannot create/edit leads or run analysis |

---

## Data Model Change

### `leads` table
```sql
ALTER TABLE leads ADD COLUMN IF NOT EXISTS visible_to_all BOOLEAN DEFAULT false;
```

**Visibility rule for non-admins:**
A lead is visible if ANY of:
- `created_by = current_user_id`
- `assigned_to = current_user_id`  
- `visible_to_all = true`

Admins see all leads with no filter.

---

## Section 1: Navigation Access

### Sidebar — hidden items for non-admin

| Nav Item | Admin | Member | Readonly |
|----------|-------|--------|----------|
| Dashboard | ✓ | ✓ | ✓ |
| Today | ✓ | ✓ | ✓ |
| Inbox | ✓ | ✓ | ✓ |
| Leads | ✓ | ✓ | ✓ |
| Tasks | ✓ | ✗ hidden | ✗ hidden |
| Import | ✓ | ✗ hidden | ✗ hidden |
| Settings | ✓ | ✗ hidden | ✗ hidden |
| Quick Analysis button | ✓ | ✓ | ✗ hidden |

### Route guards

In `src/App.jsx`, wrap `TasksPage`, `ImportPage`, and `SettingsPage` routes with an `AdminRoute` guard component that redirects non-admins to `/w/:workspaceId/today`.

`AdminRoute` receives `userRole` from outlet context and renders `<Outlet />` if admin, otherwise `<Navigate to="../today" replace />`.

---

## Section 2: Lead Visibility Filter

### Helper function: `src/lib/leadVisibility.js`

```js
// Returns a Supabase query filter string for non-admin lead visibility
export function applyLeadVisibility(query, userId, userRole) {
  if (userRole === 'admin') return query
  return query.or(`created_by.eq.${userId},assigned_to.eq.${userId},visible_to_all.eq.true`)
}
```

### Files to update with visibility filter

- **`src/pages/LeadsPage.jsx`** — main leads query
- **`src/pages/TodayPage.jsx`** — leads query
- **`src/components/Sidebar.jsx`** — recent leads list query

### "Assign to All" in lead form

In `src/components/leads/LeadForm.jsx` and wherever the assignee field is rendered:
- Add **"All Members"** as the first option (value = `'__all__'`)
- On save: if `assigned_to === '__all__'`, set `{ visible_to_all: true, assigned_to: null }`
- Otherwise: set `{ visible_to_all: false, assigned_to: value || null }`

### "All" badge on lead rows/cards

In `src/components/leads/LeadsTable.jsx`, show a small `ALL` chip on rows where `visible_to_all = true`.

The leads query must include `visible_to_all` in the select.

---

## Section 3: Dashboard Branching

### `src/pages/DashboardPage.jsx`

Read `userRole` from `useOutletContext()`. If `userRole === 'admin'`, render existing dashboard. Otherwise render `<PersonalDashboard />`.

### New component: `src/components/dashboard/PersonalDashboard.jsx`

**Props:** `workspaceId`, `userId`, `members`

**Queries:**
1. Leads where `created_by = userId OR assigned_to = userId OR visible_to_all = true` — used for all widgets
2. Tasks where `assignee_ids contains userId AND status != done` — for My Tasks widget

**Widgets (4 sections):**

#### My Stats (top row — 4 cards)
- My Leads (total active, non-closed)
- Offers Sent (leads where status reached `offer_sent`)
- Accepted (leads where status = `offer_accepted`)
- Closed (leads where status = `sold`)

#### My Pipeline
Simple horizontal bar showing my lead counts by status group (Pipeline / Follow-Up / Outcome). Uses existing `LEAD_STATUSES` constants. Not the full admin `StatusBreakdown` component — a simpler inline version.

#### My Follow-Ups
Reuse existing `FollowUpWidget` component, passing only my visible leads.

#### My Tasks
Three groups:
- **Overdue** — `due_date < today`, not done
- **Due Today** — `due_date = today`, not done
- **Upcoming** — `due_date > today AND due_date <= +7 days`, not done

Each task row: title, property (if set), due date chip. Click opens task drawer.

---

## Section 4: Today Page Scoping

### Non-admin Today page

The leads section already shows "needs action" leads. For non-admins, add the visibility filter to the leads query:

```js
// existing query
supabase.from('leads').select(...)
  .eq('workspace_id', workspaceId)
  .not('status', 'in', '("closed","dead")')
  // ADD for non-admin:
  .or(`created_by.eq.${user.id},assigned_to.eq.${user.id},visible_to_all.eq.true`)
```

The tasks section (My Tasks) already filters by `assignee_ids contains user.id` — no change needed.

---

## Files to Create / Modify

| File | Action |
|------|--------|
| Supabase SQL Editor | Run migration (manual) |
| `src/lib/leadVisibility.js` | Create — shared filter helper |
| `src/components/AdminRoute.jsx` | Create — route guard component |
| `src/App.jsx` | Modify — wrap Tasks/Import/Settings with AdminRoute |
| `src/components/Sidebar.jsx` | Modify — hide Tasks/Import/Settings/QuickAnalysis for non-admin; filter recent leads |
| `src/pages/LeadsPage.jsx` | Modify — apply visibility filter to leads query |
| `src/pages/TodayPage.jsx` | Modify — apply visibility filter to leads query |
| `src/pages/DashboardPage.jsx` | Modify — branch on userRole |
| `src/components/dashboard/PersonalDashboard.jsx` | Create — personal dashboard for member/readonly |
| `src/components/leads/LeadForm.jsx` | Modify — add "All Members" assignee option |
| `src/components/leads/LeadsTable.jsx` | Modify — show "ALL" chip on visible_to_all leads; add visible_to_all to select |

---

## Supabase Migration

Run in SQL Editor:
```sql
ALTER TABLE leads ADD COLUMN IF NOT EXISTS visible_to_all BOOLEAN DEFAULT false;
```

No RLS changes — filtering is done client-side (consistent with existing pattern).
