// src/pages/ProjectsPage.jsx
import { useEffect, useState, useMemo } from 'react'
import { useOutletContext, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { calcDeal, fmtUSD, fmtPct, dealRatingColor } from '../lib/dealCalculations'
import Topbar from '../components/Topbar'
import LoadingSpinner from '../components/ui/LoadingSpinner'

// ─── tiny helpers ───────────────────────────────────────────────────────────
const dim   = 'text-[color:var(--color-text-dim)]'
const muted = 'text-[color:var(--color-text-muted)]'
const success = 'text-[color:var(--color-success-text)]'
const danger  = 'text-[color:var(--color-danger-text)]'
const accent  = 'text-[color:var(--color-accent-text)]'

function StatCard({ label, value, sub, color, wide }) {
  return (
    <div className={`rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] p-4 ${wide ? 'col-span-2' : ''}`}>
      <div className={`text-[10px] uppercase tracking-wider font-medium mb-1 ${dim}`}>{label}</div>
      <div className={`text-[22px] font-bold leading-none ${color || 'text-[color:var(--color-text)]'}`}>{value}</div>
      {sub && <div className={`text-[11px] mt-1.5 ${muted}`}>{sub}</div>}
    </div>
  )
}

function InsightCard({ icon, title, body, tone = 'neutral' }) {
  const bg = tone === 'danger'  ? 'border-[color:var(--color-danger)] bg-[color:var(--color-danger-soft)]'
           : tone === 'warn'    ? 'border-orange-300 bg-orange-50 dark:bg-orange-950/20'
           : tone === 'success' ? 'border-[color:var(--color-success)] bg-[color:var(--color-success-soft)]'
           : 'border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)]'
  const titleColor = tone === 'danger'  ? danger
                   : tone === 'warn'    ? 'text-orange-700 dark:text-orange-300'
                   : tone === 'success' ? success
                   : 'text-[color:var(--color-text)]'
  return (
    <div className={`rounded-xl border p-3.5 ${bg}`}>
      <div className={`text-[12px] font-semibold mb-1 ${titleColor}`}>{icon} {title}</div>
      <div className={`text-[11.5px] leading-snug ${muted}`}>{body}</div>
    </div>
  )
}

const TYPE_BADGE = {
  Cash:     'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  Financed: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
}

const STATUS_LABELS = { working_project: 'Active', sold: 'Sold' }
const STATUS_CLS    = {
  working_project: 'bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)]',
  sold:            'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)]',
}

const SORT_OPTIONS = [
  { value: 'annRoi',       label: 'Ann. ROI' },
  { value: 'profit',       label: 'Profit' },
  { value: 'cashIn',       label: 'Cash Invested' },
  { value: 'allInVsARV',   label: 'All-In / ARV' },
  { value: 'hold',         label: 'Hold Months' },
]

export default function ProjectsPage() {
  const { workspace, workspaceId } = useOutletContext()
  const navigate = useNavigate()
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('All')       // All | Active | Sold
  const [typeFilter, setTypeFilter]     = useState('All')       // All | Cash | HML
  const [ratingFilter, setRatingFilter] = useState('All')       // All | A | B | C | D
  const [sortBy, setSortBy]             = useState('annRoi')
  const [sortDir, setSortDir]           = useState('desc')

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const { data: fins } = await supabase
        .from('deal_financials')
        .select('*, leads!inner(id, address, city, state, status, workspace_id)')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })

      if (!fins?.length) { setRows([]); setLoading(false); return }

      const projectFins = fins.filter(f => ['working_project', 'sold'].includes(f.leads?.status))
      if (!projectFins.length) { setRows([]); setLoading(false); return }

      const leadIds = projectFins.map(f => f.lead_id)
      const { data: allItems } = await supabase
        .from('deal_renovation_items')
        .select('*')
        .in('lead_id', leadIds)

      const itemsByLead = {}
      for (const item of allItems || []) {
        if (!itemsByLead[item.lead_id]) itemsByLead[item.lead_id] = []
        itemsByLead[item.lead_id].push(item)
      }

      setRows(projectFins.map(f => ({
        financials: f,
        lead: f.leads,
        items: itemsByLead[f.lead_id] || [],
        calc: calcDeal(f, itemsByLead[f.lead_id] || []),
      })))
      setLoading(false)
    }
    load()
  }, [workspaceId])

  // ── Portfolio-level aggregates ──────────────────────────────────────────
  const portfolio = useMemo(() => {
    const active = rows.filter(r => r.lead?.status !== 'sold')
    const sold   = rows.filter(r => r.lead?.status === 'sold')
    const cash   = active.filter(r => r.financials.renovation_financing === 'Cash')
    const hml    = active.filter(r => r.financials.renovation_financing !== 'Cash')

    const totalLocked       = active.reduce((s, r) => s + (r.calc?.totalCashInvested || 0), 0)
    const cashLocked        = cash.reduce((s, r)   => s + (r.calc?.totalCashInvested || 0), 0)
    const hmlLocked         = hml.reduce((s, r)    => s + (r.calc?.totalCashInvested || 0), 0)
    const expectedProfit    = active.reduce((s, r) => s + (r.calc?.expected?.netProfit || 0), 0)
    const realizedProfit    = sold.reduce((s, r)   => s + (r.calc?.actual?.netProfit || r.calc?.expected?.netProfit || 0), 0)
    const cashExpected      = cash.reduce((s, r)   => s + (r.calc?.expected?.netProfit || 0), 0)
    const hmlExpected       = hml.reduce((s, r)    => s + (r.calc?.expected?.netProfit || 0), 0)
    const avgAnnRoi         = active.length > 0
      ? active.reduce((s, r) => s + (r.calc?.expected?.annualizedRoi || 0), 0) / active.length : 0

    // Best / worst by annualized ROI (active only)
    const byAnnRoi = [...active].sort((a, b) => (b.calc?.expected?.annualizedRoi || 0) - (a.calc?.expected?.annualizedRoi || 0))
    const best  = byAnnRoi[0]
    const worst = byAnnRoi[byAnnRoi.length - 1]

    // Most cash locked
    const mostLocked = [...active].sort((a, b) => (b.calc?.totalCashInvested || 0) - (a.calc?.totalCashInvested || 0))[0]

    // Risk: all-in vs ARV > 80%
    const risky = active.filter(r => (r.calc?.allInVsARV || 0) > 0.80)

    // Average hold months
    const avgHold = rows.length > 0
      ? rows.reduce((s, r) => s + (r.financials.hold_months || 0), 0) / rows.length : 0

    return {
      active: active.length, sold: sold.length,
      totalLocked, cashLocked, hmlLocked,
      expectedProfit, realizedProfit,
      cashExpected, hmlExpected,
      totalPnL: realizedProfit + expectedProfit,
      avgAnnRoi, avgHold,
      best, worst, mostLocked, risky,
      cashCount: cash.length, hmlCount: hml.length,
    }
  }, [rows])

  // ── Insights ─────────────────────────────────────────────────────────────
  const insights = useMemo(() => {
    const out = []

    if (portfolio.risky.length > 0) {
      const names = portfolio.risky.map(r => r.lead?.address?.split(',')[0]).join(', ')
      out.push({ tone: 'danger', icon: '⚠️', title: 'High Exposure Deals', body: `${names} — all-in cost exceeds 80% of ARV. Limited margin for cost overruns or a soft market.` })
    }

    if (portfolio.best) {
      const r = portfolio.best
      out.push({ tone: 'success', icon: '🏆', title: 'Best Capital Efficiency', body: `${r.lead?.address?.split(',')[0]}: ${(( r.calc?.expected?.annualizedRoi || 0)*100).toFixed(0)}% annualized ROI — highest return per dollar invested of all active deals.` })
    }

    if (portfolio.cashLocked > 200000) {
      out.push({ tone: 'warn', icon: '🔒', title: 'Heavy Cash Concentration', body: `$${Math.round(portfolio.cashLocked/1000)}K locked in ${portfolio.cashCount} all-cash deal${portfolio.cashCount>1?'s':''}. These funds are illiquid until sold. Cash deals produce lower ROI than equivalent HML deals.` })
    }

    if (portfolio.worst && portfolio.worst !== portfolio.best) {
      const r = portfolio.worst
      const annRoi = (r.calc?.expected?.annualizedRoi || 0) * 100
      if (annRoi < 20) {
        out.push({ tone: 'danger', icon: '📉', title: 'Weakest Deal', body: `${r.lead?.address?.split(',')[0]}: only ${annRoi.toFixed(0)}% annualized ROI. Consider whether capital could be redeployed more efficiently after this exit.` })
      }
    }

    if (portfolio.mostLocked) {
      const r = portfolio.mostLocked
      out.push({ tone: 'neutral', icon: '💰', title: 'Largest Capital Position', body: `${r.lead?.address?.split(',')[0]}: $${Math.round((r.calc?.totalCashInvested||0)/1000)}K invested — your single biggest cash exposure. A delay or reno overrun here has the most impact on liquidity.` })
    }

    if (portfolio.hmlCount > 0 && portfolio.cashCount > 0) {
      const hmlReturnRate = portfolio.hmlLocked > 0 ? portfolio.hmlExpected / portfolio.hmlLocked : 0
      const cashReturnRate = portfolio.cashLocked > 0 ? portfolio.cashExpected / portfolio.cashLocked : 0
      if (hmlReturnRate > cashReturnRate * 1.5) {
        out.push({ tone: 'neutral', icon: '📊', title: 'HML vs Cash Efficiency', body: `HML deals return ${(hmlReturnRate*100).toFixed(0)}¢ per dollar invested vs ${(cashReturnRate*100).toFixed(0)}¢ for cash deals. Leverage is working in your favor — consider HML for future deals where possible.` })
      }
    }

    out.push({ tone: 'neutral', icon: '📅', title: 'Average Hold Time', body: `${portfolio.avgHold.toFixed(1)} months across all ${rows.length} deals. Shorter holds = faster capital recycling and lower carrying cost exposure.` })

    return out
  }, [portfolio, rows.length])

  // ── Filtered + sorted rows ────────────────────────────────────────────────
  const displayRows = useMemo(() => {
    let r = [...rows]
    if (statusFilter === 'Active') r = r.filter(x => x.lead?.status !== 'sold')
    if (statusFilter === 'Sold')   r = r.filter(x => x.lead?.status === 'sold')
    if (typeFilter === 'Cash') r = r.filter(x => x.financials.renovation_financing === 'Cash')
    if (typeFilter === 'HML')  r = r.filter(x => x.financials.renovation_financing !== 'Cash')
    if (ratingFilter !== 'All') r = r.filter(x => x.calc?.dealRating?.startsWith(ratingFilter))

    const key = (x) => {
      const c = x.calc
      if (sortBy === 'annRoi')     return c?.actual?.annualizedRoi ?? c?.expected?.annualizedRoi ?? 0
      if (sortBy === 'profit')     return c?.actual?.netProfit ?? c?.expected?.netProfit ?? 0
      if (sortBy === 'cashIn')     return c?.totalCashInvested ?? 0
      if (sortBy === 'allInVsARV') return c?.allInVsARV ?? 0
      if (sortBy === 'hold')       return x.financials.hold_months ?? 0
      return 0
    }
    r.sort((a, b) => sortDir === 'desc' ? key(b) - key(a) : key(a) - key(b))
    return r
  }, [rows, statusFilter, typeFilter, ratingFilter, sortBy, sortDir])

  const activeRows = displayRows.filter(r => r.lead?.status !== 'sold')
  const soldRows   = displayRows.filter(r => r.lead?.status === 'sold')

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortBy(col); setSortDir('desc') }
  }
  const sortIcon = (col) => sortBy === col ? (sortDir === 'desc' ? ' ▼' : ' ▲') : ''

  // ── Chart data: annualized ROI per deal ──────────────────────────────────
  const chartRows = useMemo(() =>
    [...rows]
      .filter(r => r.calc?.expected || r.calc?.actual)
      .sort((a, b) => {
        const ra = a.calc?.actual?.annualizedRoi ?? a.calc?.expected?.annualizedRoi ?? 0
        const rb = b.calc?.actual?.annualizedRoi ?? b.calc?.expected?.annualizedRoi ?? 0
        return rb - ra
      })
  , [rows])
  const maxAnnRoi = chartRows.length > 0 ? Math.max(...chartRows.map(r => Math.abs(r.calc?.actual?.annualizedRoi ?? r.calc?.expected?.annualizedRoi ?? 0))) : 1

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      <Topbar
        title="Projects"
        breadcrumbs={[{ label: workspace?.name, to: `/w/${workspaceId}` }, { label: 'Projects' }]}
      />

      <div className="p-4 space-y-6 max-w-[1400px]">

        {/* ── TOP STATS BAR ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <StatCard label="Cash Locked (Active)" value={fmtUSD(portfolio.totalLocked)} sub={`${portfolio.active} active deal${portfolio.active !== 1 ? 's' : ''}`} color="text-[color:var(--color-text)]" />
          <StatCard label="Expected Pipeline"    value={fmtUSD(portfolio.expectedProfit)} sub="from active deals" color={success} />
          <StatCard label="Realized Profit"      value={fmtUSD(portfolio.realizedProfit)} sub={`${portfolio.sold} sold deal${portfolio.sold !== 1 ? 's' : ''}`} color={success} />
          <StatCard label="Total P&amp;L"        value={fmtUSD(portfolio.totalPnL)} sub="realized + expected" color={portfolio.totalPnL >= 0 ? success : danger} />
          <StatCard label="Avg Ann. ROI (active)"value={fmtPct(portfolio.avgAnnRoi)} sub="annualized, all active" />
          <StatCard label="Avg Hold Time"        value={`${portfolio.avgHold.toFixed(1)} mo`} sub={`across ${rows.length} deals`} />
        </div>

        {/* ── CASH vs HML COMPARISON ── */}
        {portfolio.cashCount > 0 && portfolio.hmlCount > 0 && (
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] p-4">
              <div className={`text-[10px] uppercase tracking-wider font-medium mb-3 ${dim}`}>Cash Deals ({portfolio.cashCount} active)</div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div><div className="text-[17px] font-bold">{fmtUSD(portfolio.cashLocked)}</div><div className={`text-[10px] ${dim}`}>Locked</div></div>
                <div><div className={`text-[17px] font-bold ${success}`}>{fmtUSD(portfolio.cashExpected)}</div><div className={`text-[10px] ${dim}`}>Expected Profit</div></div>
                <div><div className="text-[17px] font-bold">{portfolio.cashLocked > 0 ? fmtPct(portfolio.cashExpected / portfolio.cashLocked) : '—'}</div><div className={`text-[10px] ${dim}`}>Return on Cash</div></div>
              </div>
            </div>
            <div className="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] p-4">
              <div className={`text-[10px] uppercase tracking-wider font-medium mb-3 ${dim}`}>HML Deals ({portfolio.hmlCount} active)</div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div><div className="text-[17px] font-bold">{fmtUSD(portfolio.hmlLocked)}</div><div className={`text-[10px] ${dim}`}>Locked</div></div>
                <div><div className={`text-[17px] font-bold ${success}`}>{fmtUSD(portfolio.hmlExpected)}</div><div className={`text-[10px] ${dim}`}>Expected Profit</div></div>
                <div><div className="text-[17px] font-bold">{portfolio.hmlLocked > 0 ? fmtPct(portfolio.hmlExpected / portfolio.hmlLocked) : '—'}</div><div className={`text-[10px] ${dim}`}>Return on Cash</div></div>
              </div>
            </div>
          </div>
        )}

        {/* ── INSIGHTS ── */}
        {insights.length > 0 && (
          <div>
            <div className={`text-[10px] uppercase tracking-wider font-semibold mb-2 ${dim}`}>Insights</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {insights.map((ins, i) => <InsightCard key={i} {...ins} />)}
            </div>
          </div>
        )}

        {/* ── ANNUALIZED ROI CHART ── */}
        {chartRows.length > 0 && (
          <div className="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] p-4">
            <div className={`text-[10px] uppercase tracking-wider font-semibold mb-3 ${dim}`}>Annualized ROI by Deal</div>
            <div className="space-y-2">
              {chartRows.map(({ financials: f, lead, calc }) => {
                const annRoi  = calc?.actual?.annualizedRoi ?? calc?.expected?.annualizedRoi ?? 0
                const profit  = calc?.actual?.netProfit ?? calc?.expected?.netProfit ?? 0
                const barPct  = maxAnnRoi > 0 ? Math.min(Math.abs(annRoi) / maxAnnRoi * 100, 100) : 0
                const isCash  = f.renovation_financing === 'Cash'
                const isSold  = lead?.status === 'sold'
                const isActual = calc?.actual?.netProfit != null
                const shortAddr = (lead?.address || '—').split(',')[0]
                return (
                  <div key={f.id} className="flex items-center gap-3 group cursor-pointer" onClick={() => navigate(`/w/${workspaceId}/projects/${lead.id}`)}>
                    <div className="flex items-center gap-1.5 w-44 shrink-0">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${isCash ? TYPE_BADGE.Cash : TYPE_BADGE.Financed}`}>{isCash ? 'CASH' : 'HML'}</span>
                      <span className={`text-[11px] truncate group-hover:text-[color:var(--color-accent)] transition-colors ${muted}`}>{shortAddr}</span>
                    </div>
                    <div className="flex-1 h-5 bg-[color:var(--color-bg-elev-2)] rounded overflow-hidden">
                      <div
                        className={`h-full rounded transition-all duration-500 ${annRoi >= 0 ? (isSold ? 'bg-[color:var(--color-success)]' : 'bg-[color:var(--color-accent)]') : 'bg-[color:var(--color-danger)]'}`}
                        style={{ width: `${barPct}%` }}
                      />
                    </div>
                    <div className="text-right shrink-0 w-28">
                      <div className={`text-[11px] font-semibold ${annRoi >= 0 ? success : danger}`}>{fmtPct(annRoi)}{!isActual && <span className={`font-normal ${dim}`}> est</span>}</div>
                      <div className={`text-[10px] ${dim}`}>{fmtUSD(profit)} profit</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── FILTERS ── */}
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex gap-1">
            {['All', 'Active', 'Sold'].map(f => (
              <button key={f} onClick={() => setStatusFilter(f)}
                className={`px-3 py-1 rounded-full text-[12px] font-medium transition-colors ${statusFilter === f ? 'bg-[color:var(--color-accent)] text-white' : 'bg-[color:var(--color-bg-elev)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]'}`}>
                {f}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            {['All', 'Cash', 'HML'].map(f => (
              <button key={f} onClick={() => setTypeFilter(f)}
                className={`px-3 py-1 rounded-full text-[12px] font-medium transition-colors ${typeFilter === f ? 'bg-[color:var(--color-accent)] text-white' : 'bg-[color:var(--color-bg-elev)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]'}`}>
                {f}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            {['All', 'A', 'B', 'C', 'D'].map(f => (
              <button key={f} onClick={() => setRatingFilter(f)}
                className={`px-3 py-1 rounded-full text-[12px] font-medium transition-colors ${ratingFilter === f ? 'bg-[color:var(--color-accent)] text-white' : 'bg-[color:var(--color-bg-elev)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]'}`}>
                {f === 'All' ? 'All Ratings' : `${f}-Rating`}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 ml-auto">
            <span className={`text-[11px] ${dim}`}>Sort:</span>
            <select value={sortBy} onChange={e => setSortBy(e.target.value)}
              className="h-7 px-2 text-[12px] rounded border border-[color:var(--color-line)] bg-[color:var(--color-bg-input)] text-[color:var(--color-text)]">
              {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <button onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
              className={`h-7 w-7 flex items-center justify-center rounded border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] text-[12px] ${muted}`}>
              {sortDir === 'desc' ? '▼' : '▲'}
            </button>
          </div>
        </div>

        {loading ? <LoadingSpinner label="Loading projects…" /> : (
          <>
            {displayRows.length === 0 ? (
              <div className="text-center py-12 text-[13px] text-[color:var(--color-text-dim)]">
                No projects match the current filters.
              </div>
            ) : (
              <>
                {/* ── ACTIVE DEALS TABLE ── */}
                {activeRows.length > 0 && (
                  <ProjectTable
                    rows={activeRows} title={`Active Deals (${activeRows.length})`}
                    workspaceId={workspaceId} navigate={navigate}
                    sortBy={sortBy} toggleSort={toggleSort} sortIcon={sortIcon}
                    showActual={false}
                  />
                )}

                {/* ── SOLD DEALS TABLE ── */}
                {soldRows.length > 0 && (
                  <ProjectTable
                    rows={soldRows} title={`Sold Deals (${soldRows.length})`}
                    workspaceId={workspaceId} navigate={navigate}
                    sortBy={sortBy} toggleSort={toggleSort} sortIcon={sortIcon}
                    showActual={true}
                  />
                )}
              </>
            )}
          </>
        )}
      </div>
    </>
  )
}

// ─── Reusable table component ────────────────────────────────────────────────
function ProjectTable({ rows, title, workspaceId, navigate, sortBy, toggleSort, sortIcon, showActual }) {
  const TH = ({ col, label }) => (
    <th
      onClick={col ? () => toggleSort(col) : undefined}
      className={`text-left px-3 py-2.5 text-[10.5px] uppercase tracking-wider font-medium text-[color:var(--color-text-dim)] whitespace-nowrap ${col ? 'cursor-pointer hover:text-[color:var(--color-text)] select-none' : ''}`}
    >
      {label}{col ? sortIcon(col) : ''}
    </th>
  )

  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)] mb-2">{title}</div>
      <div className="overflow-x-auto rounded-xl border border-[color:var(--color-line)]">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)]">
              <TH label="Property" />
              <TH label="Type" />
              <TH label="Purchase" />
              <TH label="All-In" />
              <TH col="allInVsARV" label="All-In/ARV" />
              <TH col="cashIn"  label="Cash In" />
              <TH col="profit"  label={showActual ? 'Actual Profit' : 'Exp. Profit'} />
              {showActual && <TH label="vs Expected" />}
              <TH col="annRoi" label="Ann. ROI" />
              <TH col="hold"   label="Hold" />
              <TH label="Rating" />
              <TH label="Flags" />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ financials: f, lead, calc }) => {
              const expectedProfit = calc?.expected?.netProfit
              const actualProfit   = calc?.actual?.netProfit
              const displayProfit  = showActual && actualProfit != null ? actualProfit : expectedProfit
              const annRoi = showActual && actualProfit != null ? calc?.actual?.annualizedRoi : calc?.expected?.annualizedRoi
              const allInVsARV = calc?.allInVsARV || 0
              const cashIn = calc?.totalCashInvested || 0
              const isCash = f.renovation_financing === 'Cash'
              const shortAddr = (lead?.address || '—').split(',')[0]

              // variance: actual vs expected
              const variance = (showActual && actualProfit != null && expectedProfit != null)
                ? actualProfit - expectedProfit : null

              // flags
              const flags = []
              if (allInVsARV > 0.85) flags.push({ label: '>85% ARV', cls: 'bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-text)]' })
              else if (allInVsARV > 0.75) flags.push({ label: '>75% ARV', cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' })
              if (displayProfit != null && displayProfit < 20000) flags.push({ label: 'Low Profit', cls: 'bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-text)]' })
              if ((annRoi || 0) < 0.20 && (annRoi || 0) > -999) flags.push({ label: 'Low ROI', cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' })

              return (
                <tr
                  key={f.id}
                  onClick={() => navigate(`/w/${workspaceId}/projects/${lead.id}`)}
                  className="border-t border-[color:var(--color-line)] hover:bg-[color:var(--color-bg-elev)] cursor-pointer transition-colors"
                >
                  <td className="px-3 py-2.5 font-medium text-[color:var(--color-text)] max-w-[150px]">
                    <div className="truncate" title={lead?.address}>{shortAddr}</div>
                    <div className="text-[10px] text-[color:var(--color-text-dim)] truncate">{(lead?.address || '').replace(shortAddr, '').replace(/^,\s*/, '')}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${isCash ? TYPE_BADGE.Cash : TYPE_BADGE.Financed}`}>
                      {isCash ? 'CASH' : 'HML'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-[color:var(--color-text-muted)]">{fmtUSD(f.purchase_price_actual)}</td>
                  <td className="px-3 py-2.5 text-[color:var(--color-text-muted)]">{calc ? fmtUSD(calc.totalAllInCost) : '—'}</td>
                  <td className="px-3 py-2.5">
                    <span className={allInVsARV > 0.80 ? 'text-[color:var(--color-danger-text)] font-semibold' : allInVsARV > 0.75 ? 'text-orange-600 dark:text-orange-400' : 'text-[color:var(--color-text-muted)]'}>
                      {allInVsARV > 0 ? fmtPct(allInVsARV) : '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-[color:var(--color-text-muted)] font-medium">{fmtUSD(cashIn)}</td>
                  <td className="px-3 py-2.5">
                    {displayProfit != null ? (
                      <span className={`font-semibold ${displayProfit >= 30000 ? 'text-[color:var(--color-success-text)]' : displayProfit >= 0 ? 'text-orange-600 dark:text-orange-400' : 'text-[color:var(--color-danger-text)]'}`}>
                        {fmtUSD(displayProfit)}
                      </span>
                    ) : '—'}
                  </td>
                  {showActual && (
                    <td className="px-3 py-2.5">
                      {variance != null ? (
                        <span className={variance >= 0 ? 'text-[color:var(--color-success-text)]' : 'text-[color:var(--color-danger-text)]'}>
                          {variance >= 0 ? '+' : ''}{fmtUSD(variance)}
                        </span>
                      ) : '—'}
                    </td>
                  )}
                  <td className="px-3 py-2.5">
                    <span className={`font-semibold ${(annRoi||0) >= 0.50 ? 'text-[color:var(--color-success-text)]' : (annRoi||0) >= 0.20 ? 'text-[color:var(--color-text-muted)]' : 'text-[color:var(--color-danger-text)]'}`}>
                      {annRoi != null ? fmtPct(annRoi) : '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-[color:var(--color-text-muted)]">{f.hold_months ? `${f.hold_months}mo` : '—'}</td>
                  <td className="px-3 py-2.5">
                    {calc?.dealRating && (
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${dealRatingColor(calc.dealRating)}`}>
                        {calc.dealRating.split(' - ')[0]}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {flags.map((fl, i) => (
                        <span key={i} className={`text-[9.5px] px-1.5 py-0.5 rounded font-medium ${fl.cls}`}>{fl.label}</span>
                      ))}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
