// Pulls comments & notes from Podio "Kevin HAT Pipeline" and inserts
// them into HatCRM lead_activities, matched by address.

const CLIENT_ID     = 'hatcrm'
const CLIENT_SECRET = '3VQ5Gq8xof81kYsBwj0wZ8jdC0PjollaYv24hl8itXqKDDMlKuth6ndmIUykUoQd'
const EMAIL         = 'hili@magaleygishur.co.il'
const PASSWORD      = 'Podio12345%'
const PODIO_APP_ID  = 30070194

const SUPABASE_URL  = 'https://pyrgotfotmwazigewlke.supabase.co'
const SERVICE_KEY   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB5cmdvdGZvdG13YXppZ2V3bGtlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODQ0Mjc5MSwiZXhwIjoyMDk0MDE4NzkxfQ.9PjYMel7EAA4UApOliE0y4p49eEETCIxnx1aep99vSU'
const WORKSPACE_ID  = 'd854b1e3-b174-45f7-b11d-1b92d8e7b87d'

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// ── 1. Authenticate with Podio ────────────────────────────────────────────────
const authRes = await fetch('https://podio.com/oauth/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'password', username: EMAIL, password: PASSWORD,
    client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
  }),
})
const { access_token } = await authRes.json()
if (!access_token) { console.error('❌ Auth failed'); process.exit(1) }
console.log('✅ Authenticated with Podio')

const podio = (path) => fetch(`https://api.podio.com${path}`, {
  headers: { Authorization: `Bearer ${access_token}` }
}).then(r => r.json())

// ── 2. Load all CRM leads ─────────────────────────────────────────────────────
const leadsRes = await fetch(`${SUPABASE_URL}/rest/v1/leads?workspace_id=eq.${WORKSPACE_ID}&select=id,address,city`, {
  headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
})
const crmLeads = await leadsRes.json()
console.log(`Loaded ${crmLeads.length} CRM leads`)

// Build lookup: normalized address → lead id
function normalize(s) {
  return (s || '').toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
const leadMap = {}
for (const l of crmLeads) {
  const key = normalize(l.address)
  leadMap[key] = l.id
}

// ── 3. Fetch all items from Podio app ─────────────────────────────────────────
console.log('Fetching Podio items...')
let allItems = [], offset = 0, total = Infinity
while (offset < total) {
  const res = await podio(`/item/app/${PODIO_APP_ID}/?limit=100&offset=${offset}`)
  total = res.total || 0
  allItems = allItems.concat(res.items || [])
  offset += (res.items || []).length
  if (!(res.items || []).length) break
  process.stdout.write(`  Fetched ${allItems.length}/${total}\r`)
  await sleep(200)
}
console.log(`\n✅ Fetched ${allItems.length} Podio items`)

// ── 4. For each item, get comments and match to CRM lead ──────────────────────
let imported = 0, skipped = 0
const activities = []

for (const item of allItems) {
  // Extract address from Podio item title or first text field
  const title = item.title || ''
  const addrKey = normalize(title)

  // Try exact match, then partial match
  let leadId = leadMap[addrKey]
  if (!leadId) {
    // Try matching if CRM address is contained in Podio title
    for (const [key, id] of Object.entries(leadMap)) {
      if (addrKey.includes(key) || key.includes(addrKey.split(' ').slice(0,3).join(' '))) {
        leadId = id
        break
      }
    }
  }

  if (!leadId) { skipped++; continue }

  // Fetch comments for this item
  try {
    await sleep(150) // rate limit
    const comments = await podio(`/comment/item/${item.item_id}/`)
    if (Array.isArray(comments) && comments.length > 0) {
      for (const c of comments) {
        if (!c.value) continue
        activities.push({
          lead_id:    leadId,
          user_id:    null, // Podio user — no matching CRM user_id
          type:       'comment',
          content:    `[Podio] ${c.created_by?.name || 'Unknown'}: ${c.value}`,
          created_at: c.created_on || new Date().toISOString(),
          metadata:   { source: 'podio', podio_comment_id: c.comment_id },
        })
      }
    }
  } catch (e) {
    // ignore per-item errors
  }

  imported++
}

console.log(`Matched: ${imported} items | Skipped (no match): ${skipped}`)
console.log(`Comments to import: ${activities.length}`)

if (activities.length === 0) {
  console.log('No comments found to import.')
  process.exit(0)
}

// ── 5. Insert activities into Supabase in batches ─────────────────────────────
const BATCH = 50
let inserted = 0
for (let i = 0; i < activities.length; i += BATCH) {
  const batch = activities.slice(i, i + BATCH)
  const res = await fetch(`${SUPABASE_URL}/rest/v1/lead_activities`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify(batch),
  })
  if (!res.ok) {
    const err = await res.text()
    console.error('❌ Insert error:', err)
  } else {
    inserted += batch.length
    process.stdout.write(`  Inserted ${inserted}/${activities.length}\r`)
  }
}

console.log(`\n✅ Done! Imported ${inserted} Podio comments into HatCRM activity timelines.`)
