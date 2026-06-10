// import-podio-leads.mjs
// Imports the Podio "Kevin HAT Pipeline - ALL FU" CSV into HatCRM Supabase

import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const SUPABASE_URL = 'https://pyrgotfotmwazigewlke.supabase.co'
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB5cmdvdGZvdG13YXppZ2V3bGtlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODQ0Mjc5MSwiZXhwIjoyMDk0MDE4NzkxfQ.9PjYMel7EAA4UApOliE0y4p49eEETCIxnx1aep99vSU'
const WORKSPACE_ID = 'd854b1e3-b174-45f7-b11d-1b92d8e7b87d'

// ── CSV parser that handles quoted fields with embedded newlines ──────────────
function parseCSV(text) {
  // Strip BOM
  text = text.replace(/^﻿/, '')
  const rows = []
  let row = [], field = '', inQ = false, i = 0
  while (i < text.length) {
    const c = text[i]
    if (inQ) {
      if (c === '"' && text[i+1] === '"') { field += '"'; i += 2; continue }
      if (c === '"') { inQ = false; i++; continue }
      field += c; i++; continue
    }
    if (c === '"') { inQ = true; i++; continue }
    if (c === ',') { row.push(field); field = ''; i++; continue }
    if (c === '\r') { i++; continue }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue }
    field += c; i++
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows.filter(r => r.some(v => v.trim() !== ''))
}

// ── Address parser ────────────────────────────────────────────────────────────
function parseAddress(raw) {
  if (!raw) return { address: '', city: '', state: 'FL', zip_code: '' }
  // Remove trailing ", USA"
  let s = raw.replace(/,\s*USA\s*$/i, '').trim()
  // Split on commas
  const parts = s.split(',').map(p => p.trim())
  if (parts.length >= 3) {
    const address = parts[0]
    const city    = parts[1]
    // last part may be "FL 32244" or "FL"
    const last    = parts[parts.length - 1]
    const stateZip = last.trim().split(/\s+/)
    const state   = stateZip[0] || 'FL'
    const zip_code = stateZip[1] || ''
    return { address, city, state, zip_code }
  }
  // Fallback: use whole thing as address
  return { address: s, city: '', state: 'FL', zip_code: '' }
}

// ── Field helpers ─────────────────────────────────────────────────────────────
function num(v) {
  if (!v) return null
  const n = parseFloat(v.replace(/[,$]/g, ''))
  return isNaN(n) ? null : n
}

function cleanNotes(v) {
  if (!v) return null
  // Remove shield.io badge markdown
  return v.replace(/!\[image\]\(https:\/\/img\.shields\.io[^)]+\)/g, '').trim() || null
}

function parseDate(v) {
  if (!v || !v.match(/^\d{4}-\d{2}-\d{2}/)) return null
  return v.slice(0, 10)
}

// ── Column indices (0-based) ──────────────────────────────────────────────────
const C = {
  address:        0,
  agentName:      1,
  temp:           13,
  zillow:         14,
  dealCheck:      15,
  type:           17,
  contact:        18,
  agentNameField: 19,
  agentPhone:     20,
  agentEmail:     21,
  status:         32,
  followUpStart:  34,
  submittedStart: 36,
  acceptedStart:  38,
  notes:          40,
  sellerPrice:    44,
  arvConserv:     46,
  arvRealistic:   48,
  arvOptimistic:  50,
  rent:           52,
  rehab:          54,
  mao:            56,
  bedrooms:       58,
  bathrooms:      59,
  garage:         60,
  yearBuilt:      61,
  sqft:           62,
  lotSize:        63,
  occupancy:      64,
}

// ── Main ──────────────────────────────────────────────────────────────────────
const __dir = dirname(fileURLToPath(import.meta.url))
const csvPath = join(__dir, 'Kevin HAT Pipeline - ALL FU.csv')
const csvText = readFileSync(csvPath, 'utf-8')
const rows = parseCSV(csvText)

// First row is headers
const dataRows = rows.slice(1).filter(r => r[C.address]?.trim())

console.log(`Parsed ${dataRows.length} data rows`)

// Deduplicate by address (keep last occurrence per address since later rows have more notes)
const seen = new Map()
for (const row of dataRows) {
  const addr = row[C.address]?.trim()
  if (addr) seen.set(addr, row)
}
const uniqueRows = Array.from(seen.values())
console.log(`After dedup: ${uniqueRows.length} unique addresses`)

// ── Transform rows to lead records ───────────────────────────────────────────
const leads = uniqueRows.map(row => {
  const { address, city, state, zip_code } = parseAddress(row[C.address])

  // ARV: prefer realistic, fallback to conservative, fallback to optimistic
  let arv = num(row[C.arvRealistic]) || num(row[C.arvConserv]) || num(row[C.arvOptimistic]) || null
  // Sanity check: ARVs entered as 230/240/250 instead of 230000 are bad data
  if (arv && arv < 1000) arv = arv * 1000

  const maoVal = num(row[C.mao])
  const rehabVal = num(row[C.rehab])

  // Notes: combine Podio notes + type info + submitted/accepted dates
  const rawNotes = cleanNotes(row[C.notes]) || ''
  const typeLine = row[C.type]?.trim() ? `[Type: ${row[C.type].trim()}]` : ''
  const submittedLine = parseDate(row[C.submittedStart]) ? `[Offer submitted: ${parseDate(row[C.submittedStart])}]` : ''
  const acceptedLine  = parseDate(row[C.acceptedStart])  ? `[Offer accepted: ${parseDate(row[C.acceptedStart])}]`   : ''
  const notesParts = [typeLine, submittedLine, acceptedLine, rawNotes].filter(Boolean)
  const notes = notesParts.join('\n').trim() || null

  // Garage
  const garageStr = row[C.garage]?.trim()
  const has_garage = garageStr === 'Yes' ? true : garageStr === 'No' ? false : null

  // Year built
  const ybStr = row[C.yearBuilt]?.trim()
  const year_built = ybStr && /^\d{4}$/.test(ybStr) ? parseInt(ybStr) : null

  // Sqft
  const sqftStr = row[C.sqft]?.trim()
  const sqft = sqftStr && !isNaN(parseInt(sqftStr)) ? parseInt(sqftStr) : null

  // Bedrooms / bathrooms
  const bedroomsStr = row[C.bedrooms]?.trim()
  const bathroomsStr = row[C.bathrooms]?.trim()
  const bedrooms = bedroomsStr && !isNaN(parseInt(bedroomsStr)) ? parseInt(bedroomsStr) : null
  const bathrooms = bathroomsStr ? parseFloat(bathroomsStr) : null

  // Listing agent info
  const listing_agent_name  = row[C.agentNameField]?.trim() || null
  const listing_agent_phone = row[C.agentPhone]?.trim() || null
  const listing_agent_email = row[C.agentEmail]?.trim() || null

  // Lead source: if contact is "Agent" → mls
  const contactType = row[C.contact]?.trim()
  const lead_source = contactType === 'Agent' ? 'mls' : null

  // Zillow URL (validate)
  const zillowRaw = row[C.zillow]?.trim()
  const zillow_url = zillowRaw && zillowRaw.startsWith('http') ? zillowRaw : null

  return {
    workspace_id:         WORKSPACE_ID,
    address,
    city:                 city || null,
    state:                state || 'FL',
    zip_code:             zip_code || null,
    status:               'follow_up',
    is_hot:               row[C.temp]?.trim() === 'Hot',
    follow_up_date:       parseDate(row[C.followUpStart]),
    arv:                  arv,
    renovation_cost:      rehabVal,
    mao:                  maoVal,
    asking_price:         num(row[C.sellerPrice]),
    rent_estimate:        num(row[C.rent]),
    bedrooms,
    bathrooms,
    has_garage,
    year_built,
    sqft,
    notes,
    zillow_url,
    lead_source,
    listing_agent_name,
    listing_agent_phone,
    listing_agent_email,
  }
})

console.log(`Prepared ${leads.length} leads for import`)
console.log(`Hot leads: ${leads.filter(l => l.is_hot).length}`)
console.log(`With follow-up dates: ${leads.filter(l => l.follow_up_date).length}`)
console.log(`With ARV: ${leads.filter(l => l.arv).length}`)
console.log(`With MAO: ${leads.filter(l => l.mao).length}`)

// ── Insert into Supabase ──────────────────────────────────────────────────────
const res = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
  method: 'POST',
  headers: {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal',
  },
  body: JSON.stringify(leads),
})

if (!res.ok) {
  const err = await res.text()
  console.error('❌ Insert failed:', res.status, err)
  process.exit(1)
}

console.log(`✅ Successfully imported ${leads.length} leads into HatCRM!`)
