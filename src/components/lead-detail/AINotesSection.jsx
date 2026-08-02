import { useState, useEffect, useRef } from 'react'
import Card from '../ui/Card'
import NotesRenderer from './NotesRenderer'
import DealQA from './DealQA'
import { supabase } from '../../lib/supabase'
import { suggestRenoTier } from '../../lib/renoTierSuggest'
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

export default function AINotesSection({ lead, canEdit, onUpdated }) {
  const [localNotes, setLocalNotes] = useState(lead.ai_notes || '')
  const [generating, setGenerating] = useState(false)
  const [phase,      setPhase]      = useState(null)   // 'analysis' | 'negotiation'
  const [genError,   setGenError]   = useState(null)
  const [confirm,    setConfirm]    = useState(false)
  const [showRenoPicker, setShowRenoPicker] = useState(false)
  const [pickerTier,     setPickerTier]     = useState(null)
  const [pickerSqft,     setPickerSqft]     = useState(String(lead.sqft || ''))
  const [pickerSuggestion, setPickerSuggestion] = useState(null)
  const [generatingScripts, setGeneratingScripts] = useState(false)
  const RENO_RATES = { cosmetic: 12, medium: 22, heavy: 38 }
  const [competitiveMode, setCompetitiveMode] = useState(false)
  const [collapsed,  setCollapsed]  = useState(false)
  const [aiCompsArv,   setAiCompsArv]   = useState(null)  // ARV extracted from comps during last generation
  // Pre-populate overrides from lead so user sees current values — editing triggers re-run
  const [arvOverride,  setArvOverride]  = useState(lead.arv ? String(Math.round(Number(lead.arv))) : '')
  const [renoOverride, setRenoOverride] = useState(lead.renovation_cost ? String(Math.round(Number(lead.renovation_cost))) : '')
  const [domOverride,       setDomOverride]       = useState('')
  const [rentOverride,      setRentOverride]      = useState(lead.rent_estimate ? String(Math.round(Number(lead.rent_estimate))) : '')
  const [priceDropOverride, setPriceDropOverride] = useState('')
  const [sellerNotesOverride, setSellerNotesOverride] = useState('')
  const [aiRent,       setAiRent]       = useState(null)  // estimated rent from bedrooms
  // Initialize lastArv/lastReno to current lead values so overrideChanged = false until user edits
  const [lastArv,      setLastArv]      = useState(lead.arv ? Number(lead.arv) : null)
  const [lastReno,     setLastReno]     = useState(lead.renovation_cost ? Number(lead.renovation_cost) : null)
  const [lastDom,      setLastDom]      = useState(null)   // DOM used in last core run
  const [lastRent,     setLastRent]     = useState(lead.rent_estimate ? Number(lead.rent_estimate) : null)
  const [negoStale,      setNegoStale]      = useState(false)
  const [updatingNego,   setUpdatingNego]   = useState(false)
  const [refreshingComps, setRefreshingComps] = useState(false)
  const cancelledRef = useRef(false)

  useEffect(() => {
    setLocalNotes(lead.ai_notes || '')
  }, [lead.ai_notes])

  // Resync override fields when lead changes (switching between leads) — full reset
  useEffect(() => {
    setArvOverride(lead.arv ? String(Math.round(Number(lead.arv))) : '')
    setRenoOverride(lead.renovation_cost ? String(Math.round(Number(lead.renovation_cost))) : '')
    setRentOverride(lead.rent_estimate ? String(Math.round(Number(lead.rent_estimate))) : '')
    setLastArv(lead.arv ? Number(lead.arv) : null)
    setLastReno(lead.renovation_cost ? Number(lead.renovation_cost) : null)
    setLastRent(lead.rent_estimate ? Number(lead.rent_estimate) : null)
    setAiCompsArv(null)
  }, [lead.id])

  // Also resync override inputs whenever the lead's own field values change (e.g. user edits ARV/Reno inline)
  // This keeps the "FROM FINANCIALS" display accurate without stomping mid-session user edits.
  useEffect(() => {
    setArvOverride(lead.arv ? String(Math.round(Number(lead.arv))) : '')
  }, [lead.arv])

  useEffect(() => {
    setRenoOverride(lead.renovation_cost ? String(Math.round(Number(lead.renovation_cost))) : '')
    setLastReno(lead.renovation_cost ? Number(lead.renovation_cost) : null)
  }, [lead.renovation_cost])

  useEffect(() => {
    setRentOverride(lead.rent_estimate ? String(Math.round(Number(lead.rent_estimate))) : '')
  }, [lead.rent_estimate])

  const runGenerate = async (forceRefreshComps = false) => {
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
      const estimatedRent = lead.rent_estimate || (lead.bedrooms >= 4 ? 2000 : lead.bedrooms === 3 ? 1600 : 1300)
      setAiRent(estimatedRent)
      // Apply any override values already entered by the user (reno, rent, DOM, notes)
      const renoVal  = renoOverride  ? parseFloat(renoOverride.replace(/[^0-9.]/g, ''))  || null : null
      const rentVal  = rentOverride  ? parseFloat(rentOverride.replace(/[^0-9.]/g, ''))  || null : null
      const domVal   = domOverride   ? parseInt(domOverride.replace(/[^0-9]/g, ''))       || null : null
      const notesVal = sellerNotesOverride.trim() || null
      if (renoVal) setLastReno(renoVal)
      if (rentVal) setLastRent(rentVal)
      const leadWithArv = {
        ...leadWithContext,
        ...(arvForCore ? { arv: arvForCore }            : {}),
        ...(renoVal    ? { renovation_cost: renoVal }   : {}),
        ...(rentVal    ? { rent_estimate: rentVal }      : {}),
        ...(domVal     ? { days_on_market: domVal }      : {}),
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

  const cancelGenerate = () => {
    cancelledRef.current = true
    setGenerating(false)
    setPhase(null)
    setGenError(null)
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

  const handleGenerate = (forceRefreshComps = false) => {
    const renoMissing = !lead.renovation_cost && !renoOverride
    if (renoMissing) {
      const suggestion = suggestRenoTier(lead)
      setShowRenoPicker(true)
      setPickerTier(suggestion.tier)
      setPickerSuggestion(suggestion)
      setPickerSqft(String(lead.sqft || ''))
      return
    }
    if (localNotes && !forceRefreshComps) setConfirm(true)
    else runGenerate(forceRefreshComps)
  }

  const applyTierAndRun = async () => {
    if (!pickerTier) return
    const sqft = parseInt(pickerSqft, 10) || 1200
    const reno = Math.round(sqft * RENO_RATES[pickerTier] / 1000) * 1000
    setRenoOverride(String(reno))
    setShowRenoPicker(false)
    // Save to lead so Financials section updates too
    await supabase.from('leads').update({ renovation_cost: reno }).eq('id', lead.id)
    onUpdated?.({ ...lead, renovation_cost: reno })
    if (localNotes) setConfirm(true)
    else runGenerate(false)
  }

  // Re-run only core analysis with ARV and/or reno overrides — skips comps (fast ~8s)
  const reRunWithOverrides = async () => {
    // ARV priority: user-typed → AI comps ARV from last run → lead.arv from DB
    const arv  = arvOverride
      ? parseFloat(arvOverride.replace(/[^0-9.]/g, '')) || null
      : (aiCompsArv || (lead.arv ? Number(lead.arv) : null))
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
        competitive_mode: competitiveMode,
      }
      const coreResult = await callFnFull('generate-core-analysis', { lead: overrideLead })
      if (cancelledRef.current) return
      const coreNotes = coreResult.notes || ''
      // Use server-computed MAO (reliable) — fall back to regex only if missing
      const reRunAiMao = coreResult.computed_mao ?? parseAiMao(coreNotes)
      if (arv)         setLastArv(arv)
      if (reno)        setLastReno(reno)
      if (dom != null) setLastDom(dom)
      if (rent)        setLastRent(rent)
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
        ...(lastDom  != null ? { days_on_market: lastDom } : {}),
        ...(lastRent ? { rent_estimate: lastRent }          : {}),
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
      setNegoStale(false)
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

  const generatedAt = localNotes?.match(/^Generated:\s*(.+)/m)?.[1] || null

  const hasExistingComps = !!(localNotes?.match(/={5,}\s*\nMARKET COMPS/i))

  const phaseLabel = phase === 'analysis'
    ? (hasExistingComps ? 'Re-running analysis (reusing comps)…' : 'Fetching comps & running deal analysis…')
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
                <div className="flex items-center gap-2">
                  {generatedAt && (
                    <span className="text-[10.5px] text-[color:var(--color-text-faint)]">{generatedAt}</span>
                  )}
                  <button
                    onClick={() => handleGenerate(false)}
                    className="flex items-center gap-1 text-[12px] text-[color:var(--color-accent-text)] hover:opacity-80 transition-opacity"
                  >
                    ✦ {localNotes ? 'Re-run' : 'Run Analysis'}
                  </button>
                  {localNotes && hasExistingComps && (
                    <button
                      onClick={() => handleGenerate(true)}
                      title="Re-fetch market comps from scratch (only needed when new sales have closed nearby)"
                      className="text-[10.5px] text-[color:var(--color-text-dim)] hover:text-[color:var(--color-text)] transition-colors"
                    >
                      ↺ Refresh Comps
                    </button>
                  )}
                </div>
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

      {/* ── Reno tier picker — shown when Run Analysis clicked with no reno ── */}
      {showRenoPicker && !generating && (() => {
        const sqft  = parseInt(pickerSqft, 10) || null
        const tiers = [
          { key: 'cosmetic', label: 'Cosmetic',  desc: 'Paint, floors, fixtures, kitchen/bath refresh',          rate: RENO_RATES.cosmetic },
          { key: 'medium',   label: 'Medium',    desc: 'Cosmetic + 1 major (roof, HVAC, electric, or plumbing)',  rate: RENO_RATES.medium   },
          { key: 'heavy',    label: 'Heavy',     desc: 'Cosmetic + 2+ majors / gut rehab',                        rate: RENO_RATES.heavy    },
        ]
        const fmt    = n => `$${n.toLocaleString()}`
        const estFor = t => sqft ? fmt(Math.round(sqft * t.rate / 1000) * 1000) : `~${fmt(1200 * t.rate)}–${fmt(1800 * t.rate)}`
        const selEst = pickerTier ? estFor(tiers.find(t => t.key === pickerTier)) : null
        return (
          <div className="mb-3 rounded-lg border border-[color:var(--color-warn)] bg-[color:var(--color-warn-soft)] p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-semibold text-[color:var(--color-warn-text)]">⚠ No renovation cost — pick a scope to continue</span>
              <button onClick={() => setShowRenoPicker(false)} className="text-[color:var(--color-warn-text)] opacity-60 hover:opacity-100 text-lg leading-none">×</button>
            </div>
            {pickerSuggestion && (
              <div className="flex items-start gap-1.5 bg-black/20 rounded px-2.5 py-1.5">
                <span className="text-[10px] text-[color:var(--color-warn-text)] opacity-70 mt-0.5">🤖</span>
                <span className="text-[11px] text-[color:var(--color-warn-text)] opacity-80 leading-snug">
                  <strong>Suggested: {pickerSuggestion.tier.charAt(0).toUpperCase() + pickerSuggestion.tier.slice(1)}</strong>
                  {' — '}{pickerSuggestion.reason}
                </span>
              </div>
            )}
            {!lead.sqft && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-[color:var(--color-warn-text)]">Property sqft (optional):</span>
                <input type="number" value={pickerSqft} onChange={e => setPickerSqft(e.target.value)}
                  placeholder="e.g. 1400"
                  className="w-24 h-7 px-2 text-[12px] bg-white/60 border border-[color:var(--color-warn)] rounded text-[color:var(--color-warn-text)] focus:outline-none" />
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              {tiers.map(t => (
                <button key={t.key} onClick={() => setPickerTier(t.key)}
                  className={`flex flex-col items-start gap-0.5 rounded-lg border-2 px-3 py-2 text-left transition-all ${
                    pickerTier === t.key
                      ? 'border-[color:var(--color-warn)] bg-[color:var(--color-warn)]/20'
                      : 'border-[color:var(--color-warn)]/40 bg-white/40 hover:border-[color:var(--color-warn)]/70'
                  }`}>
                  <div className="flex items-center gap-1.5 w-full">
                    <span className="text-[12px] font-bold text-[color:var(--color-warn-text)]">{t.label}</span>
                    {pickerSuggestion?.tier === t.key && (
                      <span className="text-[8.5px] font-bold uppercase tracking-wide px-1 py-0.5 rounded bg-[color:var(--color-warn)] text-white leading-none">AI pick</span>
                    )}
                  </div>
                  <span className="text-[11px] font-semibold text-[color:var(--color-warn-text)]">{estFor(t)}</span>
                  <span className="text-[9.5px] text-[color:var(--color-warn-text)] opacity-70 leading-tight">{t.desc}</span>
                  <span className="text-[9px] text-[color:var(--color-warn-text)] opacity-50 mt-0.5">${t.rate}/sqft · Jacksonville avg</span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3 pt-1 flex-wrap">
              <button onClick={applyTierAndRun} disabled={!pickerTier}
                className="px-3 py-1.5 text-[12px] font-semibold rounded-md bg-[color:var(--color-warn)] text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed">
                {pickerTier ? `Use ${selEst} & run analysis` : 'Select a scope above'}
              </button>
              <button onClick={() => setShowRenoPicker(false)}
                className="text-[11.5px] text-[color:var(--color-warn-text)] underline underline-offset-2 hover:opacity-70">
                Enter exact cost in Financials ↑
              </button>
              <button onClick={() => { setShowRenoPicker(false); if (localNotes) setConfirm(true); else runGenerate(false) }}
                className="text-[11px] text-[color:var(--color-warn-text)] opacity-50 hover:opacity-80 ml-auto">
                Run with $0 anyway
              </button>
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
          {/* ARV / Reno info strip — read-only, edited in Financials section above */}
          <div className="mb-2 flex items-center gap-4 px-2 py-1.5 rounded-md bg-[color:var(--color-bg)] border border-[color:var(--color-line)]">
            <span className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] font-semibold shrink-0">From Financials ↑</span>
            <span className="text-[11px] text-[color:var(--color-text-muted)]">
              ARV <strong className="text-[color:var(--color-text)]">{lead.arv ? `$${Number(lead.arv).toLocaleString()}` : '—'}</strong>
              {aiCompsArv && Number(aiCompsArv) !== Number(lead.arv) && (
                <span className="ml-1 text-[color:var(--color-accent-text)]">(AI est: ${Number(aiCompsArv).toLocaleString()})</span>
              )}
            </span>
            <span className="text-[11px] text-[color:var(--color-text-muted)]">
              Reno <strong className="text-[color:var(--color-text)]">{lead.renovation_cost ? `$${Number(lead.renovation_cost).toLocaleString()}` : '—'}</strong>
            </span>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
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
                placeholder={aiRent ? `$${aiRent.toLocaleString()} (est)` : 'e.g. $1,550'}
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
          onGenerateScripts={generateScripts}
          generatingScripts={generatingScripts}
          onRefreshComps={canEdit ? refreshCompsOnly : null}
          refreshingComps={refreshingComps}
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
