import { useState } from 'react'
import { formatCurrency } from '../../lib/calculations'
import AgentNegotiationModal from './AgentNegotiationModal'
import AgentPhoneScriptModal from './AgentPhoneScriptModal'

// ── Same formulas as analyze-deal.mjs ──────────────────────────────────────
function computeFlipBreakdown(pp, arv, reno, holdMonths = 3) {
  const hmlLoan         = pp * 0.90 + reno
  const monthlyPmt      = hmlLoan * 0.01
  const points          = hmlLoan * 0.02
  const downPayment     = pp * 0.10
  const fixedCosts      = 2450
  const totalCashNeeded = downPayment + points + fixedCosts
  const holdingPerMo    = monthlyPmt + 208 + 100
  const totalHolding    = holdingPerMo * holdMonths
  const saleProceeds    = arv * 0.93
  const totalProfit     = saleProceeds - hmlLoan - totalHolding - totalCashNeeded
  const roi             = totalCashNeeded > 0 ? (totalProfit / totalCashNeeded) * 100 : 0
  const annualizedRoi   = holdMonths > 0 ? (roi / holdMonths) * 12 : 0
  return { hmlLoan, monthlyPmt, points, downPayment, fixedCosts, totalCashNeeded, holdingPerMo, totalHolding, saleProceeds, totalProfit, roi, annualizedRoi, holdMonths }
}

function computeBrrrrBreakdown(pp, arv, reno, monthlyRent, holdMonths = 6) {
  const hmlLoan           = pp * 0.90 + reno
  const monthlyPmt        = hmlLoan * 0.01
  const points            = hmlLoan * 0.02
  const downPayment       = pp * 0.10
  const fixedCosts        = 2450
  const totalCashNeeded   = downPayment + points + fixedCosts
  const holdingPerMo      = monthlyPmt + 208 + 100
  const totalHolding      = holdingPerMo * holdMonths
  const refiLoan          = arv * 0.70
  const refiCosts         = refiLoan * 0.03
  const refiCashOut       = refiLoan - refiCosts - hmlLoan - totalHolding
  const totalCashInvested = refiCashOut >= 0
    ? Math.max(0, totalCashNeeded - refiCashOut)
    : totalCashNeeded + Math.abs(refiCashOut)
  const refiMoPmt         = refiLoan * 0.006607
  const monthlyCF         = monthlyRent > 0 ? monthlyRent - refiMoPmt - 208 - 100 : null
  const annualCF          = monthlyCF != null ? monthlyCF * 12 : null
  const coc               = totalCashInvested > 0 && annualCF != null ? (annualCF / totalCashInvested) * 100 : null
  return { hmlLoan, monthlyPmt, points, downPayment, fixedCosts, totalCashNeeded, holdingPerMo, totalHolding, refiLoan, refiCosts, refiCashOut, totalCashInvested, refiMoPmt, monthlyCF, annualCF, coc, holdMonths }
}

const fc = formatCurrency
const pct = n => n != null ? `${n.toFixed(1)}%` : '—'

// ── Breakdown modal content ─────────────────────────────────────────────────
function BreakdownModal({ analysis, lead, onClose }) {
  const { strategy, inputs } = analysis
  // Always use current lead values — inputs may be stale from a previous run
  const arv  = Number(lead.arv  || inputs?.arv  || 0)
  const reno = Number(lead.renovation_cost ?? inputs?.renovation_cost ?? 0)
  const rent = Number(lead.rent_estimate || lead.monthly_rent || inputs?.monthly_rent || 0)
  // Purchase price: prefer manually-set lead.mao (user may have edited it),
  // fall back to formula, then asking price
  const formulaMao = arv ? Math.round(arv * 0.75 - reno - 2450) : null
  const pp = Number(lead.mao || formulaMao || lead.asking_price || 0)

  const isFlip = strategy !== 'brrrr'
  const f = isFlip ? computeFlipBreakdown(pp, arv, reno) : computeBrrrrBreakdown(pp, arv, reno, rent)

  const Row = ({ label, value, bold, positive, separator, indent }) => (
    separator
      ? <div className="border-t border-[color:var(--color-line)] my-1" />
      : <div className={`flex items-center justify-between py-1 ${indent ? 'pl-4' : ''}`}>
          <span className={`text-[12px] ${bold ? 'font-bold text-[color:var(--color-text)]' : 'text-[color:var(--color-text-muted)]'}`}>{label}</span>
          <span className={`text-[12px] font-semibold tabular-nums ${bold ? 'text-[color:var(--color-text)]' : ''} ${positive === true ? 'text-[color:var(--color-success-text)]' : positive === false ? 'text-[color:var(--color-danger-text)]' : 'text-[color:var(--color-text)]'}`}>
            {value}
          </span>
        </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev)] shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[color:var(--color-line)]">
          <div>
            <div className="text-[13px] font-bold text-[color:var(--color-text)] uppercase tracking-wide">{isFlip ? 'Flip' : 'BRRRR'} — Full Calculation</div>
            <div className="text-[11px] text-[color:var(--color-text-dim)] mt-0.5">
              Purchase {fc(pp)} · ARV {fc(arv)} · Reno {fc(reno)}{!isFlip && rent ? ` · Rent ${fc(rent)}/mo` : ''}
            </div>
          </div>
          <button onClick={onClose} className="text-[color:var(--color-text-dim)] hover:text-[color:var(--color-text)] text-xl leading-none">×</button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto max-h-[75vh]">

          {/* Purchase & Financing */}
          <div>
            <div className="text-[9.5px] uppercase tracking-widest text-[color:var(--color-text-dim)] font-bold mb-1">Purchase & Financing</div>
            <Row label="Purchase Price" value={fc(pp)} />
            <Row label={`HML Loan (90% purchase + 100% reno)`} value={fc(f.hmlLoan)} />
            <Row label="Down Payment (10%)" value={fc(f.downPayment)} />
            <Row separator />
            <Row label="Points (2% of loan)" value={fc(f.points)} indent />
            <Row label="Title & closing costs" value={fc(f.fixedCosts)} indent />
            <Row label="Total Cash to Close" value={fc(f.totalCashNeeded)} bold />
          </div>

          {/* Holding Costs */}
          <div>
            <div className="text-[9.5px] uppercase tracking-widest text-[color:var(--color-text-dim)] font-bold mb-1">Holding Costs ({f.holdMonths} months)</div>
            <Row label="Monthly loan payment (1%/mo)" value={fc(f.monthlyPmt)} indent />
            <Row label="Property taxes" value="$208/mo" indent />
            <Row label="Insurance" value="$100/mo" indent />
            <Row label={`Total per month`} value={fc(f.holdingPerMo)} />
            <Row label={`Total holding (${f.holdMonths} months)`} value={fc(f.totalHolding)} bold />
          </div>

          {isFlip ? (<>
            {/* Flip — All-In Cost Summary */}
            <div>
              <div className="text-[9.5px] uppercase tracking-widest text-[color:var(--color-text-dim)] font-bold mb-1">All-In Cost Summary</div>
              <Row label="Purchase Price" value={fc(pp)} />
              <Row label={`Renovation`} value={fc(reno)} indent />
              <Row label="Points (2% of HML)" value={fc(f.points)} indent />
              <Row label="Title & closing costs" value={fc(f.fixedCosts)} indent />
              <Row label={`Holding (${f.holdMonths} mo × ${fc(f.holdingPerMo)}/mo)`} value={fc(f.totalHolding)} indent />
              <Row separator />
              <Row label="Total All-In" value={fc(pp + reno + f.points + f.fixedCosts + f.totalHolding)} bold />
            </div>

            {/* Flip — Sale & Profit */}
            <div>
              <div className="text-[9.5px] uppercase tracking-widest text-[color:var(--color-text-dim)] font-bold mb-1">Sale & Profit</div>
              <Row label="ARV" value={fc(arv)} />
              <Row label="Selling costs (7%)" value={`−${fc(arv * 0.07)}`} indent />
              <Row label="Sale Proceeds" value={fc(f.saleProceeds)} />
              <Row separator />
              <Row label="− HML Loan repayment" value={`−${fc(f.hmlLoan)}`} indent />
              <Row label="− Total Holding" value={`−${fc(f.totalHolding)}`} indent />
              <Row label="− Cash to Close" value={`−${fc(f.totalCashNeeded)}`} indent />
              <Row separator />
              <Row label="Total Profit" value={fc(f.totalProfit)} bold positive={f.totalProfit >= 30000} />
            </div>
            <div>
              <div className="text-[9.5px] uppercase tracking-widest text-[color:var(--color-text-dim)] font-bold mb-1">Returns</div>
              <Row label="ROI" value={pct(f.roi)} />
              <Row label={`Annualized ROI (÷${f.holdMonths}mo × 12)`} value={pct(f.annualizedRoi)} bold />
              <Row label="Min. profit threshold" value="$30,000" />
              <Row label="Buffer above minimum" value={fc(f.totalProfit - 30000)} positive={f.totalProfit >= 30000} />
            </div>
          </>) : (<>
            {/* BRRRR — Refi */}
            <div>
              <div className="text-[9.5px] uppercase tracking-widest text-[color:var(--color-text-dim)] font-bold mb-1">Refinance</div>
              <Row label="Refi Loan (70% of ARV)" value={fc(f.refiLoan)} />
              <Row label="Refi Closing Costs (3%)" value={`−${fc(f.refiCosts)}`} indent />
              <Row label="HML Loan Repayment" value={`−${fc(f.hmlLoan)}`} indent />
              <Row label="Holding Costs" value={`−${fc(f.totalHolding)}`} indent />
              <Row separator />
              <Row
                label={f.refiCashOut >= 0 ? "Cash Back at Refi" : "Additional Cash Needed at Refi"}
                value={fc(Math.abs(f.refiCashOut))}
                positive={f.refiCashOut >= 0}
                bold
              />
            </div>
            {/* BRRRR — All-In Cost Summary */}
            <div className="rounded-md bg-[color:var(--color-bg-elev-2)] px-3 py-2">
              <div className="text-[9.5px] uppercase tracking-widest text-[color:var(--color-text-dim)] font-bold mb-1">All-In Cost Summary</div>
              <Row label="Purchase Price" value={fc(pp)} indent />
              <Row label="Renovation" value={fc(reno)} indent />
              <Row label="Down Payment (10%)" value={fc(f.downPayment)} indent />
              <Row label="HML Points (2% of loan)" value={fc(f.points)} indent />
              <Row label="Title & Closing" value={fc(f.fixedCosts)} indent />
              <Row label={`HML Interest (1%/mo × ${f.holdMonths} months)`} value={fc(f.monthlyPmt * f.holdMonths)} indent />
              <Row label={`Taxes + Insurance (${f.holdMonths} months)`} value={fc((208 + 100) * f.holdMonths)} indent />
              <Row separator />
              <Row label="Total All-In Cost" value={fc(pp + reno + f.downPayment + f.points + f.fixedCosts + f.totalHolding)} bold />
              <Row separator />
              <Row label="Funded by HML Loan" value={`−${fc(f.hmlLoan)}`} indent />
              <Row label="Your Cash Out of Pocket" value={fc(f.totalCashNeeded + f.totalHolding)} />
              <Row separator />
              {f.refiCashOut >= 0
                ? <Row label="Refi Cash Back" value={`−${fc(f.refiCashOut)}`} indent positive />
                : <Row label="Additional Cash at Refi" value={`+${fc(Math.abs(f.refiCashOut))}`} indent />
              }
              <Row
                label="Cash Left in Deal (after refi)"
                value={fc(f.totalCashInvested)}
                bold
                positive={f.totalCashInvested === 0}
              />
            </div>
            {/* BRRRR — Cash Flow */}
            <div>
              <div className="text-[9.5px] uppercase tracking-widest text-[color:var(--color-text-dim)] font-bold mb-1">Monthly Cash Flow (post-refi)</div>
              <Row label="Gross Rent" value={rent > 0 ? fc(rent) : '—'} />
              <Row label="Refi Mortgage (6.9% / 30yr)" value={`−${fc(f.refiMoPmt)}`} indent />
              <Row label="Property Taxes" value="−$208" indent />
              <Row label="Insurance" value="−$100" indent />
              <Row separator />
              <Row label="Monthly Cash Flow" value={f.monthlyCF != null ? fc(f.monthlyCF) : '—'} bold positive={f.monthlyCF != null && f.monthlyCF > 0} />
              <Row label="Annual Cash Flow" value={f.annualCF != null ? fc(f.annualCF) : '—'} />
              <Row label="Cash-on-Cash Return" value={pct(f.coc)} bold positive={f.coc != null && f.coc >= 8} />
            </div>
          </>)}

        </div>

        <div className="px-5 py-3 border-t border-[color:var(--color-line)] flex justify-end">
          <button onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-[12px] font-semibold bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] border border-[color:var(--color-line)] transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main panel ──────────────────────────────────────────────────────────────
export default function DealAnalysisPanel({ analysis, lead }) {
  const [risksOpen,    setRisksOpen]    = useState(false)
  const [showBreakdown,setShowBreakdown]= useState(false)
  const [emailOpen,    setEmailOpen]    = useState(false)
  const [phoneOpen,    setPhoneOpen]    = useState(false)
  if (!analysis) return null

  const { verdict = 'UNKNOWN', score, profit, roi, annualized_roi, total_cash_needed,
          recommendation, key_risks = [], analyzed_at, strategy = 'flip',
          reno_unknown, reno_was_estimated, inputs } = analysis

  const isFlip = strategy !== 'brrrr'

  const theme = score >= 70
    ? { bg: 'var(--color-success-soft)', border: 'var(--color-success)', text: 'var(--color-success-text)' }
    : score >= 45
    ? { bg: 'var(--color-warn-soft)',    border: 'var(--color-warn)',    text: 'var(--color-warn-text)' }
    : { bg: 'var(--color-danger-soft)',  border: 'var(--color-danger)',  text: 'var(--color-danger-text)' }

  const dashboardUrl = (() => {
    const p = new URLSearchParams({
      pp:      lead.offer_price     || lead.asking_price || '',
      arv:     lead.arv             || '',
      reno:    lead.renovation_cost || '',
      rent:    lead.rent_estimate   || '0',
      address: lead.address         || '',
    })
    return `/deal-analyzer.html?${p.toString()}`
  })()

  const ts = analyzed_at
    ? new Date(analyzed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  // Compute live breakdowns from current lead values so metric cards update instantly
  // when MAO / ARV / reno are edited — no Re-check required
  const liveArv  = Number(lead.arv  || analysis.inputs?.arv  || 0)
  const liveReno = Number(lead.renovation_cost ?? analysis.inputs?.renovation_cost ?? 0)
  const liveFormulaMao = liveArv ? Math.round(liveArv * 0.75 - liveReno - 2450) : null
  const livePp   = Number(lead.mao || liveFormulaMao || lead.asking_price || 0)

  const flipLive  = isFlip
    ? computeFlipBreakdown(livePp, liveArv, liveReno)
    : null
  const liveRent  = Number(lead.rent_estimate || lead.monthly_rent || analysis.inputs?.monthly_rent || 0)
  const brrrrLive = !isFlip
    ? computeBrrrrBreakdown(livePp, liveArv, liveReno, liveRent)
    : null

  const metrics = isFlip
    ? [
        { label: 'Est. Profit',    value: flipLive ? formatCurrency(Math.round(flipLive.totalProfit))           : '—', note: 'at MAO' },
        { label: 'ROI',            value: flipLive ? `${Math.round(flipLive.roi * 10) / 10}%`                   : '—', note: '3-month flip' },
        { label: 'Annualized ROI', value: flipLive ? `${Math.round(flipLive.annualizedRoi * 10) / 10}%`         : '—', note: '× 12 / hold' },
        { label: 'Cash to Close',  value: flipLive ? formatCurrency(Math.round(flipLive.totalCashNeeded))       : '—', note: 'down + costs' },
      ]
    : [
        { label: 'Annual Cash Flow', value: brrrrLive?.annualCF   != null ? formatCurrency(Math.round(brrrrLive.annualCF))                  : '—', note: 'post-refi' },
        { label: 'Cash-on-Cash',     value: brrrrLive?.coc        != null ? `${Math.round(brrrrLive.coc * 10) / 10}%`                       : '—', note: 'CoC return' },
        { label: 'CoC (same)',       value: brrrrLive?.coc        != null ? `${Math.round(brrrrLive.coc * 10) / 10}%`                       : '—', note: 'annualized' },
        { label: 'Cash in Deal',     value: brrrrLive?.totalCashInvested != null ? formatCurrency(Math.round(brrrrLive.totalCashInvested))   : '—', note: 'total invested' },
      ]

  const isDraft = reno_unknown || reno_was_estimated
  const draftRenoAmt = reno_was_estimated && inputs?.renovation_cost
    ? formatCurrency(inputs.renovation_cost)
    : null

  // Verdict/score are stale when live values differ from what was analyzed
  const verdictStale = inputs && (
    Math.abs(livePp - (inputs.purchase_price || 0)) > 1 ||
    Math.abs(liveArv - (inputs.arv || 0)) > 1 ||
    Math.abs(liveReno - (inputs.renovation_cost || 0)) > 1
  )

  return (
    <div className="mt-4 space-y-3">

      {/* ── Draft banner when reno is estimated or unknown ── */}
      {isDraft && (
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg border border-[color:var(--color-warn)] bg-[color:var(--color-warn-soft)]">
          <span className="text-[color:var(--color-warn-text)] shrink-0 mt-px">⚠</span>
          <p className="text-[11.5px] text-[color:var(--color-warn-text)] leading-snug">
            {reno_unknown
              ? <><strong>Draft analysis</strong> — assumes $0 renovation. MAO will shift once you enter a real cost.</>
              : <><strong>Draft analysis</strong> — based on estimated reno ({draftRenoAmt}). MAO will shift once you have a contractor quote.</>
            }
          </p>
        </div>
      )}

      {/* ── Verdict banner ── */}
      <div
        className="flex items-center gap-3 px-4 py-3 rounded-xl border"
        style={{ background: theme.bg, borderColor: theme.border }}
      >
        {score != null && (
          <div className="shrink-0 text-center min-w-[48px]">
            <div className="text-[22px] font-black leading-none" style={{ color: theme.text }}>{score}</div>
            <div className="text-[9px] uppercase tracking-widest font-semibold opacity-60" style={{ color: theme.text }}>/100</div>
          </div>
        )}
        <div className="w-px self-stretch opacity-20" style={{ background: theme.text }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-bold uppercase tracking-wide" style={{ color: theme.text }}>{verdict}</span>
            {isDraft && (
              <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-[color:var(--color-warn)] text-white opacity-80">DRAFT</span>
            )}
            {verdictStale && !isDraft && (
              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded border border-[color:var(--color-warn)] text-[color:var(--color-warn-text)] opacity-80">↺ re-run for updated verdict</span>
            )}
            <span className="text-[10px] opacity-50 font-medium" style={{ color: theme.text }}>· {strategy}</span>
          </div>
          {recommendation && (
            <p className={`text-[12px] leading-snug mt-0.5 opacity-80 ${verdictStale ? 'line-through opacity-40' : ''}`} style={{ color: theme.text }}>{recommendation}</p>
          )}
        </div>
      </div>

      {/* ── Key metrics — click any to open breakdown ── */}
      <div>
        <button
          onClick={() => setShowBreakdown(true)}
          className="w-full group"
          title="Click to see full calculation breakdown"
        >
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {metrics.map(({ label, value, note }) => (
              <div key={label}
                className="bg-[color:var(--color-bg)] border border-[color:var(--color-line)] group-hover:border-[color:var(--color-accent)] rounded-lg p-2.5 text-center transition-colors">
                <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-0.5">{label}</div>
                <div className="text-[14px] font-bold text-[color:var(--color-text)]">{value}</div>
                <div className="text-[9px] text-[color:var(--color-text-dim)] opacity-60 mt-0.5">{note}</div>
              </div>
            ))}
          </div>
          <div className="text-[10px] text-[color:var(--color-accent-text)] opacity-0 group-hover:opacity-100 text-center mt-1 transition-opacity">
            ▼ Click to see full calculation
          </div>
        </button>
      </div>

      {/* ── Risk factors (collapsed) ── */}
      {key_risks.length > 0 && (
        <div className="rounded-lg border border-[color:var(--color-warn)] overflow-hidden">
          <button
            onClick={() => setRisksOpen(v => !v)}
            className="w-full flex items-center justify-between px-3 py-2 bg-[color:var(--color-warn-soft)] text-[color:var(--color-warn-text)] hover:opacity-80 transition-opacity"
          >
            <span className="text-[11.5px] font-semibold">⚠ {key_risks.length} risk factor{key_risks.length > 1 ? 's' : ''}</span>
            <span className="text-[10px] opacity-60">{risksOpen ? '▲ hide' : '▼ show'}</span>
          </button>
          {risksOpen && (
            <div className="px-3 py-2 bg-[color:var(--color-warn-soft)] border-t border-[color:var(--color-warn)] space-y-1">
              {key_risks.map((r, i) => (
                <div key={i} className="text-[11.5px] text-[color:var(--color-warn-text)] flex items-start gap-1.5">
                  <span className="shrink-0 mt-0.5">·</span>
                  <span>{r}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Footer actions ── */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[color:var(--color-line)]">
        {ts && <span className="text-[10.5px] text-[color:var(--color-text-dim)]">Analyzed {ts}</span>}
        <div className="flex flex-wrap gap-1.5 ml-auto">
          <button type="button" onClick={() => setShowBreakdown(true)}
            className="text-[12px] px-2.5 py-1.5 bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)] rounded-lg border border-[color:var(--color-accent)] transition-colors font-semibold">
            🧮 Full Breakdown
          </button>
          <button type="button" onClick={() => setEmailOpen(true)}
            className="text-[12px] px-2.5 py-1.5 bg-[color:var(--color-bg-elev-2)] hover:bg-[color:var(--color-accent-soft)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-accent-text)] rounded-lg border border-[color:var(--color-line)] transition-colors">
            📧 Agent Email
          </button>
          <button type="button" onClick={() => setPhoneOpen(true)}
            className="text-[12px] px-2.5 py-1.5 bg-[color:var(--color-bg-elev-2)] hover:bg-[color:var(--color-accent-soft)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-accent-text)] rounded-lg border border-[color:var(--color-line)] transition-colors">
            📞 Phone Script
          </button>
          <a href={dashboardUrl} target="_blank" rel="noopener noreferrer"
            className="text-[12px] px-2.5 py-1.5 bg-[color:var(--color-bg-elev-2)] hover:bg-[color:var(--color-accent-soft)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-accent-text)] rounded-lg border border-[color:var(--color-line)] transition-colors">
            Open Dashboard →
          </a>
        </div>
      </div>

      {/* ── Breakdown modal ── */}
      {showBreakdown && (
        <BreakdownModal analysis={analysis} lead={lead} onClose={() => setShowBreakdown(false)} />
      )}

      <AgentNegotiationModal open={emailOpen} onClose={() => setEmailOpen(false)} lead={lead} />
      <AgentPhoneScriptModal open={phoneOpen} onClose={() => setPhoneOpen(false)} lead={lead} />
    </div>
  )
}
