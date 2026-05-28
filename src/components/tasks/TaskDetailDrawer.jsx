import { useEffect, useState, useRef } from 'react'
import Drawer from '../ui/Drawer'
import Button from '../ui/Button'
import ConfirmDialog from '../ui/ConfirmDialog'
import TaskActivity from './TaskActivity'
import TaskComment from './TaskComment'
import TaskAttachments from './TaskAttachments'
import { supabase } from '../../lib/supabase'
import { TASK_STATUSES, TASK_PRIORITIES } from '../../lib/constants'
import { logTaskChanges } from '../../lib/taskHelpers'

export default function TaskDetailDrawer({ open, taskId, onClose, onChanged, onDeleted, workspaceId, userId, userRole, members, projects, memberMap, projectMap }) {
  const [task, setTask] = useState(null)
  const [loading, setLoading] = useState(false)
  const [savingField, setSavingField] = useState(null)
  const [error, setError] = useState(null)
  const [activityRefresh, setActivityRefresh] = useState(0)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const initialRef = useRef(null)
  const canEdit = userRole !== 'readonly'
  const canDelete = userRole === 'admin' || task?.created_by === userId

  useEffect(() => {
    if (!taskId || !open) { setTask(null); return }
    let cancelled = false
    setLoading(true)
    supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .single()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setError(error.message)
        else { setTask(data); initialRef.current = data }
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [taskId, open])

  const patch = async (changes) => {
    if (!task) return
    setSavingField(Object.keys(changes)[0])
    const before = task
    const optimistic = { ...task, ...changes }
    setTask(optimistic)
    const { data, error } = await supabase
      .from('tasks')
      .update(changes)
      .eq('id', task.id)
      .select('*')
      .single()
    setSavingField(null)
    if (error) {
      setError(error.message)
      setTask(before)
      return
    }
    setTask(data)
    initialRef.current = data
    await logTaskChanges(task.id, userId, before, data, memberMap, projectMap)
    setActivityRefresh(v => v + 1)
    onChanged?.(data)
  }

  const handleDelete = async () => {
    if (!task) return
    await supabase.from('tasks').delete().eq('id', task.id)
    setConfirmDelete(false)
    onDeleted?.(task.id)
    onClose?.()
  }

  const inputCls = 'w-full text-[13px] px-2 h-8 bg-[color:var(--color-bg)] border border-[color:var(--color-line)] rounded text-[color:var(--color-text)] focus:outline-none focus:border-[color:var(--color-accent)] disabled:opacity-50'

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        title={task?.title || (loading ? 'Loading…' : 'Task')}
        width={520}
      >
        {!task ? (
          <div className="p-4 text-[13px] text-[color:var(--color-text-dim)]">
            {loading ? 'Loading…' : (error || 'Task not found.')}
          </div>
        ) : (
          <div className="p-4 space-y-4">
            {/* Title */}
            <div>
              <label className="text-[10.5px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)]">Title</label>
              <input
                type="text"
                defaultValue={task.title}
                disabled={!canEdit}
                onBlur={(e) => {
                  const v = e.target.value.trim()
                  if (v && v !== task.title) patch({ title: v })
                }}
                className={`${inputCls} h-9 text-[14px] font-medium mt-1`}
              />
            </div>

            {/* Quick fields grid */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10.5px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)]">Status</label>
                <select
                  value={task.status}
                  disabled={!canEdit}
                  onChange={e => patch({ status: e.target.value })}
                  className={inputCls + ' mt-1'}
                >
                  {TASK_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>

              <div>
                <label className="text-[10.5px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)]">Priority</label>
                <select
                  value={task.priority}
                  disabled={!canEdit}
                  onChange={e => patch({ priority: e.target.value })}
                  className={inputCls + ' mt-1'}
                >
                  {TASK_PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>

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

              <div>
                <label className="text-[10.5px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)]">Due date</label>
                <input
                  type="date"
                  value={task.due_date || ''}
                  disabled={!canEdit}
                  onChange={e => patch({ due_date: e.target.value || null })}
                  className={inputCls + ' mt-1'}
                />
              </div>

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
            </div>

            {/* Description */}
            <div>
              <label className="text-[10.5px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)]">Description</label>
              <textarea
                defaultValue={task.description || ''}
                disabled={!canEdit}
                rows={4}
                onBlur={(e) => {
                  const v = e.target.value
                  if (v !== (task.description || '')) patch({ description: v || null })
                }}
                placeholder="Add a description…"
                className="w-full mt-1 text-[13px] px-2 py-1.5 bg-[color:var(--color-bg)] border border-[color:var(--color-line)] rounded text-[color:var(--color-text)] focus:outline-none focus:border-[color:var(--color-accent)] resize-y leading-relaxed placeholder:text-[color:var(--color-text-faint)]"
              />
            </div>

            {/* Tags */}
            <div>
              <label className="text-[10.5px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)]">Tags</label>
              <input
                type="text"
                defaultValue={(task.tags || []).join(', ')}
                disabled={!canEdit}
                placeholder="comma, separated, tags"
                onBlur={(e) => {
                  const parsed = e.target.value.split(',').map(t => t.trim()).filter(Boolean)
                  const same = (parsed.length === (task.tags || []).length) && parsed.every((t, i) => t === task.tags[i])
                  if (!same) patch({ tags: parsed })
                }}
                className={inputCls + ' mt-1'}
              />
              {(task.tags || []).length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {task.tags.map(t => (
                    <span key={t} className="inline-flex items-center px-1.5 h-[18px] rounded text-[10.5px] bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-muted)]">{t}</span>
                  ))}
                </div>
              )}
            </div>

            {/* Attachments */}
            <div className="pt-2 border-t border-[color:var(--color-line)]">
              <div className="text-[10.5px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)] mb-2">Attachments</div>
              <TaskAttachments taskId={task.id} workspaceId={workspaceId} userId={userId} canEdit={canEdit} />
            </div>

            {/* Comments + Activity */}
            <div className="pt-2 border-t border-[color:var(--color-line)] space-y-3">
              <div className="text-[10.5px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)]">Activity</div>
              {canEdit && <TaskComment taskId={task.id} userId={userId} onPosted={() => setActivityRefresh(v => v + 1)} />}
              <TaskActivity taskId={task.id} refreshKey={activityRefresh} />
            </div>

            {/* Delete */}
            {canDelete && (
              <div className="pt-2 border-t border-[color:var(--color-line)]">
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
                  <span className="text-[color:var(--color-danger-text)]">Delete task</span>
                </Button>
              </div>
            )}

            {savingField && (
              <div className="text-[10.5px] text-[color:var(--color-text-dim)] italic">Saving {savingField}…</div>
            )}
            {error && (
              <div className="text-[11.5px] text-[color:var(--color-danger-text)] bg-[color:var(--color-danger-soft)] p-2 rounded">{error}</div>
            )}
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
        title="Delete this task?"
        message="This will permanently delete the task, its comments, and its attachments."
        confirmLabel="Delete"
      />
    </>
  )
}
