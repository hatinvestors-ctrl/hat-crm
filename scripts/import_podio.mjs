// Parses the Podio CSV export and emits a SQL INSERT block for HAT CRM.
// Usage: node scripts/import_podio.mjs <csv> <workspace_id> <user_id> > import.sql

import fs from 'node:fs'

const [, , csvPath, workspaceId, userId] = process.argv
if (!csvPath || !workspaceId || !userId) {
  console.error('Usage: node import_podio.mjs <csv> <workspace_id> <user_id>')
  process.exit(1)
}

// ── CSV parser (handles quoted fields with embedded newlines + escaped quotes) ──
function parseCSV(text) {
  const rows = []
  let cur = [], field = '', inQuotes = false, i = 0
  while (i < text.length) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue }
      if (c === '"') { inQuotes = false; i++; continue }
      field += c; i++; continue
    }
    if (c === '"') { inQuotes = true; i++; continue }
    if (c === ',') { cur.push(field); field = ''; i++; continue }
    if (c === '\r') { i++; continue }
    if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; i++; continue }
    field += c; i++
  }
  if (field || cur.length) { cur.push(field); rows.push(cur) }
  return rows.filter(r => r.some(v => v !== ''))
}

// ── SQL string escape ──
const SQL = (v) => {
  if (v === null || v === undefined || v === '') return 'NULL'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL'
  return "'" + String(v).replace(/'/g, "''") + "'"
}

const NUM = (v) => {
  if (v === null || v === undefined || v === '') return null
  const cleaned = String(v).replace(/[$,]/g, '').trim()
  const n = parseFloat(cleaned)
  return Number.isFinite(n) ? n : null
}

const INT = (v) => {
  const n = NUM(v)
  return n === null ? null : Math.round(n)
}

const DATE = (v) => {
  if (!v) return null
  const s = String(v).trim()
  // Match YYYY-MM-DD prefix (Podio dates are ISO)
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}

// ── Podio Lead Status → HAT CRM status ──
const STATUS_MAP = {
  'New Lead':                  'new_lead',
  'MAO Calculated':            'mao_calculated',
  'Offer Pending HAT Signing': 'offer_pending_hat_signing',
  'Offer Signed':              'offer_signed',
  'Offer Sent':                'offer_sent',
  'Negotiating':               'negotiating',
  'Follow Up':                 'follow_up',
  'Offer Accepted':            'offer_accepted',
  'Rejected / Not Accepted':   'rejected_not_accepted',
  'Sold':                      'sold',
  'Dead Lead':                 'dead_lead',
  'MoveToSequence':            'move_to_sequence',
  'Sequence Completed':        'sequence_completed',
  'Working Project':           'working_project',
  'Pending FollowUps':         'pending_followups',
  'Not In Our Buy BOX':        'not_in_buy_box',
  'AgentRel':                  'agent_rel',
  'Imported':                  'imported',
  'AutomatedOffers':           'automated_offers',
}

// ── Parse address. Handles full ("3624 Anvers Blvd, Jacksonville, FL 32210, USA")
//    and partial ("2211 Bayview Rd, Jacksonville") forms.
function parseAddress(s) {
  if (!s) return { address: null, city: null, state: null, zip_code: null }
  let parts = s.split(',').map(p => p.trim()).filter(Boolean)
  if (parts.length && /^USA?$/i.test(parts[parts.length - 1])) parts.pop()

  let state = null, zip_code = null, city = null, address = null

  if (parts.length) {
    const last = parts[parts.length - 1]
    const stateZip = last.match(/^([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/)
    const stateOnly = last.match(/^([A-Z]{2})$/)
    const zipOnly = last.match(/^(\d{5}(?:-\d{4})?)$/)
    if (stateZip)   { state = stateZip[1]; zip_code = stateZip[2]; parts.pop() }
    else if (stateOnly) { state = stateOnly[1]; parts.pop() }
    else if (zipOnly)   { zip_code = zipOnly[1]; parts.pop() }
  }

  if (parts.length >= 2) {
    city = parts.pop()
    address = parts.join(', ')
  } else if (parts.length === 1) {
    address = parts[0]
  }

  return { address, city, state, zip_code }
}

// ── Strip image markdown / shields.io junk from notes ──
function cleanNotes(s) {
  if (!s) return null
  return String(s)
    .replace(/!\[image\]\(https:\/\/img\.shields\.io[^)]*\)/g, '')
    .replace(/^\s+|\s+$/g, '')
    || null
}

const raw = fs.readFileSync(csvPath, 'utf8')
const rows = parseCSV(raw)
const headers = rows[0].map(h => h.trim())
const dataRows = rows.slice(1)

// Build a header → index map
const H = Object.fromEntries(headers.map((h, i) => [h, i]))
const col = (row, name) => (H[name] != null ? row[H[name]] : '')

// All target columns in deterministic order
const COLUMNS = [
  'workspace_id','created_by','assigned_to',
  'address','city','state','zip_code',
  'seller_name','phone','email','lead_source',
  'asking_price','arv','conservative_arv','aggressive_arv',
  'renovation_cost','rent_estimate','mao',
  'bedrooms','bathrooms','sqft','year_built',
  'lot_size_sqft','has_garage',
  'zillow_url',
  'status','follow_up_date','contract_signed_date','notes',
]

function parseGarage(s) {
  if (!s) return null
  const v = String(s).trim().toLowerCase()
  if (['yes','y','true','1'].includes(v)) return true
  if (['no','n','false','0'].includes(v)) return false
  return null
}

function parseLotSize(s) {
  if (!s) return null
  const str = String(s).trim().toLowerCase()
  const n = parseFloat(str.replace(/[^\d.]/g, ''))
  if (!Number.isFinite(n) || n <= 0) return null
  if (str.includes('acre')) return Math.round(n * 43560)  // acres → sqft
  return Math.round(n)
}

const valueRows = []
let imported = 0, skipped = 0

for (const row of dataRows) {
  const propertyAddress = col(row, 'Property Address')?.trim()
  if (!propertyAddress) { skipped++; continue }

  const { address, city, state, zip_code } = parseAddress(propertyAddress)
  if (!address) { skipped++; continue }
  const statusRaw = col(row, 'Lead Status')?.trim()
  const status = STATUS_MAP[statusRaw] || 'imported'

  const lead = {
    workspace_id: workspaceId,
    created_by: userId,
    assigned_to: userId,
    address,
    city: city || 'Jacksonville',
    state: state || 'FL',
    zip_code,
    seller_name: col(row, 'Full Name')?.trim() || col(row, 'Agent Name')?.trim() || null,
    phone: col(row, 'Formatted Phone')?.trim()
        || col(row, ' Selling POC Phone - Mobile')?.trim()
        || col(row, 'Agent Phone')?.trim()
        || null,
    email: col(row, 'Email')?.trim() || col(row, 'Agent Email')?.trim() || null,
    lead_source: 'imported',
    asking_price: NUM(col(row, "Seller's Ideal Price - amount")),
    arv:              NUM(col(row, 'ARV – Realistic - amount')),
    conservative_arv: NUM(col(row, 'ARV – Conservative - amount')),
    aggressive_arv:   NUM(col(row, 'ARV – Optimistic - amount')),
    renovation_cost:  NUM(col(row, 'Rehab Estimation - amount')),
    rent_estimate:    NUM(col(row, 'Estimated Rent  - amount')),
    mao:              NUM(col(row, 'MAO - amount')),
    bedrooms:  INT(col(row, 'Bedrooms')),
    bathrooms: NUM(col(row, 'Bathrooms')),
    sqft:      INT(col(row, 'Property Size (Sq. Ft.)')),
    year_built:INT(col(row, 'Year Built')),
    lot_size_sqft: parseLotSize(col(row, 'Lot Size')),
    has_garage:    parseGarage(col(row, 'Garage?')),
    zillow_url: col(row, 'Zillow Link')?.trim() || null,
    status,
    follow_up_date:       DATE(col(row, 'Follow Up Date - start')),
    contract_signed_date: DATE(col(row, 'Offer Accepted Date - start')),
    notes: cleanNotes(col(row, 'Notes')),
  }

  const vals = COLUMNS.map(k => {
    const v = lead[k]
    if (v === null || v === undefined || v === '') return 'NULL'
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL'
    return SQL(v)
  })
  valueRows.push(`  (${vals.join(', ')})`)
  imported++
}

console.log('-- HAT CRM bulk import from Podio export')
console.log(`-- Source: ${csvPath}`)
console.log(`-- Imported: ${imported}    Skipped (missing/empty address): ${skipped}`)
console.log('')
console.log(`INSERT INTO leads (${COLUMNS.join(', ')}) VALUES`)
console.log(valueRows.join(',\n') + ';')
console.error(`\n✓ Generated single bulk INSERT with ${imported} rows (${skipped} skipped)`)
