import { useEffect, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import Topbar from '../components/Topbar'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import EmptyState from '../components/ui/EmptyState'
import Badge from '../components/ui/Badge'
import { supabase } from '../lib/supabase'
import { categorizeLeads } from '../lib/staleness'
import { formatCurrency, formatDate } from '../lib/calculations'
import { applyLeadVisibility } from '../lib/leadVisibility'

const TONE_STYLES = {
  danger: {
    border: 'border-l-[color:var(--color-danger)]',
    bg:     'bg-[color:var(--color-danger-soft)]',
    text:   'text-[color:var(--color-danger-text)]',
    chip:   'bg-[color:var(--color-danger)] text-white',
    dot:    'bg-[color:var(--color-danger)]',
  },
  warn: {
    border: 'border-l-[color:var(--color-warn)]',
    bg:     'bg-[color:var(--color-warn-soft)]',
    text:   'text-[color:var(--color-warn-text)]',
    chip:   'bg-[color:var(--color-warn)] text-white',
    dot:    'bg-[color:var(--color-warn)]',
  },
  accent: {
    border: 'border-l-[color:var(--color-accent)]',
    bg:     'bg-[color:var(--color-accent-soft)]',
    text:   'text-[color:var(--color-accent-text)]',
    chip:   'bg-[color:var(--color-accent)] text-white',
    dot:    'bg-[color:var(--color-accent)]',
  },
  neutral: {
    border: 'border-l-[color:var(--color-text-dim)]',
    bg:     'bg-[color:var(--color-bg-elev-2)]',
    text:   'text-[color:var(--color-text-muted)]',
    chip:   'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-muted)] ring-1 ring-[color:var(--color-line)]',
    dot:    'bg-[color:var(--color-text-dim)]',
  },
}

export default function TodayPage() {
  const { workspace, workspaceId, members, user, userRole } = useOutletContext()
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState(null)
  const [myTasks, setMyTasks] = useState([])
  const [taskProjects, setTaskProjects] = useState([])
  const [activityDate, setActivityDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [activityUser, setActivityUser] = useState('')
  const [activityFeed, setActivityFeed] = useState([])
  const [activityLeadMap, setActivityLeadMap] = useState({})
  const [activityLoading, setActivityLoading] = useState(false)

  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false
    let leadsQ = supabase
      .from('leads')
      .select('id, address, city, status, follow_up_date, contract_signed_date, assigned_to, arv, mao, offer_price, created_at, updated_at, snooze_until')
      .eq('workspace_id', workspaceId)
      .not('status', 'in', '("closed","dead")')
    leadsQ = applyLeadVisibility(leadsQ, user.id, userRole)
    leadsQ.then(({ data }) => {
      if (!cancelled) {
        setLeads(data || [])
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [workspaceId, user.id, userRole])

  useEffect(() => {
    if (!workspaceId || !user?.id) return
    const today = new Date().toISOString().slice(0, 10)
    supabase
      .from('tasks')
      .select('id, title, due_date, status, assignee_ids, project_id')
      .eq('workspace_id', workspaceId)
      .contains('assignee_ids', [user.id])
      .neq('status', 'done')
      .lte('due_date', today)
      .order('due_date', { ascending: true })
      .then(({ data }) => setMyTasks(data || []))

    supabase
      .from('leads')
      .select('id, address')
      .eq('workspace_id', workspaceId)
      .then(({ data }) => setTaskProjects(data || []))
  }, [workspaceId, user?.id])

  useEffect(() => {
    if (!workspaceId || !user?.id) return
    setActivityLoading(true)
    // Step 1: get visible lead IDs
    let leadsQ = supabase.from('leads').select('id, address').eq('workspace_id', workspaceId)
    leadsQ = applyLeadVisibility(leadsQ, user.id, userRole)
    leadsQ.then(async ({ data: visibleLeads }) => {
      const leadIds = (visibleLeads || []).map(l => l.id)
      const leadMap = Object.fromEntries((visibleLeads || []).map(l => [l.id, l]))
      setActivityLeadMap(leadMap)
      if (leadIds.length === 0) { setActivityFeed([]); setActivityLoading(false); return }
      // Step 2: get activities for those leads on the selected date
      let q = supabase
        .from('lead_activities')
        .select('id, lead_id, user_id, type, content, created_at')
        .in('lead_id', leadIds)
        .gte('created_at', `${activityDate}T00:00:00`)
        .lte('created_at', `${activityDate}T23:59:59`)
        .order('created_at', { ascending: false })
      // Admins can filter by user; non-admins always see only their own activity
      const effectiveUser = userRole === 'admin' ? activityUser : user.id
      if (effectiveUser) q = q.eq('user_id', effectiveUser)
      const { data } = await q
      setActivityFeed(data || [])
      setActivityLoading(false)
    })
  }, [workspaceId, user?.id, userRole, activityDate, activityUser])

  const snoozeLead = async (e, leadId, hours) => {
    e.preventDefault()
    e.stopPropagation()
    setBusyId(leadId)
    const until = new Date(Date.now() + hours * 3600 * 1000).toISOString()
    const { error } = await supabase.from('leads').update({ snooze_until: until }).eq('id', leadId)
    if (!error) {
      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, snooze_until: until } : l))
    }
    setBusyId(null)
  }

  const markHandled = async (e, leadId) => {
    e.preventDefault()
    e.stopPropagation()
    setBusyId(leadId)
    const nowIso = new Date().toISOString()
    const snoozeIso = new Date(Date.now() + 24 * 3600 * 1000).toISOString()
    const { error } = await supabase
      .from('leads')
      .update({ updated_at: nowIso, snooze_until: snoozeIso })
      .eq('id', leadId)
    if (!error) {
      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, updated_at: nowIso, snooze_until: snoozeIso } : l))
    }
    setBusyId(null)
  }

  const markTaskDone = async (e, taskId) => {
    e.preventDefault()
    e.stopPropagation()
    const { error } = await supabase.from('tasks').update({ status: 'done' }).eq('id', taskId)
    if (!error) setMyTasks(prev => prev.filter(t => t.id !== taskId))
  }

  const memberMap = Object.fromEntries((members || []).map(m => [m.user_id, m.profiles]))
  const taskProjectMap = Object.fromEntries(taskProjects.map(p => [p.id, p]))
  const todayStr = new Date().toISOString().slice(0, 10)
  const overdueTasks = myTasks.filter(t => t.due_date < todayStr)
  const todayTasks   = myTasks.filter(t => t.due_date === todayStr)
  const { byBucket, totalCount } = categorizeLeads(leads, workspace?.settings)

  if (loading) return <LoadingSpinner fullPage label="Scanning your pipeline…" />

  return (
    <>
      <Topbar
        title="Today"
        breadcrumbs={[{ label: workspace.name }, { label: 'Today' }]}
      />

      <div className="px-6 py-6 max-w-[1100px] w-full space-y-6 flex-1">
        <div className="pb-5 border-b border-[color:var(--color-line)]">
          <p className="text-[12px] text-[color:var(--color-text-dim)]">Needs attention</p>
          <h2 className="text-[22px] font-semibold text-[color:var(--color-text)] tracking-tight mt-1">
            {totalCount === 0
              ? 'You\'re all caught up.'
              : `${totalCount} lead${totalCount === 1 ? '' : 's'} need${totalCount === 1 ? 's' : ''} action.`}
          </h2>
          <p className="text-[13px] text-[color:var(--color-text-muted)] mt-1 leading-relaxed">
            Leads that are stuck in a status too long, overdue follow-ups, or missing a next step. Tackle them in priority order — top to bottom.
          </p>
        </div>

        {totalCount === 0 ? (
          <EmptyState
            icon="✓"
            title="Inbox zero."
            description="Every active lead is moving. No overdue follow-ups, no stalled offers, no leads sitting idle. Nice work."
          />
        ) : (
          <div className="space-y-5">
            {byBucket.map(({ bucket, leads: bucketLeads }) => {
              const tone = TONE_STYLES[bucket.tone]
              return (
                <section
                  key={bucket.id}
                  className={`bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] border-l-4 ${tone.border} rounded-lg overflow-hidden`}
                >
                  <header className="px-4 py-3 border-b border-[color:var(--color-line)] flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${tone.dot}`} />
                        <h3 className="text-[14px] font-semibold text-[color:var(--color-text)]">{bucket.label}</h3>
                        <span className={`inline-flex items-center px-1.5 h-5 text-[11px] font-semibold rounded-full ${tone.chip} tabular-nums`}>
                          {bucketLeads.length}
                        </span>
                      </div>
                      <p className="text-[12px] text-[color:var(--color-text-muted)] mt-0.5">{bucket.description}</p>
                    </div>
                  </header>

                  <ul className="divide-y divide-[color:var(--color-line)]">
                    {bucketLeads.map(lead => {
                      const assignee = memberMap[lead.assigned_to]
                      return (
                        <li key={lead.id}>
                          <Link
                            to={`/w/${workspaceId}/leads/${lead.id}`}
                            className="block px-4 py-3 hover:bg-[color:var(--color-bg-elev-2)] transition-colors"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-[14px] font-medium text-[color:var(--color-text)] truncate">
                                    {lead.address}
                                  </span>
                                  <Badge status={lead.status} />
                                </div>
                                <div className={`text-[12px] font-medium ${tone.text} mt-1`}>
                                  → {bucket.action(lead)}
                                </div>
                                <div className="text-[11.5px] text-[color:var(--color-text-dim)] mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                                  {lead.city && <span>{lead.city}</span>}
                                  {assignee && <span>{assignee.full_name}</span>}
                                  {lead.mao && <span className="tabular-nums">MAO {formatCurrency(lead.mao)}</span>}
                                  {lead.offer_price && <span className="tabular-nums">Offer {formatCurrency(lead.offer_price)}</span>}
                                </div>
                              </div>
                              <div className="text-right shrink-0 text-[11px] text-[color:var(--color-text-dim)] flex flex-col items-end gap-1.5">
                                <div>
                                  <div>Updated</div>
                                  <div className="text-[color:var(--color-text-muted)] tabular-nums">{formatDate(lead.updated_at)}</div>
                                </div>
                                <div className="flex gap-1">
                                  <button
                                    type="button"
                                    onClick={(e) => snoozeLead(e, lead.id, 24)}
                                    disabled={busyId === lead.id}
                                    title="Hide from Today for 24 hours"
                                    className="text-[11px] px-2 py-0.5 rounded bg-[color:var(--color-bg-elev-2)] hover:bg-[color:var(--color-bg-elev)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] border border-[color:var(--color-line)] transition-colors disabled:opacity-50"
                                  >
                                    💤 Snooze 24h
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => markHandled(e, lead.id)}
                                    disabled={busyId === lead.id}
                                    title="Mark as handled — resets idle counter and hides for 24h"
                                    className="text-[11px] px-2 py-0.5 rounded bg-[color:var(--color-bg-elev-2)] hover:bg-[color:var(--color-success-soft)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-success-text)] border border-[color:var(--color-line)] transition-colors disabled:opacity-50"
                                  >
                                    ✓ Handled
                                  </button>
                                </div>
                              </div>
                            </div>
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )
            })}
          </div>
        )}

        {(overdueTasks.length > 0 || todayTasks.length > 0) && (
          <section className="bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] rounded-lg overflow-hidden">
            <header className="px-4 py-3 border-b border-[color:var(--color-line)]">
              <h3 className="text-[14px] font-semibold text-[color:var(--color-text)]">My Tasks</h3>
              <p className="text-[12px] text-[color:var(--color-text-muted)] mt-0.5">Tasks assigned to you that are due today or overdue</p>
            </header>

            {overdueTasks.length > 0 && (
              <div>
                <div className="px-4 py-1.5 bg-[color:var(--color-danger-soft)] border-b border-[color:var(--color-line)]">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--color-danger-text)]">Overdue — {overdueTasks.length}</span>
                </div>
                <ul className="divide-y divide-[color:var(--color-line)]">
                  {overdueTasks.map(task => (
                    <li key={task.id}>
                      <a
                        href={`/w/${workspaceId}/tasks/${task.id}`}
                        className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-[color:var(--color-bg-elev-2)] transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-medium text-[color:var(--color-text)] truncate">{task.title}</div>
                          {task.project_id && taskProjectMap[task.project_id] && (
                            <div className="text-[11.5px] text-[color:var(--color-text-dim)] mt-0.5">🏠 {taskProjectMap[task.project_id].address}</div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[11px] text-[color:var(--color-danger-text)]">{task.due_date}</span>
                          <button
                            type="button"
                            onClick={(e) => markTaskDone(e, task.id)}
                            className="text-[11px] px-2 py-0.5 rounded bg-[color:var(--color-bg-elev-2)] hover:bg-[color:var(--color-success-soft)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-success-text)] border border-[color:var(--color-line)] transition-colors"
                          >
                            ✓ Done
                          </button>
                        </div>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {todayTasks.length > 0 && (
              <div>
                <div className="px-4 py-1.5 bg-[color:var(--color-warn-soft)] border-b border-[color:var(--color-line)]">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--color-warn-text)]">Due Today — {todayTasks.length}</span>
                </div>
                <ul className="divide-y divide-[color:var(--color-line)]">
                  {todayTasks.map(task => (
                    <li key={task.id}>
                      <a
                        href={`/w/${workspaceId}/tasks/${task.id}`}
                        className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-[color:var(--color-bg-elev-2)] transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-medium text-[color:var(--color-text)] truncate">{task.title}</div>
                          {task.project_id && taskProjectMap[task.project_id] && (
                            <div className="text-[11.5px] text-[color:var(--color-text-dim)] mt-0.5">🏠 {taskProjectMap[task.project_id].address}</div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[11px] text-[color:var(--color-warn-text)]">Today</span>
                          <button
                            type="button"
                            onClick={(e) => markTaskDone(e, task.id)}
                            className="text-[11px] px-2 py-0.5 rounded bg-[color:var(--color-bg-elev-2)] hover:bg-[color:var(--color-success-soft)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-success-text)] border border-[color:var(--color-line)] transition-colors"
                          >
                            ✓ Done
                          </button>
                        </div>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {/* Activity Feed */}
        <section className="bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] rounded-lg overflow-hidden">
          <header className="px-4 py-3 border-b border-[color:var(--color-line)] flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h3 className="text-[14px] font-semibold text-[color:var(--color-text)]">Activity Feed</h3>
              <p className="text-[12px] text-[color:var(--color-text-muted)] mt-0.5">Comments and changes on your leads</p>
            </div>
            <div className="flex items-center gap-2">
              {userRole === 'admin' && (
                <select
                  value={activityUser}
                  onChange={e => setActivityUser(e.target.value)}
                  className="h-7 px-2 text-[12px] bg-[color:var(--color-bg)] border border-[color:var(--color-line)] rounded text-[color:var(--color-text)] focus:outline-none focus:border-[color:var(--color-accent)]"
                >
                  <option value="">All Users</option>
                  {members.map(m => (
                    <option key={m.user_id} value={m.user_id}>{m.profiles?.full_name || 'Member'}</option>
                  ))}
                </select>
              )}
              <input
                type="date"
                value={activityDate}
                onChange={e => setActivityDate(e.target.value)}
                className="h-7 px-2 text-[12px] bg-[color:var(--color-bg)] border border-[color:var(--color-line)] rounded text-[color:var(--color-text)] focus:outline-none focus:border-[color:var(--color-accent)]"
              />
            </div>
          </header>

          {activityLoading ? (
            <div className="px-4 py-6 text-[13px] text-[color:var(--color-text-dim)] text-center">Loading…</div>
          ) : activityFeed.length === 0 ? (
            <div className="px-4 py-6 text-[13px] text-[color:var(--color-text-dim)] text-center">No activity on this date.</div>
          ) : (() => {
            // Group by lead
            const byLead = {}
            for (const item of activityFeed) {
              if (!byLead[item.lead_id]) byLead[item.lead_id] = []
              byLead[item.lead_id].push(item)
            }
            return (
              <div className="divide-y divide-[color:var(--color-line)]">
                {Object.entries(byLead).map(([leadId, items]) => {
                  const lead = activityLeadMap[leadId]
                  const comments = items.filter(i => i.type === 'comment')
                  const changes  = items.filter(i => i.type !== 'comment')
                  return (
                    <div key={leadId} className="px-4 py-3">
                      <Link
                        to={`/w/${workspaceId}/leads/${leadId}`}
                        className="text-[13px] font-medium text-[color:var(--color-accent-text)] hover:underline"
                      >
                        🏠 {lead?.address || leadId}
                      </Link>

                      {comments.length > 0 && (
                        <div className="mt-2">
                          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1.5">
                            💬 Comments ({comments.length})
                          </div>
                          <ul className="space-y-1.5">
                            {comments.map(item => {
                              const author = memberMap[item.user_id]?.full_name || 'Someone'
                              const time   = new Date(item.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
                              return (
                                <li key={item.id} className="flex gap-2 text-[12.5px]">
                                  <span className="text-[color:var(--color-text-dim)] shrink-0 tabular-nums">{time}</span>
                                  <span className="text-[color:var(--color-text-muted)] shrink-0">{author}:</span>
                                  <span className="text-[color:var(--color-text)] leading-snug">{item.content}</span>
                                </li>
                              )
                            })}
                          </ul>
                        </div>
                      )}

                      {changes.length > 0 && (
                        <div className="mt-2">
                          <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1.5">
                            🔄 Changes ({changes.length})
                          </div>
                          <ul className="space-y-1">
                            {changes.map(item => {
                              const author = memberMap[item.user_id]?.full_name || 'Someone'
                              const time   = new Date(item.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
                              return (
                                <li key={item.id} className="flex gap-2 text-[12px] text-[color:var(--color-text-muted)]">
                                  <span className="shrink-0 tabular-nums">{time}</span>
                                  <span className="shrink-0">{author}:</span>
                                  <span className="text-[color:var(--color-text-dim)]">{item.content}</span>
                                </li>
                              )
                            })}
                          </ul>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })()}
        </section>
      </div>
    </>
  )
}
