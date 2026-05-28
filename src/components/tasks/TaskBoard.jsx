import { DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, DragOverlay, closestCorners } from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useState } from 'react'
import TaskColumn from './TaskColumn'
import TaskCard from './TaskCard'
import { TASK_STATUSES } from '../../lib/constants'

export default function TaskBoard({ tasks, memberMap, projectMap, activityCounts, attachmentCounts, onOpenTask, onQuickAdd, onMove }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const [activeId, setActiveId] = useState(null)

  const byStatus = {}
  for (const s of TASK_STATUSES) byStatus[s.value] = []
  for (const t of tasks) {
    if (byStatus[t.status]) byStatus[t.status].push(t)
  }
  for (const s of TASK_STATUSES) {
    byStatus[s.value].sort((a, b) => (a.position || 0) - (b.position || 0))
  }

  const activeTask = tasks.find(t => t.id === activeId)

  const findColumnOf = (taskId) => {
    for (const s of TASK_STATUSES) {
      if (byStatus[s.value].some(t => t.id === taskId)) return s.value
    }
    return null
  }

  const onDragEnd = (event) => {
    const { active, over } = event
    setActiveId(null)
    if (!over) return

    const fromStatus = findColumnOf(active.id)
    if (!fromStatus) return

    // Drop target can be either a column id ("column-<status>") or another task id.
    let toStatus = null
    let overTaskId = null
    if (typeof over.id === 'string' && over.id.startsWith('column-')) {
      toStatus = over.id.replace('column-', '')
    } else {
      toStatus = findColumnOf(over.id)
      overTaskId = over.id
    }
    if (!toStatus) return

    const targetList = byStatus[toStatus].filter(t => t.id !== active.id)
    let targetIdx
    if (overTaskId) {
      targetIdx = targetList.findIndex(t => t.id === overTaskId)
      if (targetIdx < 0) targetIdx = targetList.length
    } else {
      targetIdx = targetList.length // dropped on empty column area → bottom
    }

    onMove?.(active.id, toStatus, targetList, targetIdx, fromStatus)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={(e) => setActiveId(e.active.id)}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={onDragEnd}
    >
      <div className="flex gap-3 overflow-x-auto pb-2">
        {TASK_STATUSES.map(status => (
          <TaskColumn
            key={status.value}
            status={status}
            tasks={byStatus[status.value]}
            memberMap={memberMap}
            projectMap={projectMap}
            activityCounts={activityCounts}
            attachmentCounts={attachmentCounts}
            onOpenTask={onOpenTask}
            onQuickAdd={(title) => onQuickAdd(status.value, title)}
          />
        ))}
      </div>

      <DragOverlay>
        {activeTask ? (
          <div className="w-[284px] rotate-2">
            <TaskCard
              task={activeTask}
              project={projectMap[activeTask.project_id]}
              assignee={memberMap[activeTask.assignee_id]}
              activityCount={activityCounts[activeTask.id] || 0}
              attachmentCount={attachmentCounts[activeTask.id] || 0}
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
