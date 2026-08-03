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

function FullBreakdownTab({ lead, strategy }) {
  const arv  = Number(lead.arv || 0)
  const reno = Number(lead.renovation_cost ?? 0)
  const rent = Number(lead.rent_estimate || lead.monthly_rent || 0)
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
  const [confirm,     setConfirm]     = useState(false)
  const [showRenoPicker, setShowRenoPicker] = useState(false)
  const [generatingScripts, setGeneratingScripts] = useState(false)
  const [competitiveMode, setCompetitiveMode] = useState(false)
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

  useEffect(() => { setLocalNotes(lead.ai_notes || '') }, [lead.ai_notes])

  const hasAnalysis = !!lead.deal_analysis
  const renoMissing = lead.renovation_cost == null

  // Note: ARV/Reno/DOM/Rent overrides have no input UI in this card (edited only in
  // PropertyInfoSection/FinancialSection), so they are intentionally excluded from this check.
  const overrideChanged = !!priceDropOverride.trim() || !!sellerNotesOverride.trim()

  function handleRun(forceRefreshComps) {
    if (renoMissing) { setShowRenoPicker(true); return }
    if (localNotes && !forceRefreshComps) { setConfirm(true); return }
    runGenerate(forceRefreshComps, strategy)
  }

  function cancelGenerate() {
    cancelledRef.current = true
    setGenerating(false)
    setPhase(null)
    setGenError(null)
  }

  const runGenerate = async (forceRefreshComps = false, strategyOverride = null, renoOverrideVal = null) => {
    setConfirm(false)
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

      // Phase 1b — core analysis with comps ARV injected so all numbers agree
      const compsArvMatch = compsNotes?.match(/Realistic ARV:\s*\$([0-9,]+)/i)
      const resolvedArv = compsArvMatch ? parseInt(compsArvMatch[1].replace(/,/g, '')) : null
      if (resolvedArv) setAiCompsArv(resolvedArv)
      const arvForCore = resolvedArv || (lead.arv ? Number(lead.arv) : null)
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
      const dbUpdate = {
        ai_notes: fullNotes,
        ...(finalArv !== null && finalArv !== undefined ? { arv: finalArv } : {}),
        ...(finalMao !== null && finalMao !== undefined ? { mao: finalMao } : {}),
      }
      if (lead.id) {
        await supabase.from('leads').update(dbUpdate).eq('id', lead.id)
        // starting_offer saved separately so a missing column never blocks the main update
        if (aiStartingOffer !== null) {
          await supabase.from('leads').update({ starting_offer: aiStartingOffer }).eq('id', lead.id).then(({ error }) => {
            if (error) console.warn('starting_offer column not yet added — run migration:', error.message)
          })
        }
      }

      setLocalNotes(fullNotes)
      // Patch deal_analysis.inputs so isStale stays false after AI analysis updates mao/arv
      const updatedDealAnalysis = lead.deal_analysis ? {
        ...lead.deal_analysis,
        inputs: {
          ...(lead.deal_analysis.inputs || {}),
          ...(finalArv !== null && finalArv !== undefined ? { arv: finalArv } : {}),
          ...(finalMao !== null && finalMao !== undefined ? { purchase_price: finalMao } : {}),
        }
      } : lead.deal_analysis
      onUpdated?.({ ...lead, ...dbUpdate, deal_analysis: updatedDealAnalysis, ...(aiStartingOffer !== null ? { starting_offer: aiStartingOffer } : {}) })

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
        }),
      })
      const verdictData = await verdictRes.json()
      if (verdictRes.ok && verdictData.ok) {
        await logDealAnalysis(lead.id, userId, verdictData.analysis)
        onUpdated?.({ ...lead, ...dbUpdate, deal_analysis: verdictData.analysis, ai_notes: fullNotes })
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
    // ARV/Reno have no override input UI here (edited only in FinancialSection) — always
    // use the AI comps ARV from the last run / lead's DB values, never a stale override.
    // DOM/Rent are read straight from `lead` (edited in Property Info / Financials).
    const arv  = aiCompsArv || (lead.arv ? Number(lead.arv) : null)
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
      const supabaseUpdate = {
        ai_notes: fullNotes,
        ...(arv  != null        ? { arv }                  : {}),
        ...(reno != null        ? { renovation_cost: reno } : {}),
        ...(reRunAiMao !== null ? { mao: reRunAiMao }       : {}),
      }
      if (lead.id) {
        await supabase.from('leads').update(supabaseUpdate).eq('id', lead.id)
        if (reRunStartingOffer !== null) {
          await supabase.from('leads').update({ starting_offer: reRunStartingOffer }).eq('id', lead.id).then(({ error }) => {
            if (error) console.warn('starting_offer column not yet added — run migration:', error.message)
          })
        }
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
      onUpdated?.({ ...lead, ai_notes: fullNotes, ...supabaseUpdate, deal_analysis: reRunDealAnalysis, ...(reRunStartingOffer !== null ? { starting_offer: reRunStartingOffer } : {}) })
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
      onUpdated?.({ ...lead, ai_notes: fullNotes })
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
      onUpdated?.({ ...lead, ai_notes: fullNotes })
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
      onUpdated?.({ ...lead, ai_notes: fullNotes })
    } catch (err) {
      setGenError(err.message || 'Failed to refresh comps.')
    } finally {
      setRefreshingComps(false)
    }
  }

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
          ) : (
            <button
              onClick={() => handleRun(false)}
              className={`text-[12px] font-semibold px-3 py-1.5 rounded-lg text-white hover:opacity-90 transition-opacity ${
                staleness.stale && hasAnalysis ? 'bg-[color:var(--color-warn)]' : 'bg-[color:var(--color-accent)]'
              }`}
            >
              {!hasAnalysis ? '✦ Run Analysis' : staleness.stale ? '⚠ Re-run Analysis' : '↺ Re-run Analysis'}
            </button>
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
            onUpdated?.({ ...lead, renovation_cost: reno })
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

      {hasAnalysis && (() => {
        const a = lead.deal_analysis
        const theme = a.score >= 70
          ? { bg: 'var(--color-success-soft)', border: 'var(--color-success)', text: 'var(--color-success-text)' }
          : a.score >= 45
          ? { bg: 'var(--color-warn-soft)', border: 'var(--color-warn)', text: 'var(--color-warn-text)' }
          : { bg: 'var(--color-danger-soft)', border: 'var(--color-danger)', text: 'var(--color-danger-text)' }
        return (
          <div className="mb-3 rounded-lg border overflow-hidden" style={{ borderColor: theme.border, background: theme.bg }}>
            <div className="grid grid-cols-2 sm:grid-cols-5 divide-x" style={{ borderColor: theme.border }}>
              <div className="px-3 py-2">
                <div className="text-[9px] uppercase tracking-widest opacity-70" style={{ color: theme.text }}>Verdict</div>
                <div className="text-[14px] font-bold" style={{ color: theme.text }}>{a.verdict || '—'}</div>
              </div>
              <div className="px-3 py-2">
                <div className="text-[9px] uppercase tracking-widest opacity-70" style={{ color: theme.text }}>Score</div>
                <div className="text-[14px] font-bold" style={{ color: theme.text }}>{a.score ?? '—'}</div>
              </div>
              <div className="px-3 py-2">
                <div className="text-[9px] uppercase tracking-widest opacity-70" style={{ color: theme.text }}>MAO</div>
                <div className="text-[14px] font-bold" style={{ color: theme.text }}>{lead.mao ? fc(lead.mao) : '—'}</div>
              </div>
              <div className="px-3 py-2">
                <div className="text-[9px] uppercase tracking-widest opacity-70" style={{ color: theme.text }}>Starting Offer</div>
                <div className="text-[14px] font-bold" style={{ color: theme.text }}>{lead.starting_offer ? fc(lead.starting_offer) : '—'}</div>
              </div>
              <div className="px-3 py-2">
                <div className="text-[9px] uppercase tracking-widest opacity-70" style={{ color: theme.text }}>Profit</div>
                <div className="text-[14px] font-bold" style={{ color: theme.text }}>{a.profit != null ? fc(a.profit) : '—'}</div>
              </div>
            </div>
          </div>
        )
      })()}

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

      {confirm && (
        <div className="mb-3 flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-[color:var(--color-warn-soft)] border border-[color:var(--color-warn)]">
          <span className="text-[12px] text-[color:var(--color-warn-text)]">
            Replace existing AI analysis with a fresh generation?
          </span>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => setConfirm(false)}
              className="text-[11.5px] px-2.5 py-1 rounded bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => runGenerate(false, strategy)}
              className="text-[11.5px] px-2.5 py-1 rounded bg-[color:var(--color-warn)] text-white hover:opacity-90 transition-opacity"
            >
              Regenerate
            </button>
          </div>
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
