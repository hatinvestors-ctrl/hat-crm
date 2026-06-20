// Redfin leads from 2026-05-27 (daily import — 2 leads after Second Chance review)
const SUPABASE_URL = 'https://pyrgotfotmwazigewlke.supabase.co'
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB5cmdvdGZvdG13YXppZ2V3bGtlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODQ0Mjc5MSwiZXhwIjoyMDk0MDE4NzkxfQ.9PjYMel7EAA4UApOliE0y4p49eEETCIxnx1aep99vSU'
const WORKSPACE_ID = 'd854b1e3-b174-45f7-b11d-1b92d8e7b87d'
const KEVIN_UUID = '6d551c7a-6191-4f33-9d48-e7fd3a985fad'

const HEADERS = {
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  apikey: SERVICE_ROLE_KEY,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
}

async function checkDuplicate(houseNum, streetWord) {
  const url = `${SUPABASE_URL}/rest/v1/leads?workspace_id=eq.${WORKSPACE_ID}&address=ilike.${houseNum} ${streetWord}*&select=id&limit=1`
  const r = await fetch(url, { headers: HEADERS })
  const data = await r.json()
  return data.length > 0
}

async function insertRow(row) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(row),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`Insert error ${r.status}: ${text}`)
  return JSON.parse(text)
}

const leads = [
  {
    address: '3052 College St',
    zip_code: '32205',
    bedrooms: 2, bathrooms: null, sqft: null,
    asking_price: 240000,
    list_price: 250000,
    redfin_trigger_type: 'price_drop',
    is_hot: true,
    notes: `📊 ARV ~$275K | MAO ~$156K | Score: 35/100 | Reno est: $35K (Light-Medium)

✅ WHY INTERESTING:
- 🔁 Second Chance Promoted | Original Score: 35/100
- ZIP 32205 (Avondale/Riverside) — one of strongest JAX resale ZIPs, limited inventory at this price
- Price drop $250K → $240K signals motivation; $240K in 32205 is below typical 2BR comps
- Separate garage convertible to workshop/ADU — adds functional and rental value
- 2BR can potentially be expanded to 3BR (check floor plan for bonus room or garage conversion)

⚠️ RISKS / CONCERNS:
- Only 2BR limits buyer pool for resale and rental demand (2-bed SFR less desirable as rental)
- "Beautifully updated kitchen and bathroom" suggests retail pricing already reflected
- ARV spread may be thin if home is truly move-in ready — verify condition before pursuing

🎯 RECOMMENDATION: WATCH
Strong ZIP justifies review. Confirm if 3BR conversion is feasible — if yes, ARV jumps ~$15-25K and spread opens up. Call agent to assess true condition and seller flexibility on price.`,
  },
  {
    address: '3859 Abby Ln',
    zip_code: '32207',
    bedrooms: 4, bathrooms: 3, sqft: 1880,
    asking_price: 339000,
    list_price: 345340,
    redfin_trigger_type: 'price_drop',
    is_hot: true,
    notes: `📊 ARV ~$370K | MAO ~$217K | Score: 60/100 | $180/sqft | Reno est: $0-10K (move-in ready per listing)

✅ WHY INTERESTING:
- 🔁 Second Chance Promoted | Original Score: 60/100
- "Investment opportunity" + "potential rental income $3000+/month" — seller is marketing to investors
- 4/3 at 1880sqft is strong rental profile; if rent is $3000/month, gross yield = 10.6% at $339K ask
- Price drop $345K → $339K + "JUST REDUCED" language = motivated seller, more room to negotiate
- ZIP 32207 (Southside Jax) — solid rental demand, good schools, stable appreciation

⚠️ RISKS / CONCERNS:
- "Fully renovated" means asking price reflects finished product — spread for BRRRR likely thin
- At $339K + no reno, refi at 70% of $370K ARV = $259K → $80K cash left in deal (high)
- Verify $3000+/month rent claim — actual comp rents for 4/3 in 32207 may be lower
- 3-bath configuration adds cost if anything needs repair post-purchase

🎯 RECOMMENDATION: PROMOTE
Rental yield math is worth verifying. If $3000+/month rent is real, this is a cash-flow play not BRRRR. Request rent comps and call agent to confirm actual tenant demand. Do NOT offer ask price — negotiate down to $310-320K to make the numbers work.`,
  },
]

const now = new Date().toISOString()

for (const lead of leads) {
  const parts = lead.address.trim().split(/\s+/)
  const isDup = await checkDuplicate(parts[0], parts[1])
  if (isDup) {
    console.log(`⏭️  Skip (exists): ${lead.address}`)
    continue
  }

  try {
    const result = await insertRow({
      workspace_id: WORKSPACE_ID,
      address: lead.address,
      city: 'Jacksonville',
      state: 'FL',
      zip_code: lead.zip_code,
      property_type: 'single_family',
      bedrooms: lead.bedrooms,
      bathrooms: lead.bathrooms,
      sqft: lead.sqft,
      asking_price: lead.asking_price,
      list_price: lead.list_price,
      lead_source: 'redfin_auto',
      redfin_trigger_type: lead.redfin_trigger_type,
      status: 'triage',
      auto_imported: true,
      mls_status: 'active',
      is_hot: lead.is_hot,
      notes: lead.notes,
      assigned_to: KEVIN_UUID,
      created_at: now,
      updated_at: now,
    })
    console.log(`✅ Inserted: ${lead.address} → ${result[0]?.id}`)
  } catch (err) {
    console.error(`❌ Failed: ${lead.address} — ${err.message}`)
  }
}

console.log('Done.')
