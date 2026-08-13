// src/pages/AcquisitionIntelligencePage.jsx
// Capability #18 — Acquisition Intelligence / Performance dashboard.
//
// Executive operating view over the measurement layer in
// src/lib/acquisitionMetrics.js. Every number here is computed from real
// rows (leads, lead_activities, deal_financials) loaded fresh on this page
// — no new table, no LLM call, no fabricated history. "Reliable tracking
// since" is shown explicitly wherever historical coverage is limited.
import { useEffect, useMemo, useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import Topbar from '../components/Topbar'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import { supabase } from '../lib/supabase'
import { formatCurrency } from '../lib/calculations'
import { LEAD_SOURCE_MAP } from '../lib/constants'
import {
  indexActivitiesByLead, classifyLeadFunnel, computeFunnel, computeSideBuckets,
  computeSourcePerformance, computeV2Performance, computeOpportunityBuckets,
  computeFollowUpPerformance, computeOfferAnalytics, computeEconomics,
  computeDataQuality, computeExecutionMetrics,
} from '../lib/acquisitionMetrics'

// Capability #17's Log Outcome (the first reliable, structured event source
// beyond raw status changes) shipped on 2026-08-13 — everything before that
// date is reconstructed from status-change history only, which is real but
// coarser (no decision-at-time-of-action snapshot, no explicit contact
// outcome). Shown verbatim in the Data Quality panel.
const RELIABLE_TRACKING_SINCE = '2026-08-13'

const RANGES = [
  { key: '7d', label: '7 Days', days: 7 },
  { key: '30d', label: '30 Days', days: 30 },
  { key: '90d', label: '90 Days', days: 90 },
  { key: 'ytd', label: 'YTD', days: null },
  { key: 'all', label: 'All Time', days: null },
]

function pct(x) { return x == null ? '—' : `${Math.round(x * 100)}%` }
function num(x) { return x == null ? '—' : x.toLocaleString() }

function KpiCard({ label, value, sub }) {
  return (
    <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] px-4 py-3">
      <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)]">{label}</div>
      <div className="text-[22px] font-bold text-[color:var(--color-text)] tabular-nums mt-0.5">{value}</div>
      {sub && <div className="text-[10.5px] text-[color:var(--color-text-dim)] mt-0.5">{sub}</div>}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <section className="mb-7">
      <h3 className="text-[13px] font-bold uppercase tracking-wide text-[color:var(--color-text)] mb-2.5">{title}</h3>
      {children}
    </section>
  )
}

function Table({ columns, rows, onRowClick }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[color:var(--color-line)]">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="bg-[color:var(--color-bg-elev)] text-[color:var(--color-text-dim)] text-[10px] uppercase tracking-wider">
            {columns.map(c => <th key={c.key} className="text-left px-3 py-2 font-semibold whitespace-nowrap">{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={i}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              className={`border-t border-[color:var(--color-line)] ${onRowClick ? 'cursor-pointer hover:bg-[color:var(--color-bg-elev)]' : ''}`}
            >
              {columns.map(c => <td key={c.key} className="px-3 py-2 tabular-nums whitespace-nowrap">{c.render ? c.render(r) : r[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DrillDown({ facts, onClose }) {
  if (!facts) return null
  return (
    <div className="mt-2 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] font-semibold text-[color:var(--color-text)]">{facts.length} lead{facts.length === 1 ? '' : 's'}</div>
        <button type="button" onClick={onClose} className="text-[11px] text-[color:var(--color-text-dim)] hover:text-[color:var(--color-text)]">Close</button>
      </div>
      <div className="max-h-64 overflow-y-auto space-y-1">
        {facts.slice(0, 200).map(f => (
          <Link key={f.lead.id} to={`../leads/${f.lead.id}`} className="block text-[11.5px] text-[color:var(--color-accent-text)] hover:underline truncate">
            {f.lead.address}
          </Link>
        ))}
        {facts.length > 200 && <div className="text-[10.5px] text-[color:var(--color-text-dim)]">…and {facts.length - 200} more</div>}
      </div>
    </div>
  )
}

export default function AcquisitionIntelligencePage() {
  const { workspace, workspaceId } = useOutletContext()
  const [range, setRange] = useState('30d')
  const [loading, setLoading] = useState(true)
  const [leads, setLeads] = useState([])
  const [activities, setActivities] = useState([])
  const [dealFinancials, setDealFinancials] = useState([])
  const [drillKey, setDrillKey] = useState(null)

  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false
    async function load() {
      setLoading(true)
      const { data: leadRows } = await supabase
        .from('leads')
        .select('id, address, status, lead_source, created_at, decision_v2, offer_price, asking_price, mao, contract_signed_date, follow_up_date, deal_analysis')
        .eq('workspace_id', workspaceId)
      const leadIds = (leadRows || []).map(l => l.id)
      let activityRows = []
      if (leadIds.length > 0) {
        const { data } = await supabase.from('lead_activities').select('lead_id, type, metadata, created_at').in('lead_id', leadIds)
        activityRows = data || []
      }
      const { data: dfRows } = await supabase.from('deal_financials').select('lead_id, purchase_date, sold_date, actual_sale_price, purchase_price_actual').eq('workspace_id', workspaceId)
      if (!cancelled) {
        setLeads(leadRows || [])
        setActivities(activityRows)
        setDealFinancials(dfRows || [])
        setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [workspaceId])

  const rangedLeads = useMemo(() => {
    const r = RANGES.find(x => x.key === range)
    if (range === 'all') return leads
    let cutoff
    if (range === 'ytd') cutoff = new Date(new Date().getFullYear(), 0, 1)
    else cutoff = new Date(Date.now() - r.days * 86400000)
    return leads.filter(l => l.created_at && new Date(l.created_at) >= cutoff)
  }, [leads, range])

  const facts = useMemo(() => {
    const activitiesByLead = indexActivitiesByLead(activities)
    const dealFinancialsByLead = new Map(dealFinancials.map(df => [df.lead_id, df]))
    return rangedLeads.map(l => classifyLeadFunnel(l, activitiesByLead, dealFinancialsByLead))
  }, [rangedLeads, activities, dealFinancials])

  const funnel = useMemo(() => computeFunnel(facts), [facts])
  const sideBuckets = useMemo(() => computeSideBuckets(facts), [facts])
  const sourcePerf = useMemo(() => computeSourcePerformance(facts), [facts])
  const v2Perf = useMemo(() => computeV2Performance(facts), [facts])
  const oppBuckets = useMemo(() => computeOpportunityBuckets(facts), [facts])
  const followUp = useMemo(() => computeFollowUpPerformance(facts), [facts])
  const offers = useMemo(() => computeOfferAnalytics(facts), [facts])
  const economics = useMemo(() => computeEconomics(facts, dealFinancials), [facts, dealFinancials])
  const dataQuality = useMemo(() => computeDataQuality(facts), [facts])
  const execMetrics = useMemo(() => computeExecutionMetrics(facts), [facts])

  if (loading) return <LoadingSpinner fullPage label="Computing acquisition metrics…" />

  const drillFacts = drillKey ? facts.filter(drillKey.filterFn) : null

  return (
    <>
      <Topbar title="Acquisition Intelligence" breadcrumbs={[{ label: workspace.name }, { label: 'Acquisition Intelligence' }]} />

      <div className="px-6 py-6 w-full flex-1 max-w-[1200px]">
        {/* Date range */}
        <div className="flex flex-wrap gap-1.5 mb-5">
          {RANGES.map(r => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRange(r.key)}
              className={`text-[11.5px] font-semibold px-2.5 h-7 rounded-full border transition-colors ${
                range === r.key
                  ? 'bg-[color:var(--color-accent)] border-[color:var(--color-accent)] text-white'
                  : 'bg-[color:var(--color-bg-elev)] border-[color:var(--color-line)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]'
              }`}
            >
              {r.label}
            </button>
          ))}
          <span className="text-[10.5px] text-[color:var(--color-text-dim)] self-center ml-2">
            Reliable event tracking since {RELIABLE_TRACKING_SINCE} — earlier data reconstructed from status history only.
          </span>
        </div>

        {/* Top KPI row */}
        <Section title="Summary">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard label="Leads Received" value={num(funnel[0].count)} />
            <KpiCard label="Actionable" value={num(funnel[2].count)} />
            <KpiCard label="Contacts" value={num(funnel[4].count)} />
            <KpiCard label="Offers Sent" value={num(funnel[5].count)} />
            <KpiCard label="Under Contract" value={num(funnel[7].count)} />
            <KpiCard label="Acquired" value={num(funnel[8].count)} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3">
            <KpiCard label="Lead → Offer" value={pct(funnel[5].conversionFromStart)} />
            <KpiCard label="Offer → Contract" value={pct(funnel[5].count ? funnel[7].count / funnel[5].count : null)} />
            <KpiCard label="Lead → Acquisition" value={pct(funnel[8].conversionFromStart)} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
            <KpiCard label="Follow-Ups Completed" value={num(followUp.completed)} />
            <KpiCard label="Re-Engagement Opportunities" value={num(followUp.reEngageOpportunities)} />
            <KpiCard label="Active Negotiations" value={num(execMetrics.activeNegotiations)} />
            <KpiCard label="Overdue Follow-Ups" value={num(followUp.overdue)} />
          </div>
        </Section>

        {/* Funnel */}
        <Section title="Acquisition Funnel">
          <Table
            columns={[
              { key: 'label', label: 'Stage' },
              { key: 'count', label: 'Count' },
              { key: 'conversionFromPrev', label: '% of Prev', render: r => pct(r.conversionFromPrev) },
              { key: 'conversionFromStart', label: '% of Total', render: r => pct(r.conversionFromStart) },
            ]}
            rows={funnel}
            onRowClick={(r) => {
              const idx = funnel.findIndex(s => s.key === r.key)
              setDrillKey({ label: r.label, filterFn: f => f.furthestRank >= idx })
            }}
          />
          <div className="text-[10.5px] text-[color:var(--color-text-dim)] mt-1.5">
            Side buckets (not counted forward): Pass {num(sideBuckets.pass)} · Not In Buy Box {num(sideBuckets.notFit)} · Dead {num(sideBuckets.dead)} · Lost {num(sideBuckets.lost)}
          </div>
          {drillKey && <DrillDown facts={drillFacts} onClose={() => setDrillKey(null)} />}
        </Section>

        {/* Source performance */}
        <Section title="Source Performance">
          <Table
            columns={[
              { key: 'source', label: 'Source', render: r => LEAD_SOURCE_MAP[r.source]?.label || r.source },
              { key: 'leads', label: 'Leads' },
              { key: 'buyBoxFitPct', label: 'Buy Box Fit', render: r => pct(r.buyBoxFitPct) },
              { key: 'actionablePct', label: 'Actionable', render: r => pct(r.actionablePct) },
              { key: 'contactPct', label: 'Contact', render: r => pct(r.contactPct) },
              { key: 'offerPct', label: 'Offer', render: r => pct(r.offerPct) },
              { key: 'contractPct', label: 'Contract', render: r => pct(r.contractPct) },
              { key: 'acquisitionPct', label: 'Acquired', render: r => pct(r.acquisitionPct) },
              { key: 'avgOpportunity', label: 'Avg Opportunity', render: r => r.avgOpportunity != null ? Math.round(r.avgOpportunity) : '—' },
            ]}
            rows={sourcePerf}
          />
        </Section>

        {/* V2 performance */}
        <Section title="V2 Decision Engine Performance">
          <Table
            columns={[
              { key: 'recommendation', label: 'Recommendation (at action, else current)' },
              { key: 'leads', label: 'Leads' },
              { key: 'contacted', label: 'Contacted' },
              { key: 'offers', label: 'Offers' },
              { key: 'contracts', label: 'Contracts' },
              { key: 'acquisitions', label: 'Acquisitions' },
            ]}
            rows={v2Perf}
          />
          <div className="text-[10.5px] text-[color:var(--color-text-dim)] mt-2 mb-1.5">By Opportunity score bucket:</div>
          <Table
            columns={[
              { key: 'label', label: 'Opportunity' },
              { key: 'leads', label: 'Leads' },
              { key: 'offers', label: 'Offers' },
              { key: 'contracts', label: 'Contracts' },
              { key: 'acquisitions', label: 'Acquisitions' },
            ]}
            rows={oppBuckets}
          />
        </Section>

        {/* Offer analytics */}
        <Section title="Offer / Negotiation Analytics">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiCard label="Avg Offer / Ask" value={pct(offers.avgOfferToAskPct)} sub={`n=${offers.offersWithAskData}`} />
            <KpiCard label="Avg Offer / MAO" value={pct(offers.avgOfferToMaoPct)} sub={`n=${offers.offersWithMaoData}`} />
            <KpiCard label="Counters Logged" value={num(offers.countersLogged)} />
            <KpiCard label="Offers Sent" value={num(execMetrics.offersSent)} />
          </div>
        </Section>

        {/* Economics */}
        <Section title="Economic Value">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <KpiCard label="Pipeline Value (active, projected)" value={formatCurrency(economics.pipelineValue)} sub={`${economics.pipelineCount} leads`} />
            <KpiCard label="Projected Profit (under contract)" value={formatCurrency(economics.projectedProfit)} sub={`${economics.projectedCount} leads`} />
            <KpiCard label="Realized Profit (closed, actual)" value={formatCurrency(economics.realizedProfit)} sub={`${economics.realizedCount} deals — deal_financials`} />
          </div>
        </Section>

        {/* Data quality */}
        <Section title="Data Quality">
          <div className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] px-4 py-3 text-[12px] text-[color:var(--color-text)]">
            <div className="font-semibold mb-1">Tracking Coverage: {pct(dataQuality.coveragePct)}</div>
            <div className="text-[11px] text-[color:var(--color-text-muted)] space-y-0.5">
              <div>{dataQuality.missingSource} leads missing lead_source</div>
              <div>{dataQuality.missingDecision} leads with no decision_v2 yet</div>
              <div>{dataQuality.offersMissingAmount} offers missing offer_price</div>
              <div>{dataQuality.contractsMissingDate} contracts missing contract_signed_date</div>
            </div>
          </div>
        </Section>
      </div>
    </>
  )
}
