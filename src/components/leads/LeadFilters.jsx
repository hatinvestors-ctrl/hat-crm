import { LEAD_STATUSES, LEAD_SOURCES } from '../../lib/constants'
import Button from '../ui/Button'

const inputCls = 'h-7 px-2 text-[12.5px] rounded-md bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] text-[color:var(--color-text)] placeholder:text-[color:var(--color-text-faint)] focus:outline-none focus:border-[color:var(--color-accent)] focus:ring-1 focus:ring-[color:var(--color-accent)]'
const selectCls = `${inputCls} pr-7 appearance-none bg-no-repeat bg-[length:12px] bg-[right_6px_center] cursor-pointer`
const selectStyle = { backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23808a99' stroke-width='2'><polyline points='6 9 12 15 18 9'/></svg>")` }

export default function LeadFilters({ filters, onChange, onClear, members = [], isAdmin = false }) {
  const update = (patch) => onChange?.({ ...filters, ...patch })
  const hasActive = Object.values(filters).some(v => v !== '' && v !== null && v !== undefined)

  return (
    <div className="bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] rounded-lg p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Search address or seller…"
          value={filters.search || ''}
          onChange={(e) => update({ search: e.target.value })}
          className={`${inputCls} flex-1 min-w-[200px]`}
        />
        <select value={filters.status || ''} onChange={(e) => update({ status: e.target.value || null })} className={selectCls} style={selectStyle}>
          <option value="">All statuses</option>
          {LEAD_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        {isAdmin && (
          <select value={filters.assigned_to || ''} onChange={(e) => update({ assigned_to: e.target.value || null })} className={selectCls} style={selectStyle}>
            <option value="">All assignees</option>
            <option value="unassigned">Unassigned</option>
            {members.map(m => <option key={m.user_id} value={m.user_id}>{m.profiles?.full_name || 'User'}</option>)}
          </select>
        )}
        {isAdmin && (
          <select value={filters.lead_source || ''} onChange={(e) => update({ lead_source: e.target.value || null })} className={selectCls} style={selectStyle}>
            <option value="">All sources</option>
            {LEAD_SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        )}
        <input type="text" placeholder="City" value={filters.city || ''} onChange={(e) => update({ city: e.target.value })} className={`${inputCls} w-24`} />
        <input type="text" placeholder="Zip" value={filters.zip_code || ''} onChange={(e) => update({ zip_code: e.target.value })} className={`${inputCls} w-20`} />
        <div className="flex gap-1">
          <input type="number" placeholder="Min ARV" value={filters.arv_min || ''} onChange={(e) => update({ arv_min: e.target.value })} className={`${inputCls} w-24 tabular-nums`} />
          <input type="number" placeholder="Max ARV" value={filters.arv_max || ''} onChange={(e) => update({ arv_max: e.target.value })} className={`${inputCls} w-24 tabular-nums`} />
        </div>
        {hasActive && (
          <Button variant="ghost" size="sm" onClick={onClear}>Clear</Button>
        )}
      </div>
    </div>
  )
}
