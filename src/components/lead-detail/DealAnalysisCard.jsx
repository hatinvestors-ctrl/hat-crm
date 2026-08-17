// src/components/lead-detail/DealAnalysisCard.jsx
import { useState, useEffect, useRef } from 'react'
import Card from '../ui/Card'
import NotesRenderer from './NotesRenderer'
import DealQA from './DealQA'
import RenoTierPicker from './RenoTierPicker'
import { supabase } from '../../lib/supabase'
import {
  formatCurrency, computeFlipBreakdown, computeBrrrrBreakdown, bisectThreshold,
  calculateFlipMAO, calculateBrrrrMAO, FLIP_MIN_PROFIT_TARGET, BRRRR_MAX_CASH_LEFT_IN, FLIP_STRONG_PROFIT, getEffectiveOffer,
} from '../../lib/calculations'
import { logDealAnalysis } from '../../lib/activityLogger'
import { computeFlipResult, computeBrrrrResult, computeStrategyRecommendation, computeFlipDownsideSensitivity } from '../../lib/dealExplanation'
import { getDecisionMaturity } from '../../lib/arvProvenance'
import { useDealStaleness } from '../../hooks/useDealStaleness'
import { evaluateAndRecordRediscovery, fetchRediscoveryStatus } from '../../lib/propertyIntelligence'
import { isDistressedLead } from '../../lib/distressInfo'
import { derivePriority } from '../../lib/leadPriority'
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

// Capability #19.1 — computeFlipBreakdown/computeBrrrrBreakdown/
// bisectThreshold/maxOfferForProfit moved to src/lib/calculations.js
// (calculateFlipMAO/calculateBrrrrMAO) so there is exactly ONE
// implementation of the canonical Flip/BRRRR cost model, not one per
// component. Imported above.
const fc = formatCurrency

// Deal Analysis Clarity capability, Section 11 — deterministic verdict
// colors, same 4-state vocabulary (STRONG/PASS/WATCH/NO DEAL) for both
// Flip and BRRRR, never LLM-chosen.
const VERDICT_THEME = {
  STRONG:    { bg: 'var(--color-success-soft)', border: 'var(--color-success)', text: 'var(--color-success-text)' },
  PASS:      { bg: 'var(--color-success-soft)', border: 'var(--color-success)', text: 'var(--color-success-text)' },
  WATCH:     { bg: 'var(--color-warn-soft)',    border: 'var(--color-warn)',    text: 'var(--color-warn-text)' },
  'NO DEAL': { bg: 'var(--color-danger-soft)',  border: 'var(--color-danger)',  text: 'var(--color-danger-text)' },
}
// Capability — Flip Margin of Safety Explainability, Section 11. Display
// text ONLY — the underlying enum value ('PASS', used by VERDICT_RANK,
// VERDICT_THEME, and every `.verdict === 'PASS'` comparison in
// dealExplanation.js) is completely unchanged, so nothing that reads the
// raw verdict breaks. Audited "PASS" is genuinely ambiguous in acquisition
// language — it can read as "pass on this deal / walk away", the opposite
// of what it means here ("this deal passes/clears the bar"). This tier is
// computed live on every render and never written to the database (see
// computeFlipResult/computeBrrrrResult in dealExplanation.js), so renaming
// only what's shown carries zero data-migration risk. Deliberately scoped
// to ONLY this Flip/BRRRR tier — the unrelated `lead.deal_analysis.verdict`
// (AI-generated, different vocabulary, used by ActionZone.jsx/
// NotesRenderer.jsx/QuickAnalysisModal.jsx) is a different field and is not
// touched.
export const VERDICT_DISPLAY_LABEL = { STRONG: 'STRONG', PASS: 'SOLID', WATCH: 'WATCH', 'NO DEAL': 'NO DEAL' }
const pct = n => n != null ? `${n.toFixed(1)}%` : '—'

// Explains a BRRRR verdict in plain terms and shows exactly what would need to
// change to cross into BUY — checked one lever at a time (rent, renovation cost,
// ARV), holding the other two at their current values.
// Capability #19.1, Section 13 — "Path to a BRRRR Deal", rebuilt around the
// new calculateBrrrrMAO() solver (src/lib/calculations.js). Shows the
// BRRRR MAO, WHICH of HAT's two requirements is limiting it (Section 10),
// and plain-language guidance — no "pick one lever" phrasing (Section 12),
// no lever shown unless the solver actually produced a number for it
// (Section 14 — never fake precision).
export function BrrrrRealityCheck({ lead }) {
  const arv  = lead.arv != null ? Number(lead.arv) : null
  const reno = lead.renovation_cost != null ? Number(lead.renovation_cost) : null
  const rent = lead.rent_estimate != null ? Number(lead.rent_estimate) : (lead.monthly_rent != null ? Number(lead.monthly_rent) : null)
  const holdMonths = lead.hold_months || 6

  const result = calculateBrrrrMAO(arv, reno, rent, holdMonths)

  // Current-scenario purchase price — the SAME effective-offer function
  // Financials/Detailed Analysis use (calculations.js), not a separately-
  // derived lead.mao/asking_price guess. Without this, changing rehab
  // could move Financials' "We Offer" and Detailed Analysis' numbers
  // while Path to a Deal kept showing the old price.
  const currentPP = getEffectiveOffer(lead, result.mao)
  const current = (arv && reno != null && rent && currentPP) ? computeBrrrrBreakdown(currentPP, arv, reno, rent, holdMonths) : null

  return (
    <div className="mb-3 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] p-3 space-y-2.5">
      <div className="text-[9.5px] uppercase tracking-widest text-[color:var(--color-text-dim)] font-bold">🎯 Path to a BRRRR Deal</div>

      <div className="text-[11px] text-[color:var(--color-text-muted)]">
        HAT requirements: <strong className="text-[color:var(--color-text)]">positive monthly cash flow</strong> and
        <strong className="text-[color:var(--color-text)]"> less than {fc(BRRRR_MAX_CASH_LEFT_IN)} cash left in after refinance</strong>.
      </div>

      {result.mao == null ? (
        <p className="text-[11.5px] text-[color:var(--color-warn-text)] border-t border-[color:var(--color-line)] pt-2">
          Max Buy (BRRRR): <strong>NOT READY</strong> — {result.reason}. {rent == null ? 'Add a Rent Estimate in Financials.' : arv == null ? 'Add an ARV in Financials.' : 'Add a renovation cost in Financials.'}
        </p>
      ) : (
        <>
          {current && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Cash Left In (current)</div>
                <div className={`text-[14px] font-bold ${current.totalCashInvested < BRRRR_MAX_CASH_LEFT_IN ? 'text-[color:var(--color-success-text)]' : 'text-[color:var(--color-danger-text)]'}`}>
                  {fc(current.totalCashInvested)} {current.totalCashInvested < BRRRR_MAX_CASH_LEFT_IN ? '✓' : '✗'}
                </div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Monthly Cash Flow (current)</div>
                <div className={`text-[14px] font-bold ${current.monthlyCF > 0 ? 'text-[color:var(--color-success-text)]' : 'text-[color:var(--color-danger-text)]'}`}>
                  {current.monthlyCF != null ? `${fc(current.monthlyCF)}/mo ${current.monthlyCF > 0 ? '✓' : '✗'}` : '—'}
                </div>
              </div>
            </div>
          )}

          <div className="border-t border-[color:var(--color-line)] pt-2 grid grid-cols-2 gap-3">
            <div>
              <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Max Buy (BRRRR)</div>
              <div className="text-[16px] font-bold text-[color:var(--color-text)]">{fc(Math.round(result.mao / 100) * 100)}</div>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Limiting Factor</div>
              <div className="text-[13px] font-bold text-[color:var(--color-accent-text)]">
                {result.limitingFactor === 'CASH_LEFT_IN' ? 'Cash Left In' : 'Cash Flow'}
              </div>
            </div>
          </div>
          <div className="text-[10.5px] text-[color:var(--color-text-dim)]">
            At {fc(Math.round(result.mao / 100) * 100)}: cash left in {fc(result.cashLeftInAtMao)}, cash flow {result.cashFlowAtMao != null ? `${fc(result.cashFlowAtMao)}/mo` : '—'}.
          </div>

          {currentPP != null && currentPP > result.mao && (
            <p className="text-[11px] text-[color:var(--color-text-muted)]">
              To make this work: purchase price needs to be ≤ {fc(Math.round(result.mao / 100) * 100)} (currently {fc(currentPP)}), assuming ARV/reno/rent stay the same.
            </p>
          )}
        </>
      )}
    </div>
  )
}

// Capability — Flip Margin of Safety Explainability. Answers "WHY is this
// deal STRONG/thin/not working RIGHT NOW", as distinct from FlipRealityCheck
// below ("Path to a Flip Deal"), which answers "WHAT WOULD NEED TO CHANGE"
// — deliberately different questions, not duplicated (Section 8). Every
// number here comes straight from flipResult (computeFlipResult in
// dealExplanation.js) — no second calculation, no LLM.
export function FlipMarginOfSafety({ lead, flipResult }) {
  const [whyOpen, setWhyOpen] = useState(false)
  const [testDownside, setTestDownside] = useState(false)
  const { verdict, currentOffer, mao, projectedProfit, targetProfit, marginOfSafety } = flipResult
  if (!marginOfSafety) return null
  const theme = VERDICT_THEME[verdict] || VERDICT_THEME.WATCH
  const maturity = getDecisionMaturity(lead)
  const sensitivity = testDownside ? computeFlipDownsideSensitivity(lead, flipResult) : null

  // Last-Mile UX, Section 6 — this used to repeat a full Current Offer /
  // Max Buy / Cushion / Profit / Target row that's already visible
  // immediately above in the Deal Economics Hero (DealDecisionCenter.jsx)
  // wherever this component is actually mounted. Removed the repeated
  // row; this section now leads with INTERPRETATION ("how much room for
  // error do we have") instead of restating the same five numbers. The
  // one number genuinely new here — profit cushion vs. price cushion,
  // which can differ — stays, since it isn't shown in the Hero. Downside
  // testing (functionality) unchanged.
  return (
    <div className="mb-3 rounded-lg border border-[color:var(--color-line)] border-l-[3px] overflow-hidden bg-[color:var(--color-bg-elev-2)]" style={{ borderLeftColor: theme.border }}>
      <div className="px-3 pt-2.5 flex items-center justify-between gap-2 flex-wrap">
        <span className="text-[9px] uppercase tracking-widest font-bold text-[color:var(--color-text-dim)]">Margin of Safety</span>
        {maturity === 'PRELIMINARY' && (
          <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[color:var(--color-warn-soft)] text-[color:var(--color-warn-text)] border border-[color:var(--color-warn)]">
            🟡 PRELIMINARY — comps/ARV not yet confirmed
          </span>
        )}
      </div>

      {/* Tier + plain-language "why" — visible immediately, no click
          needed, per the mission's "never make Kevin interpret an
          important number by himself" principle. */}
      <div className="px-3 pb-2.5 pt-1">
        <span className="text-[12.5px] font-extrabold" style={{ color: theme.text }}>
          {VERDICT_DISPLAY_LABEL[verdict] || verdict} — {marginOfSafety.title}
        </span>
        {marginOfSafety.why && (
          <p className="text-[11.5px] mt-1 leading-snug text-[color:var(--color-text-muted)]">{marginOfSafety.why}</p>
        )}
        {marginOfSafety.profitCushion != null && marginOfSafety.priceCushion != null && Math.round(marginOfSafety.profitCushion) !== Math.round(marginOfSafety.priceCushion) && (
          <button type="button" onClick={() => setWhyOpen(o => !o)} className="text-[10.5px] font-semibold underline text-[color:var(--color-text-dim)] mt-1">
            {whyOpen ? 'Hide' : 'ⓘ Profit cushion vs. price cushion'}
          </button>
        )}
        {whyOpen && marginOfSafety.profitCushion != null && (
          <div className="text-[11px] mt-1 text-[color:var(--color-text-dim)]">
            Profit above the $30K target: {marginOfSafety.profitCushion >= 0 ? '+' : '−'}{fc(Math.round(Math.abs(marginOfSafety.profitCushion)))} — not always the same as the price cushion shown above, since purchase price also moves financing/holding costs.
          </div>
        )}
      </div>

      {/* Optional downside sensitivity (Section 15) — collapsed by default,
          reuses computeFlipBreakdown with modified inputs only; no new
          model, no probability claims. */}
      {currentOffer != null && lead.arv != null && lead.renovation_cost != null && (
        <div className="px-3 pb-2.5 border-t border-[color:var(--color-line)] pt-2">
          <button type="button" onClick={() => setTestDownside(o => !o)} className="text-[10.5px] font-semibold underline text-[color:var(--color-text-dim)]">
            {testDownside ? 'Hide downside test' : 'Test downside'}
          </button>
          {sensitivity && (
            <div className="mt-1.5 space-y-1">
              {sensitivity.map((s, i) => (
                <div key={i} className="text-[11px] flex items-center justify-between gap-2 text-[color:var(--color-text-muted)]">
                  <span>If {s.label}:</span>
                  <span className="font-bold text-[color:var(--color-text)]">
                    Profit {fc(Math.round(s.profit))} {s.profit >= targetProfit ? '✓ still clears target' : '✗ falls below target'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Capability #19.1, Section 12 — "Path to a Flip Deal", rebuilt around
// calculateFlipMAO() (src/lib/calculations.js) instead of a bisected
// per-lever price search — Flip MAO is linear in purchase price so the
// closed-form solve is exact, not approximated. $30K/$40K bar aligned to
// HAT's actual minimum (Section 6) — a $30,728 deal is no longer labeled
// CONDITIONAL by a stale $40K rule; "Strong" is descriptive context, not
// a lower verdict for the acceptable tier.
export function FlipRealityCheck({ lead }) {
  const arv  = lead.arv != null ? Number(lead.arv) : null
  const reno = lead.renovation_cost != null ? Number(lead.renovation_cost) : null
  if (!arv || reno == null) return null
  const holdMonths = lead.hold_months || 6

  const flipMao = calculateFlipMAO(arv, reno, holdMonths)
  // Same effective-offer function Financials/Detailed Analysis use — one
  // "current price" concept across the whole card, not a third guess.
  const currentPP = getEffectiveOffer(lead, flipMao)
  const current = currentPP != null ? computeFlipBreakdown(currentPP, arv, reno, holdMonths) : null
  const profit = current?.totalProfit ?? null

  const meetsTarget = profit != null && profit >= FLIP_MIN_PROFIT_TARGET
  const strong = profit != null && profit >= FLIP_STRONG_PROFIT
  const profitColor = strong ? 'text-[color:var(--color-success-text)]' : meetsTarget ? 'text-[color:var(--color-success-text)]' : 'text-[color:var(--color-danger-text)]'

  return (
    <div className="mb-3 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] p-3 space-y-2.5">
      <div className="text-[9.5px] uppercase tracking-widest text-[color:var(--color-text-dim)] font-bold">🎯 Path to a Flip Deal</div>

      <div className="text-[11px] text-[color:var(--color-text-muted)]">
        HAT minimum profit target: <strong className="text-[color:var(--color-text)]">{fc(FLIP_MIN_PROFIT_TARGET)}</strong>
      </div>

      {current && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Projected Profit (current)</div>
            <div className={`text-[14px] font-bold ${profitColor}`}>{fc(profit)}</div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Status</div>
            <div className={`text-[12.5px] font-bold ${profitColor}`}>
              {strong ? 'STRONG — exceeds target' : meetsTarget ? 'MEETS MINIMUM FLIP TARGET' : `$${(FLIP_MIN_PROFIT_TARGET - profit).toLocaleString()} short of target`}
            </div>
          </div>
        </div>
      )}

      <div className="border-t border-[color:var(--color-line)] pt-2 grid grid-cols-2 gap-3">
        <div>
          <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Max Buy (Flip)</div>
          <div className="text-[16px] font-bold text-[color:var(--color-text)]">{flipMao != null ? fc(Math.round(flipMao / 100) * 100) : '—'}</div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Profit At Max Buy</div>
          <div className="text-[13px] font-bold text-[color:var(--color-text)]">{flipMao != null ? `≈ ${fc(FLIP_MIN_PROFIT_TARGET)}` : '—'}</div>
        </div>
      </div>

      {/* Capability #19.2, Section 10 — plain-language distance from Flip
          MAO, in terms of the CURRENT purchase-price scenario above, not a
          repeat of the lever list below. */}
      {currentPP != null && flipMao != null && (
        <p className="text-[11px] text-[color:var(--color-text-muted)]">
          {currentPP <= flipMao
            ? `You are currently ${fc(flipMao - currentPP)} below the maximum supported purchase price.`
            : `Purchase price needs to decrease by ${fc(currentPP - flipMao)} to reach Max Buy.`}
        </p>
      )}

      {!meetsTarget && flipMao != null && (
        <p className="text-[11px] text-[color:var(--color-text-muted)]">
          Any ONE of these would bring the deal to HAT's {fc(FLIP_MIN_PROFIT_TARGET)} minimum target, assuming the other assumptions stay unchanged:
        </p>
      )}
      {!meetsTarget && flipMao != null && (() => {
        const round1k = n => Math.round(n / 1000) * 1000
        const arvNeeded = calculateFlipMAO(arv, reno, holdMonths, FLIP_MIN_PROFIT_TARGET) != null && currentPP != null
          ? bisectThreshold(a => computeFlipBreakdown(currentPP, a, reno, holdMonths).totalProfit >= FLIP_MIN_PROFIT_TARGET, arv * 0.5, arv * 2)
          : null
        const renoNeeded = reno > 0 && currentPP != null
          ? bisectThreshold(r => computeFlipBreakdown(currentPP, arv, r, holdMonths).totalProfit >= FLIP_MIN_PROFIT_TARGET, 0, reno)
          : null
        return (
          <div className="space-y-1">
            {currentPP != null && (
              <div className="flex items-center justify-between text-[11.5px]">
                <span className="text-[color:var(--color-text-muted)]">Price — current {fc(currentPP)}</span>
                <span className="font-semibold text-[color:var(--color-accent-text)]">need ≤ {fc(Math.round(flipMao / 1000) * 1000)}</span>
              </div>
            )}
            <div className="flex items-center justify-between text-[11.5px]">
              <span className="text-[color:var(--color-text-muted)]">ARV — current {fc(arv)}</span>
              <span className="font-semibold text-[color:var(--color-accent-text)]">{arvNeeded != null ? `need ≥ ${fc(round1k(arvNeeded))}` : 'not reachable at a realistic level'}</span>
            </div>
            <div className="flex items-center justify-between text-[11.5px]">
              <span className="text-[color:var(--color-text-muted)]">Rehab — current {fc(reno)}</span>
              <span className="font-semibold text-[color:var(--color-accent-text)]">{renoNeeded != null ? `need ≤ ${fc(round1k(renoNeeded))}` : reno > 0 ? 'no amount fixes this alone' : 'n/a (already $0)'}</span>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

function TargetProfitCalc({ arv, reno, holdMonths, currentPP, currentProfit }) {
  const [targetProfit, setTargetProfit] = useState('30000')
  const parsed = parseFloat(targetProfit.replace(/[^0-9.]/g, '')) || 0
  const maxOffer = arv ? calculateFlipMAO(arv, reno, holdMonths, parsed) : null
  const roundedMaxOffer = maxOffer != null ? Math.round(maxOffer / 100) * 100 : null
  const diff = roundedMaxOffer != null ? roundedMaxOffer - currentPP : null

  return (
    <div className="rounded-lg border border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)] p-3">
      <div className="text-[9.5px] uppercase tracking-widest text-[color:var(--color-accent-text)] font-bold mb-2">
        Target Profit → Max Buy
      </div>
      <p className="text-[10.5px] text-[color:var(--color-accent-text)] opacity-80 mb-2 leading-snug">
        Max Buy above uses HAT's {fc(FLIP_MIN_PROFIT_TARGET)} default target. If you'd accept a different profit to win the deal, this shows what purchase price that allows instead.
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
  const isFlip = strategy !== 'brrrr'
  const holdMonths = lead.hold_months || 6
  // Same canonical MAO + effective-offer functions every other card on
  // this page uses — this tab used to compute its own flat-75%-rule MAO
  // and prefer stored lead.mao directly, a fourth "current price" concept.
  const canonicalMao = isFlip ? calculateFlipMAO(arv, reno, holdMonths) : calculateBrrrrMAO(arv, reno, rent, holdMonths)?.mao
  const pp = Number(getEffectiveOffer(lead, canonicalMao) || 0)
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

export default function DealAnalysisCard({ lead, userId, canEdit, onUpdated, onStrategyChange, hideDecisionSummary = false }) {
  const staleness = useDealStaleness(lead)

  const [strategy,    setStrategy]    = useState(lead.deal_analysis?.strategy || 'flip')

  // Bug fix — the Flip/BRRRR tab picked here was local-only state, so
  // Financials (a sibling section, not a child of this card) kept showing
  // "Flip MAO" even after Kevin switched this card to BRRRR (real report:
  // 6552 Bartholf Ave — Detailed Analysis read BRRRR MAO $138,100 while
  // Financials still showed Flip MAO $133,700 for the same lead). Notify
  // the parent (LeadDetailPage) of the active strategy on mount and on
  // every change, WITHOUT converting this into a controlled prop — every
  // internal read of `strategy` below is unchanged.
  useEffect(() => { onStrategyChange?.(strategy) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const [localNotes,  setLocalNotes]  = useState(lead.ai_notes || '')
  const [generating,  setGenerating]  = useState(false)
  const [phase,       setPhase]       = useState(null)
  const [genError,    setGenError]    = useState(null)
  const [showRenoPicker, setShowRenoPicker] = useState(false)
  const [generatingScripts, setGeneratingScripts] = useState(false)
  const [competitiveMode, setCompetitiveMode] = useState(false)
  // Last-Mile UX — Override Inputs are power-user controls; collapsed by
  // default and moved below the AI narrative (Section 9) so they never
  // interrupt the executive reading path (AI Deal Read -> AI's own
  // Recommended Action/comps/etc). No analysis behavior changed — only
  // where/how the same controls are shown.
  const [overrideOpen, setOverrideOpen] = useState(false)
  const [aiCompsArv, setAiCompsArv] = useState(null)
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
    // Shorten "Refresh Detailed Analysis": once a lead already has an
    // analysis, only re-run the core numbers that actually depend on
    // ARV/reno (MAO, profit, verdict) — skip comps (property-value
    // evidence that doesn't change just because reno moved; refresh it
    // explicitly via "Refresh Comps" below) and skip the negotiation plan
    // (now a separate "Update Negotiation Plan" button, since it doesn't
    // need to change on every ARV/reno tweak either).
    if (hasAnalysis && lead.arv && !forceRefreshComps) {
      reRunWithOverrides()
    } else {
      runGenerate(forceRefreshComps, strategy)
    }
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
      // Negotiation plan is intentionally NOT auto-refreshed here anymore
      // — it's a separate LLM call that doesn't need to re-run just
      // because ARV/reno moved. Kevin can refresh it on demand with the
      // "Update Negotiation Plan" button when he actually wants that.
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

  // Capability #19.2, Section 9 — the existing staleness check (above)
  // only catches INPUT drift (ARV/reno/strategy changed since the last
  // run). It can't catch FORMULA drift: this exact AI text was generated
  // by an older prompt-side MAO/profit formula before Flip MAO existed as
  // a concept, so its "$X at MAO" language can reference a number that no
  // longer matches the canonical Flip MAO shown everywhere else on this
  // page, even though nothing about the property changed. Comparing the
  // AI text's own "Our MAO: $X" line against today's canonical Flip MAO
  // catches that case with a concise notice — never editing the historical
  // text itself.
  const aiTextMao = parseAiMao(localNotes)
  const canonicalFlipMaoForStaleness = (lead.arv != null && lead.renovation_cost != null)
    ? calculateFlipMAO(Number(lead.arv), Number(lead.renovation_cost), lead.hold_months || 6)
    : null
  const aiTextMaoStale = strategy !== 'brrrr' && aiTextMao != null && canonicalFlipMaoForStaleness != null
    && Math.abs(aiTextMao - canonicalFlipMaoForStaleness) > 1000

  // Deal Analysis Clarity capability — Flip and BRRRR are ALWAYS both
  // calculated independently (Section 9's explicit requirement: "Do not
  // make the selected UI tab determine the underlying strategy
  // recommendation"). The strategy tab only decides which one's numbers
  // are shown as the primary summary below.
  const flipResult = hasAnalysis ? computeFlipResult(lead) : { available: false, reason: 'Run analysis first.' }
  const brrrrResult = hasAnalysis ? computeBrrrrResult(lead) : { available: false, reason: 'Run analysis first.' }
  const strategyRecommendation = computeStrategyRecommendation(flipResult, brrrrResult)

  return (
    <Card title="Deal Analysis" subtitle="Comps, negotiation plan, verdict, and scripts — all from one run">
      {hasAnalysis && strategyRecommendation.summary && (
        <div className="mb-2.5 text-[11.5px]">
          <span className="font-extrabold text-[color:var(--color-text)]">{strategyRecommendation.summary}</span>
          <span className="text-[color:var(--color-text-dim)]">
            {' · '}Flip: {flipResult.available ? (VERDICT_DISPLAY_LABEL[flipResult.verdict] || flipResult.verdict) : '—'}
            {'  ·  '}BRRRR: {brrrrResult.available ? (VERDICT_DISPLAY_LABEL[brrrrResult.verdict] || brrrrResult.verdict) : '—'}
          </span>
        </div>
      )}
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-[color:var(--color-line)] mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg border border-[color:var(--color-line)] overflow-hidden text-[11px] font-bold">
            {['flip', 'brrrr'].map(s => (
              <button
                key={s}
                onClick={() => {
                  if (s === strategy) return
                  setStrategy(s)
                  onStrategyChange?.(s)
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

        {/* Negotiation plan is a separate LLM call from "Refresh Detailed
            Analysis" now — Kevin asked not to regenerate it on every
            ARV/reno tweak, since it doesn't need to change just because
            the numbers moved slightly. Only shown once one already
            exists (first-time analysis still generates one). */}
        {canEdit && !generating && /NEGOTIATION PLAN/i.test(localNotes) && (
          <button
            onClick={() => updateNegoPlan()}
            disabled={updatingNego}
            className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-[color:var(--color-line)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] hover:border-[color:var(--color-accent)] transition-colors disabled:opacity-50"
          >
            {updatingNego ? 'Updating…' : '🤝 Update Negotiation Plan'}
          </button>
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

      {!staleness.stale && aiTextMaoStale && !generating && (
        <div className="mb-3 flex items-center gap-2 px-3 py-2.5 rounded-lg border border-[color:var(--color-warn)] bg-[color:var(--color-warn-soft)]">
          <span className="text-[11.5px] font-semibold text-[color:var(--color-warn-text)]">
            ⚠ This AI analysis predates the current Max Buy calculation ({fc(Math.round(canonicalFlipMaoForStaleness / 100) * 100)}) — figures below may not match. Use "Refresh Detailed Analysis" above for updated numbers.
          </span>
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

      {/* Capability — Deal Analysis Clarity + Flip/BRRRR Separation.
          Before this change, "Why"/"Biggest Risk" were parsed out of
          ai_notes free text (leadPriority.js's derivePriority) — which the
          AI writes by picking whichever of Flip/BRRRR scores best,
          independent of the tab Kevin has open. A Flip-tab WHY could
          describe BRRRR cash flow. Replaced with deterministic,
          template-built explanations (src/lib/dealExplanation.js) scoped
          STRICTLY to the selected strategy tab — every number in Why/
          Biggest Risk comes from the same canonical calculateFlipMAO/
          calculateBrrrrMAO/computeFlipBreakdown/computeBrrrrBreakdown
          functions the rest of the page uses. No LLM call, no invented
          numbers, no cross-strategy leakage. */}
      {(flipResult.available || brrrrResult.available) && (() => {
        const activeResult = strategy === 'brrrr' ? brrrrResult : flipResult
        const theme = VERDICT_THEME[activeResult.verdict] || VERDICT_THEME.WATCH
        // Premium visual pass, Part 19/20 — "AI Deal Read," an executive
        // explanation layer, not an engineering dashboard. Semantic color
        // now signals only (left border + the AI Read value itself);
        // surface is neutral so this doesn't compete with the Deal tab's
        // own hero for visual dominance. Same data, same verdict.
        return (
          <div className="mb-3 rounded-lg border border-[color:var(--color-line)] border-l-[3px] overflow-hidden bg-[color:var(--color-bg-elev-2)]" style={{ borderLeftColor: theme.border }}>
            <div className="px-3 pt-2 flex items-center justify-between">
              <span className="text-[9px] uppercase tracking-widest font-bold text-[color:var(--color-text-dim)]">
                AI Deal Read — {strategy === 'brrrr' ? 'BRRRR' : 'Flip'}
              </span>
            </div>

            {activeResult.available ? (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-[color:var(--color-line)]">
                  <div className="px-3 py-2">
                    <div className="text-[9px] uppercase tracking-widest text-[color:var(--color-text-dim)]">AI Read</div>
                    <div className="text-[14px] font-bold leading-tight" style={{ color: theme.text }}>{VERDICT_DISPLAY_LABEL[activeResult.verdict] || activeResult.verdict}</div>
                  </div>
                  <div className="px-3 py-2">
                    <div className="text-[9px] uppercase tracking-widest text-[color:var(--color-text-dim)]">
                      {strategy === 'brrrr' ? 'Cash Left In' : 'Projected Profit'}
                    </div>
                    <div className="text-[14px] font-bold tabular-nums text-[color:var(--color-text)]">
                      {strategy === 'brrrr'
                        ? (activeResult.cashLeftIn != null ? fc(activeResult.cashLeftIn) : '—')
                        : (activeResult.projectedProfit != null ? fc(activeResult.projectedProfit) : '—')}
                    </div>
                  </div>
                  <div className="px-3 py-2">
                    <div className="text-[9px] uppercase tracking-widest text-[color:var(--color-text-dim)]">
                      {strategy === 'brrrr' ? 'Cash Flow' : 'Starting Offer'}
                    </div>
                    <div className="text-[14px] font-bold tabular-nums text-[color:var(--color-text)]">
                      {strategy === 'brrrr'
                        ? (activeResult.monthlyCashFlow != null ? `${fc(activeResult.monthlyCashFlow)}/mo` : '—')
                        : (activeResult.currentOffer != null ? fc(activeResult.currentOffer) : '—')}
                    </div>
                  </div>
                  <div className="px-3 py-2">
                    <div className="text-[9px] uppercase tracking-widest text-[color:var(--color-text-dim)]">Max Buy</div>
                    <div className="text-[14px] font-bold tabular-nums text-[color:var(--color-text)]">{activeResult.mao != null ? fc(Math.round(activeResult.mao / 100) * 100) : 'Not confirmed'}</div>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 divide-x divide-[color:var(--color-line)] border-t border-[color:var(--color-line)]">
                  <div className="px-3 py-2">
                    <div className="text-[9px] uppercase tracking-widest text-[color:var(--color-text-dim)] mb-0.5">Why It Works</div>
                    {activeResult.why.length > 0 ? (
                      <ul className="text-[11.5px] font-medium leading-tight space-y-0.5 text-[color:var(--color-text)]">
                        {activeResult.why.map((r, i) => <li key={i}>✓ {r}</li>)}
                      </ul>
                    ) : (
                      <div className="text-[12px] font-medium text-[color:var(--color-text-dim)]">—</div>
                    )}
                  </div>
                  <div className="px-3 py-2">
                    <div className="text-[9px] uppercase tracking-widest text-[color:var(--color-text-dim)] mb-0.5">Biggest Risk</div>
                    {activeResult.biggestRisk.length > 0 ? (
                      <div className="text-[11.5px] font-medium leading-tight text-[color:var(--color-warn-text)]">⚠ {activeResult.biggestRisk[0]}</div>
                    ) : (
                      <div className="text-[12px] font-medium text-[color:var(--color-text-dim)]">—</div>
                    )}
                  </div>
                </div>
                {/* Recommended Move (Part 11) — phrased directly from the
                    same mao/currentOffer this strip already displays, not
                    a new recommendation. Below MAO -> stay under it;
                    above MAO -> the offer needs to come down. */}
                {activeResult.mao != null && activeResult.currentOffer != null && (
                  <div className="px-3 py-2 border-t border-[color:var(--color-line)]">
                    <div className="text-[9px] uppercase tracking-widest text-[color:var(--color-text-dim)] mb-0.5">Recommended Move</div>
                    <p className="text-[11.5px] font-medium text-[color:var(--color-text)]">
                      {activeResult.currentOffer <= activeResult.mao
                        ? `Stay at or below ${fc(Math.round(activeResult.mao / 100) * 100)}. Preserve additional room through negotiation where possible.`
                        : `Reduce the offer — currently ${fc(activeResult.currentOffer - activeResult.mao)} above Max Buy.`}
                    </p>
                  </div>
                )}
              </>
            ) : (
              <div className="px-3 py-2.5">
                <div className="text-[12px] font-medium text-[color:var(--color-text-dim)]">⚠ {activeResult.reason}</div>
              </div>
            )}
          </div>
        )
      })()}

      {/* Phase 2.1 — Margin of Safety and Path to a Deal now live as the
          Deal tab's own decision summary (moved, not duplicated — same
          exported components, same canonical data). AI & Comps keeps the
          Detailed Analysis verdict strip above plus comps/notes/Ask AI —
          "detailed evidence", not the decision summary itself. Guarded by
          `hideDecisionSummary` so this card still renders them standalone
          wherever else it might be used (e.g. if never wired into the
          Deal tab, nothing regresses — default is to show, same as before). */}
      {!hideDecisionSummary && hasAnalysis && strategy !== 'brrrr' && flipResult.available && (
        <FlipMarginOfSafety lead={lead} flipResult={flipResult} />
      )}

      {!hideDecisionSummary && hasAnalysis && strategy === 'brrrr' && (
        <BrrrrRealityCheck lead={lead} />
      )}
      {!hideDecisionSummary && hasAnalysis && strategy !== 'brrrr' && (
        <FlipRealityCheck lead={lead} />
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

      {/* Last-Mile UX — a small connecting label so the AI-generated
          narrative below reads as the NEXT LAYER of the same explanation
          (deeper AI read on comps/seller signals/market), not a second
          competing verdict next to the deterministic AI Deal Read above. */}
      {localNotes && (
        <div className="text-[9px] uppercase tracking-widest font-bold text-[color:var(--color-text-dim)] mb-1.5 mt-1">
          AI Narrative &amp; Evidence
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

      {/* Override Inputs — moved below the full AI narrative (was
          previously sandwiched between AI Deal Read and the AI's own
          Recommended Action/comps, interrupting the executive reading
          path). Collapsed by default; same controls, same
          reRunWithOverrides() behavior, zero analysis change. */}
      {localNotes && !generating && (
        <div className="mt-3 pt-3 border-t border-[color:var(--color-line)]">
          <button type="button" onClick={() => setOverrideOpen(o => !o)}
            className="text-[10.5px] font-semibold uppercase tracking-wider text-[color:var(--color-text-dim)] hover:text-[color:var(--color-text)]">
            {overrideOpen ? '▾' : '▸'} Adjust Analysis
          </button>
          {overrideOpen && (
            <div className="mt-2 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] px-3 py-2.5">
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
        </div>
      )}
    </Card>
  )
}
