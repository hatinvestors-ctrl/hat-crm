// src/pages/ProjectsPage.jsx
import { useEffect, useState, useMemo } from 'react'
import { useOutletContext, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { calcDeal, fmtUSD, fmtPct, dealRatingColor } from '../lib/dealCalculations'
import Topbar from '../components/Topbar'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import ProjectsIntelligencePage from './ProjectsIntelligencePage'

// ─── tiny helpers ───────────────────────────────────────────────────────────
const dim   = 'text-[color:var(--color-text-dim)]'
const muted = 'text-[color:var(--color-text-muted)]'
const success = 'text-[color:var(--color-success-text)]'
const danger  = 'text-[color:var(--color-danger-text)]'
const accent  = 'text-[color:var(--color-accent-text)]'

function FilterGroup({ label, options, value, onChange }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider font-medium text-[color:var(--color-text-dim)]">{label}</span>
      <div className="flex gap-1">
        {options.map(o => (
          <button key={o.value} onClick={() => onChange(o.value)}
            className={`px-3 py-1 rounded-full text-[12px] font-medium transition-colors whitespace-nowrap ${
              value === o.value
                ? 'bg-[color:var(--color-accent)] text-white'
                : 'bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]'
            }`}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function StatCard({ label, value, sub, color, id, activeId, onToggle }) {
  const isOpen = activeId === id
  const clickable = !!id
  return (
    <div
      onClick={clickable ? () => onToggle(id) : undefined}
      className={`rounded-xl border p-4 transition-colors ${
        isOpen
          ? 'border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)]'
          : 'border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)]'
      } ${clickable ? 'cursor-pointer hover:border-[color:var(--color-accent)] select-none' : ''}`}
    >
      <div className={`text-[10px] uppercase tracking-wider font-medium mb-1 flex items-center gap-1 ${isOpen ? 'text-[color:var(--color-accent-text)]' : dim}`}>
        {label}
        {clickable && <span className="opacity-50 text-[9px]">{isOpen ? '▲' : '▼'}</span>}
      </div>
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

function StatBreakdownPanel({ id, rows, navigate, workspaceId }) {
  const active = rows.filter(r => !isSoldStatus(r.lead?.status))
  const sold   = rows.filter(r => isSoldStatus(r.lead?.status))

  const configs = {
    locked: {
      title: 'Cash Locked — Active Deals',
      subtitle: 'Your actual out-of-pocket cash currently tied up in each active deal',
      source: active,
      getValue:   r => r.calc?.totalCashInvested || 0,
      getSecond:  r => ({ label: 'Expected Profit', val: r.calc?.expected?.netProfit || 0, color: 'success' }),
      valueLabel: 'Cash Invested',
      valueColor: 'text-[color:var(--color-text)]',
    },
    pipeline: {
      title: 'Expected Pipeline — Active Deals',
      subtitle: 'Expected profit per deal when sold at projected price (your share for JV deals)',
      source: active,
      getValue:   r => r.calc?.expected?.netProfit || 0,
      getSecond:  r => ({ label: 'Cash In', val: r.calc?.totalCashInvested || 0, color: 'muted' }),
      valueLabel: 'Expected Profit',
      valueColor: success,
    },
    realized: {
      title: 'Realized Profit — Sold Deals',
      subtitle: 'Actual profit collected from completed deals',
      source: sold,
      getValue:   r => r.calc?.actual?.netProfit ?? r.calc?.expected?.netProfit ?? 0,
      getSecond:  r => ({ label: 'ROI', val: null, formatted: fmtPct(r.calc?.actual?.roi ?? r.calc?.expected?.roi), color: 'success' }),
      valueLabel: 'Actual Profit',
      valueColor: success,
    },
    pnl: {
      title: 'Total P&L Breakdown',
      subtitle: 'Realized (sold) + expected (active) — full portfolio picture',
      source: rows,
      getValue:   r => isSoldStatus(r.lead?.status)
        ? (r.calc?.actual?.netProfit ?? r.calc?.expected?.netProfit ?? 0)
        : (r.calc?.expected?.netProfit || 0),
      getSecond:  r => ({ label: isSoldStatus(r.lead?.status) ? 'Flip Sold ✓' : 'Active', val: null, formatted: isSoldStatus(r.lead?.status) ? 'Flip Sold' : 'Active', color: isSoldStatus(r.lead?.status) ? 'success' : 'accent' }),
      valueLabel: 'Profit',
      valueColor: success,
    },
    roi: {
      title: 'Annualized ROI — Active Deals',
      subtitle: 'ROI normalized to a 12-month basis — fairest comparison across different hold times',
      source: active,
      getValue:   r => r.calc?.expected?.annualizedRoi || 0,
      getSecond:  r => ({ label: 'Hold', val: null, formatted: `${r.financials.hold_months || '?'}mo`, color: 'muted' }),
      valueLabel: 'Ann. ROI',
      valueColor: success,
      formatValue: v => fmtPct(v),
    },
  }

  const cfg = configs[id]
  if (!cfg) return null

  const sorted = [...cfg.source].sort((a, b) => cfg.getValue(b) - cfg.getValue(a))
  const total  = sorted.reduce((s, r) => s + cfg.getValue(r), 0)
  const fmt    = cfg.formatValue || fmtUSD

  return (
    <div className="rounded-xl border border-[color:var(--color-accent)] bg-[color:var(--color-bg-card)] shadow-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-[color:var(--color-line)] bg-[color:var(--color-accent-soft)]">
        <div className="text-[12px] font-semibold text-[color:var(--color-accent-text)]">{cfg.title}</div>
        <div className={`text-[11px] mt-0.5 ${muted}`}>{cfg.subtitle}</div>
      </div>
      <div className="divide-y divide-[color:var(--color-line)]">
        {sorted.map(r => {
          const val    = cfg.getValue(r)
          const second = cfg.getSecond(r)
          const isJV   = !!r.financials.is_jv
          const isCash = !isJV && r.financials.renovation_financing === 'Cash'
          const typeCls = isJV ? TYPE_BADGE.JV : isCash ? TYPE_BADGE.Cash : TYPE_BADGE.Financed
          const typeLabel = isJV ? 'JV' : isCash ? 'CASH' : 'HML'
          const addr = (r.lead?.address || '—').split(',')[0]
          const barPct = total !== 0 ? Math.abs(val) / Math.abs(total) * 100 : 0

          return (
            <div
              key={r.financials.id}
              onClick={() => navigate(`/w/${workspaceId}/projects/${r.lead.id}`)}
              className="flex items-center gap-3 px-4 py-3 hover:bg-[color:var(--color-bg-elev)] cursor-pointer transition-colors group"
            >
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${typeCls}`}>{typeLabel}</span>
              <div className="w-36 shrink-0">
                <div className="text-[12px] font-medium text-[color:var(--color-text)] truncate group-hover:text-[color:var(--color-accent)] transition-colors">{addr}</div>
                {second && (
                  <div className={`text-[10px] ${second.color === 'success' ? success : second.color === 'accent' ? accent : muted}`}>
                    {second.label}: {second.formatted ?? fmtUSD(second.val)}
                  </div>
                )}
              </div>
              <div className="flex-1 h-2 bg-[color:var(--color-bg-elev-2)] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${val >= 0 ? 'bg-[color:var(--color-accent)]' : 'bg-[color:var(--color-danger)]'}`}
                  style={{ width: `${Math.min(barPct, 100)}%` }}
                />
              </div>
              <div className={`text-[13px] font-bold w-28 text-right shrink-0 ${val >= 0 ? cfg.valueColor : danger}`}>
                {fmt(val)}
              </div>
            </div>
          )
        })}
      </div>
      <div className="px-4 py-2.5 border-t border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] flex justify-between items-center">
        <span className={`text-[11px] font-medium ${dim}`}>Total · {sorted.length} deal{sorted.length !== 1 ? 's' : ''}</span>
        <span className={`text-[13px] font-bold ${cfg.valueColor}`}>{fmt(total)}</span>
      </div>
    </div>
  )
}

const TYPE_BADGE = {
  Cash:     'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  Financed: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  JV:       'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
}

const isSoldStatus = s => s === 'flip_sold' || s === 'sold'
const STATUS_LABELS = { working_project: 'Active', flip_sold: 'Flip Sold ✓', sold: 'Sold' }
const STATUS_CLS    = {
  working_project: 'bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)]',
  flip_sold:       'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)]',
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
  const [activePanel, setActivePanel]   = useState(null)
  const [view, setView]                 = useState('deals') // 'deals' | 'intelligence'

  const togglePanel = (id) => setActivePanel(p => p === id ? null : id)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const { data: fins } = await supabase
        .from('deal_financials')
        .select('*, leads!inner(id, address, city, state, status, workspace_id)')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })

      if (!fins?.length) { setRows([]); setLoading(false); return }

      const projectFins = fins.filter(f => ['working_project', 'sold', 'flip_sold'].includes(f.leads?.status))
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
    const active = rows.filter(r => !isSoldStatus(r.lead?.status))
    const sold   = rows.filter(r => isSoldStatus(r.lead?.status))
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
    if (statusFilter === 'Active') r = r.filter(x => !isSoldStatus(x.lead?.status))
    if (statusFilter === 'Sold')   r = r.filter(x => isSoldStatus(x.lead?.status))
    if (typeFilter === 'Cash') r = r.filter(x => !x.financials.is_jv && x.financials.renovation_financing === 'Cash')
    if (typeFilter === 'HML')  r = r.filter(x => !x.financials.is_jv && x.financials.renovation_financing !== 'Cash')
    if (typeFilter === 'JV')   r = r.filter(x => !!x.financials.is_jv)
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

  const activeRows = displayRows.filter(r => !isSoldStatus(r.lead?.status))
  const soldRows   = displayRows.filter(r => isSoldStatus(r.lead?.status))

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

        {/* ── VIEW TABS ── */}
        <div className="flex gap-1 border-b border-[color:var(--color-line)] pb-0">
          {[
            { id: 'deals',        label: 'Deals' },
            { id: 'intelligence', label: '📊 Intelligence' },
          ].map(t => (
            <button key={t.id} onClick={() => setView(t.id)}
              className={`px-4 py-2 text-[13px] font-medium border-b-2 transition-colors -mb-px ${
                view === t.id
                  ? 'border-[color:var(--color-accent)] text-[color:var(--color-accent-text)]'
                  : 'border-transparent text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── INTELLIGENCE VIEW ── */}
        {view === 'intelligence' && !loading && (
          <ProjectsIntelligencePage rows={rows} />
        )}

        {view === 'deals' && <>

        {/* ── TOP STATS BAR ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <StatCard id="locked"   label="Cash Locked (Active)" value={fmtUSD(portfolio.totalLocked)}    sub={`${portfolio.active} active deals · click to see breakdown`} color="text-[color:var(--color-text)]" activeId={activePanel} onToggle={togglePanel} />
          <StatCard id="pipeline" label="Expected Pipeline"    value={fmtUSD(portfolio.expectedProfit)} sub="active deals · click to see breakdown" color={success} activeId={activePanel} onToggle={togglePanel} />
          <StatCard id="realized" label="Realized Profit"      value={fmtUSD(portfolio.realizedProfit)} sub={`${portfolio.sold} sold deals · click to see breakdown`} color={success} activeId={activePanel} onToggle={togglePanel} />
          <StatCard id="pnl"      label="Total P&amp;L"        value={fmtUSD(portfolio.totalPnL)}       sub="realized + expected" color={portfolio.totalPnL >= 0 ? success : danger} activeId={activePanel} onToggle={togglePanel} />
          <StatCard id="roi"      label="Avg Ann. ROI (active)"value={fmtPct(portfolio.avgAnnRoi)}      sub="annualized · click to see breakdown" activeId={activePanel} onToggle={togglePanel} />
          <StatCard label="Avg Hold Time" value={`${portfolio.avgHold.toFixed(1)} mo`} sub={`across ${rows.length} deals`} />
        </div>

        {/* ── INLINE BREAKDOWN PANEL ── */}
        {activePanel && <StatBreakdownPanel id={activePanel} rows={rows} navigate={navigate} workspaceId={workspaceId} />}

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
                const isJV    = !!f.is_jv
                const isCash  = !isJV && f.renovation_financing === 'Cash'
                const isSold  = isSoldStatus(lead?.status)
                const isActual = calc?.actual?.netProfit != null
                const shortAddr = (lead?.address || '—').split(',')[0]
                return (
                  <div key={f.id} className="flex items-center gap-3 group cursor-pointer" onClick={() => navigate(`/w/${workspaceId}/projects/${lead.id}`)}>
                    <div className="flex items-center gap-1.5 w-44 shrink-0">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${isJV ? TYPE_BADGE.JV : isCash ? TYPE_BADGE.Cash : TYPE_BADGE.Financed}`}>{isJV ? 'JV' : isCash ? 'CASH' : 'HML'}</span>
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
        <div className="flex flex-wrap gap-4 items-end">
          <FilterGroup label="Status" options={[
            { value: 'All',    label: 'All Deals' },
            { value: 'Active', label: 'Active' },
            { value: 'Sold',   label: 'Sold' },
          ]} value={statusFilter} onChange={setStatusFilter} />

          <FilterGroup label="Deal Type" options={[
            { value: 'All',  label: 'All Types' },
            { value: 'Cash', label: 'Cash' },
            { value: 'HML',  label: 'HML / Financed' },
            { value: 'JV',   label: 'Joint Venture' },
          ]} value={typeFilter} onChange={setTypeFilter} />

          <FilterGroup label="Deal Rating" options={[
            { value: 'All', label: 'All Ratings' },
            { value: 'A',   label: 'A — Excellent' },
            { value: 'B',   label: 'B — Good' },
            { value: 'C',   label: 'C — Fair' },
            { value: 'D',   label: 'D — Poor' },
          ]} value={ratingFilter} onChange={setRatingFilter} />

          <div className="flex items-center gap-1.5 ml-auto">
            <span className={`text-[11px] ${dim}`}>Sort by:</span>
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

        </> /* end deals view */}

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
              const isJV   = !!f.is_jv
              const isCash = !isJV && f.renovation_financing === 'Cash'
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
