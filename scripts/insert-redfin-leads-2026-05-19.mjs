// Redfin leads from 2026-05-19 (test import batch)
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
    address: '2185 Morehouse Rd',
    zip_code: '32209',
    bedrooms: 3, bathrooms: null, sqft: null,
    asking_price: 60000,
    list_price: 90000,
    redfin_trigger_type: 'price_drop',
    is_hot: true,
    notes: 'Price drop $90,000 → $60,000 (-$30K). Taken down to studs, ready for redevelopment. 3BR. Westside Jax (32209). VERY HOT — massive discount, gut rehab opportunity.',
  },
  {
    address: '1984 W 3rd St',
    zip_code: '32209',
    bedrooms: null, bathrooms: null, sqft: null,
    asking_price: 113000,
    list_price: 113000,
    redfin_trigger_type: 'generic_alert',
    is_hot: false,
    notes: 'Redfin alert May 19. $113K Westside Jax (32209). Confirm property details before pursuing.',
  },
  {
    address: '137 W 25th St',
    zip_code: '32206',
    bedrooms: null, bathrooms: null, sqft: null,
    asking_price: 117000,
    list_price: 117000,
    redfin_trigger_type: 'generic_alert',
    is_hot: false,
    notes: 'Redfin alert May 19. $117K Springfield/Durkeeville area (32206). Confirm property details.',
  },
  {
    address: '5953 110th St',
    zip_code: '32244',
    bedrooms: null, bathrooms: null, sqft: null,
    asking_price: 140000,
    list_price: 140000,
    redfin_trigger_type: 'generic_alert',
    is_hot: false,
    notes: 'Redfin alert May 19. $140K Westside Jax (32244). Confirm property details.',
  },
  {
    address: '9232 Adams Ave',
    zip_code: '32208',
    bedrooms: null, bathrooms: null, sqft: null,
    asking_price: 148000,
    list_price: 148000,
    redfin_trigger_type: 'generic_alert',
    is_hot: false,
    notes: 'Redfin alert May 19. $148K Northside Jax (32208). Confirm property details.',
  },
  {
    address: '10127 Haverford Rd',
    zip_code: '32218',
    bedrooms: 3, bathrooms: 2, sqft: null,
    asking_price: 165000,
    list_price: 165000,
    redfin_trigger_type: 'generic_alert',
    is_hot: false,
    notes: 'Redfin alert May 19. 3/2 concrete block construction. $165K Northside Jax (32218). Solid construction type for BRRRR.',
  },
  {
    address: '10207 Moncrief-Dinsmore Rd',
    zip_code: '32219',
    bedrooms: null, bathrooms: null, sqft: null,
    asking_price: 169000,
    list_price: 169000,
    redfin_trigger_type: 'generic_alert',
    is_hot: false,
    notes: 'Redfin alert May 19. $169K Dinsmore area (32219). Confirm property details before pursuing.',
  },
  {
    address: '1165 Orton St',
    zip_code: '32209',
    bedrooms: null, bathrooms: null, sqft: null,
    asking_price: 179000,
    list_price: 179000,
    redfin_trigger_type: 'generic_alert',
    is_hot: false,
    notes: 'Redfin alert May 19. $179K Westside Jax (32209). Confirm property details.',
  },
  {
    address: '5511 Cruz Rd',
    zip_code: '32208',
    bedrooms: null, bathrooms: null, sqft: null,
    asking_price: 180000,
    list_price: 180000,
    redfin_trigger_type: 'generic_alert',
    is_hot: false,
    notes: 'Redfin alert May 19. $180K Northside Jax (32208). Confirm property details.',
  },
  {
    address: '7250 Sabal Ter',
    zip_code: '32219',
    bedrooms: null, bathrooms: null, sqft: null,
    asking_price: 185000,
    list_price: 185000,
    redfin_trigger_type: 'generic_alert',
    is_hot: false,
    notes: 'Redfin alert May 19. $185K Dinsmore area (32219). Confirm property details.',
  },
  {
    address: '7256 Sabal Ter',
    zip_code: '32219',
    bedrooms: null, bathrooms: null, sqft: null,
    asking_price: 185000,
    list_price: 185000,
    redfin_trigger_type: 'generic_alert',
    is_hot: false,
    notes: 'Redfin alert May 19. $185K Dinsmore area (32219). Adjacent to 7250 Sabal Ter — may be multi-unit or adjacent lot. Confirm.',
  },
  {
    address: '2319 College St',
    zip_code: '32204',
    bedrooms: 4, bathrooms: 2, sqft: null,
    asking_price: 205000,
    list_price: 215000,
    redfin_trigger_type: 'price_drop',
    is_hot: true,
    notes: 'Price drop $215,000 → $205,000 (-$10K). Fixer Upper for Cash Buyers. Riverside area (32204). 4BR/2BA. HOT — cash buyer listing, distressed, desirable Riverside location.',
  },
  {
    address: '6903 Clovis Rd',
    zip_code: '32244',
    bedrooms: null, bathrooms: null, sqft: null,
    asking_price: 219000,
    list_price: 219000,
    redfin_trigger_type: 'generic_alert',
    is_hot: false,
    notes: 'Redfin alert May 19. $219K Westside Jax (32244). Confirm property details.',
  },
  {
    address: '2625 Kohn Rd',
    zip_code: '32207',
    bedrooms: null, bathrooms: null, sqft: null,
    asking_price: 220000,
    list_price: 220000,
    redfin_trigger_type: 'generic_alert',
    is_hot: false,
    notes: 'Redfin alert May 19. $220K Southside Jax (32207). Confirm property details.',
  },
  {
    address: '6218 Carranza Dr',
    zip_code: '32244',
    bedrooms: null, bathrooms: null, sqft: null,
    asking_price: 296000,
    list_price: 296000,
    redfin_trigger_type: 'generic_alert',
    is_hot: false,
    notes: 'Redfin alert May 19. $296K Westside Jax (32244). Upper end of range — confirm distressed/value-add before pursuing.',
  },
  {
    address: '1917 Blair Rd',
    zip_code: '32207',
    bedrooms: null, bathrooms: null, sqft: null,
    asking_price: 329000,
    list_price: 329000,
    redfin_trigger_type: 'generic_alert',
    is_hot: false,
    notes: 'Redfin alert May 19. $329K Southside Jax (32207). Near top of target range — confirm strong ARV potential before pursuing.',
  },
]

const importDate = '2026-05-19T12:00:00.000Z'

let inserted = 0
let failed = 0

for (const lead of leads) {
  // Dedup check
  const existing = await sql(`
    SELECT id FROM public.leads
    WHERE workspace_id = ${s(WORKSPACE_ID)}
      AND address = ${s(lead.address)}
    LIMIT 1
  `)
  if (existing.length > 0) {
    console.log(`⏭️  Skip (exists): ${lead.address}`)
    continue
  }

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
      ${lead.is_hot ? 'true' : 'false'}, ${s(lead.notes)}, ${s(importDate)}, ${s(importDate)}
    )
    RETURNING id, address
  `
  try {
    const result = await sql(q)
    console.log(`✅ Inserted: ${lead.address} → ${result[0]?.id}`)
    inserted++
  } catch (err) {
    console.error(`❌ Failed: ${lead.address} — ${err.message}`)
    failed++
  }
}

console.log(`\nDone. Inserted: ${inserted} | Failed: ${failed} | Total leads: ${leads.length}`)
