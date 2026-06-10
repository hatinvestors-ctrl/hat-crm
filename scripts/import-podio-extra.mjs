// import-podio-extra.mjs — imports Offers Sent + Offer Accepted leads

const SUPABASE_URL = 'https://pyrgotfotmwazigewlke.supabase.co'
const SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB5cmdvdGZvdG13YXppZ2V3bGtlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODQ0Mjc5MSwiZXhwIjoyMDk0MDE4NzkxfQ.9PjYMel7EAA4UApOliE0y4p49eEETCIxnx1aep99vSU'
const WORKSPACE_ID = 'd854b1e3-b174-45f7-b11d-1b92d8e7b87d'

const BASE = {
  workspace_id: WORKSPACE_ID, address: null, city: null, state: 'FL', zip_code: null,
  status: null, is_hot: false, follow_up_date: null, arv: null, mao: null,
  renovation_cost: null, asking_price: null, rent_estimate: null,
  bedrooms: null, bathrooms: null, has_garage: null, year_built: null, sqft: null,
  lead_source: null, zillow_url: null, notes: null,
}

const leads = [
  { ...BASE, address: '12221 Sand Lake Ct', city: 'Jacksonville', zip_code: '32218',
    status: 'offer_sent', mao: 230000,
    zillow_url: 'http://www.zillow.com/homes/12221-Sand-Lake-Ct,-Jacksonville,-FL-32218,-USA_rb' },

  { ...BASE, address: '9129 Tamworth Rd', city: 'Jacksonville', zip_code: '32208',
    status: 'offer_accepted', arv: 160000,
    zillow_url: 'http://www.zillow.com/homes/9129-Tamworth-Rd,-Jacksonville,-FL-32208,-USA_rb' },

  { ...BASE, address: '8321 Old Plank Rd', city: 'Jacksonville', zip_code: '32220',
    status: 'offer_accepted', follow_up_date: '2026-05-18',
    bedrooms: 3, bathrooms: 2, has_garage: false, year_built: 1972, sqft: 1066,
    lead_source: 'mls',
    zillow_url: 'http://www.zillow.com/homes/8321-Old-Plank-Rd,-Jacksonville,-FL-32220,-USA_rb',
    notes: '[Type: Flip]\nFire home. Could be profitable at the right price. Numbers look good at purchase price of 70K.' },
]

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

console.log(`✅ Imported ${leads.length} leads (1 offer_sent + 2 offer_accepted)`)
