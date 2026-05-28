import fs from 'node:fs'

const PAT = 'sbp_781ad2a5c682ee39cd1c2855409c7352bd6c4d9f'
const PROJECT_REF = 'pyrgotfotmwazigewlke'

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  if (!r.ok) throw new Error(`SQL ${r.status}: ${await r.text()}`)
  return r.json()
}
const esc = (s) => s === null || s === undefined ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`
const numOrNull = (n) => (n === null || n === undefined || !isFinite(n)) ? 'NULL' : String(n)

// IMPROVED parser
function parse(body) {
  const compact = body.replace(/\s+/g, ' ')
  // Direct Redfin: "<addr>, <city>, <state> <zip> N Beds, N.N Baths, N Sq. Ft. Price: $X (Previous price: $Y)"
  const m = compact.match(/(\d+[^,]+?),\s*([A-Za-z][A-Za-z\s.'-]+?),\s*([A-Z]{2})\s+(\d{5})\s+(\d+)\s+Beds?,\s*(\d+(?:\.\d+)?)\s+Baths?,\s*([\d,]+)\s+Sq\.?\s*Ft\.\s*Price:\s*\$([\d,]+)(?:\s*\(Previous price:\s*\$([\d,]+)\))?/i)
  if (m) {
    return {
      address: m[1].trim().replace(/^[•*\s]+/, ''),
      city: m[2].trim(),
      state: m[3].trim(),
      zip: m[4].trim(),
      bedrooms: parseInt(m[5], 10),
      bathrooms: parseFloat(m[6]),
      sqft: parseInt(m[7].replace(/,/g, ''), 10),
      currentPrice: parseInt(m[8].replace(/,/g, ''), 10),
      previousPrice: m[9] ? parseInt(m[9].replace(/,/g, ''), 10) : null,
    }
  }
  return null
}

// Map of gmail message_id → lead_id (we already inserted)
const wrap = JSON.parse(fs.readFileSync('./_emails.json', 'utf8'))
const inner = JSON.parse(wrap[0].text)
const emails = Array.isArray(inner.results) ? inner.results : [inner.results]

// Get lead_ids from the processed_emails table
const processed = await sql(`SELECT message_id, lead_id, action FROM redfin_processed_emails`)
const map = Object.fromEntries(processed.map(p => [p.message_id, p]))

let updated = 0
for (const email of emails) {
  const rec = map[email.id]
  if (!rec || rec.action !== 'created_lead') continue  // skip the appended one
  const parsed = parse(email.body_plain || '')
  if (!parsed) { console.log(`Could not re-parse ${email.subject}`); continue }

  console.log(`\n📝 Updating ${rec.lead_id}: ${parsed.address}`)
  console.log(`   ${parsed.bedrooms}bd/${parsed.bathrooms}ba ${parsed.sqft}sqft, $${parsed.currentPrice} (prev $${parsed.previousPrice})`)

  const result = await sql(`
    UPDATE leads SET
      address = ${esc(parsed.address)},
      city = ${esc(parsed.city)},
      state = ${esc(parsed.state)},
      zip_code = ${esc(parsed.zip)},
      bedrooms = ${numOrNull(parsed.bedrooms)},
      bathrooms = ${numOrNull(parsed.bathrooms)},
      sqft = ${numOrNull(parsed.sqft)},
      asking_price = ${numOrNull(parsed.currentPrice)},
      notes = notes || E'\n\n=== PARSED DETAILS ===\nBeds: ${parsed.bedrooms} · Baths: ${parsed.bathrooms} · Sqft: ${parsed.sqft.toLocaleString()}\nCurrent: $${parsed.currentPrice.toLocaleString()}${parsed.previousPrice ? ` (was $${parsed.previousPrice.toLocaleString()})` : ''}'
    WHERE id = '${rec.lead_id}'
    RETURNING id, address, bedrooms, bathrooms, sqft, asking_price
  `)
  console.log(`   ✓`, JSON.stringify(result[0]))
  updated++
}
console.log(`\n${updated} leads updated.`)
