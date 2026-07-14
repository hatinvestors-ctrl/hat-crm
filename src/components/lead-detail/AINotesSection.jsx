import { useState, useEffect, useRef } from 'react'
import Card from '../ui/Card'
import NotesRenderer from './NotesRenderer'
import WhatIfPanel from './WhatIfPanel'
import DealQA from './DealQA'
import { supabase } from '../../lib/supabase'

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

export default function AINotesSection({ lead, canEdit, onUpdated }) {
  const [localNotes, setLocalNotes] = useState(lead.ai_notes || '')
  const [generating, setGenerating] = useState(false)
  const [phase,      setPhase]      = useState(null)   // 'analysis' | 'negotiation'
  const [genError,   setGenError]   = useState(null)
  const [confirm,    setConfirm]    = useState(false)
  const [collapsed,  setCollapsed]  = useState(false)
  const [aiCompsArv,   setAiCompsArv]   = useState(null)  // ARV extracted from comps during last generation
  const [arvOverride,  setArvOverride]  = useState('')    // user-typed ARV override
  const [renoOverride, setRenoOverride] = useState('')    // user-typed reno cost override
  const [domOverride,       setDomOverride]       = useState('')
  const [rentOverride,      setRentOverride]      = useState('')
  const [priceDropOverride, setPriceDropOverride] = useState('')
  const [sellerNotesOverride, setSellerNotesOverride] = useState('')
  const [aiRent,       setAiRent]       = useState(null)  // estimated rent from bedrooms
  const [lastArv,      setLastArv]      = useState(null)   // ARV used in last core run
  const [lastReno,     setLastReno]     = useState(null)   // Reno used in last core run
  const [lastDom,      setLastDom]      = useState(null)   // DOM used in last core run
  const [lastRent,     setLastRent]     = useState(null)   // Rent used in last core run
  const [negoStale,    setNegoStale]    = useState(false)  // nego plan out of sync with current core inputs
  const [updatingNego, setUpdatingNego] = useState(false)
  const cancelledRef = useRef(false)

  useEffect(() => {
    setLocalNotes(lead.ai_notes || '')
  }, [lead.ai_notes])

  const runGenerate = async () => {
    setConfirm(false)
    setGenerating(true)
    setGenError(null)
    cancelledRef.current = false

    try {
      if (!lead.asking_price) throw new Error('NO_ASKING_PRICE')

      // Phase 1a — comps first to get reliable ARV from actual comparable sales
      setPhase('analysis')
      const teamComments = await fetchLeadContext(lead)
      const leadWithContext = teamComments ? { ...lead, team_comments: teamComments } : lead
      const compsNotes = await callFn('generate-comps', { lead: leadWithContext }).catch(() => null)
      if (cancelledRef.current) return

      // Phase 1b — core analysis with comps ARV injected so all numbers agree
      const compsArvMatch = compsNotes?.match(/Realistic ARV:\s*\$([0-9,]+)/i)
      const resolvedArv = compsArvMatch ? parseInt(compsArvMatch[1].replace(/,/g, '')) : null
      if (resolvedArv) setAiCompsArv(resolvedArv)
      const arvForCore = resolvedArv || (lead.arv ? Number(lead.arv) : null)
      const estimatedRent = lead.rent_estimate || (lead.bedrooms >= 4 ? 2000 : lead.bedrooms === 3 ? 1600 : 1300)
      setAiRent(estimatedRent)
      const leadWithArv = { ...leadWithContext, ...(arvForCore ? { arv: arvForCore } : {}) }
      setLastArv(arvForCore)
      const coreNotes = await callFn('generate-core-analysis', { lead: leadWithArv })
      if (cancelledRef.current) return
      if (!coreNotes) throw new Error('Core analysis failed')

      // Phase 2 — negotiation plan + communications in parallel
      setPhase('negotiation')
      const aiSummary = coreNotes.slice(0, 3000)
      const [planResult, commsResult] = await Promise.allSettled([
        callFn('generate-negotiation-plan', { lead: leadWithArv, ai_notes: aiSummary }),
        callFn('generate-communications',   { lead: leadWithArv, ai_notes: aiSummary }),
      ])
      if (cancelledRef.current) return

      const planNotes  = planResult.status  === 'fulfilled' ? planResult.value  : null
      const commsNotes = commsResult.status === 'fulfilled' ? commsResult.value : null

      const fullNotes = [coreNotes, compsNotes, planNotes, commsNotes].filter(Boolean).join('\n\n')

      // Save to Supabase (new functions don't save internally)
      if (lead.id) {
        await supabase.from('leads').update({
          ai_notes: fullNotes,
          ...(arvForCore ? { arv: arvForCore } : {}),
        }).eq('id', lead.id)
      }

      setLocalNotes(fullNotes)
      onUpdated?.({ ...lead, ai_notes: fullNotes })
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

  const cancelGenerate = () => {
    cancelledRef.current = true
    setGenerating(false)
    setPhase(null)
    setGenError(null)
  }

  const handleGenerate = () => {
    if (localNotes) setConfirm(true)
    else runGenerate()
  }

  // Re-run only core analysis with ARV and/or reno overrides — skips comps (fast ~8s)
  const reRunWithOverrides = async () => {
    const arv  = arvOverride  ? parseFloat(arvOverride.replace(/[^0-9.]/g, ''))  || null : null
    const reno = renoOverride ? parseFloat(renoOverride.replace(/[^0-9.]/g, '')) || null : null
    const dom  = domOverride  ? parseInt(domOverride.replace(/[^0-9]/g, ''))     || null : null
    const rent      = rentOverride      ? parseFloat(rentOverride.replace(/[^0-9.]/g, ''))      || null : null
    const priceDrop = priceDropOverride ? parseFloat(priceDropOverride.replace(/[^0-9.]/g, '')) || null : null
    const sellerNotes = sellerNotesOverride.trim() || null
    if (!arv && !reno && dom == null && !rent && priceDrop == null && !sellerNotes) return
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
        ...(dom  != null ? { days_on_market: dom }     : {}),
        ...(rent      != null ? { rent_estimate: rent }         : {}),
        ...(priceDrop != null ? { price_drop_pct: priceDrop }  : {}),
        ...(sellerNotes       ? { notes: sellerNotes }          : {}),
        ...(teamComments      ? { team_comments: teamComments } : {}),
      }
      const coreNotes = await callFn('generate-core-analysis', { lead: overrideLead })
      if (cancelledRef.current) return
      if (arv)         setLastArv(arv)
      if (reno)        setLastReno(reno)
      if (dom != null) setLastDom(dom)
      if (rent)        setLastRent(rent)
      // Replace just the core portion — preserve comps/plan/comms
      const existingParts = localNotes.split(/(?=={5,}\s*\n(?:MARKET COMPS|RENTAL COMPS|NEGOTIATION PLAN|COMMUNICATIONS))/i)
      const nonCoreParts  = existingParts.slice(1).join('')
      const fullNotes     = coreNotes + (nonCoreParts ? '\n\n' + nonCoreParts.trim() : '')
      // Flag nego plan as stale if it exists and inputs changed
      const hasNego = /NEGOTIATION PLAN/i.test(localNotes)
      if (hasNego) setNegoStale(true)
      const supabaseUpdate = {
        ai_notes: fullNotes,
        ...(arv  != null ? { arv }              : {}),
        ...(reno != null ? { renovation_cost: reno } : {}),
      }
      if (lead.id) await supabase.from('leads').update(supabaseUpdate).eq('id', lead.id)
      setLocalNotes(fullNotes)
      onUpdated?.({ ...lead, ai_notes: fullNotes, ...supabaseUpdate })
    } catch (err) {
      if (!cancelledRef.current) setGenError(err.message || 'Re-run failed.')
    } finally {
      if (!cancelledRef.current) { setGenerating(false); setPhase(null) }
    }
  }

  // Re-run negotiation plan + communications with the updated core analysis numbers
  const updateNegoPlan = async () => {
    setUpdatingNego(true)
    setGenError(null)
    try {
      // Pull the current core notes (first section before MARKET COMPS / NEGOTIATION PLAN)
      const corePart   = localNotes.split(/(?=={5,}\s*\n(?:MARKET COMPS|NEGOTIATION PLAN|COMMUNICATIONS))/i)[0]
      const compsPart  = localNotes.match(/(={5,}\s*\nMARKET COMPS[\s\S]*?)(?=={5,}\s*\n(?:NEGOTIATION PLAN|COMMUNICATIONS)|$)/i)?.[1] || ''
      const aiSummary  = corePart.slice(0, 3000)
      const teamComments = await fetchLeadContext(lead)
      const overrideLead = {
        ...lead,
        ...(lastArv  ? { arv: lastArv }                    : {}),
        ...(lastReno ? { renovation_cost: lastReno }        : {}),
        ...(lastDom  != null ? { days_on_market: lastDom } : {}),
        ...(lastRent ? { rent_estimate: lastRent }          : {}),
        ...(priceDropOverride ? { price_drop_pct: parseFloat(priceDropOverride) || null } : {}),
        ...(sellerNotesOverride.trim() ? { notes: sellerNotesOverride.trim() } : {}),
        ...(teamComments      ? { team_comments: teamComments } : {}),
      }
      const [planResult, commsResult] = await Promise.allSettled([
        callFn('generate-negotiation-plan', { lead: overrideLead, ai_notes: aiSummary }),
        callFn('generate-communications',   { lead: overrideLead, ai_notes: aiSummary }),
      ])
      const planNotes  = planResult.status  === 'fulfilled' ? planResult.value  : null
      const commsNotes = commsResult.status === 'fulfilled' ? commsResult.value : null
      const fullNotes  = [corePart.trim(), compsPart.trim(), planNotes, commsNotes].filter(Boolean).join('\n\n')
      if (lead.id) await supabase.from('leads').update({ ai_notes: fullNotes }).eq('id', lead.id)
      setLocalNotes(fullNotes)
      onUpdated?.({ ...lead, ai_notes: fullNotes })
      setNegoStale(false)
    } catch (err) {
      setGenError(err.message || 'Failed to update negotiation plan.')
    } finally {
      setUpdatingNego(false)
    }
  }

  const overrideChanged =
    (arvOverride  && parseFloat(arvOverride.replace(/[^0-9.]/g,''))  !== lastArv)  ||
    (renoOverride && parseFloat(renoOverride.replace(/[^0-9.]/g,'')) !== lastReno) ||
    (domOverride  && parseInt(domOverride.replace(/[^0-9]/g,''))     !== lastDom)  ||
    (rentOverride      && parseFloat(rentOverride.replace(/[^0-9.]/g,''))      !== lastRent) ||
    !!priceDropOverride.trim() ||
    !!sellerNotesOverride.trim()

  // Reno budget: computed from lead fields when renovation_cost is unknown
  const renoBudgetCard = !lead.renovation_cost && lead.arv && lead.mao ? (() => {
    const arv    = Number(lead.arv)
    const mao    = Number(lead.mao)
    const asking = Number(lead.asking_price || 0) || mao
    const pp     = Math.min(asking, mao)  // effective purchase price — never overpay above MAO
    const refi_  = arv * 0.70
    const maxBRRRR = Math.round((refi_ - 30000 - pp * 0.90 * 1.085 - 1500) / 2.085)
    const maxFlip  = Math.round(arv * 0.92 - pp - 25000)
    const fmt = n => n > 0 ? `$${n.toLocaleString()}` : 'Deal too tight'
    const ppLabel = pp < mao ? `Ask $${pp.toLocaleString()}` : `MAO $${mao.toLocaleString()}`
    return (
      <div className="mb-3 rounded-lg border border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)] overflow-hidden">
        <div className="px-3 py-1.5 border-b border-[color:var(--color-accent)]">
          <span className="text-[9.5px] uppercase tracking-wider font-bold text-[color:var(--color-accent-text)]">
            🔨 Max Reno to Make Deal Work at {ppLabel}
          </span>
        </div>
        <div className="grid grid-cols-2 divide-x divide-[color:var(--color-accent)]">
          <div className="px-3 py-2">
            <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-accent-text)] opacity-70 mb-0.5">BRRRR (cash left in &lt;$30K)</div>
            <div className="text-[14px] font-bold text-[color:var(--color-accent-text)]">{fmt(maxBRRRR)}</div>
          </div>
          <div className="px-3 py-2">
            <div className="text-[9px] uppercase tracking-wider text-[color:var(--color-accent-text)] opacity-70 mb-0.5">Flip (net profit &gt;$25K)</div>
            <div className="text-[14px] font-bold text-[color:var(--color-accent-text)]">{fmt(maxFlip)}</div>
          </div>
        </div>
      </div>
    )
  })() : null

  const phaseLabel = phase === 'analysis'
    ? 'Fetching comps & running deal analysis…'
    : phase === 'negotiation'
    ? 'Generating negotiation plan…'
    : 'Generating…'

  return (
    <Card
      title="AI Analysis"
      action={
        <div className="flex items-center gap-2">
          {canEdit && (
            <>
              {generating ? (
                <span className="flex items-center gap-1 text-[12px] text-[color:var(--color-accent-text)]">
                  <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                  </svg>
                  {phaseLabel}
                  <button
                    onClick={cancelGenerate}
                    className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-dim)] hover:text-[color:var(--color-text)] transition-colors"
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  onClick={handleGenerate}
                  className="flex items-center gap-1 text-[12px] text-[color:var(--color-accent-text)] hover:opacity-80 transition-opacity"
                >
                  ✦ {localNotes ? 'Re-run Full Analysis' : 'Full AI Analysis'}
                </button>
              )}
            </>
          )}
          <button
            onClick={() => setCollapsed(c => !c)}
            title={collapsed ? 'Expand' : 'Collapse'}
            className="flex items-center justify-center w-6 h-6 rounded text-[color:var(--color-text-dim)] hover:text-[color:var(--color-text)] hover:bg-[color:var(--color-bg-elev-2)] transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              className="w-3.5 h-3.5 transition-transform duration-200"
              style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
      }
    >
      {collapsed ? null : (<>

      {/* Override inputs — shown after analysis is available */}
      {localNotes && !generating && (
        <div className="mb-3 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] px-3 py-2.5">
          <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] font-semibold mb-2">
            Override Inputs → Re-run Analysis
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex flex-col gap-0.5">
              <label className="text-[9.5px] text-[color:var(--color-text-dim)] uppercase tracking-wider">
                ARV {aiCompsArv && <span className="normal-case font-normal tracking-normal text-[color:var(--color-accent-text)]">· AI estimate: ${Number(aiCompsArv).toLocaleString()}</span>}
              </label>
              <input
                value={arvOverride}
                onChange={e => setArvOverride(e.target.value)}
                placeholder={lead.arv ? `$${Number(lead.arv).toLocaleString()} (current)` : 'e.g. $215,000'}
                className="w-36 h-7 px-2 rounded border border-[color:var(--color-line)] bg-[color:var(--color-bg)] text-[11.5px] text-[color:var(--color-text)] outline-none focus:border-[color:var(--color-accent)]"
              />
            </div>
            <div className="flex flex-col gap-0.5">
              <label className="text-[9.5px] text-[color:var(--color-text-dim)] uppercase tracking-wider">
                Reno Cost {!lead.renovation_cost && <span className="normal-case font-normal tracking-normal text-[color:var(--color-warn-text)]">· unknown</span>}
              </label>
              <input
                value={renoOverride}
                onChange={e => setRenoOverride(e.target.value)}
                placeholder={lead.renovation_cost ? `$${Number(lead.renovation_cost).toLocaleString()} (current)` : 'e.g. $35,000'}
                className="w-36 h-7 px-2 rounded border border-[color:var(--color-line)] bg-[color:var(--color-bg)] text-[11.5px] text-[color:var(--color-text)] outline-none focus:border-[color:var(--color-accent)]"
              />
            </div>
            <div className="flex flex-col gap-0.5">
              <label className="text-[9.5px] text-[color:var(--color-text-dim)] uppercase tracking-wider">
                DOM {lead.days_on_market != null && <span className="normal-case font-normal tracking-normal text-[color:var(--color-text-dim)]">· MLS: {lead.days_on_market}d</span>}
              </label>
              <input
                value={domOverride}
                onChange={e => setDomOverride(e.target.value)}
                placeholder={lead.days_on_market != null ? `${lead.days_on_market} days (MLS)` : 'e.g. 45'}
                className="w-28 h-7 px-2 rounded border border-[color:var(--color-line)] bg-[color:var(--color-bg)] text-[11.5px] text-[color:var(--color-text)] outline-none focus:border-[color:var(--color-accent)]"
              />
            </div>
            <div className="flex flex-col gap-0.5">
              <label className="text-[9.5px] text-[color:var(--color-text-dim)] uppercase tracking-wider">
                Rent/mo {aiRent && <span className="normal-case font-normal tracking-normal text-[color:var(--color-accent-text)]">· est: ${aiRent.toLocaleString()}</span>}
              </label>
              <input
                value={rentOverride}
                onChange={e => setRentOverride(e.target.value)}
                placeholder={aiRent ? `$${aiRent.toLocaleString()} (est)` : 'e.g. $1,500'}
                className="w-28 h-7 px-2 rounded border border-[color:var(--color-line)] bg-[color:var(--color-bg)] text-[11.5px] text-[color:var(--color-text)] outline-none focus:border-[color:var(--color-accent)]"
              />
            </div>
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
            {overrideChanged && (
              <div className="flex flex-col gap-0.5 mt-3.5">
                <button
                  onClick={reRunWithOverrides}
                  className="h-7 px-3 rounded text-[11.5px] font-semibold bg-[color:var(--color-accent)] text-white hover:opacity-90 transition-opacity"
                >
                  ↻ Re-run Full Analysis
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Stale nego plan notice */}
      {negoStale && !generating && !updatingNego && (
        <div className="mb-3 flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-[color:var(--color-warn)] bg-[color:var(--color-warn-soft)]">
          <div>
            <div className="text-[11.5px] font-semibold text-[color:var(--color-warn-text)]">⚠ Negotiation plan is based on old numbers</div>
            <div className="text-[10.5px] text-[color:var(--color-warn-text)] opacity-80 mt-0.5">You changed ARV or Reno — the plan and scripts still reflect the previous analysis.</div>
          </div>
          <button
            onClick={updateNegoPlan}
            className="shrink-0 h-7 px-3 rounded text-[11.5px] font-semibold bg-[color:var(--color-warn)] text-white hover:opacity-90 transition-opacity"
          >
            ↻ Update Plan
          </button>
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
              onClick={runGenerate}
              className="text-[11.5px] px-2.5 py-1 rounded bg-[color:var(--color-warn)] text-white hover:opacity-90 transition-opacity"
            >
              Regenerate
            </button>
          </div>
        </div>
      )}

      {genError && (
        <p className="mb-3 text-[11.5px] text-[color:var(--color-danger-text)]">⚠ {genError}</p>
      )}

      {localNotes ? (<>
        {renoBudgetCard}
        <NotesRenderer
          notes={localNotes}
          lead={lead}
          missingFields={[
            !lead.arv             && 'ARV',
            !lead.renovation_cost && 'Reno Cost',
            !lead.rent_estimate   && 'Rent Estimate',
          ].filter(Boolean)}
          extraTabs={[{
            id: 'askai',
            label: 'Ask AI',
            icon: '💬',
            content: (
              <div className="space-y-2">
                <WhatIfPanel lead={lead} />
                <DealQA lead={lead} aiNotes={localNotes} />
              </div>
            ),
          }]}
        />
      </>) : generating ? (
        <p className="text-[12.5px] text-[color:var(--color-text-dim)] italic">{phaseLabel} This takes 30–50 seconds.</p>
      ) : (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <p className="text-[13px] text-[color:var(--color-text-dim)]">No AI analysis yet.</p>
          {canEdit && (
            <p className="text-[12px] text-[color:var(--color-text-faint)]">Click <strong>✦ Full AI Analysis</strong> above to run a full investor analysis including comps, negotiation plan, and communications.</p>
          )}
        </div>
      )}

      </>)}
    </Card>
  )
}
