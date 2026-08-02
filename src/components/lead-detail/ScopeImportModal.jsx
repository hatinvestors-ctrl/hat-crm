import { useState, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { RENOVATION_CATEGORIES, fmtUSD } from '../../lib/dealCalculations'

const CATEGORIES = RENOVATION_CATEGORIES

function parseCsvLine(line) {
  const cols = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') { inQ = !inQ }
    else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = '' }
    else { cur += ch }
  }
  cols.push(cur.trim())
  return cols
}

function parseMoney(s) {
  if (!s) return 0
  return Math.max(0, parseFloat(String(s).replace(/[$,\s]/g, '')) || 0)
}

function guessCategory(text) {
  const t = text.toLowerCase()
  if (/roof|shingle|gutter|fascia/.test(t))                    return 'Roofing'
  if (/kitchen|cabinet|countertop|appliance/.test(t))          return 'Kitchen'
  if (/bath|toilet|tub|shower|vanity/.test(t))                 return 'Bathrooms'
  if (/floor|tile|carpet|hardwood|vinyl/.test(t))              return 'Flooring'
  if (/paint|drywall|plaster|patch/.test(t))                   return 'Painting'
  if (/hvac|ac|heat|furnace|duct|air/.test(t))                 return 'HVAC'
  if (/plumb|pipe|water|drain|sewer|fixture/.test(t))          return 'Plumbing'
  if (/electric|wire|panel|outlet|switch|light/.test(t))       return 'Electrical'
  if (/window|door|entry/.test(t))                             return 'Windows & Doors'
  if (/foundation|crawl|basement|slab/.test(t))                return 'Foundation'
  if (/insulation|attic/.test(t))                              return 'Insulation'
  if (/exterior|siding|stucco|fence/.test(t))                  return 'Exterior'
  if (/land|lawn|yard|tree|driveway/.test(t))                  return 'Landscaping'
  if (/demo|demolish|remove|tear/.test(t))                     return 'Demo'
  if (/trim|molding|baseboard|millwork/.test(t))               return 'Trim & Millwork'
  if (/permit|fee|inspection/.test(t))                         return 'Permits & Fees'
  if (/clean/.test(t))                                         return 'Cleaning'
  return 'Other'
}

function parseCsvText(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length === 0) return []

  const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9]/g, '_'))

  const descIdx = headers.findIndex(h => /desc|item|work|scope|task|name/.test(h))
  const costIdx = headers.findIndex(h => /cost|amount|budget|price|estimate|total/.test(h))
  const catIdx  = headers.findIndex(h => /cat/.test(h))

  if (descIdx === -1 && costIdx === -1) {
    // No recognizable header — treat as flat lines: description [tab/,] cost
    return lines
      .map(l => parseCsvLine(l))
      .filter(cols => cols.length >= 1 && cols[0].trim())
      .map(cols => {
        const desc = cols[0].trim()
        const cost = cols.length > 1 ? parseMoney(cols[cols.length - 1]) : 0
        return { category: guessCategory(desc), description: desc, estimated_cost: cost }
      })
      .filter(i => i.description)
  }

  return lines.slice(1)
    .map(l => parseCsvLine(l))
    .filter(cols => cols.length > 0)
    .map(cols => {
      const desc = descIdx >= 0 ? (cols[descIdx] || '').trim() : ''
      const cost = costIdx >= 0 ? parseMoney(cols[costIdx]) : 0
      const rawCat = catIdx >= 0 ? (cols[catIdx] || '').trim() : ''
      const category = CATEGORIES.includes(rawCat) ? rawCat : guessCategory(desc || rawCat)
      return { category, description: desc, estimated_cost: cost }
    })
    .filter(i => i.description)
}

export default function ScopeImportModal({ open, onClose, leadId, workspaceId, lead, onImported }) {
  const [tab, setTab]         = useState('paste')   // 'paste' | 'csv' | 'seed'
  const [text, setText]       = useState('')
  const [items, setItems]     = useState(null)       // null = not parsed yet
  const [parsing, setParsing] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState(null)
  const fileRef = useRef(null)

  if (!open) return null

  const renovBudget   = Number(lead?.renovation_cost || 0)
  const renovLender   = Number(lead?.deal_financials?.[0]?.renovation_lender_amount || lead?.renovation_lender_amount || 0)

  const reset = () => { setText(''); setItems(null); setError(null); setParsing(false); setSaving(false) }
  const handleClose = () => { reset(); setTab('paste'); onClose() }

  // ── Text paste → AI parse ───────────────────────────────────────
  const parseWithAI = async () => {
    if (!text.trim()) return
    setParsing(true)
    setError(null)
    try {
      const res  = await fetch('/.netlify/functions/parse-sow', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ text }),
      })
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || 'Parse failed')
      setItems(data.items)
    } catch (e) {
      setError(e.message)
    } finally {
      setParsing(false)
    }
  }

  // ── CSV file → client-side parse ───────────────────────────────
  const handleFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const parsed = parseCsvText(ev.target.result)
        if (!parsed.length) { setError('No items found — check your CSV format.'); return }
        setItems(parsed)
        setError(null)
      } catch (err) {
        setError(err.message)
      }
    }
    reader.readAsText(file)
  }

  // ── Seed from lead budget ───────────────────────────────────────
  const seedItems = [
    renovBudget > 0 && { category: 'Other', description: 'Total Renovation Budget', estimated_cost: renovBudget },
  ].filter(Boolean)

  // ── Save parsed items ───────────────────────────────────────────
  const save = async (rowsToSave) => {
    if (!rowsToSave?.length) return
    setSaving(true)
    setError(null)
    try {
      const rows = rowsToSave.map((it, idx) => ({
        lead_id:        leadId,
        workspace_id:   workspaceId,
        category:       it.category,
        description:    it.description || null,
        estimated_cost: Number(it.estimated_cost) || 0,
        status:         'planned',
        sort_order:     idx,
      }))
      const { error: err } = await supabase.from('deal_renovation_items').insert(rows)
      if (err) throw err
      onImported?.()
      handleClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const updateItem = (idx, field, val) => {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: val } : it))
  }
  const removeItem = (idx) => setItems(prev => prev.filter((_, i) => i !== idx))

  const total = (items || []).reduce((s, i) => s + (Number(i.estimated_cost) || 0), 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[color:var(--color-bg)] border border-[color:var(--color-line)] rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[color:var(--color-line)]">
          <div>
            <h2 className="text-[15px] font-semibold text-[color:var(--color-text)]">Import Scope of Work</h2>
            <p className="text-[11.5px] text-[color:var(--color-text-dim)] mt-0.5">Paste a SOW, upload a CSV, or seed from the lead budget</p>
          </div>
          <button onClick={handleClose} className="text-[color:var(--color-text-dim)] hover:text-[color:var(--color-text)] text-lg px-1">×</button>
        </div>

        {/* Tab bar */}
        {!items && (
          <div className="flex border-b border-[color:var(--color-line)]">
            {[
              { id: 'paste', label: '✦ AI Parse (paste text)' },
              { id: 'csv',   label: '↑ Upload CSV' },
              { id: 'seed',  label: '⊕ Seed from Budget' },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => { setTab(t.id); setError(null) }}
                className={`px-4 py-2.5 text-[12px] font-medium border-b-2 transition-colors ${
                  tab === t.id
                    ? 'border-[color:var(--color-accent)] text-[color:var(--color-accent-text)]'
                    : 'border-transparent text-[color:var(--color-text-dim)] hover:text-[color:var(--color-text)]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-auto p-5">

          {/* ── Paste tab ── */}
          {!items && tab === 'paste' && (
            <div className="space-y-3">
              <p className="text-[12px] text-[color:var(--color-text-dim)]">
                Paste your contractor's SOW, bid sheet, or any list of work items. AI will extract line items and map them to categories.
              </p>
              <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder={"Kitchen cabinets replacement   $8,500\nRoof shingles full replacement  $12,000\nHVAC replace unit              $6,500\n…"}
                rows={12}
                className="w-full px-3 py-2 text-[12px] rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-input)] text-[color:var(--color-text)] focus:outline-none focus:border-[color:var(--color-accent)] resize-none font-mono"
              />
              {error && <p className="text-[11.5px] text-[color:var(--color-danger-text)]">{error}</p>}
              <div className="flex gap-2">
                <button
                  onClick={parseWithAI}
                  disabled={!text.trim() || parsing}
                  className="px-4 py-2 text-[12px] font-semibold rounded-lg bg-[color:var(--color-accent)] text-white disabled:opacity-50 hover:opacity-90 transition-opacity"
                >
                  {parsing ? 'Parsing…' : '✦ Parse with AI'}
                </button>
              </div>
            </div>
          )}

          {/* ── CSV tab ── */}
          {!items && tab === 'csv' && (
            <div className="space-y-4">
              <p className="text-[12px] text-[color:var(--color-text-dim)]">
                Upload a CSV with columns like <code className="bg-[color:var(--color-bg-elev-2)] px-1 rounded">description, cost</code> or <code className="bg-[color:var(--color-bg-elev-2)] px-1 rounded">item, category, estimated_cost</code>. The first row should be headers.
              </p>

              {/* Drag-drop zone */}
              <label className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-[color:var(--color-line)] hover:border-[color:var(--color-accent)] transition-colors p-10 cursor-pointer">
                <span className="text-3xl">📄</span>
                <div className="text-center">
                  <p className="text-[13px] font-medium text-[color:var(--color-text)]">Click to upload a CSV file</p>
                  <p className="text-[11.5px] text-[color:var(--color-text-dim)] mt-0.5">or drag and drop here</p>
                </div>
                <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" onChange={handleFile} className="sr-only" />
              </label>

              <details className="text-[11.5px] text-[color:var(--color-text-dim)]">
                <summary className="cursor-pointer hover:text-[color:var(--color-text)]">Expected CSV format</summary>
                <pre className="mt-2 p-3 bg-[color:var(--color-bg-elev-2)] rounded-lg text-[10.5px] overflow-auto">{`description,category,estimated_cost
"Replace kitchen cabinets",Kitchen,8500
"Roof shingles - full replacement",Roofing,12000
"Install new HVAC unit",HVAC,6500`}</pre>
              </details>

              {error && <p className="text-[11.5px] text-[color:var(--color-danger-text)]">{error}</p>}
            </div>
          )}

          {/* ── Seed tab ── */}
          {!items && tab === 'seed' && (
            <div className="space-y-4">
              <p className="text-[12px] text-[color:var(--color-text-dim)]">
                Quickly seed the scope table with budget numbers from this lead. You can break them out into individual line items later.
              </p>

              <div className="rounded-lg border border-[color:var(--color-line)] divide-y divide-[color:var(--color-line)]">
                {renovBudget > 0 && (
                  <div className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-[12px] font-medium text-[color:var(--color-text)]">Total Renovation Budget</p>
                      <p className="text-[11px] text-[color:var(--color-text-dim)]">From lead renovation_cost field</p>
                    </div>
                    <span className="text-[13px] font-semibold text-[color:var(--color-text)]">{fmtUSD(renovBudget)}</span>
                  </div>
                )}
                {renovLender > 0 && (
                  <div className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="text-[12px] font-medium text-[color:var(--color-text)]">Lender Renovation Escrow</p>
                      <p className="text-[11px] text-[color:var(--color-text-dim)]">Amount lender is financing toward reno</p>
                    </div>
                    <span className="text-[13px] font-semibold text-[color:var(--color-text)]">{fmtUSD(renovLender)}</span>
                  </div>
                )}
                {!renovBudget && !renovLender && (
                  <div className="px-4 py-6 text-center text-[12px] text-[color:var(--color-text-dim)] italic">
                    No renovation budget data found on this lead.
                  </div>
                )}
              </div>

              {seedItems.length > 0 && (
                <button
                  onClick={() => save(seedItems)}
                  disabled={saving}
                  className="px-4 py-2 text-[12px] font-semibold rounded-lg bg-[color:var(--color-accent)] text-white disabled:opacity-50 hover:opacity-90 transition-opacity"
                >
                  {saving ? 'Adding…' : `⊕ Add ${seedItems.length} item${seedItems.length > 1 ? 's' : ''} to scope`}
                </button>
              )}
              {error && <p className="text-[11.5px] text-[color:var(--color-danger-text)]">{error}</p>}
            </div>
          )}

          {/* ── Preview & edit parsed items ── */}
          {items && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[12px] text-[color:var(--color-text-dim)]">
                  {items.length} item{items.length !== 1 ? 's' : ''} parsed — review and edit before importing.
                </p>
                <button onClick={() => setItems(null)} className="text-[11.5px] text-[color:var(--color-accent-text)] hover:underline">
                  ← Back
                </button>
              </div>

              <div className="overflow-x-auto rounded-lg border border-[color:var(--color-line)]">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)]">
                      <th className="text-left px-3 py-2 w-28">Category</th>
                      <th className="text-left px-3 py-2">Description</th>
                      <th className="text-right px-3 py-2 w-28">Est. Cost</th>
                      <th className="w-8 px-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, idx) => (
                      <tr key={idx} className="border-b border-[color:var(--color-line)] last:border-0">
                        <td className="px-2 py-1">
                          <select
                            value={it.category}
                            onChange={e => updateItem(idx, 'category', e.target.value)}
                            className="w-full h-7 px-1 text-[11px] rounded bg-[color:var(--color-bg-input)] border border-[color:var(--color-line)] text-[color:var(--color-text)] focus:outline-none"
                          >
                            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1">
                          <input
                            value={it.description}
                            onChange={e => updateItem(idx, 'description', e.target.value)}
                            className="w-full h-7 px-2 text-[11px] rounded bg-[color:var(--color-bg-input)] border border-[color:var(--color-line)] text-[color:var(--color-text)] focus:outline-none"
                          />
                        </td>
                        <td className="px-2 py-1 text-right">
                          <input
                            type="number"
                            value={it.estimated_cost}
                            onChange={e => updateItem(idx, 'estimated_cost', e.target.value)}
                            className="w-24 h-7 px-2 text-[11px] text-right rounded bg-[color:var(--color-bg-input)] border border-[color:var(--color-line)] text-[color:var(--color-text)] focus:outline-none"
                          />
                        </td>
                        <td className="px-2 py-1 text-center">
                          <button onClick={() => removeItem(idx)} className="text-[color:var(--color-text-dim)] hover:text-[color:var(--color-danger-text)] text-[13px]">×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-[color:var(--color-line)] font-semibold bg-[color:var(--color-bg-elev-2)]">
                      <td colSpan={2} className="px-3 py-2 text-[11px] text-[color:var(--color-text-dim)]">Total</td>
                      <td className="px-3 py-2 text-right text-[12px]">{fmtUSD(total)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>

              {error && <p className="text-[11.5px] text-[color:var(--color-danger-text)]">{error}</p>}

              <div className="flex gap-2">
                <button
                  onClick={() => save(items)}
                  disabled={saving || !items.length}
                  className="px-4 py-2 text-[12px] font-semibold rounded-lg bg-[color:var(--color-accent)] text-white disabled:opacity-50 hover:opacity-90 transition-opacity"
                >
                  {saving ? 'Saving…' : `Import ${items.length} item${items.length !== 1 ? 's' : ''}`}
                </button>
                <button onClick={() => setItems(null)} className="px-4 py-2 text-[12px] rounded-lg border border-[color:var(--color-line)] text-[color:var(--color-text-dim)] hover:text-[color:var(--color-text)] transition-colors">
                  Back
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
