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
          <div className="flex items-center shrink-0">
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
