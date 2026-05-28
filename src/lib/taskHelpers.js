import { supabase } from './supabase'
import { TASK_STATUS_MAP } from './constants'

// Position spacing — leaves room to insert between two cards as (a+b)/2.
const POS_GAP = 1024

// Append a task to the bottom of a column.
export function nextPositionForColumn(tasks, status) {
  const inCol = tasks.filter(t => t.status === status)
  if (inCol.length === 0) return POS_GAP
  return Math.max(...inCol.map(t => t.position || 0)) + POS_GAP
}

// Compute new position when dropping `task` at index `targetIdx` in `targetStatus`.
// `targetTasks` is the ordered list of tasks already in the target column AFTER removing the dragged task.
export function positionBetween(targetTasks, targetIdx) {
  const prev = targetTasks[targetIdx - 1]
  const next = targetTasks[targetIdx]
  if (!prev && !next) return POS_GAP
  if (!prev) return (next.position || POS_GAP) - POS_GAP
  if (!next) return (prev.position || 0) + POS_GAP
  return ((prev.position || 0) + (next.position || 0)) / 2
}

export async function logTaskActivity(taskId, userId, type, content) {
  if (!taskId) return
  await supabase.from('task_activities').insert({
    task_id: taskId,
    user_id: userId,
    type,
    content: content || null,
  })
}

export async function logTaskComment(taskId, userId, content) {
  if (!content?.trim()) return
  await logTaskActivity(taskId, userId, 'comment', content.trim())
}

// Log diff for tracked fields when updating a task. Returns inserted count.
const TRACKED = ['status', 'assignee_id', 'due_date', 'priority', 'project_id', 'title']

function describeChange(field, oldVal, newVal, memberMap = {}, projectMap = {}) {
  switch (field) {
    case 'status':
      return `Status: ${TASK_STATUS_MAP[oldVal]?.label || oldVal || '—'} → ${TASK_STATUS_MAP[newVal]?.label || newVal}`
    case 'assignee_id': {
      const a = memberMap[oldVal]?.full_name || (oldVal ? 'someone' : 'Unassigned')
      const b = memberMap[newVal]?.full_name || (newVal ? 'someone' : 'Unassigned')
      return `Assignee: ${a} → ${b}`
    }
    case 'due_date':
      return `Due: ${oldVal || '—'} → ${newVal || '—'}`
    case 'priority':
      return `Priority: ${oldVal || '—'} → ${newVal || '—'}`
    case 'project_id': {
      const a = projectMap[oldVal]?.address || (oldVal ? 'a project' : 'None')
      const b = projectMap[newVal]?.address || (newVal ? 'a project' : 'None')
      return `Project: ${a} → ${b}`
    }
    case 'title':
      return `Title changed`
    default:
      return `${field} changed`
  }
}

export async function logTaskChanges(taskId, userId, before, after, memberMap = {}, projectMap = {}) {
  const inserts = []
  for (const field of TRACKED) {
    const o = before?.[field] ?? null
    const n = after?.[field] ?? null
    if (String(o) !== String(n)) {
      inserts.push({
        task_id: taskId, user_id: userId, type: 'activity',
        content: describeChange(field, o, n, memberMap, projectMap),
      })
    }
  }
  if (inserts.length) await supabase.from('task_activities').insert(inserts)
  return inserts.length
}
