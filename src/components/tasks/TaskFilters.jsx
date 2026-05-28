import { TASK_PRIORITIES } from '../../lib/constants'

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
  if (filters.due) activeChips.push({ key: 'due', label: `Due: ${filters.due.replace('_',' ')}` })
  if (filters.priority) activeChips.push({ key: 'priority', label: `Priority: ${filters.priority}` })
  if (filters.search) activeChips.push({ key: 'search', label: `“${filters.search}”` })

  const selectCls = 'h-7 px-2 text-[12px] bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] rounded text-[color:var(--color-text)] focus:outline-none focus:border-[color:var(--color-accent)] cursor-pointer'

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select value={filters.project_id || ''} onChange={e => set('project_id', e.target.value)} className={selectCls}>
        <option value="">All Projects</option>
        <option value="__none__">— No project —</option>
        {projects.map(p => (
          <option key={p.id} value={p.id}>{p.address || '(no address)'}</option>
        ))}
      </select>

      <select value={filters.assignee_id || ''} onChange={e => set('assignee_id', e.target.value)} className={selectCls}>
        <option value="">All Assignees</option>
        <option value="me">👤 Mine</option>
        <option value="unassigned">Unassigned</option>
        {members.map(m => (
          <option key={m.user_id} value={m.user_id}>{m.profiles?.full_name || 'Member'}</option>
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
