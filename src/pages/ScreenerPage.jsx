import { useState, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import Topbar from '../components/Topbar'
import DealQueue from '../components/screener/DealQueue'
import DecisionStrip from '../components/screener/DecisionStrip'
import NotesRenderer from '../components/lead-detail/NotesRenderer'
import { lookupAddress } from '../lib/enrichment'
import { findDuplicateLeads } from '../lib/leadDedup'
import { supabase } from '../lib/supabase'

function newDeal(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    address: '',
    askingPrice: '',
    renovationCost: '',
    sourceName: '',
    sourcePhone: '',
    sourceEmail: '',
    status: 'idle',   // idle | enriching | analyzing | done | passed | saved
    enriched: null,
    coreNotes:  null,   // RECOMMENDED ACTION, DEAL SCORE, DEAL SNAPSHOT, PROS, CONS, CRM WORKFLOW
    compsNotes: null,   // MARKET COMPS, CRM COMPS USED
    planNotes:  null,   // NEGOTIATION PLAN
    commsNotes: null,   // COMMUNICATIONS (EMAIL, SMS, VOICEMAIL)
    dupWarning: null,
    score: null,
    verdict: null,
    mao: null,
    error: null,
    ...overrides,
  }
}

function parseScore(notes) {
  const m = notes?.match(/Total:\s*(\d+)\/100/)
  return m ? parseInt(m[1]) : null
}

function parseVerdict(notes) {
  const m = notes?.match(/Verdict:\s*(BUY NOW|OFFER & NEGOTIATE|OFFER|WATCH|DEAD LEAD)/i)
  return m ? m[1] : null
}

function parseMao(notes) {
  const m = notes?.match(/Target Price:\s*\$([0-9,]+)/i)
  return m ? parseInt(m[1].replace(/,/g, '')) : null
}

function parseArv(notes) {
  const m = notes?.match(/Our ARV:\s*\$([0-9,]+)/i)
  return m ? parseInt(m[1].replace(/,/g, '')) : null
}

// Comps analysis gives a more accurate ARV than the quick core estimate
function parseCompsArv(notes) {
  const m = notes?.match(/Realistic ARV:\s*\$([0-9,]+)/i)
  return m ? parseInt(m[1].replace(/,/g, '')) : null
}

function createInitialState() {
  const first = newDeal()
  return { deals: [first], selectedId: first.id }
}

export default function ScreenerPage() {
  const { workspaceId, userId } = useOutletContext()

  const [{ deals, selectedId }, setState] = useState(createInitialState)

  const setDeals = useCallback((updater) =>
    setState(s => ({ ...s, deals: typeof updater === 'function' ? updater(s.deals) : updater })), [])

  const setSelectedId = useCallback((id) =>
    setState(s => ({ ...s, selectedId: id })), [])

  const [saving, setSaving]           = useState(false)
  const [gettingNego, setGettingNego] = useState(false)
  const [tab, setTab]                 = useState('single') // 'single' | 'bulk'
  const [csvError, setCsvError]       = useState(null)

  const selectedDeal = deals.find(d => d.id === selectedId) || deals[0]

  const updateDeal = useCallback((id, patch) => {
    setDeals(prev => prev.map(d => d.id === id ? { ...d, ...patch } : d))
  }, [setDeals])

  const setField = (field, value) => {
    if (selectedDeal) updateDeal(selectedDeal.id, { [field]: value })
  }

  const analyze = async () => {
    const deal = deals.find(d => d.id === selectedId)
    if (!deal?.address || !deal?.askingPrice) return
    const dealId = deal.id

    const dups = await findDuplicateLeads(workspaceId, deal.address)
    const dupWarning = dups.length > 0 ? dups[0] : null

    updateDeal(dealId, { status: 'enriching', dupWarning, error: null })

    const enrichResult = await lookupAddress(deal.address)
    const enriched = enrichResult.ok ? enrichResult : null

    const asking = parseFloat(String(deal.askingPrice).replace(/[^0-9.]/g, '')) || null

    const lead = {
      address:          deal.address,
      city:             enriched?.city          || '',
      state:            enriched?.state         || 'FL',
      zip_code:         enriched?.zip_code      || '',
      bedrooms:         enriched?.bedrooms      || null,
      bathrooms:        enriched?.bathrooms     || null,
      sqft:             enriched?.sqft          || null,
      year_built:       enriched?.year_built    || null,
      property_type:    enriched?.property_type || null,
      asking_price:     asking,
      arv:              null,
      conservative_arv: null,
      aggressive_arv:   null,
      renovation_cost:  deal.renovationCost ? parseFloat(String(deal.renovationCost).replace(/[^0-9.]/g, '')) || null : null,
      mao:              null,
      rent_estimate:    null,
      notes:            '',
    }

    updateDeal(dealId, { status: 'analyzing', enriched })

    const postFn = async (fn, payload) => {
      const resp = await fetch(`/.netlify/functions/${fn}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!resp.ok && resp.headers.get('content-type')?.includes('text/html')) {
        throw new Error(`${fn} timed out (${resp.status})`)
      }
      const data = await resp.json()
      if (!data.ok) throw new Error(data.error || `${fn} failed`)
      return data.notes || ''
    }

    try {
      // Step 1: comps first — gives us a reliable ARV from actual comparable sales
      const compsNotes = await postFn('generate-comps', { lead }).catch(() => null)
      const compsArv = parseCompsArv(compsNotes)

      // Step 2: core analysis with the comps ARV injected so all numbers agree
      const leadWithArv = compsArv ? { ...lead, arv: compsArv } : lead
      const coreNotes = await postFn('generate-core-analysis', { lead: leadWithArv }).catch(e => { throw e })
      const error = null

      updateDeal(dealId, {
        status: 'done',
        coreNotes,
        compsNotes,
        score:   parseScore(coreNotes),
        verdict: parseVerdict(coreNotes),
        mao:     parseMao(coreNotes),
        arv:     parseCompsArv(compsNotes) || parseArv(coreNotes),
        error,
      })
    } catch (e) {
      updateDeal(dealId, { status: 'done', error: e.message })
    }
  }

  const getNegoPlan = async () => {
    const deal = deals.find(d => d.id === selectedId)
    if (!deal?.coreNotes) return
    const dealId = deal.id
    setGettingNego(true)
    try {
      const asking = parseFloat(String(deal.askingPrice).replace(/[^0-9.]/g, '')) || null
      const lead = {
        address:              deal.address,
        city:                 deal.enriched?.city          || '',
        state:                deal.enriched?.state         || 'FL',
        zip_code:             deal.enriched?.zip_code      || '',
        bedrooms:             deal.enriched?.bedrooms      || null,
        bathrooms:            deal.enriched?.bathrooms     || null,
        sqft:                 deal.enriched?.sqft          || null,
        asking_price:         asking,
        arv:                  null,
        renovation_cost:      null,
        mao:                  deal.mao,
        notes:                '',
        listing_agent_name:   deal.sourceName || '',
        sourceName:           deal.sourceName || '',
      }
      const aiSummary = [deal.coreNotes, deal.compsNotes].filter(Boolean).join('\n\n')

      // Fire negotiation plan + communications in parallel
      const [planResult, commsResult] = await Promise.allSettled([
        fetch('/.netlify/functions/generate-negotiation-plan', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ lead, ai_notes: aiSummary }),
        }).then(async r => {
          if (!r.ok && r.headers.get('content-type')?.includes('text/html')) throw new Error(`plan timed out (${r.status})`)
          const d = await r.json()
          if (!d.ok) throw new Error(d.error)
          return d.notes || ''
        }),
        fetch('/.netlify/functions/generate-communications', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ lead, ai_notes: aiSummary }),
        }).then(async r => {
          if (!r.ok && r.headers.get('content-type')?.includes('text/html')) throw new Error(`comms timed out (${r.status})`)
          const d = await r.json()
          if (!d.ok) throw new Error(d.error)
          return d.notes || ''
        }),
      ])

      const planNotes  = planResult.status  === 'fulfilled' ? planResult.value  : null
      const commsNotes = commsResult.status === 'fulfilled' ? commsResult.value : null

      if (planResult.status === 'rejected' && commsResult.status === 'rejected') {
        throw new Error(planResult.reason?.message || 'Both plan calls failed')
      }

      updateDeal(dealId, { planNotes, commsNotes })
    } catch (e) {
      alert('Could not generate negotiation plan: ' + e.message)
    } finally {
      setGettingNego(false)
    }
  }

  const passDeal = () => updateDeal(selectedId, { status: 'passed' })

  const saveToCRM = async () => {
    const deal = deals.find(d => d.id === selectedId)
    if (!deal || saving || deal.status === 'saved') return
    const dealId = deal.id
    setSaving(true)
    try {
      const asking = parseFloat(String(deal.askingPrice).replace(/[^0-9.]/g, '')) || null
      const fullNotes = [deal.coreNotes, deal.compsNotes, deal.planNotes, deal.commsNotes].filter(Boolean).join('\n\n')

      // Duplicate check — match on address (case-insensitive) within this workspace
      const { data: existing } = await supabase.from('leads')
        .select('id')
        .eq('workspace_id', workspaceId)
        .ilike('address', deal.address.trim())
        .limit(1)
        .maybeSingle()

      if (existing?.id) {
        const overwrite = window.confirm(
          `A lead for "${deal.address}" already exists in your CRM.\n\nUpdate its AI analysis with the screener results?`
        )
        if (!overwrite) { setSaving(false); return }
        await supabase.from('leads')
          .update({
            ai_notes:     fullNotes || null,
            screened:     true,
            asking_price: asking,
            arv:          deal.arv  || null,
            mao:          deal.mao  || null,
          })
          .eq('id', existing.id)
        updateDeal(dealId, { status: 'saved' })
        setSaving(false)
        return
      }

      const { data: lead, error } = await supabase.from('leads').insert({
        workspace_id:  workspaceId,
        created_by:    userId,
        address:       deal.address,
        city:          deal.enriched?.city         || null,
        state:         deal.enriched?.state        || 'FL',
        zip_code:      deal.enriched?.zip_code     || null,
        bedrooms:      deal.enriched?.bedrooms     || null,
        bathrooms:     deal.enriched?.bathrooms    || null,
        sqft:          deal.enriched?.sqft         || null,
        year_built:    deal.enriched?.year_built   || null,
        property_type: deal.enriched?.property_type || null,
        asking_price:     asking,
        arv:              deal.arv  || null,
        mao:              deal.mao  || null,
        renovation_cost:  deal.renovationCost ? parseFloat(String(deal.renovationCost).replace(/[^0-9.]/g, '')) || null : null,
        lead_source:      deal.sourceName ? 'wholesaler' : 'other',
        status:        'new_lead',
        screened:      true,
        ai_notes:      fullNotes || null,
      }).select('id').single()

      if (error) throw error

      if (deal.sourceName && lead?.id) {
        let agentId = null
        const { data: existing } = await supabase.from('agents')
          .select('id')
          .eq('workspace_id', workspaceId)
          .ilike('name', deal.sourceName)
          .limit(1)
          .maybeSingle()
        if (existing?.id) {
          agentId = existing.id
        } else {
          const { data: agent } = await supabase.from('agents')
            .insert({
              workspace_id: workspaceId,
              name:         deal.sourceName,
              phone:        deal.sourcePhone || null,
              email:        deal.sourceEmail || null,
              agent_type:   'wholesaler',
            })
            .select('id').single()
          agentId = agent?.id
        }
        if (agentId) {
          await supabase.from('agent_leads').insert({
            workspace_id: workspaceId,
            agent_id:     agentId,
            lead_id:      lead.id,
            role:         'wholesaler',
          })
        }
      }

      updateDeal(dealId, { status: 'saved' })
    } catch (e) {
      alert('Save failed: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleCSV = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setCsvError(null)
    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const lines = evt.target.result.split('\n').map(l => l.trim()).filter(Boolean)
        if (lines.length < 2) { setCsvError('CSV must have a header row and at least one data row.'); return }
        const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/^"|"$/g, ''))
        const addrIdx   = headers.findIndex(h => h === 'address')
        const priceIdx  = headers.findIndex(h => h.includes('asking') || h.includes('price'))
        const sourceIdx = headers.findIndex(h => h.includes('source'))
        if (addrIdx === -1) { setCsvError('CSV must have an "address" column.'); return }

        const newDeals = lines.slice(1).map(line => {
          const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''))
          return newDeal({
            address:     cols[addrIdx]                     || '',
            askingPrice: priceIdx  >= 0 ? cols[priceIdx]  : '',
            sourceName:  sourceIdx >= 0 ? cols[sourceIdx] : '',
          })
        }).filter(d => d.address)

        if (newDeals.length === 0) { setCsvError('No valid rows found.'); return }
        setDeals(prev => [...prev, ...newDeals])
        setSelectedId(newDeals[0].id)
        setTab('single')
      } catch (err) {
        setCsvError('Could not parse CSV: ' + err.message)
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const displayNotes = [selectedDeal?.coreNotes, selectedDeal?.compsNotes, selectedDeal?.planNotes, selectedDeal?.commsNotes].filter(Boolean).join('\n\n')

  const addDeal = () => {
    const d = newDeal()
    setDeals(prev => [...prev, d])
    setSelectedId(d.id)
  }

  return (
    <div className="flex flex-col h-full">
      <Topbar title="Deal Screener" />

      <div className="flex flex-1 min-h-0">
        {/* Left: Deal Queue */}
        <div className="w-56 shrink-0 flex flex-col min-h-0">
          <DealQueue
            deals={deals}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onAdd={addDeal}
          />
        </div>

        {/* Right: Analysis Panel */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          {/* Entry form */}
          <div className="border-b border-[color:var(--color-line)] px-4 py-3 shrink-0">
            {/* Tab switcher */}
            <div className="flex gap-2 mb-3">
              {['single', 'bulk'].map(t => (
                <button key={t} onClick={() => setTab(t)}
                  className="text-[11px] font-semibold px-2.5 py-1 rounded-md transition-colors"
                  style={{
                    background: tab === t ? 'var(--color-accent)' : 'var(--color-bg-elev-2)',
                    color:      tab === t ? '#fff'                 : 'var(--color-text-muted)',
                  }}>
                  {t === 'single' ? 'Single Entry' : 'Bulk CSV'}
                </button>
              ))}
            </div>

            {tab === 'single' && selectedDeal && (
              <div className="flex gap-2 flex-wrap items-end">
                <div className="flex-1 min-w-[200px]">
                  <label className="block text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1">Address *</label>
                  <input
                    value={selectedDeal.address}
                    onChange={e => setField('address', e.target.value)}
                    placeholder="123 Main St, Jacksonville FL"
                    className="w-full h-8 px-2.5 rounded-md border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] text-[12.5px] text-[color:var(--color-text)] outline-none focus:border-[color:var(--color-accent)]"
                  />
                </div>
                <div className="w-28">
                  <label className="block text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1">Asking Price *</label>
                  <input
                    value={selectedDeal.askingPrice}
                    onChange={e => setField('askingPrice', e.target.value)}
                    placeholder="$150,000"
                    className="w-full h-8 px-2.5 rounded-md border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] text-[12.5px] text-[color:var(--color-text)] outline-none focus:border-[color:var(--color-accent)]"
                  />
                </div>
                <div className="w-28">
                  <label className="block text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1">Reno Budget</label>
                  <input
                    value={selectedDeal.renovationCost}
                    onChange={e => setField('renovationCost', e.target.value)}
                    placeholder="$25,000 (opt)"
                    className="w-full h-8 px-2.5 rounded-md border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] text-[12.5px] text-[color:var(--color-text)] outline-none focus:border-[color:var(--color-accent)]"
                  />
                </div>
                <div className="w-36">
                  <label className="block text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1">Source Name</label>
                  <input
                    value={selectedDeal.sourceName}
                    onChange={e => setField('sourceName', e.target.value)}
                    placeholder="Wholesaler / source"
                    className="w-full h-8 px-2.5 rounded-md border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] text-[12.5px] text-[color:var(--color-text)] outline-none focus:border-[color:var(--color-accent)]"
                  />
                </div>
                <div className="w-32">
                  <label className="block text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1">Phone</label>
                  <input
                    value={selectedDeal.sourcePhone}
                    onChange={e => setField('sourcePhone', e.target.value)}
                    placeholder="(904) 555-0100"
                    className="w-full h-8 px-2.5 rounded-md border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] text-[12.5px] text-[color:var(--color-text)] outline-none focus:border-[color:var(--color-accent)]"
                  />
                </div>
                <button
                  onClick={analyze}
                  disabled={!selectedDeal.address || !selectedDeal.askingPrice || selectedDeal.status === 'enriching' || selectedDeal.status === 'analyzing'}
                  className="h-8 px-3 rounded-md text-[12px] font-semibold bg-[color:var(--color-accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-40"
                >
                  {selectedDeal.status === 'enriching' ? 'Looking up…' :
                   selectedDeal.status === 'analyzing' ? 'Analyzing…' : 'Analyze'}
                </button>
              </div>
            )}

            {tab === 'bulk' && (
              <div className="space-y-2">
                <p className="text-[12px] text-[color:var(--color-text-muted)]">
                  Upload a CSV with columns:{' '}
                  <code className="bg-[color:var(--color-bg-elev-2)] px-1 rounded">address</code>,{' '}
                  <code className="bg-[color:var(--color-bg-elev-2)] px-1 rounded">asking_price</code>,{' '}
                  <code className="bg-[color:var(--color-bg-elev-2)] px-1 rounded">source_name</code> (optional)
                </p>
                <input type="file" accept=".csv" onChange={handleCSV}
                  className="text-[12px] text-[color:var(--color-text)]" />
                {csvError && <p className="text-[11px] text-[color:var(--color-danger-text)]">{csvError}</p>}
              </div>
            )}

            {/* Duplicate warning */}
            {selectedDeal?.dupWarning && (
              <div className="mt-2 px-2.5 py-1.5 rounded-md bg-[color:var(--color-warn-soft)] border border-[color:var(--color-warn)] text-[11px] text-[color:var(--color-warn-text)]">
                Already in CRM as <strong>{selectedDeal.dupWarning.status}</strong>: {selectedDeal.dupWarning.address}
              </div>
            )}
          </div>

          {/* Analysis output */}
          <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0" style={{ scrollbarWidth: 'thin' }}>
            {selectedDeal?.error && (
              <div className="p-3 rounded-lg bg-[color:var(--color-danger-soft)] border border-[color:var(--color-danger)] text-[12px] text-[color:var(--color-danger-text)]">
                Analysis failed: {selectedDeal.error}
              </div>
            )}
            {(selectedDeal?.status === 'enriching' || selectedDeal?.status === 'analyzing') && (
              <div className="flex items-center gap-2 text-[12px] text-[color:var(--color-text-muted)] mt-4">
                <span className="animate-spin inline-block">&#x23F3;</span>
                {selectedDeal.status === 'enriching'
                  ? 'Looking up property details…'
                  : 'Fetching comps, then running deal analysis (30–50 sec)…'}
              </div>
            )}
            {/* Reno budget card — computed from AI-parsed ARV + MAO when user left reno blank */}
            {displayNotes && !selectedDeal?.renovationCost && selectedDeal?.arv && selectedDeal?.mao && (() => {
              const arv = selectedDeal.arv
              const mao = selectedDeal.mao
              const maxBRRRR = Math.round(arv * 0.70 - mao * 1.085 - 30000)
              const maxFlip  = Math.round(arv * 0.92 - mao - 25000)
              const fmt = n => n > 0 ? `$${n.toLocaleString()}` : 'Deal too tight'
              return (
                <div className="mb-3 rounded-lg border border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)] overflow-hidden">
                  <div className="px-3 py-1.5 border-b border-[color:var(--color-accent)]">
                    <span className="text-[9.5px] uppercase tracking-wider font-bold text-[color:var(--color-accent-text)]">🔨 Max Reno to Make Deal Work at MAO (${mao.toLocaleString()})</span>
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
            })()}
            {displayNotes && (
              <NotesRenderer notes={displayNotes} />
            )}
            {!displayNotes && selectedDeal?.status === 'idle' && !selectedDeal?.error && (
              <div className="text-center mt-12">
                <p className="text-[40px] mb-3">&#x1F50D;</p>
                <p className="text-[13px] text-[color:var(--color-text-dim)]">
                  Enter an address and asking price, then click Analyze.
                </p>
              </div>
            )}
          </div>

          {/* Decision strip */}
          <DecisionStrip
            deal={selectedDeal}
            onPass={passDeal}
            onSave={saveToCRM}
            onGetNegoPlan={getNegoPlan}
            saving={saving}
            gettingNego={gettingNego}
          />
        </div>
      </div>
    </div>
  )
}
