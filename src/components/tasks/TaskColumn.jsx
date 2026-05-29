import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import TaskCard from './TaskCard'
import QuickAddTask from './QuickAddTask'

const TONE_DOT = {
  neutral: 'bg-[color:var(--color-text-dim)]',
  accent:  'bg-[color:var(--color-accent)]',
  danger:  'bg-[color:var(--color-danger)]',
  warn:    'bg-[color:var(--color-warn)]',
  success: 'bg-[color:var(--color-success)]',
}

export default function TaskColumn({ status, tasks, memberMap, projectMap, activityCounts, attachmentCounts, onOpenTask, onQuickAdd }) {
  const { setNodeRef, isOver } = useDroppable({ id: `column-${status.value}` })

  return (
    <div className="flex flex-col w-[300px] shrink-0 bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] rounded-lg">
      <header className="flex items-center gap-2 px-3 h-9 border-b border-[color:var(--color-line)]">
        <span className={`w-2 h-2 rounded-full ${TONE_DOT[status.tone] || TONE_DOT.neutral}`} />
        <h3 className="text-[12px] font-semibold uppercase tracking-wider text-[color:var(--color-text)]">{status.label}</h3>
        <span className="ml-auto text-[11px] tabular-nums text-[color:var(--color-text-dim)] bg-[color:var(--color-bg-elev-2)] px-1.5 h-[18px] rounded-full inline-flex items-center">
          {tasks.length}
        </span>
      </header>

      <div
        ref={setNodeRef}
        className={`flex-1 p-2 space-y-1.5 min-h-[60px] transition-colors ${isOver ? 'bg-[color:var(--color-accent-soft)]' : ''}`}
      >
        <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map(task => (
            <TaskCard
              key={task.id}
              task={task}
              project={projectMap[task.project_id]}
              assignees={(task.assignee_ids || []).map(uid => memberMap[uid]).filter(Boolean)}
              onOpen={onOpenTask}
              activityCount={activityCounts[task.id] || 0}
              attachmentCount={attachmentCounts[task.id] || 0}
            />
          ))}
        </SortableContext>

        {tasks.length === 0 && !isOver && (
          <div className="text-[11.5px] text-[color:var(--color-text-faint)] text-center py-4 italic">No tasks</div>
        )}
      </div>

      <div className="px-2 py-1.5 border-t border-[color:var(--color-line)]">
        <QuickAddTask onAdd={onQuickAdd} />
      </div>
    </div>
  )
}
