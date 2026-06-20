const SUPABASE_URL = 'https://pyrgotfotmwazigewlke.supabase.co'
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB5cmdvdGZvdG13YXppZ2V3bGtlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODQ0Mjc5MSwiZXhwIjoyMDk0MDE4NzkxfQ.9PjYMel7EAA4UApOliE0y4p49eEETCIxnx1aep99vSU'
const WORKSPACE_ID = 'd854b1e3-b174-45f7-b11d-1b92d8e7b87d'
const KEVIN_UUID = '6d551c7a-6191-4f33-9d48-e7fd3a985fad'

const HEADERS = {
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  apikey: SERVICE_ROLE_KEY,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
  Accept: 'application/json',
}

const notes = `🔁 Second Chance Promoted | Original Score: 60/100
📊 ARV ~$315K | MAO ~$176K | Score: 60/100 | $180/sqft | Reno est: $5K–$10K (move-in ready)
   Gross spread: ~$0 (ask is AT or ABOVE realistic ARV) | Net spread after reno: NEGATIVE at ask
   Rental est: ~$2,400–$2,600/mo | Gross yield: ~8.5% at ask | Seller claims $3,000+/mo (unverified — likely inflated)

✅ WHY INTERESTING:
- Seller explicitly marketing to investors: "Incredible investment opportunity" + "potential rental income $3,000+/mo" = motivated, investor-aware seller who may negotiate
- Price drop $345,000 → $338,660 ($6,340 drop) = motivation signal; "JUST REDUCED" language = pressure building
- 4BR/3BA / 1,880sqft with 2 primary suites is a strong rental layout — dual-suite config appeals to roommate or multi-generational renter
- 7,405sqft lot + 2-car garage = above-average lot, possible ADU potential if zoning allows

⚠️ RISKS / CONCERNS:
- ASKING PRICE EXCEEDS REALISTIC ARV: Real comps from same email — 3269 St Augustine Rd (32207, 4/2, 1,740sqft) listed at $295K; 2233 Schumacher Ave (32207, 4/3.5, 2,168sqft) listed at $300K. At $338K, this property is priced $38–43K above larger/comparable homes in the same ZIP
- "Fully renovated" = asking price reflects finished product. Zero value-add left. No rehab spread available
- $180/sqft in 32207 (benchmark: under $170/sqft = strong, over $210 = retail) — at retail, not discount
- BRRRR math fails badly: refi at 70% × $315K ARV = $220K → $118K cash permanently left in deal. Not a BRRRR play

💰 DEAL MATH:
   Exit: Rental only (flip and BRRRR do not work at ask)
   Ask: $338,660 | Reno: ~$5K | Total in: ~$344K
   ARV (based on real 32207 comps): ~$310K–$320K | Realistic: ~$315K
   Gross spread at ask: -$23K (asking ABOVE comp ARV — no flip upside)
   BRRRR refi (70% × $315K): ~$220K → cash left in: ~$124K (unacceptable)
   Flip net: LOSS — comps don't support resale above $315K after carry costs
   Rent realistic est: ~$2,400–$2,600/mo | Cap rate at ask: ~8.5%
   Cap rate at $270K (target): ~11.5% — that's where the deal makes sense

🎯 STRATEGY RECOMMENDATION: Pass at current price. Rental-only play ONLY if negotiated down significantly.

📞 NEXT ACTION:
- DO NOT engage at $338K — numbers are upside down vs real comps
- If pursuing: offer $255K–$270K (target $262K). Justify with comp data — 4/2 in same ZIP at $295K, seller priced above market
- Walk: Not needed until price drops to $280K or below — confirm condition remotely first
- Follow-up: Set 45-day reminder. If price drops to $290K or below, re-evaluate. At $270K, cap rate hits ~11.5% and becomes a viable rental hold
- Script for agent call: "We're investors, we like the layout and location, but comparable 4-beds in 32207 are listing at $295–300K. We're at $255–270K. Is the seller open to investor pricing?"`

const now = new Date().toISOString()

const row = {
  workspace_id: WORKSPACE_ID,
  address: '3859 Abby Ln',
  city: 'Jacksonville',
  state: 'FL',
  zip_code: '32207',
  property_type: 'single_family',
  bedrooms: 4,
  bathrooms: 3,
  sqft: 1880,
  asking_price: 338660,
  list_price: 345000,
  lead_source: 'redfin_auto',
  redfin_trigger_type: 'price_drop',
  status: 'triage',
  auto_imported: true,
  mls_status: 'active',
  is_hot: true,
  notes,
  assigned_to: KEVIN_UUID,
  created_at: now,
  updated_at: now,
}

const r = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
  method: 'POST',
  headers: HEADERS,
  body: JSON.stringify(row),
})

const text = await r.text()
console.log('Status:', r.status)
if (r.ok) {
  const result = JSON.parse(text)
  console.log(`✅ Inserted: 3859 Abby Ln → ${result[0]?.id}`)
} else {
  console.error('❌ Failed:', text)
}
