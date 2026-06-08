// src/components/lead-detail/DealImportModal.jsx
// Parses a CSV export of the HatInvestors Flip Analysis Calculator and pre-fills deal_financials.
import { useState, useRef } from 'react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'

// Maps known label text from the PDF template → deal_financials field names
const FIELD_MAP = {
  'selling cost %':           'selling_cost_pct',
  'loan to purchase %':       'loan_to_purchase_pct',
  'renovation financing':     'renovation_financing',
  'points charged on':        'points_charged_on',
  'renovation lender':        'renovation_lender_amount',
  'purchase price':           'purchase_price_actual',
  'expected hold time (months)': 'hold_months',
  'conservative selling price':  'conservative_sell_price',
  'expected selling price':      'expected_sell_price',
  'optimistic selling price':    'optimistic_sell_price',
  'interest rate (annual)':      'interest_rate_annual',
  'points %':                    'points_pct',
  'tilte lender insurance':      'title_lender_insurance',
  'title lender insurance':      'title_lender_insurance',
  'interest potion':             'interest_portion',
  'interest portion':            'interest_portion',
  'document stamps mortgage':    'doc_stamps_mortgage',
  'intangible tax':              'intangible_tax',
  'extention':                   'extension_fee',
  'extension':                   'extension_fee',
  'title & closing costs':       'title_closing_costs',
  'insurance during hold':       'insurance_monthly',
  'utilities during hold':       'utilities_monthly',
  'taxes during hold':           'taxes_monthly',
  'hoa during hold':             'hoa_monthly',
  'miscellaneous holding costs': 'misc_holding_monthly',
}

function parseCSV(text) {
  return text.split('\n').map(row => {
    // Simple CSV split — handles basic quoting
    const cols = []
    let cur = '', inQ = false
    for (let i = 0; i < row.length; i++) {
      const ch = row[i]
      if (ch === '"') { inQ = !inQ }
      else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = '' }
      else { cur += ch }
    }
    cols.push(cur.trim())
    return cols
  }).filter(r => r.some(c => c))
}

function extractFields(rows) {
  const result = {}
  for (const row of rows) {
    const label = (row[0] || '').toLowerCase().trim()
    const value = (row[1] || '').trim()
    if (!label || !value) continue
    const field = FIELD_MAP[label]
    if (field) result[field] = value
  }
  return result
}

export default function DealImportModal({ open, onClose, onApply }) {
  const [parsed, setParsed]   = useState(null)
  const [error, setError]     = useState(null)
  const fileRef               = useRef(null)

  const handleFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const rows   = parseCSV(ev.target.result)
        const fields = extractFields(rows)
        if (Object.keys(fields).length === 0) {
          setError('No recognizable fields found. Make sure this is a CSV export of the HatInvestors template.')
          return
        }
        setParsed(fields)
      } catch {
        setError('Failed to parse CSV file.')
      }
    }
    reader.readAsText(file)
  }

  const handleApply = () => {
    if (!parsed) return
    onApply(parsed)
    setParsed(null)
    onClose()
  }

  const DISPLAY_LABELS = Object.entries(FIELD_MAP).reduce((acc, [label, field]) => {
    if (!acc[field]) acc[field] = label.replace(/(^\w|\s\w)/g, m => m.toUpperCase())
    return acc
  }, {})

  return (
    <Modal
      open={open}
      onClose={() => { setParsed(null); setError(null); onClose() }}
      title="Import from CSV"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={() => { setParsed(null); setError(null); onClose() }}>Cancel</Button>
          <Button onClick={handleApply} disabled={!parsed}>Apply to form</Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-[12px] text-[color:var(--color-text-dim)] leading-relaxed">
          Export your HatInvestors Flip Analysis Calculator as <strong>.csv</strong> (File → Download → CSV), then upload it here. The fields will be pre-filled for review — nothing is saved until you click Save.
        </p>

        <div>
          <label className="text-[11px] font-medium uppercase tracking-wide text-[color:var(--color-text-muted)] block mb-1">
            CSV File
          </label>
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            onChange={handleFile}
            className="text-[12px] text-[color:var(--color-text)] file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:text-[11px] file:bg-[color:var(--color-bg-elev-2)] file:text-[color:var(--color-text-muted)] hover:file:opacity-80 cursor-pointer"
          />
        </div>

        {error && (
          <div className="text-[12px] text-[color:var(--color-danger-text)] bg-[color:var(--color-danger-soft)] px-3 py-2 rounded">
            {error}
          </div>
        )}

        {parsed && (
          <div>
            <p className="text-[11px] text-[color:var(--color-success-text)] mb-2">
              ✓ Found {Object.keys(parsed).length} fields. Review below then click "Apply to form".
            </p>
            <div className="border border-[color:var(--color-line)] rounded overflow-hidden max-h-64 overflow-y-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="bg-[color:var(--color-bg-elev-2)] border-b border-[color:var(--color-line)]">
                    <th className="text-left px-3 py-1.5 text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Field</th>
                    <th className="text-left px-3 py-1.5 text-[10px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(parsed).map(([field, value]) => (
                    <tr key={field} className="border-b border-[color:var(--color-line)]">
                      <td className="px-3 py-1 text-[color:var(--color-text-dim)]">{DISPLAY_LABELS[field] || field}</td>
                      <td className="px-3 py-1 text-[color:var(--color-text)] font-medium">{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
