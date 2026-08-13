// src/components/lead-detail/DealAnalysisCard.jsx
import { useState, useEffect, useRef } from 'react'
import Card from '../ui/Card'
import NotesRenderer from './NotesRenderer'
import DealQA from './DealQA'
import RenoTierPicker from './RenoTierPicker'
import { supabase } from '../../lib/supabase'
import { formatCurrency } from '../../lib/calculations'
import { logDealAnalysis } from '../../lib/activityLogger'
import { useDealStaleness } from '../../hooks/useDealStaleness'
import { evaluateAndRecordRediscovery, fetchRediscoveryStatus } from '../../lib/propertyIntelligence'
import { isDistressedLead } from '../../lib/distressInfo'
import { derivePriority, PRIORITY_DISPLAY, PRIORITY_THEME } from '../../lib/leadPriority'
import { recalculateDecisionV2 } from '../../lib/decisionV2Persistence'

// Parse the AI-computed MAO from the generated notes text ("Our MAO: $X")
// so lead.mao always matches exactly what the AI Summary shows.
function parseAiMao(notesText) {
  if (!notesText) return null
  const m = notesText.match(/Our MAO:\s*\$([0-9,]+)/i)
  return m ? parseInt(m[1].replace(/,/g, ''), 10) : null
}

function parseAiStartingOffer(notesText) {
  if (!notesText) return null
  const m = notesText.match(/Starting Offer:\s*\$([0-9,]+)/i)
  return m ? parseInt(m[1].replace(/,/g, ''), 10) : null
}

// Free-text property type (as written by the AI) → our fixed select options
function mapPropertyType(text) {
  if (!text) return null
  const t = text.toLowerCase()
  if (/single|sfr/.test(t)) return 'single_family'
  if (/duplex|tri-?plex|four-?plex|multi/.test(t)) return 'multi_family'
  if (/condo/.test(t)) return 'condo'
  if (/town/.test(t)) return 'townhouse'
  if (/land|lot/.test(t)) return 'land'
  if (/commercial/.test(t)) return 'commercial'
  return null
}

// Parse the DEAL SNAPSHOT section's "Profile" and "DOM" lines so we can backfill
// Property Info fields the AI restated but the lead record is missing.
// Profile line format: "Profile:    3BR/2.5BA | 1217 sqft | ZIP 32218 | Single-Family"
function parseSnapshotFields(notesText) {
  if (!notesText) return {}
  const out = {}
  const profileMatch = notesText.match(/Profile:\s*([\d.]+)BR\/([\d.]+)BA\s*\|\s*([\d,]+)\s*sqft\s*\|\s*ZIP\s*(\d{5})\s*\|\s*([^\n|]+)/i)
  if (profileMatch) {
    out.bedrooms = parseInt(profileMatch[1], 10) || null
    out.bathrooms = parseFloat(profileMatch[2]) || null
    out.sqft = parseInt(profileMatch[3].replace(/,/g, ''), 10) || null
    out.zip_code = profileMatch[4]
    out.property_type = mapPropertyType(profileMatch[5].trim())
  }
  const domMatch = notesText.match(/DOM:\s*(\d+)\s*days?/i)
  if (domMatch) out.days_on_market = parseInt(domMatch[1], 10)
  return out
}

// --- Smart Lead Prioritization -------------------------------------------
// derivePriority / PRIORITY_DISPLAY / PRIORITY_THEME now live in
// src/lib/leadPriority.js (extracted for Capability #5 — Action Center —
// to reuse the exact same computation instead of recalculating it).

// Fetch comment-type activities for a lead and format as context string
async function fetchLeadContext(lead) {
  if (!lead.id) return ''
  const { data } = await supabase
    .from('lead_activities')
    .select('content, created_at, profiles:user_id(full_name)')
    .eq('lead_id', lead.id)
    .eq('type', 'comment')
    .order('created_at', { ascending: true })
    .limit(30)
  if (!data?.length) return ''
  return data.map(a => {
    const who = a.profiles?.full_name || 'Team'
    const when = new Date(a.created_at).toLocaleDateString()
    return `[${when}] ${who}: ${a.content}`
  }).join('\n')
}

// Calls one of the 4 analysis Netlify functions and returns notes string
async function callFn(name, body) {
  const res = await fetch(`/.netlify/functions/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const ct = res.headers.get('content-type') || ''
  if (!ct.includes('application/json')) throw new Error(`${name} timed out`)
  const data = await res.json()
  if (!data.ok) throw new Error(data.error || `${name} failed`)
  return data.notes || ''
}

// Like callFn but returns the full response object (for generate-core-analysis which also returns computed_arv/computed_mao)
async function callFnFull(name, body) {
  const res = await fetch(`/.netlify/functions/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const ct = res.headers.get('content-type') || ''
  if (!ct.includes('application/json')) throw new Error(`${name} timed out`)
  const data = await res.json()
  if (!data.ok) throw new Error(data.error || `${name} failed`)
  return data
}

// ── Same formulas as analyze-deal.mjs ──────────────────────────────────────
function computeFlipBreakdown(pp, arv, reno, holdMonths = 6) {
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

// Solves the flip math backward: given a desired profit, what's the max purchase
// price that still hits it? Same formula as computeFlipBreakdown, solved for pp.
function maxOfferForProfit(arv, reno, holdMonths, desiredProfit) {
  const ppCoeff   = 1.018 + 0.009 * holdMonths
  const renoCoeff = 1.02 + 0.01 * holdMonths
  const constant  = arv * 0.93 - holdMonths * 308 - 2450
  return (constant - reno * renoCoeff - desiredProfit) / ppCoeff
}

// Generic bisection: finds where evalFn(x) flips from false to true across [lo, hi].
// Works regardless of whether increasing x makes the condition more or less likely
// to be true. Returns null if the condition doesn't change within [lo, hi] at all
// (either always true, or — the case we care about — never true in a realistic range).
function bisectThreshold(evalFn, lo, hi, iterations = 50) {
  const trueAtLo = evalFn(lo)
  const trueAtHi = evalFn(hi)
  if (trueAtLo === trueAtHi) return trueAtLo ? lo : null
  let a = lo, b = hi
  for (let i = 0; i < iterations; i++) {
    const mid = (a + b) / 2
    if (evalFn(mid) === trueAtHi) b = mid; else a = mid
  }
  return trueAtHi ? b : a
}

// Explains a BRRRR verdict in plain terms and shows exactly what would need to
// change to cross into BUY — checked one lever at a time (rent, renovation cost,
// ARV), holding the other two at their current values.
function BrrrrRealityCheck({ lead, verdict, score }) {
  const arv  = Number(lead.arv || 0)
  const reno = Number(lead.renovation_cost ?? 0)
  const rent = Number(lead.rent_estimate || lead.monthly_rent || 0)
  const pp   = Number(lead.mao || (arv ? Math.round(arv * 0.75 - reno - 2450) : 0) || lead.asking_price || 0)
  if (!arv || !pp) return null
  const holdMonths = lead.hold_months || 6

  const f = computeBrrrrBreakdown(pp, arv, reno, rent, holdMonths)
  const cf  = f.monthlyCF
  const coc = f.coc

  const tier = (cf != null && coc != null && coc >= 8 && cf >= 200) ? 'BUY'
    : (cf != null && coc != null && coc >= 5 && cf >= 100) ? 'CONDITIONAL'
    : 'FAIL'

  const isBuy = (arvVal, renoVal, rentVal) => {
    const r = computeBrrrrBreakdown(pp, arvVal, renoVal, rentVal, holdMonths)
    return r.monthlyCF != null && r.coc != null && r.monthlyCF >= 200 && r.coc >= 8
  }

  // Each lever solved independently — everything else held at its current value.
  const rentThreshold = rent > 0
    ? bisectThreshold(r => isBuy(arv, reno, r), rent, rent + 3000)
    : null
  const renoThreshold = reno > 0 && rent > 0
    ? bisectThreshold(r => isBuy(arv, r, rent), 0, reno)
    : null
  const arvThreshold = rent > 0
    ? bisectThreshold(a => isBuy(a, reno, rent), arv * 0.5, arv * 2)
    : null

  const round50 = n => Math.round(n / 50) * 50
  const round1k = n => Math.round(n / 1000) * 1000

  const cfColor = cf == null ? 'text-[color:var(--color-text-dim)]' : cf >= 200 ? 'text-[color:var(--color-success-text)]' : cf >= 0 ? 'text-[color:var(--color-warn-text)]' : 'text-[color:var(--color-danger-text)]'
  const cocColor = coc == null ? 'text-[color:var(--color-text-dim)]' : coc >= 8 ? 'text-[color:var(--color-success-text)]' : coc >= 5 ? 'text-[color:var(--color-warn-text)]' : 'text-[color:var(--color-danger-text)]'

  return (
    <div className="mb-3 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] p-3 space-y-2">
      <div className="text-[9.5px] uppercase tracking-widest text-[color:var(--color-text-dim)] font-bold">🎯 Path to a Deal — BRRRR ({verdict || tier})</div>

      <p className="text-[11.5px] text-[color:var(--color-text-muted)] leading-relaxed">
        BRRRR is judged on two things: <strong className="text-[color:var(--color-text)]">Monthly Cash Flow</strong> (rent left over after mortgage, taxes, insurance)
        and <strong className="text-[color:var(--color-text)]">Cash-on-Cash Return</strong> (that cash flow ÷ the cash you have left in the deal after refinancing). Both must clear their bar together.
      </p>
      <ul className="text-[11px] text-[color:var(--color-text-muted)] leading-relaxed space-y-0.5 list-none">
        <li><strong className="text-[color:var(--color-success-text)]">BUY</strong> — ≥$200/mo cash flow AND ≥8% cash-on-cash. Solid rental, comfortably self-sustaining.</li>
        <li><strong className="text-[color:var(--color-warn-text)]">CONDITIONAL</strong> — ≥$100/mo AND ≥5% cash-on-cash. Works, but with little cushion for vacancy, repairs, or rent coming in under estimate.</li>
        <li><strong className="text-[color:var(--color-danger-text)]">FAIL</strong> — below either bar. Not viable as a buy-and-hold rental at these numbers; would need to change rent, ARV, or reno to work (see below).</li>
      </ul>

      <div className="grid grid-cols-2 gap-3 pt-1">
        <div>
          <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Monthly Cash Flow</div>
          <div className={`text-[14px] font-bold ${cfColor}`}>{cf != null ? fc(cf) + '/mo' : '— (no rent set)'}</div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Cash-on-Cash Return</div>
          <div className={`text-[14px] font-bold ${cocColor}`}>{coc != null ? pct(coc) : '—'}</div>
        </div>
      </div>

      {rent > 0 ? (
        <div className="border-t border-[color:var(--color-line)] pt-2 space-y-1.5">
          <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] font-semibold">To make this a BUY — pick one lever (each shown holding the others as-is):</div>

          {tier === 'BUY' ? (
            <p className="text-[11px] text-[color:var(--color-success-text)]">Already there — no changes needed.</p>
          ) : (
            <>
              <p className="text-[11px] text-[color:var(--color-accent-text)]">
                <strong>Rent</strong> would need to reach {rentThreshold != null ? <><strong>{fc(round50(rentThreshold))}/mo</strong> (currently {fc(rent)}/mo — {fc(round50(rentThreshold) - rent)} short)</> : 'a level not realistic to reach'}.
              </p>
              <p className="text-[11px] text-[color:var(--color-accent-text)]">
                <strong>Renovation cost</strong> would need to drop to {renoThreshold != null ? <><strong>{fc(round1k(renoThreshold))}</strong> or less (currently {fc(reno)})</> : reno > 0 ? "no amount fixes this on its own — cash flow is still short even at $0 reno" : "n/a (already $0)"}.
              </p>
              <p className="text-[11px] text-[color:var(--color-accent-text)]">
                <strong>ARV</strong> would need to come in {arvThreshold != null ? <>at <strong>{fc(round1k(arvThreshold))}</strong> {arvThreshold < arv ? 'or lower' : 'or higher'} (currently {fc(arv)})</> : 'at a level not realistic to reach'}.
                {arvThreshold != null && arvThreshold < arv && ' A lower ARV means a smaller refi loan and payment — better cash flow, but less cash back at refi.'}
              </p>
              <p className="text-[10px] text-[color:var(--color-text-dim)] italic pt-1">
                Purchase price alone doesn't move monthly cash flow here — the refi loan is fixed at 70% of ARV regardless of what you paid — but a lower offer still improves your cash-on-cash return.
              </p>
            </>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-[color:var(--color-warn-text)] border-t border-[color:var(--color-line)] pt-2">
          No rent estimate is set — cash flow can't be computed. Add a Rent Estimate in Financials, then re-run.
        </p>
      )}
    </div>
  )
}

// Explains a Flip verdict in plain terms and shows exactly what would need to
// change to cross into BUY — checked one lever at a time (purchase price, ARV,
// renovation cost), holding the other two at their current values.
function FlipRealityCheck({ lead, verdict, score }) {
  const arv  = Number(lead.arv || 0)
  const reno = Number(lead.renovation_cost ?? 0)
  const formulaMao = arv ? Math.round(arv * 0.75 - reno - 2450) : null
  const pp = Number(lead.mao || formulaMao || lead.asking_price || 0)
  if (!arv || !pp) return null
  const holdMonths = lead.hold_months || 6

  const f = computeFlipBreakdown(pp, arv, reno, holdMonths)
  const profit = f.totalProfit

  const tier = profit >= 40000 ? 'BUY' : profit >= 30000 ? 'CONDITIONAL' : 'PASS'

  const isBuy = (arvVal, renoVal, ppVal) => computeFlipBreakdown(ppVal, arvVal, renoVal, holdMonths).totalProfit >= 40000

  const ppThreshold   = bisectThreshold(p => isBuy(arv, reno, p), pp * 0.5, pp * 1.5)
  const arvThreshold  = bisectThreshold(a => isBuy(a, reno, pp), arv * 0.5, arv * 2)
  const renoThreshold = reno > 0 ? bisectThreshold(r => isBuy(arv, r, pp), 0, reno) : null

  const round1k = n => Math.round(n / 1000) * 1000

  const profitColor = profit >= 40000 ? 'text-[color:var(--color-success-text)]' : profit >= 30000 ? 'text-[color:var(--color-warn-text)]' : 'text-[color:var(--color-danger-text)]'
  const roiColor = f.roi >= 15 ? 'text-[color:var(--color-success-text)]' : f.roi >= 8 ? 'text-[color:var(--color-warn-text)]' : 'text-[color:var(--color-danger-text)]'

  return (
    <div className="mb-3 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] p-3 space-y-2">
      <div className="text-[9.5px] uppercase tracking-widest text-[color:var(--color-text-dim)] font-bold">🎯 Path to a Deal — Flip ({verdict || tier})</div>

      <p className="text-[11.5px] text-[color:var(--color-text-muted)] leading-relaxed">
        Flip is judged mainly on <strong className="text-[color:var(--color-text)]">Total Profit</strong> after sale (ARV × 93%, minus the HML loan, holding costs, and cash to close).
      </p>
      <ul className="text-[11px] text-[color:var(--color-text-muted)] leading-relaxed space-y-0.5 list-none">
        <li><strong className="text-[color:var(--color-success-text)]">BUY</strong> — ≥$40,000 profit. Healthy margin, safe to proceed even if costs run a bit over.</li>
        <li><strong className="text-[color:var(--color-warn-text)]">CONDITIONAL</strong> — $30,000–$39,999 profit. Still clears the minimum bar, but the margin is thin — double-check your reno estimate and ARV comps before committing, since a small overrun could wipe out the profit.</li>
        <li><strong className="text-[color:var(--color-danger-text)]">PASS</strong> — under $30,000. Not enough cushion for the risk of a flip; look for a lower price or walk away.</li>
      </ul>

      <div className="grid grid-cols-2 gap-3 pt-1">
        <div>
          <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Profit If Purchased At MAO</div>
          <div className={`text-[14px] font-bold ${profitColor}`}>{fc(profit)}</div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)]">ROI ({holdMonths}mo)</div>
          <div className={`text-[14px] font-bold ${roiColor}`}>{pct(f.roi)}</div>
        </div>
      </div>

      <div className="border-t border-[color:var(--color-line)] pt-2 space-y-1.5">
        <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] font-semibold">To make this a BUY — pick one lever (each shown holding the others as-is):</div>

        {tier === 'BUY' ? (
          <p className="text-[11px] text-[color:var(--color-success-text)]">Already there — no changes needed.</p>
        ) : (
          <>
            <p className="text-[11px] text-[color:var(--color-accent-text)]">
              <strong>Purchase Price</strong> would need to be {ppThreshold != null ? <><strong>{fc(round1k(ppThreshold))}</strong> or lower (currently {fc(pp)})</> : 'lower than is realistic here'}.
            </p>
            <p className="text-[11px] text-[color:var(--color-accent-text)]">
              <strong>ARV</strong> would need to be {arvThreshold != null ? <><strong>{fc(round1k(arvThreshold))}</strong> or higher (currently {fc(arv)})</> : 'higher than is realistic here'}.
            </p>
            <p className="text-[11px] text-[color:var(--color-accent-text)]">
              <strong>Renovation cost</strong> would need to drop to {renoThreshold != null ? <><strong>{fc(round1k(renoThreshold))}</strong> or less (currently {fc(reno)})</> : reno > 0 ? "no amount fixes this on its own — profit is still short even at $0 reno" : "n/a (already $0)"}.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

function TargetProfitCalc({ arv, reno, holdMonths, currentPP, currentProfit }) {
  const [targetProfit, setTargetProfit] = useState('30000')
  const parsed = parseFloat(targetProfit.replace(/[^0-9.]/g, '')) || 0
  const maxOffer = arv ? maxOfferForProfit(arv, reno, holdMonths, parsed) : null
  const roundedMaxOffer = maxOffer != null ? Math.round(maxOffer / 100) * 100 : null
  const diff = roundedMaxOffer != null ? roundedMaxOffer - currentPP : null

  return (
    <div className="rounded-lg border border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)] p-3">
      <div className="text-[9.5px] uppercase tracking-widest text-[color:var(--color-accent-text)] font-bold mb-2">
        Target Profit → Max Offer
      </div>
      <p className="text-[10.5px] text-[color:var(--color-accent-text)] opacity-80 mb-2 leading-snug">
        MAO above uses the fixed 75% rule. If you'd accept a lower profit to win the deal, this shows what purchase price that allows instead.
      </p>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex flex-col gap-0.5">
          <label className="text-[9.5px] text-[color:var(--color-accent-text)] uppercase tracking-wider">Acceptable Profit</label>
          <input
            value={targetProfit}
            onChange={e => setTargetProfit(e.target.value)}
            className="w-32 h-7 px-2 rounded border border-[color:var(--color-accent)] bg-[color:var(--color-bg)] text-[11.5px] text-[color:var(--color-text)] outline-none"
          />
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[9.5px] text-[color:var(--color-accent-text)] uppercase tracking-wider">Max Offer</span>
          <span className="text-[14px] font-bold text-[color:var(--color-text)]">{roundedMaxOffer != null ? fc(roundedMaxOffer) : '—'}</span>
        </div>
        {diff != null && (
          <div className="flex flex-col gap-0.5">
            <span className="text-[9.5px] text-[color:var(--color-accent-text)] uppercase tracking-wider">vs. Current MAO</span>
            <span className={`text-[12px] font-semibold ${diff >= 0 ? 'text-[color:var(--color-success-text)]' : 'text-[color:var(--color-danger-text)]'}`}>
              {diff >= 0 ? '+' : ''}{fc(diff)}
            </span>
          </div>
        )}
      </div>
      {currentProfit != null && (
        <p className="text-[10px] text-[color:var(--color-accent-text)] opacity-70 mt-2">
          Current MAO ({fc(currentPP)}) yields ~{fc(currentProfit)} profit at these ARV/reno numbers.
        </p>
      )}
    </div>
  )
}

function FullBreakdownTab({ lead, strategy }) {
  const arv  = Number(lead.arv || 0)
  const reno = Number(lead.renovation_cost ?? 0)
  const rent = Number(lead.rent_estimate || lead.monthly_rent || 0)
  const formulaMao = arv ? Math.round(arv * 0.75 - reno - 2450) : null
  const pp = Number(lead.mao || formulaMao || lead.asking_price || 0)
  const isFlip = strategy !== 'brrrr'
  const holdMonths = lead.hold_months || 6
  const f = isFlip ? computeFlipBreakdown(pp, arv, reno, holdMonths) : computeBrrrrBreakdown(pp, arv, reno, rent, holdMonths)

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
    <div className="space-y-4">
      <div className="text-[11px] text-[color:var(--color-text-dim)]">
        Purchase {fc(pp)} · ARV {fc(arv)} · Reno {fc(reno)}{!isFlip && rent ? ` · Rent ${fc(rent)}/mo` : ''}
      </div>

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

        <TargetProfitCalc arv={arv} reno={reno} holdMonths={f.holdMonths} currentPP={pp} currentProfit={f.totalProfit} />
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
  )
}

export default function DealAnalysisCard({ lead, userId, canEdit, onUpdated }) {
  const staleness = useDealStaleness(lead)

  const [strategy,    setStrategy]    = useState(lead.deal_analysis?.strategy || 'flip')
  const [localNotes,  setLocalNotes]  = useState(lead.ai_notes || '')
  const [generating,  setGenerating]  = useState(false)
  const [phase,       setPhase]       = useState(null)
  const [genError,    setGenError]    = useState(null)
  const [showRenoPicker, setShowRenoPicker] = useState(false)
  const [generatingScripts, setGeneratingScripts] = useState(false)
  const [competitiveMode, setCompetitiveMode] = useState(false)
  const [aiCompsArv, setAiCompsArv] = useState(null)
  const [showReasonDetail, setShowReasonDetail] = useState(false) // v1.0.1 — "View details" toggle for Why This Is Worth Your Time
  const [lastArv,  setLastArv]  = useState(lead.arv ? Number(lead.arv) : null)
  const [lastReno, setLastReno] = useState(lead.renovation_cost ? Number(lead.renovation_cost) : null)
  const [refreshingComps, setRefreshingComps] = useState(false)
  // Override inputs — DOM and Rent are now edited in Property Info / Financials
  // and read directly from `lead`; only Price Drop % and Seller Notes are
  // analysis-time-only inputs with no other home.
  const [priceDropOverride, setPriceDropOverride] = useState('')
  const [sellerNotesOverride, setSellerNotesOverride] = useState('')
  const [updatingNego, setUpdatingNego] = useState(false)
  const cancelledRef = useRef(false)

  const [rediscovery, setRediscovery] = useState(null) // Capability #4 — { status, reason } or null

  useEffect(() => { setLocalNotes(lead.ai_notes || '') }, [lead.ai_notes])

  // Capability #4 — Opportunity Rediscovery Engine V1. Read-only, cheap:
  // shows whatever the last evaluateAndRecordRediscovery() run persisted on
  // this property (see below). Never blocks render, never throws.
  useEffect(() => {
    let cancelled = false
    if (lead.workspace_id && lead.id) {
      fetchRediscoveryStatus({ workspaceId: lead.workspace_id, leadId: lead.id }).then(r => {
        if (!cancelled) setRediscovery(r)
      })
    }
    return () => { cancelled = true }
  }, [lead.workspace_id, lead.id])

  const hasAnalysis = !!lead.deal_analysis
  const renoMissing = lead.renovation_cost == null

  // Note: ARV/Reno/DOM/Rent overrides have no input UI in this card (edited only in
  // PropertyInfoSection/FinancialSection), so they are intentionally excluded from this check.
  const overrideChanged = !!priceDropOverride.trim() || !!sellerNotesOverride.trim()

  function handleRun(forceRefreshComps) {
    if (renoMissing) { setShowRenoPicker(true); return }
    runGenerate(forceRefreshComps, strategy)
  }

  function cancelGenerate() {
    cancelledRef.current = true
    setGenerating(false)
    setPhase(null)
    setGenError(null)
  }

  const runGenerate = async (forceRefreshComps = false, strategyOverride = null, renoOverrideVal = null) => {
    setGenerating(true)
    setGenError(null)
    cancelledRef.current = false

    try {
      if (!lead.asking_price) throw new Error('NO_ASKING_PRICE')

      setPhase('analysis')
      const teamComments = await fetchLeadContext(lead)
      const leadWithContext = teamComments ? { ...lead, team_comments: teamComments } : lead

      // Reuse existing comps when re-running analysis — comps are stable (sold homes don't change).
      // Only fetch fresh comps on first run or when explicitly requested via "Refresh Comps".
      const existingComps = localNotes
        ? (localNotes.match(/(={5,}\s*\nMARKET COMPS[\s\S]*?)(?=\n={5,}\s*\n(?:NEGOTIATION PLAN|COMMUNICATIONS)|\s*$)/i)?.[1]?.trim() || null)
        : null
      const needFreshComps = forceRefreshComps || !existingComps
      const freshComps = needFreshComps
        ? await callFn('generate-comps', { lead: leadWithContext }).catch(() => null)
        : null
      if (cancelledRef.current) return
      const compsNotes = freshComps || existingComps

      // Phase 1b — core analysis with comps ARV injected so all numbers agree.
      // ARV set in Financials is the single source of truth — comps only fill it in
      // when it's not set yet; they never silently override a value the user typed.
      const compsArvMatch = compsNotes?.match(/Realistic ARV:\s*\$([0-9,]+)/i)
      const resolvedArv = compsArvMatch ? parseInt(compsArvMatch[1].replace(/,/g, '')) : null
      if (resolvedArv) setAiCompsArv(resolvedArv)
      const arvForCore = (lead.arv ? Number(lead.arv) : null) ?? resolvedArv
      // Apply any override values already entered by the user (reno, notes) —
      // DOM and Rent are read straight from `lead` (edited in Property Info / Financials).
      const renoVal  = renoOverrideVal ?? null
      const notesVal = sellerNotesOverride.trim() || null
      if (renoVal) setLastReno(renoVal)
      const leadWithArv = {
        ...leadWithContext,
        ...(arvForCore ? { arv: arvForCore }            : {}),
        ...(renoOverrideVal ?? renoVal ?? lead.renovation_cost ? { renovation_cost: renoOverrideVal ?? renoVal ?? lead.renovation_cost } : {}),
        ...(notesVal   ? { notes: notesVal }             : {}),
        competitive_mode: competitiveMode,
      }
      setLastArv(arvForCore)
      const coreResult = await callFnFull('generate-core-analysis', { lead: leadWithArv })
      if (cancelledRef.current) return
      const coreNotes = coreResult.notes || ''
      if (!coreNotes) throw new Error('Core analysis failed')
      // Use server-computed ARV/MAO (reliable) — fall back to regex parsing only if missing
      const finalArv = coreResult.computed_arv ?? arvForCore
      const finalMao = coreResult.computed_mao ?? parseAiMao(coreNotes)
      if (finalArv) setAiCompsArv(finalArv)

      // Phase 2 — negotiation plan
      setPhase('negotiation')
      const aiSummary = coreNotes.slice(0, 3000)
      const planNotes = await callFn('generate-negotiation-plan', { lead: leadWithArv, ai_notes: aiSummary }).catch(() => null)
      if (cancelledRef.current) return

      const timestamp = `Generated: ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}\n\n`
      const fullNotes = timestamp + [coreNotes, compsNotes, planNotes].filter(Boolean).join('\n\n')

      const aiStartingOffer = coreResult.computed_starting_offer ?? parseAiStartingOffer(coreNotes)
      // Backfill Property Info fields the AI restated in DEAL SNAPSHOT — only where
      // the lead record doesn't already have a value, never overwrite existing data.
      const snapshot = parseSnapshotFields(coreNotes)
      const backfill = {
        ...(lead.bedrooms == null && snapshot.bedrooms != null ? { bedrooms: snapshot.bedrooms } : {}),
        ...(lead.bathrooms == null && snapshot.bathrooms != null ? { bathrooms: snapshot.bathrooms } : {}),
        ...(lead.sqft == null && snapshot.sqft != null ? { sqft: snapshot.sqft } : {}),
        ...(lead.zip_code == null && snapshot.zip_code != null ? { zip_code: snapshot.zip_code } : {}),
        ...(lead.property_type == null && snapshot.property_type != null ? { property_type: snapshot.property_type } : {}),
        ...(lead.days_on_market == null && snapshot.days_on_market != null ? { days_on_market: snapshot.days_on_market } : {}),
      }
      // Capability #16.1 real finding — this write previously used
      // `finalArv` (coreResult.computed_arv ?? arvForCore) unconditionally,
      // which could silently overwrite a manually-set lead.arv if the AI's
      // own returned computed_arv ever diverged from arvForCore (the value
      // that already correctly protects a manual entry, per this
      // function's own comment above: "ARV set in Financials is the single
      // source of truth"). reRunWithOverrides() already gets this right;
      // this path now matches it — never overwrite an ARV Kevin already
      // set, only ever fill it in when it was empty.
      const arvToWrite = lead.arv ? null : finalArv
      const dbUpdate = {
        ai_notes: fullNotes,
        ...(arvToWrite !== null && arvToWrite !== undefined ? { arv: arvToWrite } : {}),
        ...(finalMao !== null && finalMao !== undefined ? { mao: finalMao } : {}),
        ...backfill,
      }
      if (lead.id) {
        await supabase.from('leads').update(dbUpdate).eq('id', lead.id)
        // starting_offer saved separately so a missing column never blocks the main update
        if (aiStartingOffer !== null) {
          await supabase.from('leads').update({ starting_offer: aiStartingOffer }).eq('id', lead.id).then(({ error }) => {
            if (error) console.warn('starting_offer column not yet added — run migration:', error.message)
          })
        }
        // Capability #16.1 — this write bypasses useLeadUpdate.js (the hook
        // #15.5.1 wired for automatic V2 recalculation), so without this
        // call an improved ARV/MAO from AI+comps would sit in the DB
        // without decision_v2 ever reflecting it — exactly the gap this
        // capability closes. Deterministic only, reuses the existing
        // recalculation architecture; no new engine, no LLM call here.
        // Awaited (fast, deterministic) so dbUpdate.decision_v2 is fresh
        // before the onUpdated() call below merges it into UI state.
        const freshDecision = await recalculateDecisionV2(supabase, { ...lead, ...dbUpdate }, 'PROPERTY_DATA_UPDATE').catch(() => null)
        if (freshDecision) { dbUpdate.decision_v2 = freshDecision; dbUpdate.decision_v2_updated_at = freshDecision.calculated_at }
      }

      setLocalNotes(fullNotes)

      // Capability #4 — Opportunity Rediscovery Engine V1. This IS the
      // "existing lead updated" / "new AI analysis" re-encounter moment.
      // Reuses derivePriority (already parses score/verdict from this same
      // fullNotes for the Smart Lead Prioritization strip) — no new parsing,
      // no AI call. Fire-and-forget; never blocks the analysis flow.
      if (lead.workspace_id && lead.id) {
        const priorityNow = derivePriority(fullNotes)
        evaluateAndRecordRediscovery({
          workspaceId: lead.workspace_id,
          leadId: lead.id,
          snapshot: {
            askingPrice: lead.asking_price != null ? Number(lead.asking_price) : null,
            score: priorityNow?.confidence ?? null,
            verdict: priorityNow?.verdict ?? null,
            priority: priorityNow?.priority ?? null,
            mao: finalMao ?? (lead.mao != null ? Number(lead.mao) : null),
            profit: lead.deal_analysis?.profit ?? null,
          },
        }).then(r => { if (!cancelledRef.current) setRediscovery(r) })
      }

      // Patch deal_analysis.inputs so isStale stays false after AI analysis updates mao/arv
      const updatedDealAnalysis = lead.deal_analysis ? {
        ...lead.deal_analysis,
        inputs: {
          ...(lead.deal_analysis.inputs || {}),
          ...(finalArv !== null && finalArv !== undefined ? { arv: finalArv } : {}),
          ...(finalMao !== null && finalMao !== undefined ? { purchase_price: finalMao } : {}),
        }
      } : lead.deal_analysis
      onUpdated?.({ ...dbUpdate, deal_analysis: updatedDealAnalysis, ...(aiStartingOffer !== null ? { starting_offer: aiStartingOffer } : {}) })

      // Verdict/score/profit — same analyze-deal call FinancialSection.runAnalyze used to make
      const activeStrategy = strategyOverride ?? strategy
      const effectiveReno = renoOverrideVal ?? lead.renovation_cost ?? 0
      const freshMao = finalArv
        ? Math.round(Number(finalArv) * 0.75 - Number(effectiveReno) - 2450)
        : finalMao
      const verdictRes = await fetch('/.netlify/functions/analyze-deal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_id: lead.id,
          address: [lead.address, lead.city, lead.state].filter(Boolean).join(', '),
          purchase_price: freshMao ?? lead.mao ?? lead.asking_price,
          arv: finalArv ?? lead.arv,
          renovation_cost: effectiveReno || null,
          monthly_rent: activeStrategy === 'brrrr' ? (lead.rent_estimate || null) : null,
          strategy: activeStrategy,
          reno_was_estimated: false,
          hold_months: lead.hold_months || 6,
        }),
      })
      const verdictData = await verdictRes.json()
      if (verdictRes.ok && verdictData.ok) {
        await logDealAnalysis(lead.id, userId, verdictData.analysis)
        onUpdated?.({ ...dbUpdate, deal_analysis: verdictData.analysis, ai_notes: fullNotes })
      } else {
        setGenError(verdictData.error || 'Verdict/score generation failed — comps and negotiation plan were saved, but no deal score is available. Try re-running.')
      }

      // Auto-generate scripts in background — no await, runs independently
      generateScripts(fullNotes)
    } catch (err) {
      if (!cancelledRef.current) {
        setGenError(
          err.message === 'NO_ASKING_PRICE'
            ? "Please fill in the Seller's Asking Price before generating AI analysis."
            : err.message || 'Something went wrong.'
        )
      }
    } finally {
      if (!cancelledRef.current) {
        setGenerating(false)
        setPhase(null)
      }
    }
  }

  // Re-run only core analysis with ARV and/or reno overrides — skips comps (fast ~8s)
  const reRunWithOverrides = async () => {
    // ARV/Reno have no override input UI here (edited only in FinancialSection) — the
    // Financials value is always the source of truth; the AI comps ARV only fills in
    // when Financials has no ARV set yet, never overrides one that's already there.
    // DOM/Rent are read straight from `lead` (edited in Property Info / Financials).
    const arv  = (lead.arv ? Number(lead.arv) : null) ?? aiCompsArv
    const reno = null
    const priceDrop = priceDropOverride ? parseFloat(priceDropOverride.replace(/[^0-9.]/g, '')) || null : null
    const sellerNotes = sellerNotesOverride.trim() || null
    if (!arv && !reno && priceDrop == null && !sellerNotes) return
    setGenerating(true)
    setGenError(null)
    setPhase('analysis')
    cancelledRef.current = false
    try {
      const teamComments = await fetchLeadContext(lead)
      const overrideLead = {
        ...lead,
        ...(arv  != null ? { arv }                    : {}),
        ...(reno != null ? { renovation_cost: reno }   : {}),
        ...(priceDrop != null ? { price_drop_pct: priceDrop }  : {}),
        ...(sellerNotes       ? { notes: sellerNotes }          : {}),
        ...(teamComments      ? { team_comments: teamComments } : {}),
        competitive_mode: competitiveMode,
      }
      const coreResult = await callFnFull('generate-core-analysis', { lead: overrideLead })
      if (cancelledRef.current) return
      const coreNotes = coreResult.notes || ''
      // Use server-computed MAO (reliable) — fall back to regex only if missing
      const reRunAiMao = coreResult.computed_mao ?? parseAiMao(coreNotes)
      if (arv)         setLastArv(arv)
      if (reno)        setLastReno(reno)
      // Replace just the core portion — preserve comps/plan/comms
      const existingParts = localNotes.split(/(?=={5,}\s*\n(?:MARKET COMPS|RENTAL COMPS|NEGOTIATION PLAN|COMMUNICATIONS))/i)
      const nonCoreParts  = existingParts.slice(1).join('')
      const timestamp     = `Generated: ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}\n\n`
      const fullNotes     = timestamp + coreNotes + (nonCoreParts ? '\n\n' + nonCoreParts.trim() : '')
      const hasNego             = /NEGOTIATION PLAN/i.test(localNotes)
      const reRunStartingOffer  = coreResult.computed_starting_offer ?? parseAiStartingOffer(coreNotes)
      const snapshot = parseSnapshotFields(coreNotes)
      const backfill = {
        ...(lead.bedrooms == null && snapshot.bedrooms != null ? { bedrooms: snapshot.bedrooms } : {}),
        ...(lead.bathrooms == null && snapshot.bathrooms != null ? { bathrooms: snapshot.bathrooms } : {}),
        ...(lead.sqft == null && snapshot.sqft != null ? { sqft: snapshot.sqft } : {}),
        ...(lead.zip_code == null && snapshot.zip_code != null ? { zip_code: snapshot.zip_code } : {}),
        ...(lead.property_type == null && snapshot.property_type != null ? { property_type: snapshot.property_type } : {}),
        ...(lead.days_on_market == null && snapshot.days_on_market != null ? { days_on_market: snapshot.days_on_market } : {}),
      }
      const supabaseUpdate = {
        ai_notes: fullNotes,
        ...(arv  != null        ? { arv }                  : {}),
        ...(reno != null        ? { renovation_cost: reno } : {}),
        ...(reRunAiMao !== null ? { mao: reRunAiMao }       : {}),
        ...backfill,
      }
      if (lead.id) {
        await supabase.from('leads').update(supabaseUpdate).eq('id', lead.id)
        if (reRunStartingOffer !== null) {
          await supabase.from('leads').update({ starting_offer: reRunStartingOffer }).eq('id', lead.id).then(({ error }) => {
            if (error) console.warn('starting_offer column not yet added — run migration:', error.message)
          })
        }
        // Capability #16.1 — same automatic-recalculation gap fix as runGenerate() above.
        const freshDecision = await recalculateDecisionV2(supabase, { ...lead, ...supabaseUpdate }, 'PROPERTY_DATA_UPDATE').catch(() => null)
        if (freshDecision) { supabaseUpdate.decision_v2 = freshDecision; supabaseUpdate.decision_v2_updated_at = freshDecision.calculated_at }
      }
      setLocalNotes(fullNotes)
      const reRunDealAnalysis = lead.deal_analysis ? {
        ...lead.deal_analysis,
        inputs: {
          ...(lead.deal_analysis.inputs || {}),
          ...(arv         != null ? { arv }                    : {}),
          ...(reRunAiMao  !== null ? { purchase_price: reRunAiMao } : {}),
          ...(reno        != null ? { renovation_cost: reno }  : {}),
        }
      } : lead.deal_analysis
      onUpdated?.({ ai_notes: fullNotes, ...supabaseUpdate, deal_analysis: reRunDealAnalysis, ...(reRunStartingOffer !== null ? { starting_offer: reRunStartingOffer } : {}) })
      // Auto-update nego plan in background if one already exists
      if (hasNego) updateNegoPlan(fullNotes)
    } catch (err) {
      if (!cancelledRef.current) setGenError(err.message || 'Re-run failed.')
    } finally {
      if (!cancelledRef.current) { setGenerating(false); setPhase(null) }
    }
  }

  // Re-run negotiation plan + communications with the updated core analysis numbers
  const updateNegoPlan = async (notesOverride = null) => {
    setUpdatingNego(true)
    setGenError(null)
    try {
      const baseNotes  = notesOverride || localNotes
      // Pull the current core notes (first section before MARKET COMPS / NEGOTIATION PLAN)
      const corePart   = baseNotes.split(/(?=={5,}\s*\n(?:MARKET COMPS|NEGOTIATION PLAN|COMMUNICATIONS))/i)[0]
      const compsPart  = baseNotes.match(/(={5,}\s*\nMARKET COMPS[\s\S]*?)(?=={5,}\s*\n(?:NEGOTIATION PLAN|COMMUNICATIONS)|$)/i)?.[1] || ''
      const aiSummary  = corePart.slice(0, 3000)
      const teamComments = await fetchLeadContext(lead)
      const overrideLead = {
        ...lead,
        ...(lastArv  ? { arv: lastArv }                    : {}),
        ...(lastReno ? { renovation_cost: lastReno }        : {}),
        ...(priceDropOverride ? { price_drop_pct: parseFloat(priceDropOverride) || null } : {}),
        ...(sellerNotesOverride.trim() ? { notes: sellerNotesOverride.trim() } : {}),
        ...(teamComments      ? { team_comments: teamComments } : {}),
      }
      const planNotes = await callFn('generate-negotiation-plan', { lead: overrideLead, ai_notes: aiSummary }).catch(() => null)
      // Preserve existing COMMUNICATIONS section if present
      const commsMatch = baseNotes.match(/(={5,}\s*\nCOMMUNICATIONS[\s\S]*?)$/i)
      const commsPart  = commsMatch?.[1]?.trim() || ''
      const fullNotes  = [corePart.trim(), compsPart.trim(), planNotes, commsPart].filter(Boolean).join('\n\n')
      if (lead.id) await supabase.from('leads').update({ ai_notes: fullNotes }).eq('id', lead.id)
      setLocalNotes(fullNotes)
      onUpdated?.({ ai_notes: fullNotes })
    } catch (err) {
      setGenError(err.message || 'Failed to update negotiation plan.')
    } finally {
      setUpdatingNego(false)
    }
  }

  const generateScripts = async (notesOverride = null) => {
    const baseNotes = notesOverride || localNotes
    if (generatingScripts || !baseNotes) return
    setGeneratingScripts(true)
    setGenError(null)
    try {
      const corePart  = baseNotes.split(/(?=={5,}\s*\n(?:MARKET COMPS|NEGOTIATION PLAN|COMMUNICATIONS))/i)[0]
      const aiSummary = corePart.slice(0, 3000)
      const teamComments = await fetchLeadContext(lead)
      const overrideLead = {
        ...lead,
        ...(lastArv  ? { arv: lastArv }               : {}),
        ...(lastReno ? { renovation_cost: lastReno }   : {}),
        ...(teamComments ? { team_comments: teamComments } : {}),
      }
      const commsNotes = await callFn('generate-communications', { lead: overrideLead, ai_notes: aiSummary })
      // Append to existing notes (replace old COMMUNICATIONS if present)
      const withoutOldComms = baseNotes.replace(/(={5,}\s*\nCOMMUNICATIONS[\s\S]*)$/i, '').trim()
      const fullNotes = withoutOldComms + '\n\n' + commsNotes
      if (lead.id) await supabase.from('leads').update({ ai_notes: fullNotes }).eq('id', lead.id)
      setLocalNotes(fullNotes)
      onUpdated?.({ ai_notes: fullNotes })
    } catch (err) {
      setGenError('Scripts generation failed: ' + (err.message || 'Unknown error'))
    } finally {
      setGeneratingScripts(false)
    }
  }

  // Refresh only the comps section — replaces MARKET COMPS block, keeps everything else
  const refreshCompsOnly = async () => {
    setRefreshingComps(true)
    setGenError(null)
    try {
      const teamComments = await fetchLeadContext(lead)
      const leadWithContext = teamComments ? { ...lead, team_comments: teamComments } : lead
      const freshComps = await callFn('generate-comps', { lead: leadWithContext })
      if (!freshComps) return
      // Replace MARKET COMPS block in existing notes, preserve everything else
      const base = localNotes || ''
      const before = base.split(/(?=={5,}\s*\nMARKET COMPS)/i)[0]
      const afterMatch = base.match(/(?:={5,}\s*\nMARKET COMPS[\s\S]*?)((?=\n={5,}\s*\n(?:NEGOTIATION PLAN|COMMUNICATIONS))|$)/i)
      const after = afterMatch ? base.slice(base.indexOf(afterMatch[0]) + afterMatch[0].length) : ''
      const fullNotes = [before.trim(), freshComps.trim(), after.trim()].filter(Boolean).join('\n\n')
      if (lead.id) await supabase.from('leads').update({ ai_notes: fullNotes }).eq('id', lead.id)
      setLocalNotes(fullNotes)
      onUpdated?.({ ai_notes: fullNotes })
    } catch (err) {
      setGenError(err.message || 'Failed to refresh comps.')
    } finally {
      setRefreshingComps(false)
    }
  }

  const priorityInfo = derivePriority(localNotes)

  return (
    <Card title="Deal Analysis" subtitle="Comps, negotiation plan, verdict, and scripts — all from one run">
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-[color:var(--color-line)] mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg border border-[color:var(--color-line)] overflow-hidden text-[11px] font-bold">
            {['flip', 'brrrr'].map(s => (
              <button
                key={s}
                onClick={() => {
                  if (s === strategy) return
                  setStrategy(s)
                  if (hasAnalysis) {
                    if (renoMissing) { setShowRenoPicker(true); return }
                    runGenerate(false, s)
                  }
                }}
                disabled={generating}
                className={`px-3 py-1.5 transition-colors uppercase tracking-wide ${
                  strategy === s
                    ? 'bg-[color:var(--color-accent)] text-white'
                    : 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          {strategy === 'brrrr' && (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-[color:var(--color-text-dim)]">Rent</span>
              <span className="text-[12px] font-semibold text-[color:var(--color-text)]">
                {lead.rent_estimate ? fc(lead.rent_estimate) : '—'}
              </span>
              <span className="text-[11px] text-[color:var(--color-text-dim)]">/mo · edit in Financials</span>
            </div>
          )}
        </div>

        {canEdit && (
          generating ? (
            <span className="flex items-center gap-1 text-[12px] text-[color:var(--color-accent-text)]">
              <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
              </svg>
              {phase === 'analysis' ? 'Analyzing…' : phase === 'negotiation' ? 'Building negotiation plan…' : 'Working…'}
              <button onClick={cancelGenerate} className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-dim)] hover:text-[color:var(--color-text)] transition-colors">Cancel</button>
            </span>
          ) : (!hasAnalysis && isDistressedLead(lead) && !lead.asking_price && !lead.arv) ? (
            // Capability #10.1 — an off-market lead with no ARV/asking
            // price yet has nothing meaningful to underwrite. Don't
            // invite a click that would run on empty inputs; explain
            // instead. Reappears as a normal button the moment ARV or
            // asking price is filled in — no change to handleRun itself.
            <span className="text-[11.5px] text-[color:var(--color-text-dim)] italic">
              More property/financial information is needed before underwriting.
            </span>
          ) : (!hasAnalysis || staleness.stale) ? (
            <button
              onClick={() => handleRun(false)}
              className={`text-[12px] font-semibold px-3 py-1.5 rounded-lg text-white hover:opacity-90 transition-opacity ${
                staleness.stale && hasAnalysis ? 'bg-[color:var(--color-warn)]' : 'bg-[color:var(--color-accent)]'
              }`}
            >
              {/* Capability #16.1, Section 8 — a preliminary V2 decision
                  already exists for this lead before this button is ever
                  pressed (computed at ingestion/backfill), so "Run
                  Analysis" implying a first-time analysis would be
                  misleading. Only reframed when that's actually true. */}
              {!hasAnalysis ? (lead.decision_v2 ? '✦ Get Comps & Detailed AI' : '✦ Run Analysis') : '⚠ Refresh Detailed Analysis'}
            </button>
          ) : (
            <span className="flex items-center gap-2 text-[12px]">
              <span className="text-[color:var(--color-success-text)] font-medium">✓ Up to date</span>
              <button
                onClick={() => handleRun(false)}
                className="text-[11px] text-[color:var(--color-text-dim)] hover:text-[color:var(--color-text)] underline underline-offset-2 transition-colors"
              >
                Refresh anyway
              </button>
            </span>
          )
        )}
      </div>

      {renoMissing && showRenoPicker && (
        <RenoTierPicker
          lead={lead}
          open={showRenoPicker}
          onClose={() => setShowRenoPicker(false)}
          onApply={(reno) => {
            setShowRenoPicker(false)
            onUpdated?.({ renovation_cost: reno })
            supabase.from('leads').update({ renovation_cost: reno }).eq('id', lead.id).then(() => runGenerate(false, strategy, reno))
          }}
        />
      )}

      {staleness.stale && hasAnalysis && !generating && (
        <div className="mb-3 flex items-center gap-2 px-3 py-2.5 rounded-lg border border-[color:var(--color-warn)] bg-[color:var(--color-warn-soft)]">
          <span className="text-[11.5px] font-semibold text-[color:var(--color-warn-text)]">⚠ {staleness.reasons.join(', ')} — results may be outdated. Use "Re-run Analysis" above.</span>
        </div>
      )}

      {genError && <p className="mb-3 text-[11.5px] text-[color:var(--color-danger-text)]">⚠ {genError}</p>}

      {/* Capability #4 — Opportunity Rediscovery Engine V1. Minimal banner
          only — no timeline, no history page. Reads a status persisted by
          evaluateAndRecordRediscovery() (see propertyIntelligence.js);
          renders only for IMPROVED / REVIEW AGAIN, never for
          UNCHANGED/DECLINED so it never nags on an ordinary lead. */}
      {(rediscovery?.status === 'IMPROVED' || rediscovery?.status === 'REVIEW AGAIN') && (
        <div className="mb-3 rounded-lg border-2 px-3 py-2.5 flex items-start gap-2" style={{ borderColor: 'var(--color-accent)', background: 'var(--color-accent-soft)' }}>
          <span className="text-[16px] leading-none">🔥</span>
          <div>
            <div className="text-[13px] font-extrabold text-[color:var(--color-accent-text)]">
              {rediscovery.status === 'REVIEW AGAIN' ? 'Opportunity Rediscovered' : 'Opportunity Improved'}
            </div>
            <div className="text-[11.5px] text-[color:var(--color-accent-text)] opacity-90">This property deserves another review.</div>
            {rediscovery.reason && (
              <div className="text-[11.5px] text-[color:var(--color-accent-text)] mt-0.5"><span className="font-semibold">Reason:</span> {rediscovery.reason}</div>
            )}
          </div>
        </div>
      )}

      {/* Capability #15.1 — Phase 1 fix, copy corrected in #15.3. Audit #15
          found real leads scoring 89/100 "MAKE OFFER" while lead.status
          already said 'not_in_buy_box' — Deal Score never consults that
          status, so the contradiction was invisible to Kevin. #15.3 traced
          the actual hat-ai-agents source and found `not_in_buy_box` is a
          MANUAL reviewer judgment applied in Inbox (crm-agent.md: "do not
          auto-set this on import") — not an automated geography/type rule
          the way the original #15.1 copy implied. Wording updated to match
          that reality. Still doesn't touch the V1 score/verdict below. */}
      {lead.status === 'not_in_buy_box' && (
        <div className="mb-3 flex items-center gap-2 px-3 py-2.5 rounded-lg border-2" style={{ borderColor: 'var(--color-danger)', background: 'var(--color-danger-soft)' }}>
          <span className="text-[16px] leading-none">🚫</span>
          <div>
            <div className="text-[13px] font-extrabold text-[color:var(--color-danger-text)]">MARKED NOT IN BUY BOX</div>
            <div className="text-[11.5px] text-[color:var(--color-danger-text)] opacity-90">
              A reviewer previously marked this property as not fitting HAT's criteria. Any verdict or score below reflects deal economics only and does not know about this decision — check the original reasoning before acting on a high score.
            </div>
          </div>
        </div>
      )}

      {/* Capability #19 — CONSOLIDATION. Before this change, this card
          stacked THREE separate decision-shaped panels here (Executive
          Decision / priorityInfo, Verdict-Score-MAO / deal_analysis,
          Priority-Analysis Score / priorityInfo again) — all derived from
          the older V1/deal_analysis pipeline, all visually competing with
          the ONE authoritative decision (decision_v2) that now renders
          above, in AcquisitionCopilot, before Kevin ever scrolls this far.
          Merged into ONE compact "Detailed AI Analysis" summary, clearly
          labeled as supporting intelligence — nothing computed here
          changed, only how many times it's shown and how prominently.
          Profit labels now name their scenario explicitly (Section 6):
          a bare "Profit" next to a "Flip profit ... at MAO" bullet lower
          on the page read as two different numbers even when they agree. */}
      {(priorityInfo || hasAnalysis) && (() => {
        const theme = priorityInfo ? (PRIORITY_THEME[priorityInfo.priority] || PRIORITY_THEME.WATCH) : PRIORITY_THEME.WATCH
        const displayLabel = priorityInfo ? (PRIORITY_DISPLAY[priorityInfo.priority] || priorityInfo.priority) : null
        const a = lead.deal_analysis
        // "Profit at MAO" — analyze-deal.mjs computes deal_analysis.profit
        // using lead.mao as the purchase price (same convention as
        // FlipRealityCheck/BrrrrRealityCheck below), so the scenario is
        // named consistently everywhere it appears on this page.
        const profitAtMao = a?.profit ?? null
        return (
          <div className="mb-3 rounded-lg border overflow-hidden" style={{ borderColor: theme.border, background: theme.bg }}>
            <div className="px-3 pt-2 flex items-center justify-between">
              <span className="text-[9px] uppercase tracking-widest font-bold opacity-70" style={{ color: theme.text }}>
                Detailed AI Analysis <span className="font-normal opacity-80">(supporting — see decision above)</span>
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 divide-x" style={{ borderColor: theme.border }}>
              {displayLabel && (
                <div className="px-3 py-2">
                  <div className="text-[9px] uppercase tracking-widest opacity-70" style={{ color: theme.text }}>AI Read</div>
                  <div className="text-[14px] font-bold leading-tight" style={{ color: theme.text }}>{displayLabel}</div>
                </div>
              )}
              <div className="px-3 py-2">
                <div className="text-[9px] uppercase tracking-widest opacity-70" style={{ color: theme.text }}>Profit at MAO</div>
                <div className="text-[14px] font-bold" style={{ color: theme.text }}>{profitAtMao != null ? fc(profitAtMao) : '—'}</div>
              </div>
              <div className="px-3 py-2">
                <div className="text-[9px] uppercase tracking-widest opacity-70" style={{ color: theme.text }}>Starting Offer</div>
                <div className="text-[14px] font-bold" style={{ color: theme.text }}>{lead.starting_offer ? fc(lead.starting_offer) : '—'}</div>
              </div>
              <div className="px-3 py-2">
                <div className="text-[9px] uppercase tracking-widest opacity-70" style={{ color: theme.text }}>Max Offer (MAO)</div>
                <div className="text-[14px] font-bold" style={{ color: theme.text }}>{lead.mao ? fc(lead.mao) : '—'}</div>
              </div>
            </div>
            {priorityInfo && (
              <div className="grid grid-cols-1 sm:grid-cols-2 divide-x border-t" style={{ borderColor: theme.border }}>
                <div className="px-3 py-2">
                  <div className="text-[9px] uppercase tracking-widest opacity-70 mb-0.5" style={{ color: theme.text }}>Why</div>
                  {priorityInfo.reasons.length > 0 ? (
                    <>
                      <ul className="text-[11.5px] font-medium leading-tight space-y-0.5" style={{ color: theme.text }}>
                        {(showReasonDetail ? priorityInfo.rawReasons : priorityInfo.reasons).map((r, i) => <li key={i}>✓ {r}</li>)}
                      </ul>
                      <button
                        type="button"
                        onClick={() => setShowReasonDetail(v => !v)}
                        className="text-[10px] underline underline-offset-2 mt-1 opacity-70 hover:opacity-100 transition-opacity"
                        style={{ color: theme.text }}
                      >
                        {showReasonDetail ? 'Show summary' : 'View details'}
                      </button>
                    </>
                  ) : (
                    <div className="text-[12px] font-medium opacity-70" style={{ color: theme.text }}>—</div>
                  )}
                </div>
                <div className="px-3 py-2">
                  <div className="text-[9px] uppercase tracking-widest opacity-70 mb-0.5" style={{ color: theme.text }}>Biggest Risk</div>
                  <div className="text-[11.5px] font-medium leading-tight" style={{ color: theme.text }}>
                    {priorityInfo.biggestRisk ? `⚠ ${priorityInfo.biggestRisk}` : '—'}
                  </div>
                  {priorityInfo.dataQuality != null && (
                    <div className="text-[10px] font-medium opacity-70 mt-1" style={{ color: theme.text }}>Data Quality: {priorityInfo.dataQuality}/10</div>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {hasAnalysis && strategy === 'brrrr' && (
        <BrrrrRealityCheck lead={lead} verdict={lead.deal_analysis?.verdict} score={lead.deal_analysis?.score} />
      )}
      {hasAnalysis && strategy !== 'brrrr' && (
        <FlipRealityCheck lead={lead} verdict={lead.deal_analysis?.verdict} score={lead.deal_analysis?.score} />
      )}

      {/* Override inputs — shown after analysis is available */}
      {localNotes && !generating && (
        <div className="mb-3 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] px-3 py-2.5">
          <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] font-semibold mb-2">
            Override Inputs → Re-run Analysis
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex flex-col gap-0.5">
              <label className="text-[9.5px] text-[color:var(--color-text-dim)] uppercase tracking-wider">Price Drop %</label>
              <input
                value={priceDropOverride}
                onChange={e => setPriceDropOverride(e.target.value)}
                placeholder="e.g. 18"
                className="w-20 h-7 px-2 rounded border border-[color:var(--color-line)] bg-[color:var(--color-bg)] text-[11.5px] text-[color:var(--color-text)] outline-none focus:border-[color:var(--color-accent)]"
              />
            </div>
            <div className="flex flex-col gap-0.5 flex-1 min-w-[180px]">
              <label className="text-[9.5px] text-[color:var(--color-text-dim)] uppercase tracking-wider">Seller Notes</label>
              <input
                value={sellerNotesOverride}
                onChange={e => setSellerNotesOverride(e.target.value)}
                placeholder="Estate sale, as-is, motivated, quick close…"
                className="w-full h-7 px-2 rounded border border-[color:var(--color-line)] bg-[color:var(--color-bg)] text-[11.5px] text-[color:var(--color-text)] outline-none focus:border-[color:var(--color-accent)]"
              />
            </div>
            {/* Competitive Mode toggle */}
            <div className="flex flex-col gap-0.5 mt-3.5 min-w-[160px]">
              <label className="text-[9.5px] text-[color:var(--color-text-dim)] uppercase tracking-wider">Mode</label>
              <button
                onClick={() => setCompetitiveMode(m => !m)}
                className="h-7 px-2.5 rounded border text-[11px] font-semibold transition-all flex items-center gap-1.5"
                style={competitiveMode
                  ? { background: 'var(--color-warn-soft)', borderColor: 'var(--color-warn)', color: 'var(--color-warn-text)' }
                  : { background: 'var(--color-bg)', borderColor: 'var(--color-line)', color: 'var(--color-text-muted)' }
                }
                title="Competitive Mode: anchor closer to asking price to win the contract. Negotiate further during inspection."
              >
                <span>{competitiveMode ? '🔥' : '⚡'}</span>
                {competitiveMode ? 'Competitive ON' : 'Competitive OFF'}
              </button>
            </div>
            {(overrideChanged || competitiveMode) && (
              <div className="flex flex-col gap-0.5 mt-3.5">
                <button
                  onClick={reRunWithOverrides}
                  className="h-7 px-3 rounded text-[11.5px] font-semibold bg-[color:var(--color-accent)] text-white hover:opacity-90 transition-opacity"
                >
                  ↻ Re-run Analysis
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {updatingNego && (
        <div className="mb-3 flex items-center gap-2 px-3 py-2 rounded-lg border border-[color:var(--color-warn)] bg-[color:var(--color-warn-soft)] text-[11.5px] text-[color:var(--color-warn-text)]">
          <svg className="animate-spin w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
          </svg>
          Updating negotiation plan with new numbers…
        </div>
      )}

      {localNotes ? (
        <NotesRenderer
          notes={localNotes}
          lead={lead}
          onGenerateScripts={generateScripts}
          generatingScripts={generatingScripts}
          onRefreshComps={canEdit ? refreshCompsOnly : null}
          refreshingComps={refreshingComps}
          missingFields={[
            !lead.arv             && 'ARV',
            !lead.renovation_cost && 'Reno Cost',
            !lead.rent_estimate   && 'Rent Estimate',
          ].filter(Boolean)}
          extraTabs={[
            {
              id: 'breakdown',
              label: 'Full Breakdown',
              icon: '🧮',
              content: <FullBreakdownTab lead={lead} strategy={strategy} />,
            },
            {
              id: 'askai',
              label: 'Ask AI',
              icon: '💬',
              content: <DealQA lead={lead} aiNotes={localNotes} />,
            },
          ]}
        />
      ) : generating ? (
        <p className="text-[12.5px] text-[color:var(--color-text-dim)] italic">Running analysis — this takes 30–50 seconds.</p>
      ) : (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <p className="text-[13px] text-[color:var(--color-text-dim)]">No AI analysis yet.</p>
          {canEdit && <p className="text-[12px] text-[color:var(--color-text-faint)]">Click <strong>✦ Run Analysis</strong> above.</p>}
        </div>
      )}
    </Card>
  )
}
