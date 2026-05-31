# User Permissions & Role-Based Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce role-based access so non-admin users see only their own leads, get a personal dashboard, and are blocked from admin-only pages (Tasks, Import, Settings).

**Architecture:** Add `visible_to_all` boolean to `leads` table. Create a `leadVisibility` helper that applies a Supabase `.or()` filter for non-admins. Create an `AdminRoute` guard that redirects non-admins away from protected routes. Branch `DashboardPage` into admin (existing) vs personal (new `PersonalDashboard` component). Hide sidebar nav items and filter sidebar lead list based on `userRole`.

**Tech Stack:** React 18, React Router v6, Supabase client-side filtering, Tailwind CSS v4 custom properties.

---

## File Map

| File | Action |
|------|--------|
| Supabase SQL Editor | Run migration (manual) |
| `src/lib/leadVisibility.js` | Create — shared visibility filter helper |
| `src/components/AdminRoute.jsx` | Create — route guard redirecting non-admins |
| `src/App.jsx` | Modify — wrap Tasks/Import/Settings with AdminRoute |
| `src/components/Sidebar.jsx` | Modify — hide Tasks/Import/Settings/QuickAnalysis for non-admin; scope recent leads |
| `src/pages/LeadsPage.jsx` | Modify — apply visibility filter to leads query |
| `src/pages/TodayPage.jsx` | Modify — apply visibility filter to leads query |
| `src/components/leads/LeadForm.jsx` | Modify — add "All Members" assignee option; handle visible_to_all on save |
| `src/components/leads/LeadsTable.jsx` | Modify — show ALL chip; include visible_to_all in row render |
| `src/components/dashboard/PersonalDashboard.jsx` | Create — personal dashboard for member/readonly |
| `src/pages/DashboardPage.jsx` | Modify — branch on userRole |

---

## Task 1: Supabase Migration (Manual)

**Files:** Supabase SQL Editor

- [ ] **Step 1: Run in Supabase SQL Editor**

```sql
ALTER TABLE leads ADD COLUMN IF NOT EXISTS visible_to_all BOOLEAN DEFAULT false;
```

Expected: "Success. No rows returned."

- [ ] **Step 2: Verify**

```sql
SELECT id, assigned_to, visible_to_all FROM leads LIMIT 5;
```

Expected: `visible_to_all` column present, all values `false`.

---

## Task 2: Lead Visibility Helper

**Files:**
- Create: `src/lib/leadVisibility.js`

- [ ] **Step 1: Create the helper**

```js
// src/lib/leadVisibility.js

/**
 * Applies a Supabase visibility filter for non-admin users.
 * Admins see all leads. Members/readonly see only:
 *   - leads they created
 *   - leads assigned to them
 *   - leads marked visible_to_all
 */
export function applyLeadVisibility(query, userId, userRole) {
  if (userRole === 'admin') return query
  return query.or(`created_by.eq.${userId},assigned_to.eq.${userId},visible_to_all.eq.true`)
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/leadVisibility.js
git commit -m "feat: add lead visibility filter helper"
```

---

## Task 3: AdminRoute Guard

**Files:**
- Create: `src/components/AdminRoute.jsx`

- [ ] **Step 1: Create the component**

```jsx
// src/components/AdminRoute.jsx
import { Navigate, Outlet, useOutletContext } from 'react-router-dom'

export default function AdminRoute() {
  const { userRole, workspaceId } = useOutletContext()
  if (userRole === 'admin') return <Outlet />
  return <Navigate to={`/w/${workspaceId}/today`} replace />
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/AdminRoute.jsx
git commit -m "feat: add AdminRoute guard for role-restricted pages"
```

---

## Task 4: Wrap Protected Routes in App.jsx

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Add AdminRoute import**

Find the imports block at the top of `src/App.jsx`. After the last import line, add:

```js
import AdminRoute from './components/AdminRoute'
```

- [ ] **Step 2: Wrap Tasks, Import, Settings routes**

Find these three lines (around line 53–56):
```jsx
        <Route path="tasks" element={<TasksPage />} />
        <Route path="tasks/:taskId" element={<TasksPage />} />
        <Route path="import" element={<ImportPage />} />
        <Route path="settings" element={<SettingsPage />} />
```

Replace with:
```jsx
        <Route element={<AdminRoute />}>
          <Route path="tasks" element={<TasksPage />} />
          <Route path="tasks/:taskId" element={<TasksPage />} />
          <Route path="import" element={<ImportPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
```

- [ ] **Step 3: Commit**

```bash
git add src/App.jsx
git commit -m "feat: restrict tasks/import/settings to admin role"
```

---

## Task 5: Sidebar — Hide Nav Items + Scope Recent Leads

**Files:**
- Modify: `src/components/Sidebar.jsx`

- [ ] **Step 1: Hide Tasks, Import, Settings, QuickAnalysis for non-admin**

The Sidebar already receives `userRole` as a prop. Find the JSX that renders the Tasks, Import, and Settings nav links. They look like:

```jsx
<NavLink to={`${base}/tasks`} ...>
<NavLink to={`${base}/import`} ...>
<NavLink to={`${base}/settings`} ...>
```

And the Quick Analysis button block.

Wrap each with a `userRole === 'admin'` check:

```jsx
{userRole === 'admin' && (
  <NavLink to={`${base}/tasks`} className={navItemClasses}>
    <span className="text-[color:var(--color-text-dim)]">{ICONS.tasks}</span>
    <span className="flex-1">Tasks</span>
    {myOpenTaskCount > 0 && (
      <span className="...">{myOpenTaskCount}</span>
    )}
  </NavLink>
)}

{userRole === 'admin' && (
  <NavLink to={`${base}/import`} className={navItemClasses}>
    <span className="text-[color:var(--color-text-dim)]">{ICONS.import}</span>
    <span className="flex-1">Import</span>
  </NavLink>
)}

{userRole === 'admin' && (
  <NavLink to={`${base}/settings`} className={navItemClasses}>
    <span className="text-[color:var(--color-text-dim)]">{ICONS.settings}</span>
    <span className="flex-1">Settings</span>
  </NavLink>
)}
```

For the Quick Analysis button, find:
```jsx
<button onClick={() => setQuickAnalysisOpen(true)} ...>
  ⚡ Quick Analysis
</button>
```
Wrap it:
```jsx
{userRole === 'admin' && (
  <button onClick={() => setQuickAnalysisOpen(true)} ...>
    ⚡ Quick Analysis
  </button>
)}
```

- [ ] **Step 2: Scope recent leads list in sidebar**

The sidebar loads recent leads (around line 44). Find the leads query:
```js
    supabase
      .from('leads')
      .select('id, address, status, follow_up_date, contract_signed_date, created_at, updated_at, is_hot')
      .eq('workspace_id', workspaceId)
      .not('status', 'in', '("sold","dead_lead","rejected_not_accepted","not_in_buy_box","sequence_completed")')
      .order('updated_at', { ascending: false })
```

The Sidebar receives `userRole` as a prop but not `userId`. Add `userId` to the Sidebar's props. In `Layout.jsx`, the Sidebar is rendered as:

```jsx
<Sidebar workspace={workspace} userRole={userRole} profile={profile} onSignOut={onSignOut} />
```

Change to:
```jsx
<Sidebar workspace={workspace} userRole={userRole} profile={profile} onSignOut={onSignOut} userId={user.id} />
```

Then in `Sidebar.jsx`, add `userId` to the props destructure:
```js
export default function Sidebar({ workspace, userRole, userId, profile, onSignOut }) {
```

And import the helper at the top of `Sidebar.jsx`:
```js
import { applyLeadVisibility } from '../lib/leadVisibility'
```

Then update the leads query chain to apply visibility:
```js
    let q = supabase
      .from('leads')
      .select('id, address, status, follow_up_date, contract_signed_date, created_at, updated_at, is_hot')
      .eq('workspace_id', workspaceId)
      .not('status', 'in', '("sold","dead_lead","rejected_not_accepted","not_in_buy_box","sequence_completed")')
      .order('updated_at', { ascending: false })
    q = applyLeadVisibility(q, userId, userRole)
    q.then(({ data }) => {
```

Note: the existing `.then(({ data }) => {` call needs to be chained from `q` instead of from the original query chain. Find the end of the original chain where `.then(({ data }) => {` is and restructure it.

- [ ] **Step 3: Commit**

```bash
git add src/components/Sidebar.jsx src/components/Layout.jsx
git commit -m "feat: hide admin nav items and scope sidebar leads for non-admin"
```

---

## Task 6: LeadsPage — Apply Visibility Filter

**Files:**
- Modify: `src/pages/LeadsPage.jsx`

- [ ] **Step 1: Add import**

At the top of `src/pages/LeadsPage.jsx`, add:
```js
import { applyLeadVisibility } from '../lib/leadVisibility'
```

- [ ] **Step 2: Apply filter in fetchLeads**

Find `fetchLeads` (around line 121). The query starts:
```js
    let q = supabase.from('leads').select('*').eq('workspace_id', workspaceId)
```

After that line, add:
```js
    q = applyLeadVisibility(q, user.id, userRole)
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/LeadsPage.jsx
git commit -m "feat: apply lead visibility filter for non-admin on leads page"
```

---

## Task 7: TodayPage — Apply Visibility Filter

**Files:**
- Modify: `src/pages/TodayPage.jsx`

- [ ] **Step 1: Add import**

At the top of `src/pages/TodayPage.jsx`, add:
```js
import { applyLeadVisibility } from '../lib/leadVisibility'
```

- [ ] **Step 2: Apply filter to leads query**

Find the leads useEffect (the one that loads leads for the "needs attention" section). It contains:
```js
    supabase
      .from('leads')
      .select('id, address, city, status, follow_up_date, contract_signed_date, assigned_to, arv, mao, offer_price, created_at, updated_at, snooze_until')
      .eq('workspace_id', workspaceId)
      .not('status', 'in', '("closed","dead")')
      .then(({ data }) => {
```

Restructure to:
```js
    let leadsQ = supabase
      .from('leads')
      .select('id, address, city, status, follow_up_date, contract_signed_date, assigned_to, arv, mao, offer_price, created_at, updated_at, snooze_until')
      .eq('workspace_id', workspaceId)
      .not('status', 'in', '("closed","dead")')
    leadsQ = applyLeadVisibility(leadsQ, user.id, userRole)
    leadsQ.then(({ data }) => {
```

Also add `userRole` to the destructure from `useOutletContext()`:
```js
  const { workspace, workspaceId, members, user, userRole } = useOutletContext()
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/TodayPage.jsx
git commit -m "feat: scope today page leads to visible leads for non-admin"
```

---

## Task 8: LeadForm — "All Members" Assignee Option

**Files:**
- Modify: `src/components/leads/LeadForm.jsx`

- [ ] **Step 1: Add visible_to_all to EMPTY_LEAD**

Find `const EMPTY_LEAD = {` (around line 20). Add `visible_to_all: false` to the object:

```js
const EMPTY_LEAD = {
  // ... existing fields ...
  assigned_to: '',
  visible_to_all: false,
  // ... rest of fields ...
}
```

- [ ] **Step 2: Initialize visible_to_all when editing a lead**

Find (around line 155):
```js
        setForm({ ...EMPTY_LEAD, ...lead, assigned_to: lead.assigned_to || '' })
```

Replace with:
```js
        setForm({
          ...EMPTY_LEAD,
          ...lead,
          assigned_to: lead.visible_to_all ? '__all__' : (lead.assigned_to || ''),
          visible_to_all: lead.visible_to_all || false,
        })
```

- [ ] **Step 3: Handle __all__ on save**

Find in `handleSubmit` (around line 200), where nullable fields are normalized. After the nullable loop, add:

```js
      // Handle "All Members" assignment
      if (payload.assigned_to === '__all__') {
        payload.visible_to_all = true
        payload.assigned_to = null
      } else {
        payload.visible_to_all = false
      }
```

- [ ] **Step 4: Add "All Members" to memberOptions**

Find (around line 244):
```js
  const memberOptions = [
    { value: '', label: 'Unassigned' },
    ...members.map(m => ({ value: m.user_id, label: m.profiles?.full_name || 'User' })),
  ]
```

Replace with:
```js
  const memberOptions = [
    { value: '', label: 'Unassigned' },
    { value: '__all__', label: '🌐 All Members' },
    ...members.map(m => ({ value: m.user_id, label: m.profiles?.full_name || 'User' })),
  ]
```

- [ ] **Step 5: Commit**

```bash
git add src/components/leads/LeadForm.jsx
git commit -m "feat: add All Members assignee option with visible_to_all flag"
```

---

## Task 9: LeadsTable — Show ALL Badge

**Files:**
- Modify: `src/components/leads/LeadsTable.jsx`

- [ ] **Step 1: Add ALL chip to the assignee cell**

Find `renderRow` (around line 94). Find the assignee cell:
```jsx
        <td className="px-3 py-2.5 text-[color:var(--color-text-muted)]">
          {assignee?.full_name || <span className="text-[color:var(--color-text-dim)]">—</span>}
        </td>
```

Replace with:
```jsx
        <td className="px-3 py-2.5 text-[color:var(--color-text-muted)]">
          {lead.visible_to_all
            ? <span className="inline-flex items-center px-1.5 h-[18px] rounded text-[10.5px] font-semibold bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)]">ALL</span>
            : assignee?.full_name || <span className="text-[color:var(--color-text-dim)]">—</span>
          }
        </td>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/leads/LeadsTable.jsx
git commit -m "feat: show ALL badge on leads visible to all members"
```

---

## Task 10: PersonalDashboard Component

**Files:**
- Create: `src/components/dashboard/PersonalDashboard.jsx`

- [ ] **Step 1: Create the component**

```jsx
// src/components/dashboard/PersonalDashboard.jsx
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Card from '../ui/Card'
import StatsCard from './StatsCard'
import FollowUpWidget from './FollowUpWidget'
import PipelineWidget from './PipelineWidget'
import { supabase } from '../../lib/supabase'
import { applyLeadVisibility } from '../../lib/leadVisibility'
import { todayISO } from '../../lib/calculations'

export default function PersonalDashboard({ workspaceId, userId, userRole }) {
  const [leads, setLeads] = useState([])
  const [myTasks, setMyTasks] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!workspaceId || !userId) return
    const today = todayISO()

    let q = supabase
      .from('leads')
      .select('id, address, city, status, assigned_to, arv, mao, offer_price, follow_up_date, created_at, visible_to_all, seller_name')
      .eq('workspace_id', workspaceId)
      .not('status', 'in', '("dead_lead","rejected_not_accepted","not_in_buy_box")')
    q = applyLeadVisibility(q, userId, userRole)
    q.then(({ data }) => setLeads(data || []))

    supabase
      .from('tasks')
      .select('id, title, due_date, status, project_id')
      .eq('workspace_id', workspaceId)
      .contains('assignee_ids', [userId])
      .neq('status', 'done')
      .order('due_date', { ascending: true })
      .then(({ data }) => {
        setMyTasks(data || [])
        setLoading(false)
      })
  }, [workspaceId, userId, userRole])

  const today = todayISO()
  const activeLeads = leads.filter(l => l.status !== 'sold')
  const offersSent  = leads.filter(l => ['offer_sent','negotiating','offer_accepted','sold'].includes(l.status))
  const accepted    = leads.filter(l => ['offer_accepted','sold'].includes(l.status))
  const closed      = leads.filter(l => l.status === 'sold')
  const followUps   = leads.filter(l => l.follow_up_date && l.follow_up_date <= today)
  const pipeline    = leads.filter(l => !['dead_lead','rejected_not_accepted','sold'].includes(l.status)).slice(0, 10)

  const overdueTasks = myTasks.filter(t => t.due_date && t.due_date < today)
  const todayTasks   = myTasks.filter(t => t.due_date === today)
  const upcoming     = myTasks.filter(t => t.due_date && t.due_date > today).slice(0, 5)

  if (loading) return null

  return (
    <div className="px-6 py-6 space-y-6 max-w-[1100px] w-full">
      {/* My Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] rounded-lg p-4">
        <StatsCard label="My Active Leads" value={activeLeads.length} />
        <StatsCard label="Offers Sent" value={offersSent.length} />
        <StatsCard label="Accepted" value={accepted.length} accent />
        <StatsCard label="Closed" value={closed.length} accent />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* My Pipeline */}
        <PipelineWidget leads={pipeline} workspaceId={workspaceId} />

        {/* My Follow-Ups */}
        <FollowUpWidget leads={followUps} workspaceId={workspaceId} />
      </div>

      {/* My Tasks */}
      {myTasks.length > 0 && (
        <Card title="My Tasks">
          <div className="space-y-3">
            {overdueTasks.length > 0 && (
              <div>
                <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[color:var(--color-danger-text)] mb-1.5">
                  Overdue — {overdueTasks.length}
                </div>
                <ul className="space-y-1">
                  {overdueTasks.map(t => (
                    <li key={t.id}>
                      <Link
                        to={`/w/${workspaceId}/tasks/${t.id}`}
                        className="flex items-center justify-between gap-2 py-1.5 px-2 rounded hover:bg-[color:var(--color-bg-elev-2)] transition-colors"
                      >
                        <span className="text-[13px] text-[color:var(--color-text)] truncate">{t.title}</span>
                        <span className="text-[11px] text-[color:var(--color-danger-text)] shrink-0">{t.due_date}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {todayTasks.length > 0 && (
              <div>
                <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[color:var(--color-warn-text)] mb-1.5">
                  Due Today — {todayTasks.length}
                </div>
                <ul className="space-y-1">
                  {todayTasks.map(t => (
                    <li key={t.id}>
                      <Link
                        to={`/w/${workspaceId}/tasks/${t.id}`}
                        className="flex items-center justify-between gap-2 py-1.5 px-2 rounded hover:bg-[color:var(--color-bg-elev-2)] transition-colors"
                      >
                        <span className="text-[13px] text-[color:var(--color-text)] truncate">{t.title}</span>
                        <span className="text-[11px] text-[color:var(--color-warn-text)] shrink-0">Today</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {upcoming.length > 0 && (
              <div>
                <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1.5">
                  Upcoming
                </div>
                <ul className="space-y-1">
                  {upcoming.map(t => (
                    <li key={t.id}>
                      <Link
                        to={`/w/${workspaceId}/tasks/${t.id}`}
                        className="flex items-center justify-between gap-2 py-1.5 px-2 rounded hover:bg-[color:var(--color-bg-elev-2)] transition-colors"
                      >
                        <span className="text-[13px] text-[color:var(--color-text)] truncate">{t.title}</span>
                        <span className="text-[11px] text-[color:var(--color-text-dim)] shrink-0">{t.due_date}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/dashboard/PersonalDashboard.jsx
git commit -m "feat: create PersonalDashboard for member/readonly role"
```

---

## Task 11: DashboardPage — Branch on Role

**Files:**
- Modify: `src/pages/DashboardPage.jsx`

- [ ] **Step 1: Add PersonalDashboard import**

At the top of `src/pages/DashboardPage.jsx`, add:
```js
import PersonalDashboard from '../components/dashboard/PersonalDashboard'
```

- [ ] **Step 2: Add userRole and user to outlet context destructure**

Find:
```js
  const { workspace, workspaceId, profile, members } = useOutletContext()
```

Replace with:
```js
  const { workspace, workspaceId, profile, members, user, userRole } = useOutletContext()
```

- [ ] **Step 3: Add early return for non-admin**

After the `useOutletContext()` line and before the existing `useState` declarations, add:

```js
  if (userRole !== 'admin') {
    return (
      <>
        <Topbar
          title="Dashboard"
          breadcrumbs={[{ label: workspace?.name }, { label: 'My Dashboard' }]}
        />
        <PersonalDashboard workspaceId={workspaceId} userId={user?.id} userRole={userRole} />
      </>
    )
  }
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/DashboardPage.jsx
git commit -m "feat: show personal dashboard for non-admin users"
```

---

## Task 12: Push and Deploy

- [ ] **Step 1: Push all commits**

```bash
git push
```

- [ ] **Step 2: Run Supabase migration if not done yet**

(See Task 1 — run the SQL in Supabase SQL Editor)

- [ ] **Step 3: Verify locally**

```
npx netlify dev
```

Open `http://localhost:8888` and test:

**As admin:**
- Dashboard shows team stats (existing view)
- Sidebar shows Tasks, Import, Settings, Quick Analysis
- Leads page shows all leads

**As member (create a test member in workspace_members with role='member'):**
- Dashboard shows Personal Dashboard with my stats
- Sidebar hides Tasks, Import, Settings, Quick Analysis
- Navigating to `/w/:id/tasks` redirects to Today
- Leads page shows only my leads + visible_to_all leads
- Creating a lead with "All Members" assignee sets visible_to_all=true and shows ALL badge in table
