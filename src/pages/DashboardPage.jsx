import { useEffect, useMemo, useState } from 'react'
import { useOutletContext, Link } from 'react-router-dom'
import Topbar from '../components/Topbar'
import PersonalDashboard from '../components/dashboard/PersonalDashboard'
import StatsCard from '../components/dashboard/StatsCard'
import StatusBreakdown from '../components/dashboard/StatusBreakdown'
import FollowUpWidget from '../components/dashboard/FollowUpWidget'
import PipelineWidget from '../components/dashboard/PipelineWidget'
import TimeRangePicker, { TIME_RANGES, rangeStart } from '../components/dashboard/TimeRangePicker'
import ThroughputGrid from '../components/dashboard/ThroughputGrid'
import BottleneckGrid from '../components/dashboard/BottleneckGrid'
import DailyActivityChart from '../components/dashboard/DailyActivityChart'
import SourcePerformance from '../components/dashboard/SourcePerformance'
import TeammatePerformance from '../components/dashboard/TeammatePerformance'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import Button from '../components/ui/Button'
import { supabase } from '../lib/supabase'
import { todayISO, formatCurrency } from '../lib/calculations'

// Status transitions we care about for throughput counters.
// Each maps a destination status to a metric key.
const TRANSITION_METRICS = {
  new_lead:                  'new_leads',
  mao_calculated:            'mao_calculated',
  offer_pending_hat_signing: 'sent_to_hat',
  offer_signed:              'hat_signed',
  offer_sent:                'offers_to_seller',
  offer_accepted:            'accepted',
  sold:                      'sold',
}
const METRIC_KEYS = Object.values(TRANSITION_METRICS)

export default function DashboardPage() {
  const { workspace, workspaceId, profile, members, user, userRole } = useOutletContext()

  if (userRole !== 'admin') {
    return (
      <>
        <Topbar
          title="Dashboard"
          breadcrumbs={[{ label: workspace?.name }, { label: 'My Dashboard' }]}
        />
        <PersonalDashboard workspaceId={workspaceId} userId={user?.id} userRole={userRole} />
      </>
    )
  }

  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState('30d')
  const [allLeads, setAllLeads] = useState([])
  const [transitions, setTransitions] = useState([])

  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false
    async function load() {
      setLoading(true)
      const [leadsRes, actsRes] = await Promise.all([
        supabase
          .from('leads')
          .select('id, status, arv, mao, offer_price, asking_price, list_price, lead_source, assigned_to, address, city, seller_name, is_hot, follow_up_date, created_at, updated_at')
          .eq('workspace_id', workspaceId),
        // Pull last 365 days of status-transition activities for charts + throughput
        supabase
          .from('lead_activities')
          .select('lead_id, user_id, content, metadata, created_at, leads!inner(workspace_id, assigned_to)')
          .eq('leads.workspace_id', workspaceId)
          .eq('type', 'activity')
          .gte('created_at', new Date(Date.now() - 365 * 86400000).toISOString())
          .order('created_at', { ascending: false })
          .limit(5000),
      ])
      if (cancelled) return
      setAllLeads(leadsRes.data || [])
      // Filter to ONLY status transitions
      const acts = (actsRes.data || []).filter(a => a.metadata?.field === 'status' && a.metadata?.new_value)
      setTransitions(acts)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [workspaceId])

  // ── Aggregations ────────────────────────────────────────────────────────
  const today = todayISO()
  const rangeStartDate = useMemo(() => rangeStart(range), [range])
  const rangeMs = useMemo(() => Date.now() - rangeStartDate.getTime(), [rangeStartDate])
  const prevStart = useMemo(() => new Date(rangeStartDate.getTime() - rangeMs), [rangeStartDate, rangeMs])

  // Throughput: count status transitions where new_value lands on key statuses.
  // Plus a "new_leads" track = leads.created_at within range (since 'new_lead' transition isn't always logged).
  const throughput = useMemo(() => {
    const empty = Object.fromEntries(METRIC_KEYS.map(k => [k, 0]))
    const cur = { ...empty }
    const prev = { ...empty }
    for (const a of transitions) {
      const ts = new Date(a.created_at)
      const k = TRANSITION_METRICS[a.metadata?.new_value]
      if (!k) continue
      if (ts >= rangeStartDate) cur[k]++
      else if (ts >= prevStart) prev[k]++
    }
    // Override new_leads from leads.created_at (more reliable than relying on transition logs for first state)
    cur.new_leads = 0; prev.new_leads = 0
    for (const l of allLeads) {
      const ts = new Date(l.created_at)
      if (ts >= rangeStartDate) cur.new_leads++
      else if (ts >= prevStart) prev.new_leads++
    }
    // Compute deltas
    const out = { ...cur }
    for (const k of METRIC_KEYS) out['delta_' + k] = cur[k] - prev[k]
    return out
  }, [transitions, allLeads, rangeStartDate, prevStart])

  // Leads grouped by current status (for bottlenecks)
  const leadsByStatus = useMemo(() => {
    const m = {}
    for (const l of allLeads) {
      ;(m[l.status] ||= []).push(l)
    }
    return m
  }, [allLeads])

  // Daily activity chart series — last 30 days
  const dailySeries = useMemo(() => {
    const newLeadsByDay = {}
    const offersByDay = {}
    const since = new Date(); since.setDate(since.getDate() - 30); since.setHours(0,0,0,0)
    for (const l of allLeads) {
      const d = new Date(l.created_at)
      if (d < since) continue
      const k = d.toISOString().slice(0, 10)
      newLeadsByDay[k] = (newLeadsByDay[k] || 0) + 1
    }
    for (const a of transitions) {
      if (a.metadata?.new_value !== 'offer_sent') continue
      const d = new Date(a.created_at)
      if (d < since) continue
      const k = d.toISOString().slice(0, 10)
      offersByDay[k] = (offersByDay[k] || 0) + 1
    }
    return { newLeadsByDay, offersByDay }
  }, [allLeads, transitions])

  // Offers-sent-in-range by assignee — for the teammate table
  const offersByAssignee = useMemo(() => {
    const m = {}
    for (const a of transitions) {
      if (a.metadata?.new_value !== 'offer_sent') continue
      if (new Date(a.created_at) < rangeStartDate) continue
      const uid = a.leads?.assigned_to || '__unassigned__'
      m[uid] = (m[uid] || 0) + 1
    }
    return m
  }, [transitions, rangeStartDate])

  // Top-level KPIs
  const headlines = useMemo(() => {
    const total = allLeads.length
    const hot = allLeads.filter(l => l.is_hot && !['sold','dead_lead'].includes(l.status)).length
    const followUpsToday = allLeads.filter(l => l.follow_up_date === today)
    const activePipelineArv = allLeads
      .filter(l => !['sold','dead_lead','rejected_not_accepted','not_in_buy_box','sequence_completed'].includes(l.status))
      .reduce((s, l) => s + Number(l.arv || 0), 0)
    return { total, hot, followUpsToday, activePipelineArv }
  }, [allLeads, today])

  if (loading) return <LoadingSpinner fullPage label="Loading dashboard…" />

  const greeting = (() => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 18) return 'Good afternoon'
    return 'Good evening'
  })()
  const firstName = profile?.full_name?.split(' ')[0] || ''
  const rangeLabel = (TIME_RANGES.find(r => r.value === range) || TIME_RANGES[1]).label

  // Pipeline + status breakdown reuse existing components
  const ACTIVE = ['new_lead','mao_calculated','offer_pending_hat_signing','offer_signed','offer_sent','negotiating','follow_up','offer_accepted','move_to_sequence','working_project','automated_offers','agent_rel','imported']
  const activePipeline = allLeads.filter(l => ACTIVE.includes(l.status))
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
    .slice(0, 10)
  const statusCounts = Object.fromEntries(Object.entries(leadsByStatus).map(([k, v]) => [k, v.length]))

  return (
    <>
      <Topbar title="Dashboard" />
      <div className="px-6 py-6 max-w-[1400px] w-full space-y-5 flex-1">

        {/* Greeting + range picker */}
        <section className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4 pb-5 border-b border-[color:var(--color-line)]">
          <div>
            <p className="text-[12px] text-[color:var(--color-text-dim)]">{greeting}{firstName ? `, ${firstName}` : ''}</p>
            <h2 className="text-[22px] font-semibold text-[color:var(--color-text)] tracking-tight mt-1">
              {headlines.followUpsToday.length > 0
                ? `${headlines.followUpsToday.length} follow-up${headlines.followUpsToday.length === 1 ? '' : 's'} need attention today.`
                : 'No follow-ups today. Stay sharp.'}
            </h2>
          </div>
          <div className="flex gap-2 items-center">
            <TimeRangePicker value={range} onChange={setRange} />
            <Link to={`/w/${workspaceId}/today`}>
              <Button variant="primary">Open Today →</Button>
            </Link>
          </div>
        </section>

        {/* Compact inline metrics — always visible */}
        <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-6 pb-5 border-b border-[color:var(--color-line)]">
          <StatsCard label="Total Leads" value={headlines.total} />
          <StatsCard label="🔥 Hot Active" value={headlines.hot} accent={headlines.hot > 0} />
          <StatsCard label="Follow-ups Today" value={headlines.followUpsToday.length} accent={headlines.followUpsToday.length > 0} />
          <StatsCard label="Offers Sent · range" value={throughput.offers_to_seller} />
          <StatsCard label="Offer Accepted" value={statusCounts.offer_accepted || 0} />
          <StatsCard label="Pipeline ARV" value={formatCurrency(headlines.activePipelineArv)} />
        </section>

        {/* Throughput grid */}
        <ThroughputGrid rangeLabel={rangeLabel} throughput={throughput} />

        {/* Bottlenecks */}
        <BottleneckGrid workspaceId={workspaceId} leadsByStatus={leadsByStatus} />

        {/* Daily activity chart */}
        <DailyActivityChart days={30} {...dailySeries} />

        {/* Performance tables */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SourcePerformance leads={allLeads} />
          <TeammatePerformance leads={allLeads} members={members} offersByAssignee={offersByAssignee} />
        </section>

        {/* Existing widgets — kept as bottom row */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            <PipelineWidget leads={activePipeline} workspaceId={workspaceId} />
            <StatusBreakdown counts={statusCounts} />
          </div>
          <div>
            <FollowUpWidget leads={headlines.followUpsToday} workspaceId={workspaceId} />
          </div>
        </section>
      </div>
    </>
  )
}
