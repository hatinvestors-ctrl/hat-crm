// src/pages/ProjectsIntelligencePage.jsx
// Portfolio Intelligence — pattern analysis, sweet spots, 70% rule, capital velocity
import { useMemo } from 'react'
import { fmtUSD, fmtPct } from '../lib/dealCalculations'

// ─── style constants ─────────────────────────────────────────────────────────
const dim     = 'text-[color:var(--color-text-dim)]'
const muted   = 'text-[color:var(--color-text-muted)]'
const success = 'text-[color:var(--color-success-text)]'
const danger  = 'text-[color:var(--color-danger-text)]'

const SectionTitle = ({ children }) => (
  <div className={`text-[10px] uppercase tracking-wider font-semibold mb-3 ${dim}`}>{children}</div>
)

const Card = ({ children, className = '' }) => (
  <div className={`rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] p-4 ${className}`}>
    {children}
  </div>
)

// horizontal bar chart row
function BarRow({ label, value, max, fmt, color, sub, badge }) {
  const pct = max > 0 ? Math.min(Math.abs(value) / max * 100, 100) : 0
  const positive = value >= 0
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="w-40 shrink-0 flex items-center gap-1.5">
        {badge && <span className={`text-[9.5px] px-1.5 py-0.5 rounded font-medium shrink-0 ${badge.cls}`}>{badge.label}</span>}
        <div>
          <div className={`text-[11.5px] font-medium text-[color:var(--color-text)] truncate`}>{label}</div>
          {sub && <div className={`text-[10px] ${dim}`}>{sub}</div>}
        </div>
      </div>
      <div className="flex-1 h-4 bg-[color:var(--color-bg-elev-2)] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${positive ? color || 'bg-[color:var(--color-accent)]' : 'bg-[color:var(--color-danger)]'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className={`text-[12px] font-bold w-24 text-right shrink-0 ${positive ? (color ? color.replace('bg-','text-') : success) : danger}`}>
        {fmt ? fmt(value) : value}
      </div>
    </div>
  )
}

function ScorePill({ pass, label }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[10.5px] px-2 py-0.5 rounded-full font-medium ${
      pass
        ? 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)]'
        : 'bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-text)]'
    }`}>
      {pass ? '✓' : '✗'} {label}
    </span>
  )
}

const TYPE_CLS = {
  JV:       'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  Cash:     'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  Financed: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
}

function dealType(f) {
  if (f.is_jv) return 'JV'
  if (f.renovation_financing === 'Cash') return 'Cash'
  return 'HML'
}

// ─── main component ───────────────────────────────────────────────────────────
export default function ProjectsIntelligencePage({ rows }) {
  const active = useMemo(() => rows.filter(r => r.lead?.status !== 'sold'), [rows])
  const sold   = useMemo(() => rows.filter(r => r.lead?.status === 'sold'),  [rows])
  const all    = rows

  // ── derive sweet-spot formula from A/B rated deals ────────────────────────
  const formula = useMemo(() => {
    const good = all.filter(r => {
      const rating = r.calc?.dealRating || ''
      return rating.startsWith('A') || rating.startsWith('B')
    })
    if (!good.length) return null
    const purchases = good.map(r => r.financials.purchase_price_actual || 0)
    const renos     = good.map(r => r.calc?.totalRenovationCost || 0)
    const arvs      = good.map(r => r.calc?.expected?.sellPrice || r.calc?.actual?.sellPrice || 0)
    const holds     = good.map(r => r.financials.hold_months || 0)
    const allInRatios = good.map(r => r.calc?.allInVsARV || 0)
    const annRois   = good.map(r => r.calc?.expected?.annualizedRoi ?? r.calc?.actual?.annualizedRoi ?? 0)
    const avg = arr => arr.reduce((s, v) => s + v, 0) / arr.length
    return {
      purchaseMin: Math.min(...purchases), purchaseMax: Math.max(...purchases), purchaseAvg: avg(purchases),
      renoMin: Math.min(...renos), renoMax: Math.max(...renos), renoAvg: avg(renos),
      arvMin: Math.min(...arvs), arvMax: Math.max(...arvs), arvAvg: avg(arvs),
      holdMin: Math.min(...holds), holdMax: Math.max(...holds), holdAvg: avg(holds),
      allInAvg: avg(allInRatios), allInMax: Math.max(...allInRatios),
      annRoiAvg: avg(annRois),
      count: good.length,
    }
  }, [all])

  // ── 70% rule calc ────────────────────────────────────────────────────────
  const rule70Rows = useMemo(() => all.map(r => {
    const pp  = r.financials.purchase_price_actual || 0
    const arv = r.calc?.expected?.sellPrice || r.calc?.actual?.sellPrice || 0
    const ren = r.calc?.totalRenovationCost || 0
    const max70 = arv * 0.70 - ren
    const variance = pp - max70
    const pct70 = arv > 0 ? pp / (arv * 0.70 - ren + pp) * 100 : 0
    return { r, pp, arv, ren, max70, variance, annRoi: r.calc?.expected?.annualizedRoi ?? r.calc?.actual?.annualizedRoi ?? 0 }
  }).sort((a, b) => a.variance - b.variance), [all])

  // ── capital velocity ──────────────────────────────────────────────────────
  const velocity = useMemo(() => {
    const totalCash      = active.reduce((s, r) => s + (r.calc?.totalCashInvested || 0), 0)
    const weightedRoi    = active.length > 0
      ? active.reduce((s, r) => s + (r.calc?.expected?.annualizedRoi || 0) * (r.calc?.totalCashInvested || 0), 0) / (totalCash || 1)
      : 0

    // Best-deal rate = avg of A-rated HML deals
    const aHml = active.filter(r => r.calc?.dealRating?.startsWith('A') && r.financials.renovation_financing !== 'Cash' && !r.financials.is_jv)
    const bestRate = aHml.length > 0
      ? aHml.reduce((s, r) => s + (r.calc?.expected?.annualizedRoi || 0), 0) / aHml.length
      : weightedRoi

    const currentAnnualReturn = totalCash * weightedRoi
    const bestCaseReturn      = totalCash * bestRate
    const opportunityCost     = bestCaseReturn - currentAnnualReturn

    // cash drag: how much cash locked in Cash/JV deals vs if it were in HML
    const cashDeals = active.filter(r => r.financials.renovation_financing === 'Cash' || r.financials.is_jv)
    const cashDealCapital = cashDeals.reduce((s, r) => s + (r.calc?.totalCashInvested || 0), 0)
    const cashDealActualReturn = cashDeals.reduce((s, r) => s + (r.calc?.expected?.netProfit || 0), 0)
    const cashDealAtBestReturn = cashDealCapital * bestRate
    const cashDrag = cashDealAtBestReturn - cashDealActualReturn

    return { totalCash, weightedRoi, bestRate, currentAnnualReturn, bestCaseReturn, opportunityCost, cashDrag, cashDealCapital, aHmlCount: aHml.length }
  }, [active])

  // ── per-deal formula score ────────────────────────────────────────────────
  const dealScores = useMemo(() => {
    if (!formula) return []
    return all.map(r => {
      const f  = r.financials
      const pp = f.purchase_price_actual || 0
      const ren = r.calc?.totalRenovationCost || 0
      const arv = r.calc?.expected?.sellPrice || r.calc?.actual?.sellPrice || 0
      const hold = f.hold_months || 0
      const allIn = r.calc?.allInVsARV || 0
      const type = dealType(f)

      // 70% rule max
      const max70 = arv * 0.70 - ren

      const criteria = [
        { label: `Buy < $${Math.round(formula.purchaseMax/1000)}K`,  pass: pp <= formula.purchaseMax * 1.05 },
        { label: `Reno < $${Math.round(formula.renoMax/1000)}K`,    pass: ren <= formula.renoMax * 1.10 },
        { label: `ARV $${Math.round(formula.arvMin/1000)}K–$${Math.round(formula.arvMax/1000)}K`, pass: arv >= formula.arvMin * 0.90 && arv <= formula.arvMax * 1.10 },
        { label: `Hold ≤ ${formula.holdMax}mo`,                     pass: hold <= formula.holdMax + 1 },
        { label: `All-In < 80% ARV`,                                pass: allIn < 0.80 },
        { label: `Within 70% Rule`,                                  pass: pp <= max70 * 1.05 },
        { label: `HML/JV (not pure cash)`,                          pass: type !== 'Cash' },
      ]
      const score = criteria.filter(c => c.pass).length
      return { r, criteria, score, total: criteria.length }
    }).sort((a, b) => b.score - a.score)
  }, [all, formula])

  // ── chart: annualized ROI per deal ───────────────────────────────────────
  const annRoiMax = Math.max(...all.map(r => Math.abs(r.calc?.expected?.annualizedRoi ?? r.calc?.actual?.annualizedRoi ?? 0)), 1)
  const profitMax = Math.max(...all.map(r => Math.abs(r.calc?.expected?.netProfit ?? r.calc?.actual?.netProfit ?? 0)), 1)

  if (!rows.length) return (
    <div className="text-center py-20 text-[13px] text-[color:var(--color-text-dim)]">
      No project data yet. Add projects to see intelligence analysis.
    </div>
  )

  return (
    <div className="space-y-6">

      {/* ── YOUR FORMULA ─────────────────────────────────────────────────── */}
      {formula && (
        <div>
          <SectionTitle>Your Proven Formula — Based on {formula.count} A/B-Rated Deals</SectionTitle>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {[
              { label: 'Purchase Price',  value: `$${Math.round(formula.purchaseMin/1000)}K – $${Math.round(formula.purchaseMax/1000)}K`, sub: `avg $${Math.round(formula.purchaseAvg/1000)}K`, color: 'text-[color:var(--color-text)]' },
              { label: 'Renovation',      value: `$${Math.round(formula.renoMin/1000)}K – $${Math.round(formula.renoMax/1000)}K`,    sub: `avg $${Math.round(formula.renoAvg/1000)}K`,    color: 'text-[color:var(--color-text)]' },
              { label: 'Target ARV',      value: `$${Math.round(formula.arvMin/1000)}K – $${Math.round(formula.arvMax/1000)}K`,    sub: `avg $${Math.round(formula.arvAvg/1000)}K`,    color: 'text-[color:var(--color-text)]' },
              { label: 'Hold Time',       value: `${formula.holdMin}–${formula.holdMax} mo`,  sub: `avg ${formula.holdAvg.toFixed(1)}mo`,          color: 'text-[color:var(--color-text)]' },
              { label: 'Max All-In/ARV',  value: fmtPct(formula.allInMax),          sub: `avg ${fmtPct(formula.allInAvg)}`,     color: 'text-orange-600 dark:text-orange-400' },
              { label: 'Avg Ann. ROI',    value: fmtPct(formula.annRoiAvg),         sub: 'on winning deals',                    color: success },
              { label: 'Deal Type',       value: 'HML / JV',                        sub: 'avoid pure cash',                     color: 'text-purple-600 dark:text-purple-400' },
            ].map(s => (
              <div key={s.label} className="rounded-xl border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] p-3">
                <div className={`text-[9.5px] uppercase tracking-wider font-medium mb-1 ${dim}`}>{s.label}</div>
                <div className={`text-[15px] font-bold leading-tight ${s.color}`}>{s.value}</div>
                <div className={`text-[10px] mt-0.5 ${muted}`}>{s.sub}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── DEAL SCORECARD ───────────────────────────────────────────────── */}
      {dealScores.length > 0 && (
        <div>
          <SectionTitle>Deal Scorecard — How Each Deal Matches Your Formula</SectionTitle>
          <div className="space-y-3">
            {dealScores.map(({ r, criteria, score, total }) => {
              const addr    = (r.lead?.address || '—').split(',')[0]
              const type    = dealType(r.financials)
              const isSold  = r.lead?.status === 'sold'
              const annRoi  = r.calc?.actual?.annualizedRoi ?? r.calc?.expected?.annualizedRoi ?? 0
              const profit  = r.calc?.actual?.netProfit ?? r.calc?.expected?.netProfit ?? 0
              const pct     = Math.round(score / total * 100)
              const barColor = pct >= 80 ? 'bg-[color:var(--color-success)]'
                             : pct >= 60 ? 'bg-[color:var(--color-accent)]'
                             : 'bg-[color:var(--color-danger)]'
              return (
                <Card key={r.financials.id}>
                  <div className="flex flex-wrap items-start gap-3 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${TYPE_CLS[type]}`}>{type}</span>
                      {isSold && <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)]">SOLD</span>}
                      <span className="text-[13px] font-semibold text-[color:var(--color-text)] truncate">{addr}</span>
                    </div>
                    <div className="ml-auto flex items-center gap-4 shrink-0">
                      <div className="text-right">
                        <div className={`text-[11px] font-semibold ${profit >= 0 ? success : danger}`}>{fmtUSD(profit)}</div>
                        <div className={`text-[10px] ${muted}`}>{isSold ? 'actual' : 'expected'} profit</div>
                      </div>
                      <div className="text-right">
                        <div className={`text-[11px] font-semibold ${annRoi >= 0.5 ? success : annRoi >= 0.2 ? muted : danger}`}>{fmtPct(annRoi)}</div>
                        <div className={`text-[10px] ${muted}`}>ann. ROI</div>
                      </div>
                      <div className="text-right w-14">
                        <div className={`text-[15px] font-bold ${pct >= 80 ? success : pct >= 60 ? 'text-[color:var(--color-accent-text)]' : danger}`}>{score}/{total}</div>
                        <div className={`text-[10px] ${muted}`}>criteria</div>
                      </div>
                    </div>
                  </div>
                  {/* score bar */}
                  <div className="h-1.5 bg-[color:var(--color-bg-elev-2)] rounded-full overflow-hidden mb-2.5">
                    <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${pct}%` }} />
                  </div>
                  {/* criteria pills */}
                  <div className="flex flex-wrap gap-1.5">
                    {criteria.map((c, i) => <ScorePill key={i} pass={c.pass} label={c.label} />)}
                  </div>
                </Card>
              )
            })}
          </div>
        </div>
      )}

      {/* ── 70% RULE TRACKER ─────────────────────────────────────────────── */}
      <div>
        <SectionTitle>70% Rule Tracker — Max Purchase vs What You Paid</SectionTitle>
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)]">
                {['Deal', 'Type', 'ARV', 'Reno Budget', '70% Rule Max', 'You Paid', 'Over / Under', 'Impact'].map(h => (
                  <th key={h} className={`text-left px-3 py-2.5 text-[10.5px] uppercase tracking-wider font-medium ${dim} whitespace-nowrap`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rule70Rows.map(({ r, pp, arv, ren, max70, variance, annRoi }) => {
                const type   = dealType(r.financials)
                const addr   = (r.lead?.address || '—').split(',')[0]
                const over   = variance > 0
                const pctOver = max70 > 0 ? Math.abs(variance) / max70 * 100 : 0
                return (
                  <tr key={r.financials.id} className="border-t border-[color:var(--color-line)] hover:bg-[color:var(--color-bg-elev)] transition-colors">
                    <td className="px-3 py-2.5 font-medium text-[color:var(--color-text)] max-w-[140px] truncate">{addr}</td>
                    <td className="px-3 py-2.5">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${TYPE_CLS[type]}`}>{type}</span>
                    </td>
                    <td className="px-3 py-2.5 text-[color:var(--color-text-muted)]">{fmtUSD(arv)}</td>
                    <td className="px-3 py-2.5 text-[color:var(--color-text-muted)]">{fmtUSD(ren)}</td>
                    <td className="px-3 py-2.5 font-medium text-[color:var(--color-text)]">{fmtUSD(max70)}</td>
                    <td className="px-3 py-2.5 text-[color:var(--color-text-muted)]">{fmtUSD(pp)}</td>
                    <td className="px-3 py-2.5">
                      <span className={`font-semibold ${over ? danger : success}`}>
                        {over ? '+' : '-'}{fmtUSD(Math.abs(variance))}
                        <span className={`text-[10px] font-normal ml-1 ${over ? danger : success}`}>
                          ({pctOver.toFixed(0)}% {over ? 'over' : 'under'})
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`text-[11px] font-semibold ${annRoi >= 0.5 ? success : annRoi >= 0.2 ? muted : danger}`}>
                        {fmtPct(annRoi)} ann.
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
        <div className={`text-[11px] mt-2 ${muted}`}>
          Rule: Max price = ARV × 70% − Renovation. Deals over the rule can still work but leave less margin for error.
        </div>
      </div>

      {/* ── SWEET SPOT CHARTS ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Chart 1: Ann. ROI per deal */}
        <Card>
          <div className={`text-[10px] uppercase tracking-wider font-semibold mb-3 ${dim}`}>Annualized ROI per Deal</div>
          {[...all].sort((a, b) => {
            const ra = a.calc?.actual?.annualizedRoi ?? a.calc?.expected?.annualizedRoi ?? 0
            const rb = b.calc?.actual?.annualizedRoi ?? b.calc?.expected?.annualizedRoi ?? 0
            return rb - ra
          }).map(r => {
            const annRoi = r.calc?.actual?.annualizedRoi ?? r.calc?.expected?.annualizedRoi ?? 0
            const type   = dealType(r.financials)
            const addr   = (r.lead?.address || '—').split(',')[0]
            const isActual = r.calc?.actual?.annualizedRoi != null
            const barCol = annRoi >= 1.5 ? 'bg-[color:var(--color-success)]'
                         : annRoi >= 0.5 ? 'bg-[color:var(--color-accent)]'
                         : annRoi >= 0   ? 'bg-orange-400'
                         : 'bg-[color:var(--color-danger)]'
            return (
              <BarRow key={r.financials.id}
                label={addr}
                value={annRoi}
                max={annRoiMax}
                fmt={fmtPct}
                color={barCol}
                sub={`${r.financials.hold_months}mo hold · ${isActual ? 'actual' : 'est.'}`}
                badge={{ label: type, cls: TYPE_CLS[type] }}
              />
            )
          })}
        </Card>

        {/* Chart 2: Profit per deal */}
        <Card>
          <div className={`text-[10px] uppercase tracking-wider font-semibold mb-3 ${dim}`}>Net Profit per Deal (Your Share)</div>
          {[...all].sort((a, b) => {
            const pa = a.calc?.actual?.netProfit ?? a.calc?.expected?.netProfit ?? 0
            const pb = b.calc?.actual?.netProfit ?? b.calc?.expected?.netProfit ?? 0
            return pb - pa
          }).map(r => {
            const profit  = r.calc?.actual?.netProfit ?? r.calc?.expected?.netProfit ?? 0
            const type    = dealType(r.financials)
            const addr    = (r.lead?.address || '—').split(',')[0]
            const isActual = r.calc?.actual?.netProfit != null
            const barCol = profit >= 50000 ? 'bg-[color:var(--color-success)]'
                         : profit >= 30000 ? 'bg-[color:var(--color-accent)]'
                         : profit >= 0     ? 'bg-orange-400'
                         : 'bg-[color:var(--color-danger)]'
            return (
              <BarRow key={r.financials.id}
                label={addr}
                value={profit}
                max={profitMax}
                fmt={fmtUSD}
                color={barCol}
                sub={`${fmtUSD(r.calc?.totalCashInvested || 0)} cash in · ${isActual ? 'actual' : 'est.'}`}
                badge={{ label: type, cls: TYPE_CLS[type] }}
              />
            )
          })}
        </Card>

        {/* Chart 3: All-In/ARV ratio */}
        <Card>
          <div className={`text-[10px] uppercase tracking-wider font-semibold mb-3 ${dim}`}>All-In / ARV Ratio — Lower is Safer</div>
          <div className={`text-[11px] mb-3 ${muted}`}>Green &lt;75% · Orange 75–80% · Red &gt;80%</div>
          {[...all].sort((a, b) => (a.calc?.allInVsARV || 0) - (b.calc?.allInVsARV || 0)).map(r => {
            const ratio = r.calc?.allInVsARV || 0
            const addr  = (r.lead?.address || '—').split(',')[0]
            const type  = dealType(r.financials)
            const annRoi = r.calc?.actual?.annualizedRoi ?? r.calc?.expected?.annualizedRoi ?? 0
            const barCol = ratio < 0.75 ? 'bg-[color:var(--color-success)]'
                         : ratio < 0.80 ? 'bg-orange-400'
                         : 'bg-[color:var(--color-danger)]'
            return (
              <BarRow key={r.financials.id}
                label={addr}
                value={ratio}
                max={1}
                fmt={fmtPct}
                color={barCol}
                sub={`${fmtPct(annRoi)} ann. ROI`}
                badge={{ label: type, cls: TYPE_CLS[type] }}
              />
            )
          })}
        </Card>

        {/* Chart 4: Hold time vs Ann ROI */}
        <Card>
          <div className={`text-[10px] uppercase tracking-wider font-semibold mb-3 ${dim}`}>Hold Time vs Annualized ROI</div>
          <div className={`text-[11px] mb-3 ${muted}`}>Shorter holds = higher annualized returns. Each extra month with HML costs ~$1,700.</div>
          {[...all].sort((a, b) => (a.financials.hold_months || 0) - (b.financials.hold_months || 0)).map(r => {
            const hold   = r.financials.hold_months || 0
            const addr   = (r.lead?.address || '—').split(',')[0]
            const type   = dealType(r.financials)
            const annRoi = r.calc?.actual?.annualizedRoi ?? r.calc?.expected?.annualizedRoi ?? 0
            return (
              <div key={r.financials.id} className="flex items-center gap-3 py-1.5">
                <div className="w-40 shrink-0 flex items-center gap-1.5">
                  <span className={`text-[9.5px] px-1.5 py-0.5 rounded font-medium shrink-0 ${TYPE_CLS[type]}`}>{type}</span>
                  <span className={`text-[11.5px] font-medium text-[color:var(--color-text)] truncate`}>{addr}</span>
                </div>
                {/* hold time bubbles */}
                <div className="flex-1 flex items-center gap-0.5">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <div key={i} className={`h-4 flex-1 rounded-sm transition-colors ${
                      i < hold
                        ? (hold <= 5 ? 'bg-[color:var(--color-success)]' : hold <= 7 ? 'bg-orange-400' : 'bg-[color:var(--color-danger)]')
                        : 'bg-[color:var(--color-bg-elev-2)]'
                    }`} />
                  ))}
                </div>
                <div className="w-28 text-right shrink-0">
                  <div className={`text-[12px] font-bold ${annRoi >= 0.5 ? success : annRoi >= 0.2 ? muted : danger}`}>{fmtPct(annRoi)}</div>
                  <div className={`text-[10px] ${dim}`}>{hold} months</div>
                </div>
              </div>
            )
          })}
        </Card>
      </div>

      {/* ── CAPITAL VELOCITY ─────────────────────────────────────────────── */}
      <div>
        <SectionTitle>Capital Velocity — How Hard Is Your Money Working?</SectionTitle>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <Card>
            <div className={`text-[10px] uppercase tracking-wider font-medium mb-1 ${dim}`}>Current Weighted Ann. ROI</div>
            <div className={`text-[26px] font-bold ${velocity.weightedRoi >= 0.5 ? success : 'text-orange-600'}`}>{fmtPct(velocity.weightedRoi)}</div>
            <div className={`text-[11px] mt-1 ${muted}`}>on {fmtUSD(velocity.totalCash)} deployed</div>
            <div className={`text-[11px] mt-0.5 ${muted}`}>= {fmtUSD(velocity.currentAnnualReturn)} / year projected</div>
          </Card>
          <Card>
            <div className={`text-[10px] uppercase tracking-wider font-medium mb-1 ${dim}`}>Best-Deal Rate ({velocity.aHmlCount} A-rated HML)</div>
            <div className={`text-[26px] font-bold ${success}`}>{fmtPct(velocity.bestRate)}</div>
            <div className={`text-[11px] mt-1 ${muted}`}>if all capital deployed at this rate</div>
            <div className={`text-[11px] mt-0.5 ${success}`}>= {fmtUSD(velocity.bestCaseReturn)} / year</div>
          </Card>
          <Card className="border-orange-300 dark:border-orange-700">
            <div className={`text-[10px] uppercase tracking-wider font-medium mb-1 text-orange-600 dark:text-orange-400`}>Opportunity Cost of Cash Deals</div>
            <div className="text-[26px] font-bold text-orange-600 dark:text-orange-400">{fmtUSD(velocity.cashDrag)}</div>
            <div className={`text-[11px] mt-1 ${muted}`}>annual profit left on the table</div>
            <div className={`text-[11px] mt-0.5 ${muted}`}>{fmtUSD(velocity.cashDealCapital)} locked in cash deals vs HML</div>
          </Card>
        </div>

        {/* velocity insight text */}
        <Card className="bg-[color:var(--color-bg-elev-2)]">
          <div className="space-y-2 text-[12px] leading-relaxed text-[color:var(--color-text-muted)]">
            <div>
              <span className="font-semibold text-[color:var(--color-text)]">What this means:</span> Your best HML deals (Beckner, Toledo, Pennant) average <span className={`font-semibold ${success}`}>{fmtPct(velocity.bestRate)}</span> annualized ROI on very small cash positions. Your cash deals lock up large amounts for much lower returns.
            </div>
            <div>
              If you converted {fmtUSD(velocity.cashDealCapital)} currently in cash deals into {Math.floor(velocity.cashDealCapital / 40000)} HML deals at your best-deal rate, you could generate approximately <span className={`font-semibold ${success}`}>{fmtUSD(velocity.cashDealCapital * velocity.bestRate)}</span> per year instead of <span className="font-semibold text-orange-600">{fmtUSD(velocity.cashDealCapital * (velocity.cashDrag / (velocity.cashDealCapital || 1) + (velocity.currentAnnualReturn / (velocity.totalCash || 1))))}</span> — a difference of <span className="font-semibold text-orange-600">{fmtUSD(velocity.cashDrag)}</span>.
            </div>
            <div>
              <span className="font-semibold text-[color:var(--color-text)]">Recommendation:</span> Use HML for as many deals as possible. Reserve cash only for JV structures or when HML isn't available. Target 4–6 month hold times to recycle capital faster.
            </div>
          </div>
        </Card>
      </div>

    </div>
  )
}
