import fs from 'node:fs'

const PAT = 'sbp_781ad2a5c682ee39cd1c2855409c7352bd6c4d9f'
const PROJECT_REF = 'pyrgotfotmwazigewlke'
const WORKSPACE = 'd854b1e3-b174-45f7-b11d-1b92d8e7b87d'
const USER = 'ee6d7325-6d42-4fbf-bf19-e2235c6f9e88'

const raw = fs.readFileSync('./_emails.json', 'utf8')
const wrap = JSON.parse(raw)
const inner = JSON.parse(wrap[0].text)
const emails = Array.isArray(inner.results) ? inner.results : (inner.results ? [inner.results] : [])

// ── SQL helper ─────────────────────────────────────────
async function sql(query, params = {}) {
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

// ── Address normalization (for duplicate detection) ─────
function normalize(s) {
  if (!s) return ''
  let n = String(s).toLowerCase().replace(/[.,#]/g, '').replace(/\s+/g, ' ').trim()
  const map = [
    [/\b(st|str)\b\.?/g, 'street'],
    [/\b(rd)\b\.?/g, 'road'],
    [/\b(dr)\b\.?/g, 'drive'],
    [/\b(ave|av)\b\.?/g, 'avenue'],
    [/\b(blvd)\b\.?/g, 'boulevard'],
    [/\b(ln)\b\.?/g, 'lane'],
    [/\b(ct)\b\.?/g, 'court'],
    [/\b(cir)\b\.?/g, 'circle'],
    [/\b(pkwy)\b\.?/g, 'parkway'],
    [/\b(ter)\b\.?/g, 'terrace'],
    [/\b(pl)\b\.?/g, 'place'],
    [/\b(trl)\b\.?/g, 'trail'],
  ]
  map.forEach(([re, rep]) => { n = n.replace(re, rep) })
  return n.replace(/\s+/g, ' ').trim()
}

// ── Subject → trigger type ──────────────────────────────
function triggerType(subject = '') {
  const s = subject.toLowerCase()
  if (/price (decrease|drop|reduc)/.test(s)) return 'price_drop'
  if (/back on market/.test(s)) return 'back_on_market'
  if (/new listing/.test(s)) return 'new_listing'
  if (/open house/.test(s)) return 'open_house'
  if (/coming soon/.test(s)) return 'coming_soon'
  if (/(days on market|100 days)/.test(s)) return 'stale_listing'
  return 'generic_alert'
}

// ── Parser ──────────────────────────────────────────────
function parseBody(body, subject) {
  // Subject form: "Price decrease to $278K on 1232 Rensselaer Ave"
  // or "Fwd: Price decrease to $278K on 1232 Rensselaer Ave"
  let subjectAddress = null
  const subjAddrMatch = subject.match(/(?:on\s+)([\d#A-Za-z][^"]+?)$/i)
  if (subjAddrMatch) subjectAddress = subjAddrMatch[1].trim().replace(/^Fwd:\s*/i, '')

  // Look for full address line: "1232 Rensselaer Ave, Jacksonville, FL 32205"
  // Try several patterns
  const addrRe = /(\d+[^,\n]+?),\s*([A-Za-z][A-Za-z\s.'-]+?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/g
  const matches = [...body.matchAll(addrRe)]
  let address = null, city = null, state = null, zip = null
  if (matches.length) {
    // Use the first address that matches subjectAddress if possible
    const wanted = subjectAddress ? subjectAddress.toLowerCase() : null
    const m = matches.find(m => wanted && m[1].toLowerCase().includes(wanted.split(' ').slice(0,3).join(' '))) || matches[0]
    address = m[1].trim().replace(/^\s*•?\s*/, '')
    city    = m[2].trim()
    state   = m[3].trim()
    zip     = m[4].trim()
  } else if (subjectAddress) {
    address = subjectAddress.trim()
  }

  // Look for "$XXX,XXX $XXX,XXX  N Beds · N Baths · NNN Sq. Ft."
  let currentPrice = null, previousPrice = null, bedrooms = null, bathrooms = null, sqft = null
  const priceBlock = body.match(/\$([\d,]+)\s+\$([\d,]+)?\s*(\d+)\s+Beds?\s*[·•]\s*(\d+(?:\.\d+)?)\s+Baths?\s*[·•]\s*([\d,]+)\s+Sq\.?\s*Ft/i)
  if (priceBlock) {
    currentPrice = parseInt(priceBlock[1].replace(/,/g, ''), 10)
    previousPrice = priceBlock[2] ? parseInt(priceBlock[2].replace(/,/g, ''), 10) : null
    bedrooms = parseInt(priceBlock[3], 10)
    bathrooms = parseFloat(priceBlock[4])
    sqft = parseInt(priceBlock[5].replace(/,/g, ''), 10)
  } else {
    // Try simpler: just the first price + beds/baths/sqft
    const simple = body.match(/\$([\d,]+)\s+(\d+)\s+Beds?\s*[·•]\s*(\d+(?:\.\d+)?)\s+Baths?\s*[·•]\s*([\d,]+)\s+Sq\.?\s*Ft/i)
    if (simple) {
      currentPrice = parseInt(simple[1].replace(/,/g, ''), 10)
      bedrooms = parseInt(simple[2], 10)
      bathrooms = parseFloat(simple[3])
      sqft = parseInt(simple[4].replace(/,/g, ''), 10)
    }
    // Subject often has the price: "Price decrease to $278K"
    if (!currentPrice) {
      const subjPrice = subject.match(/\$(\d+(?:\.\d+)?)([KkMm])?/)
      if (subjPrice) {
        let n = parseFloat(subjPrice[1])
        if (subjPrice[2]?.toLowerCase() === 'k') n *= 1000
        if (subjPrice[2]?.toLowerCase() === 'm') n *= 1000000
        currentPrice = Math.round(n)
      }
    }
  }

  // Lot size: "6,534 sq ft lot"
  let lotSqft = null
  const lotMatch = body.match(/([\d,]+)\s*sq\s*ft\s*lot/i)
  if (lotMatch) lotSqft = parseInt(lotMatch[1].replace(/,/g, ''), 10)

  return { address, city, state, zip, currentPrice, previousPrice, bedrooms, bathrooms, sqft, lotSqft }
}

function zillowUrl(address, city, state, zip) {
  const slug = [address, city, state, zip].filter(Boolean).join(' ').replace(/[.,#]/g, '').replace(/\s+/g, '-')
  return `https://www.zillow.com/homes/${encodeURIComponent(slug)}_rb/`
}

// ── Already processed message IDs ───────────────────────
const already = (await sql(`SELECT message_id FROM redfin_processed_emails WHERE processed_at > NOW() - INTERVAL '14 days'`)).map(r => r.message_id)
const alreadySet = new Set(already)
console.log(`Already processed: ${alreadySet.size}`)

const stats = { scanned: 0, created: 0, appended: 0, skipped_dup: 0, skipped_processed: 0, skipped_unparsed: 0 }

for (const email of emails) {
  stats.scanned++
  if (alreadySet.has(email.id)) { stats.skipped_processed++; continue }

  const from = typeof email.from === 'object' ? email.from.email : email.from
  const isRedfinSender = /listings@redfin\.com/i.test(from || '') ||
                         /listings@redfin\.com/i.test(email.body_plain || '')
  if (!isRedfinSender) { stats.skipped_unparsed++; continue }

  const trigger = triggerType(email.subject || '')
  const parsed = parseBody(email.body_plain || '', email.subject || '')
  if (!parsed.address) { stats.skipped_unparsed++; continue }

  console.log(`\n📨 ${email.subject}`)
  console.log(`   Parsed: ${parsed.address}, ${parsed.city || '?'}, ${parsed.state || '?'} ${parsed.zip || '?'}`)
  console.log(`   $${parsed.currentPrice} (prev $${parsed.previousPrice}) ${parsed.bedrooms}bd/${parsed.bathrooms}ba ${parsed.sqft}sqft lot=${parsed.lotSqft}`)
  console.log(`   trigger=${trigger}`)

  // Dedup check
  const norm = normalize(parsed.address)
  const dupResult = await sql(`SELECT id, status FROM leads WHERE workspace_id = '${WORKSPACE}' AND lower(regexp_replace(address, '[.,#]', '', 'g')) ILIKE '${norm.split(' ').slice(0,2).join(' ')}%' LIMIT 5`)
  const existing = dupResult.find(r => {
    // Loose match — would need re-fetch of address; for now match by prefix is ok
    return true
  })

  // Better: do a precise check via separate query
  let existingId = null
  if (dupResult.length) {
    // Re-fetch full addresses
    const ids = dupResult.map(r => `'${r.id}'`).join(',')
    const fullRows = await sql(`SELECT id, address FROM leads WHERE id IN (${ids})`)
    for (const r of fullRows) {
      if (normalize(r.address) === norm) { existingId = r.id; break }
    }
  }

  const priceHistory = parsed.previousPrice && parsed.previousPrice !== parsed.currentPrice
    ? `Price dropped from $${parsed.previousPrice.toLocaleString()} to $${parsed.currentPrice.toLocaleString()}.`
    : (parsed.currentPrice ? `Listed at $${parsed.currentPrice.toLocaleString()}.` : '')

  const triggerLabels = {
    price_drop: '💸 Price Drop',
    new_listing: '🆕 New Listing',
    back_on_market: '🔄 Back on Market',
    open_house: '🏠 Open House',
    coming_soon: '🔮 Coming Soon',
    stale_listing: '⏰ Stale Listing',
    generic_alert: '📨 Redfin Alert',
  }
  const tlabel = triggerLabels[trigger] || trigger

  if (existingId) {
    // Append activity instead of creating duplicate
    const content = `🤖 Redfin alert: ${tlabel} · ${priceHistory}`
    await sql(`
      INSERT INTO lead_activities (lead_id, user_id, type, content, metadata)
      VALUES (
        '${existingId}', '${USER}', 'activity',
        ${esc(content)},
        '{"source":"redfin_auto","trigger_type":"${trigger}","message_id":"${email.id}","price_current":${parsed.currentPrice || 'null'},"price_previous":${parsed.previousPrice || 'null'}}'::jsonb
      )
    `)
    await sql(`
      INSERT INTO redfin_processed_emails (message_id, workspace_id, lead_id, action, trigger_type, address)
      VALUES ('${email.id}', '${WORKSPACE}', '${existingId}', 'appended_activity', '${trigger}', ${esc(parsed.address)})
      ON CONFLICT (message_id) DO NOTHING
    `)
    console.log(`   ✓ Appended activity to existing lead ${existingId}`)
    stats.appended++
  } else {
    // Insert new triage lead
    const notes = `🤖 Auto-imported from Redfin (${tlabel}).\n\n${priceHistory}\n\nFrom: ${from}\nSubject: ${email.subject}\nReceived: ${email.date}\nGmail message ID: ${email.id}\n\n=== ORIGINAL EMAIL BODY (excerpt) ===\n${(email.body_plain || '').slice(0, 1500).replace(/\s+/g, ' ').trim()}`

    const zillow = zillowUrl(parsed.address, parsed.city || 'Jacksonville', parsed.state || 'FL', parsed.zip)

    const result = await sql(`
      INSERT INTO leads (
        workspace_id, created_by, assigned_to,
        address, city, state, zip_code,
        bedrooms, bathrooms, sqft, lot_size_sqft,
        asking_price, lead_source, status, auto_imported, redfin_trigger_type,
        zillow_url, notes
      ) VALUES (
        '${WORKSPACE}', '${USER}', '${USER}',
        ${esc(parsed.address)}, ${esc(parsed.city || 'Jacksonville')}, ${esc(parsed.state || 'FL')}, ${esc(parsed.zip)},
        ${numOrNull(parsed.bedrooms)}, ${numOrNull(parsed.bathrooms)}, ${numOrNull(parsed.sqft)}, ${numOrNull(parsed.lotSqft)},
        ${numOrNull(parsed.currentPrice)}, 'redfin_auto', 'triage', true, '${trigger}',
        ${esc(zillow)}, ${esc(notes)}
      )
      RETURNING id
    `)
    const newId = result[0].id
    await sql(`
      INSERT INTO redfin_processed_emails (message_id, workspace_id, lead_id, action, trigger_type, address)
      VALUES ('${email.id}', '${WORKSPACE}', '${newId}', 'created_lead', '${trigger}', ${esc(parsed.address)})
      ON CONFLICT (message_id) DO NOTHING
    `)
    console.log(`   ✓ Created new triage lead ${newId}`)
    stats.created++
  }
}

console.log('\n══════ SUMMARY ══════')
console.log(JSON.stringify(stats, null, 2))
