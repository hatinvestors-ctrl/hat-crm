import { useState, useEffect, useRef } from 'react'
import Card from '../ui/Card'
import NotesRenderer from './NotesRenderer'
import WhatIfPanel from './WhatIfPanel'
import DealQA from './DealQA'
import { supabase } from '../../lib/supabase'

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
  const [aiCompsArv, setAiCompsArv] = useState(null)   // ARV extracted from comps during last generation
  const [arvOverride, setArvOverride] = useState('')    // user-typed ARV override
  const [lastArv,    setLastArv]    = useState(null)    // ARV used in last core run
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
      const compsNotes = await callFn('generate-comps', { lead }).catch(() => null)
      if (cancelledRef.current) return

      // Phase 1b — core analysis with comps ARV injected so all numbers agree
      const compsArvMatch = compsNotes?.match(/Realistic ARV:\s*\$([0-9,]+)/i)
      const resolvedArv = compsArvMatch ? parseInt(compsArvMatch[1].replace(/,/g, '')) : null
      if (resolvedArv) setAiCompsArv(resolvedArv)
      const arvForCore = resolvedArv || (lead.arv ? Number(lead.arv) : null)
      const leadWithArv = arvForCore ? { ...lead, arv: arvForCore } : lead
      setLastArv(arvForCore)
      const coreNotes = await callFn('generate-core-analysis', { lead: leadWithArv })
      if (cancelledRef.current) return
      if (!coreNotes) throw new Error('Core analysis failed')

      // Phase 2 — negotiation plan + communications in parallel
      setPhase('negotiation')
      const aiSummary = coreNotes.slice(0, 3000)
      const [planResult, commsResult] = await Promise.allSettled([
        callFn('generate-negotiation-plan', { lead, ai_notes: aiSummary }),
        callFn('generate-communications',   { lead, ai_notes: aiSummary }),
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

  // Re-run only core analysis with a custom ARV — skips comps (fast ~8s)
  const reRunWithArv = async () => {
    const arv = parseFloat(arvOverride.replace(/[^0-9.]/g, ''))
    if (!arv) return
    setGenerating(true)
    setGenError(null)
    setPhase('analysis')
    cancelledRef.current = false
    try {
      const coreNotes = await callFn('generate-core-analysis', { lead: { ...lead, arv } })
      if (cancelledRef.current) return
      setLastArv(arv)
      const planNotes  = null // keep existing plan/comms; only core updates
      const compsNotes = localNotes.match(/={5,}\s*\n(MARKET COMPS|CRM COMPS)/i)
        ? localNotes // preserve if already in notes
        : null
      // Replace just the core portion — rebuild full notes
      const existingParts = localNotes.split(/(?=={5,}\s*\n(?:MARKET COMPS|NEGOTIATION PLAN|COMMUNICATIONS))/i)
      const nonCoreParts  = existingParts.slice(1).join('')
      const fullNotes     = coreNotes + (nonCoreParts ? '\n\n' + nonCoreParts.trim() : '')
      if (lead.id) {
        await supabase.from('leads').update({ ai_notes: fullNotes, arv }).eq('id', lead.id)
      }
      setLocalNotes(fullNotes)
      onUpdated?.({ ...lead, ai_notes: fullNotes, arv })
    } catch (err) {
      if (!cancelledRef.current) setGenError(err.message || 'Re-run failed.')
    } finally {
      if (!cancelledRef.current) { setGenerating(false); setPhase(null) }
    }
  }

  // Reno budget: computed from lead fields when renovation_cost is unknown
  const renoBudgetCard = !lead.renovation_cost && lead.arv && lead.mao ? (() => {
    const arv = Number(lead.arv)
    const mao = Number(lead.mao)
    const maxBRRRR = Math.round(arv * 0.70 - mao * 1.085 - 30000)
    const maxFlip  = Math.round(arv * 0.92 - mao - 25000)
    const fmt = n => n > 0 ? `$${n.toLocaleString()}` : 'Deal too tight'
    return (
      <div className="mb-3 rounded-lg border border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)] overflow-hidden">
        <div className="px-3 py-1.5 border-b border-[color:var(--color-accent)]">
          <span className="text-[9.5px] uppercase tracking-wider font-bold text-[color:var(--color-accent-text)]">
            🔨 Max Reno to Make Deal Work at MAO (${mao.toLocaleString()})
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
                  ✦ {localNotes ? 'Regenerate' : 'Generate AI Analysis'}
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

      {/* ARV override row — shown after analysis is available */}
      {localNotes && !generating && (
        <div className="mb-3 flex items-center gap-2 flex-wrap">
          {aiCompsArv && (
            <span className="text-[11px] text-[color:var(--color-text-dim)]">
              AI Comps ARV: <strong className="text-[color:var(--color-accent-text)]">${Number(aiCompsArv).toLocaleString()}</strong>
            </span>
          )}
          <span className="text-[11px] text-[color:var(--color-text-faint)]">·</span>
          <span className="text-[11px] text-[color:var(--color-text-dim)]">Override ARV:</span>
          <input
            value={arvOverride}
            onChange={e => setArvOverride(e.target.value)}
            placeholder={aiCompsArv ? `$${Number(aiCompsArv).toLocaleString()}` : 'e.g. $215,000'}
            className="w-32 h-6 px-2 rounded border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] text-[11.5px] text-[color:var(--color-text)] outline-none focus:border-[color:var(--color-accent)]"
          />
          {arvOverride && parseFloat(arvOverride.replace(/[^0-9.]/g,'')) !== lastArv && (
            <button
              onClick={reRunWithArv}
              className="h-6 px-2.5 rounded text-[11px] font-semibold border border-[color:var(--color-accent)] text-[color:var(--color-accent-text)] hover:bg-[color:var(--color-accent-soft)] transition-colors"
            >
              ↻ Re-run with this ARV
            </button>
          )}
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
            <p className="text-[12px] text-[color:var(--color-text-faint)]">Click <strong>✦ Generate AI Analysis</strong> above to run a full investor analysis.</p>
          )}
        </div>
      )}

      </>)}
    </Card>
  )
}
