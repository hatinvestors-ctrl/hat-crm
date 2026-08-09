import { useState } from 'react'
import Button from '../ui/Button'
import Select from '../ui/Select'
import { supabase } from '../../lib/supabase'
import { calculateMAO } from '../../lib/calculations'
import { DEFAULT_CLOSING_COSTS, DEFAULT_TARGET_PROFIT } from '../../lib/constants'
import { buildZillowUrl } from '../../lib/zillow'
import { normalizeAddress, normalizeAddressForDB } from '../../lib/leadDedup'
import { recordPropertyEvent } from '../../lib/propertyIntelligence'
import { isSafeHttpUrl } from '../../lib/urlSafety'

const LEAD_FIELDS = [
  { value: '', label: '— Skip —' },
  { value: 'address', label: 'Address (required)' },
  { value: 'city', label: 'City' },
  { value: 'state', label: 'State' },
  { value: 'zip_code', label: 'Zip Code' },
  { value: 'seller_name', label: 'Seller Name' },
  { value: 'phone', label: 'Phone' },
  { value: 'email', label: 'Email' },
  { value: 'lead_source', label: 'Lead Source' },
  { value: 'asking_price', label: 'Asking Price' },
  { value: 'arv', label: 'ARV' },
  { value: 'renovation_cost', label: 'Renovation Cost' },
  { value: 'offer_price', label: 'Offer Price' },
  { value: 'rent_estimate', label: 'Rent Estimate' },
  { value: 'bedrooms', label: 'Bedrooms' },
  { value: 'bathrooms', label: 'Bathrooms' },
  { value: 'sqft', label: 'Sqft' },
  { value: 'year_built', label: 'Year Built' },
  { value: 'property_type', label: 'Property Type' },
  { value: 'notes', label: 'Notes' },
  { value: 'zillow_url', label: 'Zillow URL' },
]

function parseCSV(text) {
  const rows = []
  let current = []
  let field = ''
  let inQuotes = false
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue }
      if (c === '"') { inQuotes = false; i++; continue }
      field += c; i++; continue
    }
    if (c === '"') { inQuotes = true; i++; continue }
    if (c === ',') { current.push(field); field = ''; i++; continue }
    if (c === '\r') { i++; continue }
    if (c === '\n') { current.push(field); rows.push(current); current = []; field = ''; i++; continue }
    field += c; i++
  }
  if (field.length || current.length) { current.push(field); rows.push(current) }
  return rows.filter(r => r.some(v => v !== ''))
}

export default function CSVImport({ workspaceId, userId, workspaceDefaults, onDone }) {
  const [rows, setRows] = useState([])
  const [headers, setHeaders] = useState([])
  const [mapping, setMapping] = useState({})
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null); setResult(null)
    try {
      const text = await file.text()
      const parsed = parseCSV(text)
      if (parsed.length < 2) throw new Error('CSV needs a header row and at least one data row.')
      const hdrs = parsed[0].map(h => h.trim())
      setHeaders(hdrs); setRows(parsed.slice(1))
      const auto = {}
      hdrs.forEach((h, idx) => {
        const norm = h.toLowerCase().replace(/[\s_-]+/g, '_')
        const match = LEAD_FIELDS.find(f => f.value === norm || f.label.toLowerCase().startsWith(norm))
        if (match?.value) auto[idx] = match.value
      })
      setMapping(auto)
    } catch (e) {
      setError(e.message)
    }
  }

  const handleImport = async () => {
    setImporting(true); setError(null); setResult(null)
    try {
      const addressIdx = Object.entries(mapping).find(([, v]) => v === 'address')?.[0]
      if (addressIdx === undefined) throw new Error('You must map at least the Address column.')

      const closingDefault = workspaceDefaults?.default_closing_costs ?? DEFAULT_CLOSING_COSTS
      const profitDefault = workspaceDefaults?.default_target_profit ?? DEFAULT_TARGET_PROFIT

      const records = rows
        .map(row => {
          const rec = {
            workspace_id: workspaceId, created_by: userId,
            closing_costs: closingDefault, target_profit: profitDefault,
            status: 'new_lead',
          }
          Object.entries(mapping).forEach(([colIdx, field]) => {
            if (!field) return
            let val = row[Number(colIdx)]?.trim()
            if (!val) return
            if (['asking_price','arv','renovation_cost','offer_price','rent_estimate','bathrooms'].includes(field)) {
              val = val.replace(/[$,]/g, '')
              const n = parseFloat(val)
              if (!isNaN(n)) rec[field] = n
            } else if (['bedrooms','sqft','year_built'].includes(field)) {
              const n = parseInt(val, 10)
              if (!isNaN(n)) rec[field] = n
            } else {
              rec[field] = val
            }
          })
          if (rec.arv) {
            const mao = calculateMAO(rec.arv, rec.renovation_cost || 0, rec.closing_costs, rec.target_profit)
            if (mao !== null) rec.mao = mao
          }
          // Drop any unsafe URL values (javascript:, data:, etc) silently
          ;['zillow_url','redfin_url','mls_url','photos_url'].forEach(k => {
            if (rec[k] && !isSafeHttpUrl(rec[k])) rec[k] = null
          })
          if (!rec.zillow_url && rec.address) {
            rec.zillow_url = buildZillowUrl(rec)
          }
          return rec
        })
        .filter(rec => rec.address)

      if (!records.length) throw new Error('No valid rows (Address column empty).')

      // De-duplicate against existing leads in this workspace
      const { data: existing } = await supabase
        .from('leads')
        .select('address')
        .eq('workspace_id', workspaceId)
      const existingSet = new Set((existing || []).map(l => normalizeAddressForDB(l.address)))
      const beforeDedup = records.length
      const duplicateRows = records.filter(r => existingSet.has(normalizeAddressForDB(r.address)))
      const deduped = records.filter(r => !existingSet.has(normalizeAddressForDB(r.address)))
      const duplicatesSkipped = beforeDedup - deduped.length

      // Property Intelligence: rows skipped here are re-encounters of an
      // address that already has a property/lead — append an event instead
      // of silently discarding the attempt. Fire-and-forget, never blocks import.
      duplicateRows.forEach(rec => {
        recordPropertyEvent({
          workspaceId, addressFields: rec, type: 'duplicate_attempt',
          content: 'CSV import row skipped — address already exists',
          metadata: { source: 'csv_import' },
        })
      })

      if (!deduped.length) {
        throw new Error(`All ${beforeDedup} rows are duplicates of existing leads. Nothing to import.`)
      }

      // Try bulk insert first; if any row hits the unique constraint, fall back to row-by-row
      let imported = 0
      let dbDuplicatesSkipped = 0
      const { data: bulkData, error: bulkErr } = await supabase.from('leads').insert(deduped).select('id')
      if (bulkErr && bulkErr.code === '23505') {
        // Fall back: insert one by one, skip constraint violations
        for (const rec of deduped) {
          const { data: rowData, error: rowErr } = await supabase.from('leads').insert(rec).select('id').single()
          if (rowErr?.code === '23505') {
            dbDuplicatesSkipped++
            recordPropertyEvent({
              workspaceId, addressFields: rec, type: 'duplicate_attempt',
              content: 'CSV import row skipped — address already exists',
              metadata: { source: 'csv_import' },
            })
          } else if (rowErr) {
            throw rowErr
          } else {
            imported++
            recordPropertyEvent({
              workspaceId, addressFields: rec, leadId: rowData?.id, type: 'lead_created',
              content: 'Lead created via CSV import', metadata: { source: 'csv_import' },
            })
          }
        }
      } else if (bulkErr) {
        throw bulkErr
      } else {
        imported = bulkData.length
        deduped.forEach(rec => {
          recordPropertyEvent({
            workspaceId, addressFields: rec, type: 'lead_created',
            content: 'Lead created via CSV import', metadata: { source: 'csv_import' },
          })
        })
      }

      setResult({
        imported,
        skipped: rows.length - records.length,
        duplicatesSkipped: duplicatesSkipped + dbDuplicatesSkipped,
      })
      onDone?.()
    } catch (e) {
      setError(e.message)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-[11px] uppercase tracking-wider font-medium text-[color:var(--color-text-muted)] mb-1.5">
          Select CSV file
        </label>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={handleFile}
          className="text-[12.5px] text-[color:var(--color-text-muted)] file:mr-3 file:px-3 file:h-7 file:rounded-md file:border file:border-[color:var(--color-line)] file:bg-[color:var(--color-bg-elev-2)] file:text-[color:var(--color-text)] file:cursor-pointer hover:file:bg-[color:var(--color-accent-soft)]"
        />
      </div>

      {error && <div className="p-2.5 bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-text)] text-[12px] rounded">{error}</div>}
      {result && (
        <div className="p-2.5 bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)] text-[12px] rounded">
          Imported {result.imported} lead{result.imported === 1 ? '' : 's'}.
          {result.skipped > 0 && ` Skipped ${result.skipped} (missing address).`}
          {result.duplicatesSkipped > 0 && ` Skipped ${result.duplicatesSkipped} duplicate address${result.duplicatesSkipped === 1 ? '' : 'es'}.`}
        </div>
      )}

      {headers.length > 0 && (
        <>
          <div className="bg-[color:var(--color-bg-elev-2)] border border-[color:var(--color-line)] rounded-lg p-4">
            <h3 className="text-[13px] font-semibold text-[color:var(--color-text)] mb-3">
              Map columns <span className="text-[color:var(--color-text-dim)] font-normal">· {rows.length} row{rows.length === 1 ? '' : 's'}</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {headers.map((h, idx) => (
                <Select
                  key={idx}
                  label={`Column: "${h}"`}
                  options={LEAD_FIELDS}
                  value={mapping[idx] || ''}
                  onChange={(e) => setMapping(prev => ({ ...prev, [idx]: e.target.value }))}
                />
              ))}
            </div>
          </div>

          <div className="bg-[color:var(--color-bg-elev-2)] border border-[color:var(--color-line)] rounded-lg p-4">
            <h3 className="text-[13px] font-semibold text-[color:var(--color-text)] mb-2">Preview · first 5 rows</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-[11.5px] border border-[color:var(--color-line)]">
                <thead>
                  <tr>{headers.map((h, i) => <th key={i} className="px-2 py-1.5 text-left bg-[color:var(--color-bg-elev)] border-b border-[color:var(--color-line)] text-[color:var(--color-text-muted)] font-medium">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.slice(0, 5).map((r, i) => (
                    <tr key={i} className="border-t border-[color:var(--color-line)]">
                      {r.map((c, j) => <td key={j} className="px-2 py-1.5 text-[color:var(--color-text)]">{c}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <Button onClick={handleImport} loading={importing}>Import {rows.length} Leads</Button>
        </>
      )}
    </div>
  )
}
