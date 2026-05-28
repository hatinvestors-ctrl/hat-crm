// Insert Redfin leads from 2026-05-25 directly into Supabase via Management API
// Run: node scripts/insert-redfin-leads.mjs

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
    address: '830 Rushing St',
    zip_code: '32209',
    bedrooms: null, bathrooms: null, sqft: null,
    asking_price: 135000,
    redfin_trigger_type: 'price_drop',
    is_hot: true,
    notes: 'Price drop from $140K. Distressed SFR Moncrief. Est reno $50K. BRRRR target — needs comps to confirm ARV $200-220K range. Analysis: hat-ai-agents/operations/deals/830-rushing.md',
  },
  {
    address: '1352 Mt Herman St',
    zip_code: '32206',
    bedrooms: null, bathrooms: null, sqft: null,
    asking_price: 110000,
    redfin_trigger_type: 'price_drop',
    is_hot: false,
    notes: 'Price drop from $115K. North Springfield. Est reno $45K. Flip works at $220K+ ARV. Below typical buy range — verify ARV ceiling for 32206. Analysis: hat-ai-agents/operations/deals/1352-mt-herman.md',
  },
  {
    address: '1336 Pinegrove Ct',
    zip_code: '32205',
    bedrooms: 3, bathrooms: 1, sqft: 937,
    asking_price: 150000,
    redfin_trigger_type: 'new_listing',
    is_hot: false,
    notes: 'New listing. 3/1, 937sqft. Avondale/Riverside area (32205). Est reno $35K. BRRRR target — needs $220K+ ARV. Strong zip but small sqft caps ARV. Analysis: hat-ai-agents/operations/deals/1336-pinegrove.md',
  },
  {
    address: '4828 Lambing Rd',
    zip_code: '32210',
    bedrooms: null, bathrooms: null, sqft: null,
    asking_price: 239500,
    redfin_trigger_type: 'price_drop',
    is_hot: true,
    notes: 'MAJOR price drop: $339,500 to $239,500 (-$100K, -29%). Westside Jax. Reason for drop unknown — investigate before offering. Est reno $25-65K depending on condition. Numbers tight, needs ARV $310K+. Analysis: hat-ai-agents/operations/deals/4828-lambing.md',
  },
  {
    address: '1615 Brook Forest Dr',
    zip_code: '32208',
    bedrooms: null, bathrooms: null, sqft: null,
    asking_price: 215000,
    redfin_trigger_type: 'back_on_market',
    is_hot: true,
    notes: 'BACK ON MARKET — prior deal fell through. Cash buyer advantage: target offer $185K (vs $215K ask). Find out why it fell through (financing vs inspection). North Jax 32208. Est reno $40K. Analysis: hat-ai-agents/operations/deals/1615-brook-forest.md',
  },
  {
    address: '6715 Frye Ave W',
    zip_code: '32210',
    bedrooms: 3, bathrooms: 1.5, sqft: 1120,
    asking_price: 207500,
    redfin_trigger_type: 'new_listing',
    is_hot: false,
    notes: 'New listing. 3/1.5, 1120sqft. Westside Jax (32210). Est reno $35K, est ARV $245K. Needs full deal analysis.',
  },
  {
    address: '1167 Wolfe St',
    zip_code: '32205',
    bedrooms: null, bathrooms: null, sqft: null,
    asking_price: 195000,
    redfin_trigger_type: 'new_listing',
    is_hot: false,
    notes: 'New listing. Murray Hill bungalow (32205). Est reno $40K, est ARV $250K. Needs full deal analysis.',
  },
  {
    address: '4510 Post St',
    zip_code: '32205',
    bedrooms: null, bathrooms: null, sqft: null,
    asking_price: 205000,
    redfin_trigger_type: 'new_listing',
    is_hot: false,
    notes: 'New listing. Avondale/Riverside area (32205). Est reno $40K, est ARV $255K. Needs full deal analysis.',
  },
  {
    address: '4618 Hercules Ave',
    zip_code: '32205',
    bedrooms: null, bathrooms: null, sqft: null,
    asking_price: 230000,
    redfin_trigger_type: 'new_listing',
    is_hot: false,
    notes: 'New listing. Avondale/Riverside area (32205). Est reno $40K, est ARV $275K. Needs full deal analysis.',
  },
  {
    address: '4757 Kingsbury St',
    zip_code: '32205',
    bedrooms: 3, bathrooms: 1.5, sqft: 884,
    asking_price: 264900,
    redfin_trigger_type: 'new_listing',
    is_hot: false,
    notes: 'New listing. 3/1.5, 884sqft. Avondale area (32205). Small sqft may cap ARV — verify comps. Est reno $45K, est ARV $310K. Needs full deal analysis.',
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
      ${s(WORKSPACE_ID)},
      ${s(lead.address)},
      'Jacksonville', 'FL',
      ${s(lead.zip_code)},
      'single_family',
      ${n(lead.bedrooms)},
      ${n(lead.bathrooms)},
      ${n(lead.sqft)},
      ${n(lead.asking_price)},
      ${n(lead.asking_price)},
      'redfin_auto',
      ${s(lead.redfin_trigger_type)},
      'triage',
      true,
      'active',
      ${lead.is_hot ? 'true' : 'false'},
      ${s(lead.notes)},
      ${s(now)},
      ${s(now)}
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

console.log('\nDone.')
