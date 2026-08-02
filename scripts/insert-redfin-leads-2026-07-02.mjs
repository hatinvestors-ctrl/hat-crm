// Redfin leads from daily Gmail batch — July 2, 2026
// Run: node scripts/insert-redfin-leads-2026-07-02.mjs

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
  {
    address: '7215 Karenita Dr',
    zip_code: '32210',
    bedrooms: 4, bathrooms: 2, sqft: 1681,
    asking_price: 100000,
    redfin_trigger_type: 'new_listing',
    is_hot: false,
    notes: '[ARV ~$230K | MAO ~$111K | Score: 85 STRONG] New listing — asking BELOW MAO. Westside Jax (32210 preferred). 4/2/1681. Est reno $50K unknown. Spread ~$130K — investigate immediately. No bad keywords in description.',
  },
  {
    address: '6317 Graves St',
    zip_code: '32210',
    bedrooms: 3, bathrooms: 1.5, sqft: 1496,
    asking_price: 150000,
    redfin_trigger_type: 'new_listing',
    is_hot: false,
    notes: '[ARV ~$215K | MAO ~$100K | Score: 35 LOW] New listing. Westside Jax (32210 preferred). 3/1.5/1496. Est reno $50K unknown. Asking above MAO — needs price reduction or lower reno cost to pencil. Worth monitoring.',
  },
  {
    address: '5753 Crestview Rd',
    zip_code: '32210',
    bedrooms: 3, bathrooms: 1, sqft: 1433,
    asking_price: 239000,
    redfin_trigger_type: 'new_listing',
    is_hot: false,
    notes: '[ARV ~$200K | MAO ~$90K | Score: 15 PASS] FSBO new listing. Westside Jax (32210 preferred). 3/1/1433. Asking $239K far exceeds MAO ~$90K. FSBO = motivated seller potential but price gap is too wide at current ask. Pass unless significant reduction.',
  },
  {
    address: '2625 Kohn Rd',
    zip_code: '32210',
    bedrooms: 4, bathrooms: 2, sqft: 1352,
    asking_price: 213400,
    redfin_trigger_type: 'price_drop',
    is_hot: false,
    notes: '[ARV ~$260K | MAO ~$132K | Score: 30 LOW] Price drop ($1.5K drop from $214,900). Westside Jax (32210 preferred). 4/2/1352. Est reno $50K. Asking still well above MAO. Small drop — seller not motivated enough yet. Monitor.',
  },
  {
    address: '11517 Oaklawn Rd',
    zip_code: '32218',
    bedrooms: 3, bathrooms: 2, sqft: 1770,
    asking_price: 279000,
    redfin_trigger_type: 'new_listing',
    is_hot: false,
    notes: '[ARV ~$280K | MAO ~$146K | Score: 10 PASS] New listing. North Jax (32218). 3/2/1770. Asking near ARV — retail pricing. No investor upside at this price. Low priority (near $280K ceiling).',
  },
  {
    address: '1322 MacArthur St',
    zip_code: '32205',
    bedrooms: 2, bathrooms: 2, sqft: 947,
    asking_price: 305000,
    redfin_trigger_type: 'price_drop',
    is_hot: false,
    notes: '[ARV ~$300K | MAO ~$160K | Score: 10 PASS] Price drop ($5K drop from $310K). Murray Hill (32205). 2/2/947 — small home with high $/sqft. Asking $305K far above MAO. Low priority (above $280K ceiling). Not viable at current price.',
  },
  {
    address: '5925 Oaklane Dr',
    zip_code: '32244',
    bedrooms: 3, bathrooms: 2, sqft: 1250,
    asking_price: 139999,
    redfin_trigger_type: 'price_drop',
    is_hot: true,
    notes: '[ARV ~$200K | MAO ~$90K | Score: 45 MAYBE] Price drop ($9.95K drop from $149,950). Westside (32244). 3/2/1250. Meaningful price reduction — seller showing motivation. Charming one-story, no bad keywords. Still above MAO at $140K — needs negotiation or lower reno estimate. Investigate.',
  },
]

for (const lead of leads) {
  try {
    const result = await insert({ ...lead, workspace_id: WORKSPACE_ID, status: 'triage', lead_source: 'redfin_auto', auto_imported: true })
    console.log('INSERTED:', lead.address, '| id:', result[0]?.id)
  } catch (e) {
    console.error('FAILED:', lead.address, e.message)
  }
}
console.log('Done.')
