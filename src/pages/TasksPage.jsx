import { useEffect, useMemo, useState } from 'react'
import { useOutletContext, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Topbar from '../components/Topbar'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import EmptyState from '../components/ui/EmptyState'
import Button from '../components/ui/Button'
import TaskBoard from '../components/tasks/TaskBoard'
import TaskFilters from '../components/tasks/TaskFilters'
import TaskDetailDrawer from '../components/tasks/TaskDetailDrawer'
import { supabase } from '../lib/supabase'
import { TASK_STATUSES } from '../lib/constants'
import { nextPositionForColumn, positionBetween, logTaskActivity } from '../lib/taskHelpers'

const URL_FILTER_KEYS = ['project_id', 'assignee_id', 'due', 'priority', 'search', 'status', 'created']

function filtersFromParams(params) {
  const f = {}
  for (const k of URL_FILTER_KEYS) {
    const v = params.get(k)
    if (v) f[k] = v
  }
  return f
}

function todayISO() { return new Date().toISOString().slice(0, 10) }
function weekStartISO() {
  const d = new Date()
  const day = d.getDay()
  const offset = day === 0 ? -6 : 1 - day
  const start = new Date(d); start.setDate(d.getDate() + offset)
  return start.toISOString().slice(0, 10)
}
function endOfWeekISO() {
  const d = new Date()
  const day = d.getDay() // 0 Sun..6 Sat
  const offset = day === 0 ? 0 : (7 - day)
  const end = new Date(d); end.setDate(d.getDate() + offset)
  return end.toISOString().slice(0, 10)
}

export default function TasksPage() {
  const { workspace, workspaceId, members, user, userRole } = useOutletContext()
  const { taskId: paramTaskId } = useParams()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [tasks, setTasks] = useState([])
  const [projects, setProjects] = useState([])
  const [counts, setCounts] = useState({ activity: {}, attachments: {} })
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState(() => filtersFromParams(searchParams))

  const canEdit = userRole !== 'readonly'

  // Persist filters to URL
  useEffect(() => {
    const next = new URLSearchParams()
    for (const k of URL_FILTER_KEYS) {
      const v = filters[k]
      if (v) next.set(k, String(v))
    }
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters])

  // Sync filter state from URL on back/forward
  useEffect(() => {
    setFilters(filtersFromParams(searchParams))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.toString()])

  // Load tasks
  const loadTasks = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('tasks')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('position', { ascending: true })
    setTasks(data || [])
    setLoading(false)
    // Counts (best-effort, non-blocking)
    if (data && data.length) {
      const ids = data.map(t => t.id)
      const [actR, attR] = await Promise.all([
        supabase.from('task_activities').select('task_id').in('task_id', ids),
        supabase.from('task_attachments').select('task_id').in('task_id', ids),
      ])
      const act = {}, att = {}
      for (const r of actR.data || []) act[r.task_id] = (act[r.task_id] || 0) + 1
      for (const r of attR.data || []) att[r.task_id] = (att[r.task_id] || 0) + 1
      setCounts({ activity: act, attachments: att })
    } else {
      setCounts({ activity: {}, attachments: {} })
    }
  }

  useEffect(() => {
    if (!workspaceId) return
    loadTasks()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  // Load projects (leads with project-eligible status)
  useEffect(() => {
    if (!workspaceId) return
    supabase
      .from('leads')
      .select('id, address, city, status')
      .eq('workspace_id', workspaceId)
      .order('address', { ascending: true })
      .then(({ data }) => setProjects(data || []))
  }, [workspaceId])

  const memberMap = useMemo(
    () => Object.fromEntries((members || []).map(m => [m.user_id, m.profiles])),
    [members]
  )
  const projectMap = useMemo(
    () => Object.fromEntries(projects.map(p => [p.id, p])),
    [projects]
  )

  // Apply filters in memory (board is workspace-scoped & usually small enough)
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

  // Quick-add
  const handleQuickAdd = async (status, title) => {
    const pos = nextPositionForColumn(tasks, status)
    const insert = {
      workspace_id: workspaceId,
      title,
      status,
      priority: 'medium',
      position: pos,
      created_by: user.id,
      project_id: (filters.project_id && filters.project_id !== '__none__') ? filters.project_id : null,
      assignee_ids: filters.assignee_id === 'me' ? [user.id] : (filters.assignee_id && filters.assignee_id !== 'unassigned' ? [filters.assignee_id] : []),
    }
    const { data, error } = await supabase.from('tasks').insert(insert).select('*').single()
    if (error) { alert(error.message); return }
    setTasks(prev => [...prev, data])
    await logTaskActivity(data.id, user.id, 'activity', 'Task created')
  }

  // Drag-move
  const handleMove = async (taskId, toStatus, targetListWithoutDragged, targetIdx, fromStatus) => {
    const newPosition = positionBetween(targetListWithoutDragged, targetIdx)
    const before = tasks.find(t => t.id === taskId)
    if (!before) return
    if (before.status === toStatus && before.position === newPosition) return

    // Optimistic
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: toStatus, position: newPosition } : t))

    const patch = { status: toStatus, position: newPosition }
    const { data, error } = await supabase.from('tasks').update(patch).eq('id', taskId).select('*').single()
    if (error) {
      alert(error.message)
      setTasks(prev => prev.map(t => t.id === taskId ? before : t))
      return
    }
    if (fromStatus !== toStatus) {
      const sLabel = TASK_STATUSES.find(s => s.value === toStatus)?.label || toStatus
      const fLabel = TASK_STATUSES.find(s => s.value === fromStatus)?.label || fromStatus
      await logTaskActivity(taskId, user.id, 'activity', `Status: ${fLabel} → ${sLabel}`)
    }
    setTasks(prev => prev.map(t => t.id === taskId ? data : t))
  }

  // Drawer open/close
  const openTask = (id) => navigate(`/w/${workspaceId}/tasks/${id}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`)
  const closeDrawer = () => navigate(`/w/${workspaceId}/tasks${searchParams.toString() ? `?${searchParams.toString()}` : ''}`)

  const onTaskChanged = (updated) => {
    setTasks(prev => prev.map(t => t.id === updated.id ? updated : t))
  }
  const onTaskDeleted = (id) => {
    setTasks(prev => prev.filter(t => t.id !== id))
  }

  const createBlankTask = async () => {
    const pos = nextPositionForColumn(tasks, 'todo')
    const { data, error } = await supabase.from('tasks').insert({
      workspace_id: workspaceId,
      title: 'New task',
      status: 'todo',
      priority: 'medium',
      position: pos,
      created_by: user.id,
    }).select('*').single()
    if (error) { alert(error.message); return }
    setTasks(prev => [...prev, data])
    await logTaskActivity(data.id, user.id, 'activity', 'Task created')
    navigate(`/w/${workspaceId}/tasks/${data.id}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`)
  }

  return (
    <>
      <Topbar
        title="Tasks"
        breadcrumbs={[{ label: workspace.name }, { label: 'Tasks' }]}
        actions={canEdit && <Button onClick={createBlankTask}>+ New Task</Button>}
      />

      <div className="px-6 py-4 flex flex-col gap-3 flex-1 min-w-0">
        <TaskFilters
          filters={filters}
          onChange={setFilters}
          members={members || []}
          projects={projects}
          currentUserId={user.id}
        />

        {loading ? (
          <LoadingSpinner label="Loading tasks…" />
        ) : tasks.length === 0 ? (
          <EmptyState
            icon="✓"
            title="No tasks yet"
            description="Create tasks to track operational work on your projects — contractors, permits, marketing, anything."
            action={canEdit && <Button onClick={createBlankTask}>+ Create your first task</Button>}
          />
        ) : (
          <TaskBoard
            tasks={filteredTasks}
            memberMap={memberMap}
            projectMap={projectMap}
            activityCounts={counts.activity}
            attachmentCounts={counts.attachments}
            onOpenTask={openTask}
            onQuickAdd={handleQuickAdd}
            onMove={handleMove}
          />
        )}

        <div className="text-[11.5px] text-[color:var(--color-text-dim)] tabular-nums">
          {filteredTasks.length} of {tasks.length} task{tasks.length === 1 ? '' : 's'}
        </div>
      </div>

      <TaskDetailDrawer
        open={!!paramTaskId}
        taskId={paramTaskId}
        onClose={closeDrawer}
        onChanged={onTaskChanged}
        onDeleted={onTaskDeleted}
        workspaceId={workspaceId}
        userId={user.id}
        userRole={userRole}
        members={members || []}
        projects={projects}
        memberMap={memberMap}
        projectMap={projectMap}
      />
    </>
  )
}
