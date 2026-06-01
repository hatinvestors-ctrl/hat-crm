// src/components/dashboard/PersonalDashboard.jsx
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Card from '../ui/Card'
import StatsCard from './StatsCard'
import FollowUpWidget from './FollowUpWidget'
import PipelineWidget from './PipelineWidget'
import TimeRangePicker, { rangeStart } from './TimeRangePicker'
import { supabase } from '../../lib/supabase'
import { applyLeadVisibility } from '../../lib/leadVisibility'
import { todayISO } from '../../lib/calculations'

const THROUGHPUT_METRICS = [
  { key: 'new_leads',       label: 'New Leads',     accent: false },
  { key: 'mao_calculated',  label: 'MAO Calculated', accent: false },
  { key: 'offers_sent',     label: 'Offers Sent',   accent: false },
  { key: 'accepted',        label: 'Accepted',      accent: true  },
  { key: 'sold',            label: 'Closed',        accent: true  },
]

const STATUS_TO_METRIC = {
  mao_calculated:            'mao_calculated',
  offer_sent:                'offers_sent',
  offer_accepted:            'accepted',
  sold:                      'sold',
}

export default function PersonalDashboard({ workspaceId, userId, userRole }) {
  const [leads, setLeads] = useState([])
  const [transitions, setTransitions] = useState([])
  const [myTasks, setMyTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState('30d')

  useEffect(() => {
    if (!workspaceId || !userId) return

    // Load all visible leads
    let q = supabase
      .from('leads')
      .select('id, address, city, status, assigned_to, arv, mao, offer_price, follow_up_date, created_at, visible_to_all, seller_name')
      .eq('workspace_id', workspaceId)
      .not('status', 'in', '("dead_lead","rejected_not_accepted","not_in_buy_box")')
    q = applyLeadVisibility(q, userId, userRole)

    q.then(async ({ data: leadsData }) => {
      setLeads(leadsData || [])
      const leadIds = (leadsData || []).map(l => l.id)
      if (leadIds.length > 0) {
        // Load status transition activities for visible leads (last 365 days)
        const { data: acts } = await supabase
          .from('lead_activities')
          .select('lead_id, user_id, metadata, created_at')
          .in('lead_id', leadIds)
          .eq('type', 'activity')
          .gte('created_at', new Date(Date.now() - 365 * 86400000).toISOString())
          .not('metadata', 'is', null)
        setTransitions((acts || []).filter(a => a.metadata?.field === 'status' && a.metadata?.new_value))
      }
    })

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
  const rangeStartDate = useMemo(() => rangeStart(range), [range])

  // Time-range-filtered metrics
  const throughput = useMemo(() => {
    const counts = Object.fromEntries(THROUGHPUT_METRICS.map(m => [m.key, 0]))
    // New leads from created_at
    for (const l of leads) {
      if (new Date(l.created_at) >= rangeStartDate) counts.new_leads++
    }
    // Other metrics from status transitions
    for (const a of transitions) {
      if (new Date(a.created_at) < rangeStartDate) continue
      const k = STATUS_TO_METRIC[a.metadata?.new_value]
      if (k) counts[k]++
    }
    return counts
  }, [leads, transitions, rangeStartDate])

  // Current-state (not range-filtered)
  const activeLeads = leads.filter(l => !['sold'].includes(l.status))
  const followUps   = leads.filter(l => l.follow_up_date && l.follow_up_date <= today)
  const pipeline    = leads.filter(l => !['dead_lead','rejected_not_accepted','sold'].includes(l.status)).slice(0, 10)

  // Tasks
  const overdueTasks = myTasks.filter(t => t.due_date && t.due_date < today)
  const todayTasks   = myTasks.filter(t => t.due_date === today)
  const upcoming     = myTasks.filter(t => t.due_date && t.due_date > today).slice(0, 5)

  if (loading) return null

  return (
    <div className="px-6 py-6 space-y-6 max-w-[1200px] w-full">

      {/* Header row: always-on stats + range picker */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="grid grid-cols-2 gap-4 bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] rounded-lg p-4 flex-1 min-w-[260px]">
          <StatsCard label="My Active Leads" value={activeLeads.length} />
          <StatsCard label="Follow-ups Due" value={followUps.length} accent={followUps.length > 0} />
        </div>
        <TimeRangePicker value={range} onChange={setRange} />
      </div>

      {/* Range-filtered throughput */}
      <div className="bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] rounded-lg p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--color-text-dim)] mb-3">
          Activity in selected period
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          {THROUGHPUT_METRICS.map(m => (
            <StatsCard key={m.key} label={m.label} value={throughput[m.key]} accent={m.accent && throughput[m.key] > 0} />
          ))}
        </div>
      </div>

      {/* Pipeline + Follow-ups */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PipelineWidget leads={pipeline} workspaceId={workspaceId} />
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
                      <Link to={`/w/${workspaceId}/tasks/${t.id}`}
                        className="flex items-center justify-between gap-2 py-1.5 px-2 rounded hover:bg-[color:var(--color-bg-elev-2)] transition-colors">
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
                      <Link to={`/w/${workspaceId}/tasks/${t.id}`}
                        className="flex items-center justify-between gap-2 py-1.5 px-2 rounded hover:bg-[color:var(--color-bg-elev-2)] transition-colors">
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
                      <Link to={`/w/${workspaceId}/tasks/${t.id}`}
                        className="flex items-center justify-between gap-2 py-1.5 px-2 rounded hover:bg-[color:var(--color-bg-elev-2)] transition-colors">
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
