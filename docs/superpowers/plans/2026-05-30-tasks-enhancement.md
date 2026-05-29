# Tasks Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-assignee support, all-leads property picker with search, additional task filters (status + created date), and a "My Tasks" section on the Today page.

**Architecture:** Supabase migration adds `assignee_ids UUID[]` to `tasks`; a new `SearchableSelect` component replaces plain selects for property picking; `TaskFilters` gains status + created-date dropdowns; `TodayPage` queries tasks by array containment and renders overdue/today groups.

**Tech Stack:** React 18, Supabase (PostgreSQL array ops with `.contains()`), Tailwind CSS v4 CSS custom properties, @dnd-kit (existing drag/drop).

---

## File Map

| File | Change |
|------|--------|
| Supabase SQL Editor | Run migration (manual step) |
| `src/components/ui/SearchableSelect.jsx` | Create — reusable searchable combobox |
| `src/pages/TasksPage.jsx` | Load all leads; add `status`+`created` filter keys and in-memory logic; fix `handleQuickAdd` to use `assignee_ids` |
| `src/components/tasks/TaskFilters.jsx` | Add status + created dropdowns; use SearchableSelect for project |
| `src/components/tasks/TaskDetailDrawer.jsx` | Multi-assignee chip list; SearchableSelect for property |
| `src/components/tasks/TaskColumn.jsx` | Pass `assignees` array instead of single `assignee` |
| `src/components/tasks/TaskBoard.jsx` | Same — pass `assignees` array in DragOverlay |
| `src/components/tasks/TaskCard.jsx` | Render up to 3 assignee avatar chips |
| `src/lib/taskHelpers.js` | Track `assignee_ids` diff instead of `assignee_id` |
| `src/pages/TodayPage.jsx` | Add "My Tasks" section (overdue + today) |

---

## Task 1: Supabase Migration

**Files:** Supabase SQL Editor (manual)

- [ ] **Step 1: Run migration in Supabase SQL Editor**

Go to Supabase → SQL Editor and run:

```sql
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assignee_ids UUID[] DEFAULT '{}';

UPDATE tasks
SET assignee_ids = ARRAY[assignee_id]
WHERE assignee_id IS NOT NULL
  AND (assignee_ids IS NULL OR assignee_ids = '{}');
```

Expected: "Success. N rows returned" (or similar).

- [ ] **Step 2: Verify**

Run this query to confirm:

```sql
SELECT id, assignee_id, assignee_ids FROM tasks LIMIT 10;
```

Every row that had `assignee_id` set should now also have `assignee_ids = '{<uuid>}'`.

---

## Task 2: SearchableSelect Component

**Files:**
- Create: `src/components/ui/SearchableSelect.jsx`

- [ ] **Step 1: Create the component**

```jsx
// src/components/ui/SearchableSelect.jsx
import { useState, useEffect, useRef } from 'react'

export default function SearchableSelect({ value, onChange, options, placeholder = 'Select…', disabled = false }) {
  const [open, setOpen]       = useState(false)
  const [query, setQuery]     = useState('')
  const containerRef          = useRef(null)

  const selected = options.find(o => o.value === value)

  const filtered = query
    ? options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
    : options

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  useEffect(() => {
    function onMouseDown(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  const triggerCls = 'w-full text-[13px] px-2 h-8 bg-[color:var(--color-bg)] border border-[color:var(--color-line)] rounded text-[color:var(--color-text)] focus:outline-none focus:border-[color:var(--color-accent)] cursor-pointer flex items-center justify-between gap-1 disabled:opacity-50'

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(v => !v)}
        className={triggerCls}
      >
        <span className={`truncate ${selected ? '' : 'text-[color:var(--color-text-dim)]'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <svg className="w-3 h-3 shrink-0 text-[color:var(--color-text-dim)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] rounded shadow-lg">
          <div className="p-1.5 border-b border-[color:var(--color-line)]">
            <input
              autoFocus
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search…"
              className="w-full text-[12px] px-2 h-7 bg-[color:var(--color-bg)] border border-[color:var(--color-line)] rounded text-[color:var(--color-text)] placeholder:text-[color:var(--color-text-dim)] focus:outline-none focus:border-[color:var(--color-accent)]"
            />
          </div>
          <div className="max-h-60 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-[12px] text-[color:var(--color-text-dim)]">No results</div>
            ) : filtered.map(o => (
              <button
                key={o.value}
                type="button"
                onClick={() => { onChange(o.value); setOpen(false) }}
                className={`w-full text-left px-3 py-1.5 text-[13px] hover:bg-[color:var(--color-bg-elev-2)] transition-colors ${o.value === value ? 'text-[color:var(--color-accent-text)] font-medium' : 'text-[color:var(--color-text)]'}`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/SearchableSelect.jsx
git commit -m "feat: add SearchableSelect combobox component"
```

---

## Task 3: TasksPage — Load All Leads + New Filter Keys

**Files:**
- Modify: `src/pages/TasksPage.jsx`

- [ ] **Step 1: Add `status` and `created` to `URL_FILTER_KEYS`**

Find line 14:
```js
const URL_FILTER_KEYS = ['project_id', 'assignee_id', 'due', 'priority', 'search']
```

Replace with:
```js
const URL_FILTER_KEYS = ['project_id', 'assignee_id', 'due', 'priority', 'search', 'status', 'created']
```

- [ ] **Step 2: Add `weekStart` helper**

Find the `endOfWeekISO` function (around line 26) and add `weekStartISO` after it:

```js
function weekStartISO() {
  const d = new Date()
  const day = d.getDay()
  const offset = day === 0 ? -6 : 1 - day  // Monday
  const start = new Date(d); start.setDate(d.getDate() + offset)
  return start.toISOString().slice(0, 10)
}
```

- [ ] **Step 3: Remove PROJECT_STATUSES filter from leads query**

Find (around line 100):
```js
  useEffect(() => {
    if (!workspaceId) return
    supabase
      .from('leads')
      .select('id, address, city, status')
      .eq('workspace_id', workspaceId)
      .in('status', PROJECT_STATUSES)
      .order('address', { ascending: true })
      .then(({ data }) => setProjects(data || []))
  }, [workspaceId])
```

Replace with (remove the `.in('status', PROJECT_STATUSES)` line):
```js
  useEffect(() => {
    if (!workspaceId) return
    supabase
      .from('leads')
      .select('id, address, city, status')
      .eq('workspace_id', workspaceId)
      .order('address', { ascending: true })
      .then(({ data }) => setProjects(data || []))
  }, [workspaceId])
```

- [ ] **Step 4: Remove the PROJECT_STATUSES import**

Find at top of file:
```js
import { PROJECT_STATUSES, TASK_STATUSES } from '../lib/constants'
```

Replace with:
```js
import { TASK_STATUSES } from '../lib/constants'
```

- [ ] **Step 5: Update in-memory filter logic**

Find the `filteredTasks` useMemo (around line 121). Replace the entire useMemo body filter with:

```js
  const filteredTasks = useMemo(() => {
    const today = todayISO()
    const weekEnd = endOfWeekISO()
    const weekStart = weekStartISO()
    return tasks.filter(t => {
      if (filters.project_id === '__none__') {
        if (t.project_id) return false
      } else if (filters.project_id && t.project_id !== filters.project_id) return false

      if (filters.assignee_id === 'me') {
        if (!(t.assignee_ids || []).includes(user.id)) return false
      } else if (filters.assignee_id === 'unassigned') {
        if ((t.assignee_ids || []).length > 0) return false
      } else if (filters.assignee_id) {
        if (!(t.assignee_ids || []).includes(filters.assignee_id)) return false
      }

      if (filters.status && t.status !== filters.status) return false

      if (filters.priority && t.priority !== filters.priority) return false

      if (filters.due === 'overdue') {
        if (!t.due_date || t.due_date >= today || t.status === 'done') return false
      } else if (filters.due === 'today') {
        if (t.due_date !== today) return false
      } else if (filters.due === 'this_week') {
        if (!t.due_date || t.due_date < today || t.due_date > weekEnd) return false
      } else if (filters.due === 'none') {
        if (t.due_date) return false
      }

      if (filters.created) {
        const created = t.created_at?.slice(0, 10)
        if (filters.created === 'today' && created !== today) return false
        if (filters.created === 'this_week' && (created < weekStart || created > today)) return false
        if (filters.created === 'this_month' && created?.slice(0, 7) !== today.slice(0, 7)) return false
      }

      if (filters.search) {
        const q = filters.search.toLowerCase()
        const hay = `${t.title || ''} ${t.description || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [tasks, filters, user.id])
```

- [ ] **Step 6: Fix handleQuickAdd to use assignee_ids**

Find `handleQuickAdd` (around line 157):
```js
      assignee_id: filters.assignee_id === 'me' ? user.id : null,
```

Replace that line with:
```js
      assignee_ids: filters.assignee_id === 'me' ? [user.id] : (filters.assignee_id && filters.assignee_id !== 'unassigned' ? [filters.assignee_id] : []),
```

- [ ] **Step 7: Commit**

```bash
git add src/pages/TasksPage.jsx
git commit -m "feat: load all leads for tasks, add status+created filters"
```

---

## Task 4: TaskFilters — New Dropdowns + SearchableSelect for Project

**Files:**
- Modify: `src/components/tasks/TaskFilters.jsx`

- [ ] **Step 1: Replace the entire file**

```jsx
// src/components/tasks/TaskFilters.jsx
import { TASK_PRIORITIES, TASK_STATUSES } from '../../lib/constants'
import SearchableSelect from '../ui/SearchableSelect'

export default function TaskFilters({ filters, onChange, members, projects, currentUserId }) {
  const set = (k, v) => onChange({ ...filters, [k]: v || undefined })

  const activeChips = []
  if (filters.project_id) {
    const p = projects.find(x => x.id === filters.project_id)
    activeChips.push({ key: 'project_id', label: `Project: ${p?.address || '…'}` })
  }
  if (filters.assignee_id === 'me') activeChips.push({ key: 'assignee_id', label: 'Mine' })
  else if (filters.assignee_id === 'unassigned') activeChips.push({ key: 'assignee_id', label: 'Unassigned' })
  else if (filters.assignee_id) {
    const m = members.find(x => x.user_id === filters.assignee_id)
    activeChips.push({ key: 'assignee_id', label: `Assignee: ${m?.profiles?.full_name || '…'}` })
  }
  if (filters.status) activeChips.push({ key: 'status', label: `Status: ${TASK_STATUSES.find(s => s.value === filters.status)?.label || filters.status}` })
  if (filters.due) activeChips.push({ key: 'due', label: `Due: ${filters.due.replace('_',' ')}` })
  if (filters.priority) activeChips.push({ key: 'priority', label: `Priority: ${filters.priority}` })
  if (filters.created) activeChips.push({ key: 'created', label: `Created: ${filters.created.replace('_',' ')}` })
  if (filters.search) activeChips.push({ key: 'search', label: `"${filters.search}"` })

  const selectCls = 'h-7 px-2 text-[12px] bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] rounded text-[color:var(--color-text)] focus:outline-none focus:border-[color:var(--color-accent)] cursor-pointer'

  const projectOptions = [
    { value: '', label: 'All Projects' },
    { value: '__none__', label: '— General (no project) —' },
    ...projects.map(p => ({ value: p.id, label: p.address || '(no address)' })),
  ]

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="w-48">
        <SearchableSelect
          value={filters.project_id || ''}
          onChange={v => set('project_id', v)}
          options={projectOptions}
          placeholder="All Projects"
        />
      </div>

      <select value={filters.assignee_id || ''} onChange={e => set('assignee_id', e.target.value)} className={selectCls}>
        <option value="">All Assignees</option>
        <option value="me">👤 Mine</option>
        <option value="unassigned">Unassigned</option>
        {members.map(m => (
          <option key={m.user_id} value={m.user_id}>{m.profiles?.full_name || 'Member'}</option>
        ))}
      </select>

      <select value={filters.status || ''} onChange={e => set('status', e.target.value)} className={selectCls}>
        <option value="">All Statuses</option>
        {TASK_STATUSES.map(s => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>

      <select value={filters.due || ''} onChange={e => set('due', e.target.value)} className={selectCls}>
        <option value="">Any Due</option>
        <option value="overdue">Overdue</option>
        <option value="today">Today</option>
        <option value="this_week">This week</option>
        <option value="none">No date</option>
      </select>

      <select value={filters.priority || ''} onChange={e => set('priority', e.target.value)} className={selectCls}>
        <option value="">Any Priority</option>
        {TASK_PRIORITIES.map(p => (
          <option key={p.value} value={p.value}>{p.label}</option>
        ))}
      </select>

      <select value={filters.created || ''} onChange={e => set('created', e.target.value)} className={selectCls}>
        <option value="">Any Time</option>
        <option value="today">Created Today</option>
        <option value="this_week">Created This Week</option>
        <option value="this_month">Created This Month</option>
      </select>

      <input
        type="search"
        value={filters.search || ''}
        onChange={e => set('search', e.target.value)}
        placeholder="Search tasks…"
        className="h-7 px-2 text-[12px] bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] rounded text-[color:var(--color-text)] placeholder:text-[color:var(--color-text-faint)] focus:outline-none focus:border-[color:var(--color-accent)] w-40"
      />

      {activeChips.length > 0 && (
        <>
          <span className="text-[color:var(--color-text-dim)]">·</span>
          {activeChips.map(chip => (
            <button
              key={chip.key}
              onClick={() => set(chip.key, '')}
              className="inline-flex items-center gap-1 px-2 h-6 text-[11px] rounded-full bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)] hover:opacity-80"
            >
              {chip.label} <span className="opacity-70">✕</span>
            </button>
          ))}
          <button
            onClick={() => onChange({})}
            className="text-[11px] px-2 h-6 rounded text-[color:var(--color-text-muted)] hover:bg-[color:var(--color-bg-elev-2)]"
          >
            Clear all
          </button>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/tasks/TaskFilters.jsx
git commit -m "feat: add status+created filters, searchable project picker"
```

---

## Task 5: TaskDetailDrawer — Multi-Assignee + SearchableSelect Property

**Files:**
- Modify: `src/components/tasks/TaskDetailDrawer.jsx`

- [ ] **Step 1: Add SearchableSelect import at top**

Find:
```js
import { TASK_STATUSES, TASK_PRIORITIES } from '../../lib/constants'
```

Replace with:
```js
import { TASK_STATUSES, TASK_PRIORITIES } from '../../lib/constants'
import SearchableSelect from '../ui/SearchableSelect'
```

- [ ] **Step 2: Replace the Assignee field (single select → multi-chip)**

Find the Assignee block (around line 132–142):
```jsx
              <div>
                <label className="text-[10.5px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)]">Assignee</label>
                <select
                  value={task.assignee_id || ''}
                  disabled={!canEdit}
                  onChange={e => patch({ assignee_id: e.target.value || null })}
                  className={inputCls + ' mt-1'}
                >
                  <option value="">Unassigned</option>
                  {members.map(m => <option key={m.user_id} value={m.user_id}>{m.profiles?.full_name || 'Member'}</option>)}
                </select>
              </div>
```

Replace with:
```jsx
              <div className="col-span-2">
                <label className="text-[10.5px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)]">Assignees</label>
                <div className="mt-1 flex flex-wrap gap-1 min-h-[32px] p-1.5 bg-[color:var(--color-bg)] border border-[color:var(--color-line)] rounded">
                  {(task.assignee_ids || []).map(uid => {
                    const m = members.find(x => x.user_id === uid)
                    const name = m?.profiles?.full_name || 'Member'
                    return (
                      <span key={uid} className="inline-flex items-center gap-1 px-2 h-6 text-[11px] rounded-full bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)]">
                        {name}
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => patch({ assignee_ids: (task.assignee_ids || []).filter(id => id !== uid) })}
                            className="opacity-60 hover:opacity-100 ml-0.5"
                          >
                            ✕
                          </button>
                        )}
                      </span>
                    )
                  })}
                  {canEdit && (
                    <select
                      value=""
                      onChange={e => {
                        const uid = e.target.value
                        if (!uid || (task.assignee_ids || []).includes(uid)) return
                        patch({ assignee_ids: [...(task.assignee_ids || []), uid] })
                      }}
                      className="h-6 px-1 text-[11px] bg-transparent border-none text-[color:var(--color-text-dim)] focus:outline-none cursor-pointer"
                    >
                      <option value="">+ Add assignee</option>
                      {members
                        .filter(m => !(task.assignee_ids || []).includes(m.user_id))
                        .map(m => <option key={m.user_id} value={m.user_id}>{m.profiles?.full_name || 'Member'}</option>)
                      }
                    </select>
                  )}
                </div>
              </div>
```

- [ ] **Step 3: Replace the Project field with SearchableSelect**

Find the Project block (around line 155–168):
```jsx
              <div className="col-span-2">
                <label className="text-[10.5px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)]">Project</label>
                <select
                  value={task.project_id || ''}
                  disabled={!canEdit}
                  onChange={e => patch({ project_id: e.target.value || null })}
                  className={inputCls + ' mt-1'}
                >
                  <option value="">— No project —</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.address || '(no address)'}</option>
                  ))}
                </select>
              </div>
```

Replace with:
```jsx
              <div className="col-span-2">
                <label className="text-[10.5px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)]">Property</label>
                <div className="mt-1">
                  <SearchableSelect
                    value={task.project_id || ''}
                    onChange={v => patch({ project_id: v || null })}
                    disabled={!canEdit}
                    options={[
                      { value: '', label: 'General (no property)' },
                      ...projects.map(p => ({ value: p.id, label: p.address || '(no address)' })),
                    ]}
                    placeholder="General (no property)"
                  />
                </div>
              </div>
```

- [ ] **Step 4: Commit**

```bash
git add src/components/tasks/TaskDetailDrawer.jsx
git commit -m "feat: multi-assignee chips and searchable property picker in task drawer"
```

---

## Task 6: TaskCard + TaskColumn + TaskBoard — Multi-Assignee Avatars

**Files:**
- Modify: `src/components/tasks/TaskCard.jsx`
- Modify: `src/components/tasks/TaskColumn.jsx`
- Modify: `src/components/tasks/TaskBoard.jsx`

- [ ] **Step 1: Update TaskCard to accept `assignees` array**

Replace the entire `TaskCard.jsx`:

```jsx
// src/components/tasks/TaskCard.jsx
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { TASK_PRIORITY_MAP } from '../../lib/constants'

function dueLabel(d) {
  if (!d) return null
  const today = new Date(); today.setHours(0,0,0,0)
  const due = new Date(d + 'T00:00:00')
  const diff = Math.round((due - today) / 86400000)
  if (diff < 0) return { text: `Overdue ${Math.abs(diff)}d`, tone: 'danger' }
  if (diff === 0) return { text: 'Today', tone: 'warn' }
  if (diff === 1) return { text: 'Tomorrow', tone: 'warn' }
  if (diff < 7) return { text: `${diff}d`, tone: 'accent' }
  return { text: due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), tone: 'neutral' }
}

const TONE_DUE = {
  danger:  'bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-text)]',
  warn:    'bg-[color:var(--color-warn-soft)] text-[color:var(--color-warn-text)]',
  accent:  'bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)]',
  neutral: 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-muted)]',
}

// assignees: array of profile objects { full_name, ... }
export default function TaskCard({ task, project, assignees = [], onOpen, activityCount = 0, attachmentCount = 0 }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  const priority = TASK_PRIORITY_MAP[task.priority]
  const due = dueLabel(task.due_date)
  const isDone = task.status === 'done'
  const visibleAssignees = assignees.slice(0, 3)
  const extraCount = assignees.length - visibleAssignees.length

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onOpen?.(task.id)}
      className={`group bg-[color:var(--color-bg)] border border-[color:var(--color-line)] rounded-md p-2.5 cursor-pointer hover:border-[color:var(--color-accent)] hover:shadow-[0_2px_8px_oklch(0_0_0/0.25)] transition-all ${isDone ? 'opacity-70' : ''}`}
    >
      <div className="flex items-start gap-1.5">
        {priority && (
          <span
            title={`${priority.label} priority`}
            className="mt-1 w-2 h-2 rounded-full shrink-0"
            style={{ background: priority.color }}
          />
        )}
        <div className={`text-[13px] leading-snug font-medium text-[color:var(--color-text)] line-clamp-2 flex-1 ${isDone ? 'line-through text-[color:var(--color-text-muted)]' : ''}`}>
          {task.title}
        </div>
      </div>

      {project && (
        <div className="mt-1.5 inline-flex items-center gap-1 px-1.5 h-[18px] rounded text-[10.5px] font-medium bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-muted)] max-w-full">
          <span>🏠</span>
          <span className="truncate">{project.address}</span>
        </div>
      )}

      <div className="mt-2 flex items-center justify-between gap-1.5 text-[10.5px] text-[color:var(--color-text-dim)]">
        <div className="flex items-center gap-1.5 min-w-0">
          {due && (
            <span className={`inline-flex items-center px-1.5 h-[18px] rounded ${TONE_DUE[due.tone]}`}>
              {due.text}
            </span>
          )}
          {activityCount > 0 && (
            <span className="inline-flex items-center gap-0.5">
              💬 {activityCount}
            </span>
          )}
          {attachmentCount > 0 && (
            <span className="inline-flex items-center gap-0.5">
              📎 {attachmentCount}
            </span>
          )}
        </div>

        {assignees.length === 0 ? (
          <span title="Unassigned" className="w-5 h-5 rounded-full bg-[color:var(--color-bg-elev-2)] border border-dashed border-[color:var(--color-line)] inline-flex items-center justify-center text-[color:var(--color-text-dim)] shrink-0">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a8 8 0 0 1 16 0v1"/></svg>
          </span>
        ) : (
          <div className="flex items-center shrink-0" style={{ gap: '-4px' }}>
            <div className="flex -space-x-1">
              {visibleAssignees.map((a, i) => (
                <span
                  key={i}
                  title={a?.full_name}
                  className="w-5 h-5 rounded-full bg-[color:var(--color-accent)] text-white inline-flex items-center justify-center text-[10px] font-semibold ring-1 ring-[color:var(--color-bg)]"
                >
                  {(a?.full_name || '?').charAt(0).toUpperCase()}
                </span>
              ))}
            </div>
            {extraCount > 0 && (
              <span className="w-5 h-5 rounded-full bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-muted)] inline-flex items-center justify-center text-[9px] font-semibold ring-1 ring-[color:var(--color-bg)] -ml-1">
                +{extraCount}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Update TaskColumn to pass assignees array**

In `TaskColumn.jsx`, find the `<TaskCard>` render (around line 33):
```jsx
            <TaskCard
              key={task.id}
              task={task}
              project={projectMap[task.project_id]}
              assignee={memberMap[task.assignee_id]}
              onOpen={onOpenTask}
              activityCount={activityCounts[task.id] || 0}
              attachmentCount={attachmentCounts[task.id] || 0}
            />
```

Replace with:
```jsx
            <TaskCard
              key={task.id}
              task={task}
              project={projectMap[task.project_id]}
              assignees={(task.assignee_ids || []).map(uid => memberMap[uid]).filter(Boolean)}
              onOpen={onOpenTask}
              activityCount={activityCounts[task.id] || 0}
              attachmentCount={attachmentCounts[task.id] || 0}
            />
```

- [ ] **Step 3: Update TaskBoard DragOverlay to pass assignees array**

In `TaskBoard.jsx`, find (around line 92):
```jsx
            <TaskCard
              task={activeTask}
              project={projectMap[activeTask.project_id]}
              assignee={memberMap[activeTask.assignee_id]}
              activityCount={activityCounts[activeTask.id] || 0}
              attachmentCount={attachmentCounts[activeTask.id] || 0}
            />
```

Replace with:
```jsx
            <TaskCard
              task={activeTask}
              project={projectMap[activeTask.project_id]}
              assignees={(activeTask.assignee_ids || []).map(uid => memberMap[uid]).filter(Boolean)}
              activityCount={activityCounts[activeTask.id] || 0}
              attachmentCount={attachmentCounts[activeTask.id] || 0}
            />
```

- [ ] **Step 4: Commit**

```bash
git add src/components/tasks/TaskCard.jsx src/components/tasks/TaskColumn.jsx src/components/tasks/TaskBoard.jsx
git commit -m "feat: show multi-assignee avatar chips on task cards"
```

---

## Task 7: taskHelpers — Track assignee_ids Diff

**Files:**
- Modify: `src/lib/taskHelpers.js`

- [ ] **Step 1: Update TRACKED and describeChange**

Find (around line 41):
```js
const TRACKED = ['status', 'assignee_id', 'due_date', 'priority', 'project_id', 'title']
```

Replace with:
```js
const TRACKED = ['status', 'assignee_ids', 'due_date', 'priority', 'project_id', 'title']
```

Find the `assignee_id` case in `describeChange` (around line 47):
```js
    case 'assignee_id': {
      const a = memberMap[oldVal]?.full_name || (oldVal ? 'someone' : 'Unassigned')
      const b = memberMap[newVal]?.full_name || (newVal ? 'someone' : 'Unassigned')
      return `Assignee: ${a} → ${b}`
    }
```

Replace with:
```js
    case 'assignee_ids': {
      const toNames = (ids) => {
        if (!ids || ids.length === 0) return 'Unassigned'
        return ids.map(id => memberMap[id]?.full_name || 'someone').join(', ')
      }
      return `Assignees: ${toNames(oldVal)} → ${toNames(newVal)}`
    }
```

Find in `logTaskChanges` (around line 72):
```js
    const o = before?.[field] ?? null
    const n = after?.[field] ?? null
    if (String(o) !== String(n)) {
```

This already works for arrays since `String([])` is `''` and `String(['a','b'])` is `'a,b'` — no change needed.

- [ ] **Step 2: Commit**

```bash
git add src/lib/taskHelpers.js
git commit -m "feat: track assignee_ids changes in task activity log"
```

---

## Task 8: TodayPage — My Tasks Section

**Files:**
- Modify: `src/pages/TodayPage.jsx`

- [ ] **Step 1: Add tasks query state and load**

Find the existing state declarations (around line 44):
```js
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
```

Replace with:
```js
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [myTasks, setMyTasks] = useState([])
  const [taskProjects, setTaskProjects] = useState([])
```

- [ ] **Step 2: Add user to destructure from useOutletContext**

Find:
```js
  const { workspace, workspaceId, members } = useOutletContext()
```

Replace with:
```js
  const { workspace, workspaceId, members, user } = useOutletContext()
```

- [ ] **Step 3: Add tasks + projects query in useEffect**

Find the existing useEffect (around line 48):
```js
  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false
    supabase
      .from('leads')
      ...
```

After that useEffect's closing `}, [workspaceId])`, add:

```js
  useEffect(() => {
    if (!workspaceId || !user?.id) return
    const today = new Date().toISOString().slice(0, 10)
    supabase
      .from('tasks')
      .select('id, title, due_date, status, assignee_ids, project_id')
      .eq('workspace_id', workspaceId)
      .contains('assignee_ids', [user.id])
      .neq('status', 'done')
      .lte('due_date', today)
      .order('due_date', { ascending: true })
      .then(({ data }) => setMyTasks(data || []))

    supabase
      .from('leads')
      .select('id, address')
      .eq('workspace_id', workspaceId)
      .then(({ data }) => setTaskProjects(data || []))
  }, [workspaceId, user?.id])
```

- [ ] **Step 4: Add markTaskDone handler**

After the `markHandled` function (around line 91), add:

```js
  const markTaskDone = async (e, taskId) => {
    e.preventDefault()
    e.stopPropagation()
    const { error } = await supabase.from('tasks').update({ status: 'done' }).eq('id', taskId)
    if (!error) setMyTasks(prev => prev.filter(t => t.id !== taskId))
  }
```

- [ ] **Step 5: Add taskProjectMap**

Find:
```js
  const memberMap = Object.fromEntries((members || []).map(m => [m.user_id, m.profiles]))
```

After that line add:
```js
  const taskProjectMap = Object.fromEntries(taskProjects.map(p => [p.id, p]))
  const today = new Date().toISOString().slice(0, 10)
  const overdueTasks = myTasks.filter(t => t.due_date < today)
  const todayTasks   = myTasks.filter(t => t.due_date === today)
```

- [ ] **Step 6: Add My Tasks section in JSX**

Find the closing `</div>` of the main content div (just before the final `</>`). The last JSX in the return looks like:

```jsx
      </div>
    </>
  )
```

Insert the My Tasks section before the closing `</div>`:

```jsx
        {(overdueTasks.length > 0 || todayTasks.length > 0) && (
          <section className="bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] rounded-lg overflow-hidden">
            <header className="px-4 py-3 border-b border-[color:var(--color-line)]">
              <h3 className="text-[14px] font-semibold text-[color:var(--color-text)]">My Tasks</h3>
              <p className="text-[12px] text-[color:var(--color-text-muted)] mt-0.5">Tasks assigned to you that are due today or overdue</p>
            </header>

            {overdueTasks.length > 0 && (
              <div>
                <div className="px-4 py-1.5 bg-[color:var(--color-danger-soft)] border-b border-[color:var(--color-line)]">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--color-danger-text)]">Overdue — {overdueTasks.length}</span>
                </div>
                <ul className="divide-y divide-[color:var(--color-line)]">
                  {overdueTasks.map(task => (
                    <li key={task.id}>
                      <a
                        href={`/w/${workspaceId}/tasks/${task.id}`}
                        className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-[color:var(--color-bg-elev-2)] transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-medium text-[color:var(--color-text)] truncate">{task.title}</div>
                          {task.project_id && taskProjectMap[task.project_id] && (
                            <div className="text-[11.5px] text-[color:var(--color-text-dim)] mt-0.5">🏠 {taskProjectMap[task.project_id].address}</div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[11px] text-[color:var(--color-danger-text)]">{task.due_date}</span>
                          <button
                            type="button"
                            onClick={(e) => markTaskDone(e, task.id)}
                            className="text-[11px] px-2 py-0.5 rounded bg-[color:var(--color-bg-elev-2)] hover:bg-[color:var(--color-success-soft)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-success-text)] border border-[color:var(--color-line)] transition-colors"
                          >
                            ✓ Done
                          </button>
                        </div>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {todayTasks.length > 0 && (
              <div>
                <div className="px-4 py-1.5 bg-[color:var(--color-warn-soft)] border-b border-[color:var(--color-line)] border-t border-t-[color:var(--color-line)]">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--color-warn-text)]">Due Today — {todayTasks.length}</span>
                </div>
                <ul className="divide-y divide-[color:var(--color-line)]">
                  {todayTasks.map(task => (
                    <li key={task.id}>
                      <a
                        href={`/w/${workspaceId}/tasks/${task.id}`}
                        className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-[color:var(--color-bg-elev-2)] transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-medium text-[color:var(--color-text)] truncate">{task.title}</div>
                          {task.project_id && taskProjectMap[task.project_id] && (
                            <div className="text-[11.5px] text-[color:var(--color-text-dim)] mt-0.5">🏠 {taskProjectMap[task.project_id].address}</div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[11px] text-[color:var(--color-warn-text)]">Today</span>
                          <button
                            type="button"
                            onClick={(e) => markTaskDone(e, task.id)}
                            className="text-[11px] px-2 py-0.5 rounded bg-[color:var(--color-bg-elev-2)] hover:bg-[color:var(--color-success-soft)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-success-text)] border border-[color:var(--color-line)] transition-colors"
                          >
                            ✓ Done
                          </button>
                        </div>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}
```

- [ ] **Step 7: Commit**

```bash
git add src/pages/TodayPage.jsx
git commit -m "feat: add My Tasks section to Today page (overdue + due today)"
```

---

## Task 9: Push and Deploy

- [ ] **Step 1: Push all commits**

```bash
git push
```

- [ ] **Step 2: Run Supabase migration if not done yet**

(See Task 1 — run the SQL in Supabase SQL Editor)

- [ ] **Step 3: Verify locally**

```bash
npx netlify dev
```

Open `http://localhost:8888` and verify:
- Tasks page: project dropdown is searchable with all leads; status + created filters appear
- Task drawer: Assignees section shows chip list with + Add assignee; Property is a searchable combobox
- Task cards: multiple assignees show stacked avatar initials
- Today page: "My Tasks" section appears when you have tasks due today/overdue assigned to you

- [ ] **Step 4: Final push if any fixes needed**

```bash
git add -A
git commit -m "fix: post-deploy corrections"
git push
```
