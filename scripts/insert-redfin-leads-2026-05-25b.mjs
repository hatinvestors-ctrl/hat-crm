// Redfin leads from 2026-05-25 (afternoon batch)
const SUPABASE_PAT = 'sbp_05434f76c664e2ed394f7e128cd22eb78058bcc1'
const SUPABASE_PROJECT_REF = 'pyrgotfotmwazigewlke'
const WORKSPACE_ID = 'd854b1e3-b174-45f7-b11d-1b92d8e7b87d'

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SUPABASE_PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`SQL error ${r.status}: ${text}`)
  try { return JSON.parse(text) } catch (_) { return [] }
}

function s(v) {
  if (v === null || v === undefined) return 'NULL'
  return `'${String(v).replace(/'/g, "''")}'`
}
function n(v) {
  if (v === null || v === undefined) return 'NULL'
  return String(Number(v))
}

const leads = [
  {
    address: '7525 Plantation Club Dr',
    zip_code: '32244',
    bedrooms: 3, bathrooms: 2, sqft: 1850,
    asking_price: 332900,
    list_price: 339900,
    redfin_trigger_type: 'price_drop',
    is_hot: false,
    notes: 'Price drop $339,900 → $332,900 (-$7K). Updated/move-in ready per listing (not distressed). 3/2, 1850sqft. Westside Jax (32244). Small drop on retail home — lower priority but in range.',
  },
  {
    address: '6855 Myrtle Oak Rd',
    zip_code: '32219',
    bedrooms: 4, bathrooms: 2, sqft: null,
    asking_price: 349900,
    list_price: 349900,
    redfin_trigger_type: 'generic_alert',
    is_hot: false,
    notes: 'Alert from Redfin Dinsmore batch. 4/2, $349,900. Dinsmore area (32219). Needs property details — confirm SFR vs new construction before pursuing.',
  },
]

const now = new Date().toISOString()

for (const lead of leads) {
  const q = `
    INSERT INTO public.leads
      (workspace_id, address, city, state, zip_code, property_type,
       bedrooms, bathrooms, sqft, asking_price, list_price,
       lead_source, redfin_trigger_type, status, auto_imported,
       mls_status, is_hot, notes, created_at, updated_at)
    VALUES (
      ${s(WORKSPACE_ID)}, ${s(lead.address)}, 'Jacksonville', 'FL', ${s(lead.zip_code)},
      'single_family', ${n(lead.bedrooms)}, ${n(lead.bathrooms)}, ${n(lead.sqft)},
      ${n(lead.asking_price)}, ${n(lead.list_price)},
      'redfin_auto', ${s(lead.redfin_trigger_type)}, 'triage', true, 'active',
      ${lead.is_hot ? 'true' : 'false'}, ${s(lead.notes)}, ${s(now)}, ${s(now)}
    )
    RETURNING id, address
  `
  try {
    const result = await sql(q)
    console.log(`✅ Inserted: ${lead.address} → ${result[0]?.id}`)
  } catch (err) {
    console.error(`❌ Failed: ${lead.address} — ${err.message}`)
  }
}

console.log('Done.')
