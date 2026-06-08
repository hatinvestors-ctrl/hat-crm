// src/pages/ProjectsPage.jsx
import { useEffect, useState, useMemo } from 'react'
import { useOutletContext, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { calcDeal, fmtUSD, fmtPct, dealRatingColor } from '../lib/dealCalculations'
import Topbar from '../components/Topbar'
import LoadingSpinner from '../components/ui/LoadingSpinner'

const STATUS_LABELS = {
  offer_accepted: 'Offer Accepted',
  working_project: 'Working Project',
  sold: 'Sold',
  dead_lead: 'Dead Lead',
}

const STATUS_CLS = {
  offer_accepted:  'bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)]',
  working_project: 'bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)]',
  sold:            'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)]',
  dead_lead:       'bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-text)]',
}

const FILTERS = ['All', 'Active', 'Sold']

export default function ProjectsPage() {
  const { workspace, workspaceId } = useOutletContext()
  const navigate = useNavigate()
  const [rows, setRows]       = useState([])   // { lead, financials, items }
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState('All')

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

  const filtered = useMemo(() => {
    if (filter === 'Active') return rows.filter(r => r.lead?.status !== 'sold')
    if (filter === 'Sold')   return rows.filter(r => r.lead?.status === 'sold')
    return rows
  }, [rows, filter])

  // Portfolio stats
  const stats = useMemo(() => {
    const active  = rows.filter(r => r.lead?.status !== 'sold')
    const sold    = rows.filter(r => r.lead?.status === 'sold')
    const actualProfit   = sold.reduce((s, r) => s + (r.calc?.actual?.netProfit || 0), 0)
    const expectedProfit = active.reduce((s, r) => s + (r.calc?.expected?.netProfit || 0), 0)
    const avgROI = sold.length > 0
      ? sold.reduce((s, r) => s + (r.calc?.actual?.roi || r.calc?.expected?.roi || 0), 0) / sold.length
      : active.length > 0
        ? active.reduce((s, r) => s + (r.calc?.expected?.roi || 0), 0) / active.length
        : 0
    return { active: active.length, sold: sold.length, actualProfit, expectedProfit, avgROI }
  }, [rows])

  // Bar chart: profit per deal (for sold deals with actual profit, else expected)
  const chartRows = useMemo(() =>
    rows
      .filter(r => r.calc?.actual || r.calc?.expected)
      .sort((a, b) => {
        const pa = (a.calc?.actual?.netProfit ?? a.calc?.expected?.netProfit) || 0
        const pb = (b.calc?.actual?.netProfit ?? b.calc?.expected?.netProfit) || 0
        return pb - pa
      })
      .slice(0, 12)
  , [rows])

  const maxProfit = chartRows.length > 0
    ? Math.max(...chartRows.map(r => Math.abs(r.calc?.actual?.netProfit ?? r.calc?.expected?.netProfit ?? 0)))
    : 1

  return (
    <>
      <Topbar
        title="Projects"
        breadcrumbs={[{ label: workspace?.name, to: `/w/${workspaceId}` }, { label: 'Projects' }]}
      />

      <div className="p-4 space-y-6">

        {/* Stats bar */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: 'Active Deals',       value: stats.active,             raw: true  },
            { label: 'Completed Deals',    value: stats.sold,               raw: true  },
            { label: 'Total Actual Profit', value: fmtUSD(stats.actualProfit)          },
            { label: 'Expected Pipeline',  value: fmtUSD(stats.expectedProfit)         },
          ].map(s => (
            <div key={s.label} className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] p-4">
              <div className="text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1">{s.label}</div>
              <div className="text-[22px] font-bold text-[color:var(--color-text)]">{s.raw ? s.value : s.value}</div>
            </div>
          ))}
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2">
          {FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-full text-[12px] font-medium transition-colors ${
                filter === f
                  ? 'bg-[color:var(--color-accent)] text-white'
                  : 'bg-[color:var(--color-bg-elev)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {loading ? <LoadingSpinner label="Loading projects…" /> : (
          <>
            {/* Deals table */}
            {filtered.length === 0 ? (
              <div className="text-center py-12 text-[13px] text-[color:var(--color-text-dim)]">
                No projects yet. Open any lead and click "Create Project" to start tracking a deal here.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-[color:var(--color-line)]">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)]">
                      {['Property', 'Status', 'Purchase', 'All-In Cost', 'Expected Profit', 'Actual Profit', 'ROI', 'Hold', 'Rating'].map(h => (
                        <th key={h} className="text-left px-3 py-2.5 text-[10.5px] uppercase tracking-wider font-medium text-[color:var(--color-text-dim)]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(({ financials: f, lead, calc }) => {
                      const expectedProfit = calc?.expected?.netProfit
                      const actualProfit   = calc?.actual?.netProfit
                      const roi = actualProfit != null ? calc.actual.roi : calc?.expected?.roi
                      const statusCls = STATUS_CLS[lead?.status] || 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-dim)]'
                      return (
                        <tr
                          key={f.id}
                          onClick={() => navigate(`/w/${workspaceId}/projects/${lead.id}`)}
                          className="border-t border-[color:var(--color-line)] hover:bg-[color:var(--color-bg-elev)] cursor-pointer transition-colors"
                        >
                          <td className="px-3 py-2.5 font-medium text-[color:var(--color-text)] max-w-[160px] truncate">{lead?.address || '—'}</td>
                          <td className="px-3 py-2.5">
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium ${statusCls}`}>
                              {STATUS_LABELS[lead?.status] || lead?.status || '—'}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-[color:var(--color-text-muted)]">{fmtUSD(f.purchase_price_actual)}</td>
                          <td className="px-3 py-2.5 text-[color:var(--color-text-muted)]">{calc ? fmtUSD(calc.totalAllInCost) : '—'}</td>
                          <td className="px-3 py-2.5">
                            {expectedProfit != null ? (
                              <span className={expectedProfit >= 0 ? 'text-[color:var(--color-success-text)]' : 'text-[color:var(--color-danger-text)]'}>
                                {fmtUSD(expectedProfit)}
                              </span>
                            ) : '—'}
                          </td>
                          <td className="px-3 py-2.5">
                            {actualProfit != null ? (
                              <span className={`font-semibold ${actualProfit >= 0 ? 'text-[color:var(--color-success-text)]' : 'text-[color:var(--color-danger-text)]'}`}>
                                {fmtUSD(actualProfit)}
                              </span>
                            ) : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-[color:var(--color-text-muted)]">{roi != null ? fmtPct(roi) : '—'}</td>
                          <td className="px-3 py-2.5 text-[color:var(--color-text-muted)]">{f.hold_months ? `${f.hold_months}mo` : '—'}</td>
                          <td className="px-3 py-2.5">
                            {calc?.dealRating && (
                              <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${dealRatingColor(calc.dealRating)}`}>
                                {calc.dealRating.split(' - ')[0]}
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Profit bar chart */}
            {chartRows.length > 0 && (
              <div>
                <div className="text-[11px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)] mb-3">
                  Profit by Deal
                </div>
                <div className="space-y-2">
                  {chartRows.map(({ financials: f, lead, calc }) => {
                    const profit = calc?.actual?.netProfit ?? calc?.expected?.netProfit ?? 0
                    const pct    = maxProfit > 0 ? Math.abs(profit) / maxProfit * 100 : 0
                    const isActual = calc?.actual?.netProfit != null
                    return (
                      <div key={f.id} className="flex items-center gap-3">
                        <div className="text-[11px] text-[color:var(--color-text-dim)] w-36 truncate shrink-0">{lead?.address || '—'}</div>
                        <div className="flex-1 h-5 bg-[color:var(--color-bg-elev-2)] rounded overflow-hidden">
                          <div
                            className={`h-full rounded transition-all duration-300 ${profit >= 0 ? 'bg-[color:var(--color-success)]' : 'bg-[color:var(--color-danger)]'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <div className={`text-[11px] font-medium w-24 text-right shrink-0 ${profit >= 0 ? 'text-[color:var(--color-success-text)]' : 'text-[color:var(--color-danger-text)]'}`}>
                          {fmtUSD(profit)}
                          {!isActual && <span className="text-[color:var(--color-text-dim)] font-normal"> est</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Summary stats */}
            {rows.length > 0 && (
              <div className="grid grid-cols-3 gap-3 text-center">
                {[
                  { label: 'Avg ROI', value: fmtPct(stats.avgROI) },
                  { label: 'Total Deals', value: rows.length },
                  { label: 'Avg Hold Time', value: (() => {
                    const total = rows.reduce((s, r) => s + (r.financials.hold_months || 0), 0)
                    return rows.length ? `${(total / rows.length).toFixed(1)} mo` : '—'
                  })() },
                ].map(s => (
                  <div key={s.label} className="rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] p-3">
                    <div className="text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1">{s.label}</div>
                    <div className="text-[18px] font-bold text-[color:var(--color-text)]">{s.value}</div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}
