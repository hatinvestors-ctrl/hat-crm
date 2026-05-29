# Tasks Enhancement Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enhance the tasks system with multi-assignee support, all-leads property picker with search, additional filters (status + created date), and a tasks section on the Today page.

**Architecture:** Schema migration adds `assignee_ids UUID[]` to `tasks`; UI replaces single-select assignee with a multi-select chip list; property picker becomes a searchable combobox; TaskFilters gains two new dropdowns; TodayPage gains a tasks section querying by array containment.

**Tech Stack:** React 18, Supabase (PostgreSQL array ops), Tailwind CSS v4 with CSS custom properties.

---

## Data Model

### `tasks` table changes

```sql
-- Add multi-assignee array (keep assignee_id for rollback safety, stop writing to it)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assignee_ids UUID[] DEFAULT '{}';

-- Migrate existing single assignees into the array
UPDATE tasks SET assignee_ids = ARRAY[assignee_id] WHERE assignee_id IS NOT NULL AND (assignee_ids IS NULL OR assignee_ids = '{}');
```

No other schema changes. `assignee_id` is left in place but no longer written by the app.

---

## Section 1: Multi-Assignee

### Assignee field in TaskDetailDrawer

Replace the `<select>` for assignee with a multi-select chip list:

- Shows current assignees as removable chips (initials + name + ✕ button)
- Below chips: dropdown of remaining members to add
- `patch({ assignee_ids: [...] })` on every add/remove
- Activity log: "Assignees: Alice → Alice, Bob"

### Task card (TaskCard.jsx)

- Show up to 3 assignee avatar chips (initials in a colored circle) stacked with slight overlap
- If more than 3, show "+N" chip

### Filter (TaskFilters.jsx + TasksPage.jsx)

- Assignee filter works by checking if selected user_id is in `assignee_ids` array
- Supabase filter: `.contains('assignee_ids', [userId])` 
- In-memory filter (current approach): `t.assignee_ids?.includes(userId)`
- "Me" option filters to `t.assignee_ids?.includes(currentUserId)`
- "Unassigned" filters to `!t.assignee_ids?.length`

---

## Section 2: Property Picker — All Leads + Searchable

### Load all leads (TasksPage.jsx + TaskDetailDrawer.jsx)

Remove the `.in('status', PROJECT_STATUSES)` filter when loading leads for task assignment. Load all leads in the workspace. This affects two places:
- `TasksPage.jsx` — the `projects` query fed into `TaskDetailDrawer` and `TaskFilters`
- `TaskDetailDrawer.jsx` — its internal `projects` prop (passed from TasksPage)

### Searchable combobox (new component: `src/components/ui/SearchableSelect.jsx`)

Props: `value`, `onChange`, `options` (array of `{ value, label }`), `placeholder`, `disabled`

Behavior:
- Renders as a styled div that looks like a select
- On click: shows a dropdown with a text input at top + filtered list below
- Typing filters options by label (case-insensitive)
- Clicking an option selects it and closes dropdown
- Clicking outside closes dropdown (useEffect + mousedown listener)
- Max height: 240px with overflow-y scroll

### "General" label

The first option in the property picker is `{ value: '', label: 'General' }` (no property). This replaces "— No project —" display text only — no DB change.

Used in: TaskDetailDrawer property field, TaskFilters project dropdown.

---

## Section 3: Additional Filters

### New filter keys

Add to `URL_FILTER_KEYS` in `TasksPage.jsx`:
- `status` — task status value (todo / in_progress / in_review / done)
- `created` — one of: `today`, `this_week`, `this_month`

### TaskFilters.jsx additions

Two new dropdowns after the existing ones:

**Status filter:**
```
<select> All Statuses | To Do | In Progress | In Review | Done </select>
```

**Created filter:**
```
<select> Any Time | Created Today | Created This Week | Created This Month </select>
```

### TasksPage.jsx filter logic additions

```js
if (filters.status && t.status !== filters.status) return false

if (filters.created) {
  const created = t.created_at?.slice(0, 10)
  if (filters.created === 'today' && created !== today) return false
  if (filters.created === 'this_week' && (created < weekStart || created > weekEnd)) return false
  if (filters.created === 'this_month' && created?.slice(0, 7) !== today.slice(0, 7)) return false
}
```

Add `weekStart` helper (Monday of current week) alongside existing `endOfWeekISO()`.

---

## Section 4: Today Page — Tasks Section

### Query

In `TodayPage.jsx`, alongside the leads query, run a tasks query:

```js
supabase
  .from('tasks')
  .select('id, title, due_date, status, assignee_ids, project_id, created_at')
  .eq('workspace_id', workspaceId)
  .contains('assignee_ids', [user.id])   // array containment
  .neq('status', 'done')
  .lte('due_date', todayISO())            // due today or earlier
  .order('due_date', { ascending: true })
```

### Display

Add a **"My Tasks"** section below the leads section in TodayPage. Split into two sub-groups:

| Group | Condition | Color tone |
|-------|-----------|------------|
| Overdue | `due_date < today` | danger (red) |
| Due Today | `due_date === today` | warn (yellow) |

Each task row shows:
- Task title (links to `/w/:workspaceId/tasks/:taskId`)
- Property address if `project_id` is set (looked up from a `projectMap`)
- Due date label ("Today" or the date string)
- **"✓ Done"** button — calls `supabase.from('tasks').update({ status: 'done' })` and removes from list optimistically

If no tasks: show nothing (don't render the section header either).

### Data needed in TodayPage

- `user` from `useOutletContext()` (already available via `members` but need to add `user` destructure)
- A second `projects` state loaded same way as TasksPage (all leads for projectMap lookup)

---

## Files to Create / Modify

| File | Action |
|------|--------|
| `src/components/ui/SearchableSelect.jsx` | Create — reusable searchable dropdown |
| `src/components/tasks/TaskDetailDrawer.jsx` | Modify — multi-assignee chips, SearchableSelect for property |
| `src/components/tasks/TaskCard.jsx` | Modify — show assignee avatar chips |
| `src/components/tasks/TaskFilters.jsx` | Modify — add status + created filters, use SearchableSelect for project |
| `src/pages/TasksPage.jsx` | Modify — load all leads, add status+created filter keys and logic |
| `src/pages/TodayPage.jsx` | Modify — add tasks section |
| `src/lib/taskHelpers.js` | Modify — update `logTaskChanges` to track `assignee_ids` diff |

---

## Supabase Migration

Run once in Supabase SQL Editor:

```sql
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assignee_ids UUID[] DEFAULT '{}';
UPDATE tasks SET assignee_ids = ARRAY[assignee_id] WHERE assignee_id IS NOT NULL AND (assignee_ids IS NULL OR assignee_ids = '{}');
```

No RLS changes needed (workspace_id scoping covers it).
