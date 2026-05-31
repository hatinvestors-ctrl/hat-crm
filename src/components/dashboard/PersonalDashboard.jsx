// src/components/dashboard/PersonalDashboard.jsx
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Card from '../ui/Card'
import StatsCard from './StatsCard'
import FollowUpWidget from './FollowUpWidget'
import PipelineWidget from './PipelineWidget'
import { supabase } from '../../lib/supabase'
import { applyLeadVisibility } from '../../lib/leadVisibility'
import { todayISO } from '../../lib/calculations'

export default function PersonalDashboard({ workspaceId, userId, userRole }) {
  const [leads, setLeads] = useState([])
  const [myTasks, setMyTasks] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!workspaceId || !userId) return
    const today = todayISO()

    let q = supabase
      .from('leads')
      .select('id, address, city, status, assigned_to, arv, mao, offer_price, follow_up_date, created_at, visible_to_all, seller_name')
      .eq('workspace_id', workspaceId)
      .not('status', 'in', '("dead_lead","rejected_not_accepted","not_in_buy_box")')
    q = applyLeadVisibility(q, userId, userRole)
    q.then(({ data }) => setLeads(data || []))

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
  const activeLeads = leads.filter(l => l.status !== 'sold')
  const offersSent  = leads.filter(l => ['offer_sent','negotiating','offer_accepted','sold'].includes(l.status))
  const accepted    = leads.filter(l => ['offer_accepted','sold'].includes(l.status))
  const closed      = leads.filter(l => l.status === 'sold')
  const followUps   = leads.filter(l => l.follow_up_date && l.follow_up_date <= today)
  const pipeline    = leads.filter(l => !['dead_lead','rejected_not_accepted','sold'].includes(l.status)).slice(0, 10)

  const overdueTasks = myTasks.filter(t => t.due_date && t.due_date < today)
  const todayTasks   = myTasks.filter(t => t.due_date === today)
  const upcoming     = myTasks.filter(t => t.due_date && t.due_date > today).slice(0, 5)

  if (loading) return null

  return (
    <div className="px-6 py-6 space-y-6 max-w-[1100px] w-full">
      {/* My Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] rounded-lg p-4">
        <StatsCard label="My Active Leads" value={activeLeads.length} />
        <StatsCard label="Offers Sent" value={offersSent.length} />
        <StatsCard label="Accepted" value={accepted.length} accent />
        <StatsCard label="Closed" value={closed.length} accent />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* My Pipeline */}
        <PipelineWidget leads={pipeline} workspaceId={workspaceId} />

        {/* My Follow-Ups */}
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
                      <Link
                        to={`/w/${workspaceId}/tasks/${t.id}`}
                        className="flex items-center justify-between gap-2 py-1.5 px-2 rounded hover:bg-[color:var(--color-bg-elev-2)] transition-colors"
                      >
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
                      <Link
                        to={`/w/${workspaceId}/tasks/${t.id}`}
                        className="flex items-center justify-between gap-2 py-1.5 px-2 rounded hover:bg-[color:var(--color-bg-elev-2)] transition-colors"
                      >
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
                      <Link
                        to={`/w/${workspaceId}/tasks/${t.id}`}
                        className="flex items-center justify-between gap-2 py-1.5 px-2 rounded hover:bg-[color:var(--color-bg-elev-2)] transition-colors"
                      >
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
