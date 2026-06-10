// Redfin leads from daily Gmail batch — June 8, 2026
// Run: node scripts/insert-redfin-leads-2026-06-08.mjs

const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB5cmdvdGZvdG13YXppZ2V3bGtlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODQ0Mjc5MSwiZXhwIjoyMDk0MDE4NzkxfQ.9PjYMel7EAA4UApOliE0y4p49eEETCIxnx1aep99vSU'
const SUPABASE_URL = 'https://pyrgotfotmwazigewlke.supabase.co'
const WORKSPACE_ID = 'd854b1e3-b174-45f7-b11d-1b92d8e7b87d'

async function insert(lead) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(lead),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`REST error ${r.status}: ${text}`)
  return JSON.parse(text)
}


const leads = [
  // --- BACK ON MARKET (from thread: "Back on market in Jacksonville: 2520 Larsen Rd and 12 more updates") ---
  {
    address: '2520 Larsen Rd',
    zip_code: '32207',
    bedrooms: 3, bathrooms: 2, sqft: 1195,
    asking_price: 229900,
    redfin_trigger_type: 'back_on_market',
    is_hot: true,
    notes: '[ARV ~$290K | MAO ~$138K | Score: 65 MEDIUM] Back on market — prior deal fell through. Riverside/San Marco area (32207 preferred). Est reno $50K unknown condition. ARV spread ~$60K. Keywords: back on market, opportunity.',
  },
  {
    address: '4805 Portsmouth Ave',
    zip_code: '32208',
    bedrooms: 3, bathrooms: null, sqft: null,
    asking_price: 115000,
    redfin_trigger_type: 'back_on_market',
    is_hot: true,
    notes: '[ARV ~$200K | MAO ~$70K | Score: 75 MEDIUM] Back on market — prior deal fell through. North Jax (32208 preferred). Est reno $50K unknown condition. ARV spread ~$85K — excellent spread at this price. Keywords: back on market, opportunity.',
  },
  {
    address: '2617 Lake Shore Blvd',
    zip_code: '32210',
    bedrooms: 4, bathrooms: null, sqft: null,
    asking_price: 239000,
    redfin_trigger_type: 'back_on_market',
    is_hot: true,
    notes: '[ARV ~$290K | MAO ~$138K | Score: 50 MAYBE] Back on market — prior deal fell through. Westside Jax (32210 preferred). 4 bed. Est reno $50K unknown condition. Spread ~$51K — verify ARV for 4-bed in 32210 before offer. Keywords: back on market, opportunity.',
  },
  {
    address: '7859 Denham Rd W',
    zip_code: '32208',
    bedrooms: 2, bathrooms: null, sqft: null,
    asking_price: 137500,
    redfin_trigger_type: 'back_on_market',
    is_hot: true,
    notes: '[ARV ~$170K | MAO ~$47K | Score: 40 MAYBE] Back on market. North Jax (32208 preferred). 2 bed limits ARV. Est reno $50K unknown condition. Spread ~$32K — borderline, negotiate down or verify reno scope. Keywords: back on market.',
  },

  // --- NEW LISTINGS (from thread: "New in Jacksonville at $199K" — message 2) ---
  {
    address: '5655 Kimbrell Dr S',
    zip_code: '32210',
    bedrooms: null, bathrooms: null, sqft: null,
    asking_price: 173000,
    redfin_trigger_type: 'new_listing',
    is_hot: false,
    notes: '[ARV ~$255K | MAO ~$111K | Score: 70 MEDIUM] New listing. Westside Jax (32210 preferred). Est reno $50K unknown. ARV spread ~$82K — strong spread for preferred ZIP. Keywords: opportunity, investor.',
  },
  {
    address: '6369 Jammes Rd',
    zip_code: '32244',
    bedrooms: null, bathrooms: null, sqft: null,
    asking_price: 199000,
    redfin_trigger_type: 'new_listing',
    is_hot: false,
    notes: '[ARV ~$260K | MAO ~$115K | Score: 60 MEDIUM] New listing. Westside Jax (32244 preferred). Est reno $50K unknown. ARV spread ~$61K. Keywords: opportunity, investor.',
  },
  {
    address: '6611 Romilly Dr',
    zip_code: '32210',
    bedrooms: null, bathrooms: null, sqft: null,
    asking_price: 200000,
    redfin_trigger_type: 'new_listing',
    is_hot: false,
    notes: '[ARV ~$255K | MAO ~$111K | Score: 45 MAYBE] New listing. Westside Jax (32210 preferred). Est reno $50K unknown. Spread ~$55K. Verify condition before pursuing. Keywords: opportunity, investor.',
  },
  {
    address: '5849 Ridgeway Rd E',
    zip_code: '32244',
    bedrooms: null, bathrooms: null, sqft: null,
    asking_price: 219500,
    redfin_trigger_type: 'new_listing',
    is_hot: false,
    notes: '[ARV ~$260K | MAO ~$115K | Score: 45 MAYBE] New listing. Westside Jax (32244 preferred). Est reno $50K unknown. Spread ~$41K — tight, needs significant negotiation or lower reno. Keywords: opportunity, investor.',
  },
  {
    address: '6731 Seaboard Ave',
    zip_code: '32244',
    bedrooms: null, bathrooms: null, sqft: null,
    asking_price: 215000,
    redfin_trigger_type: 'new_listing',
    is_hot: false,
    notes: '[ARV ~$260K | MAO ~$115K | Score: 45 MAYBE] New listing. Westside Jax (32244 preferred). Est reno $50K unknown. Spread ~$45K. Keywords: opportunity, investor.',
  },
  {
    address: '6009 Verdes Rd',
    zip_code: '32244',
    bedrooms: null, bathrooms: null, sqft: null,
    asking_price: 212000,
    redfin_trigger_type: 'new_listing',
    is_hot: false,
    notes: '[ARV ~$260K | MAO ~$115K | Score: 45 MAYBE] New listing. Westside Jax (32244 preferred). Est reno $50K unknown. Spread ~$48K. Keywords: opportunity, investor.',
  },
  {
    address: '6044 Sabre Dr',
    zip_code: '32244',
    bedrooms: null, bathrooms: null, sqft: null,
    asking_price: 209000,
    redfin_trigger_type: 'new_listing',
    is_hot: false,
    notes: '[ARV ~$260K | MAO ~$115K | Score: 45 MAYBE] New listing. Westside Jax (32244 preferred). Est reno $50K unknown. Spread ~$51K. Keywords: opportunity, investor.',
  },
]

const now = new Date().toISOString()

for (const lead of leads) {
  const record = {
    workspace_id: WORKSPACE_ID,
    address: lead.address,
    city: 'Jacksonville',
    state: 'FL',
    zip_code: lead.zip_code,
    property_type: 'single_family',
    bedrooms: lead.bedrooms ?? null,
    bathrooms: lead.bathrooms ?? null,
    sqft: lead.sqft ?? null,
    asking_price: lead.asking_price,
    list_price: lead.asking_price,
    lead_source: 'redfin_auto',
    redfin_trigger_type: lead.redfin_trigger_type,
    status: 'triage',
    auto_imported: true,
    mls_status: 'active',
    is_hot: lead.is_hot,
    notes: lead.notes,
    created_at: now,
    updated_at: now,
  }
  try {
    const result = await insert(record)
    console.log(`OK: ${lead.address} => ${result[0]?.id}`)
  } catch (err) {
    console.error(`FAIL: ${lead.address} -- ${err.message}`)
  }
}

console.log('\nDone.')
