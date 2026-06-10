// Insert 9129 TAMWORTH Road, Jacksonville, FL 32208 as a BRRRR project
// Closing date: 2026-06-10
// Run: node scripts/insert-tamworth.mjs

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://pyrgotfotmwazigewlke.supabase.co'
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY
const WORKSPACE_ID = 'd854b1e3-b174-45f7-b11d-1b92d8e7b87d'

if (!SERVICE_KEY) {
  console.error('Set SUPABASE_SERVICE_KEY env var')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
})

// ── Closing statement numbers ────────────────────────────────────────────────
// Purchase Price:       $77,500
// Acquisition Loan:    $112,000  (3 Shacks — covers purchase + reno + fees)
// Renovation Escrow:    $40,000  (part of the loan)
// Total Buyer Debits:  $124,385.99
// Total Buyer Credits: $118,046.79  (loan $112K + deposit $5K + seller credit $1,046.79)
// Cash to Close:         $6,339.20 + $5,000 EMD = $11,339.20 total out of pocket
//
// Closing cost buckets:
//   Lender fees (interest_portion):  $2,240 origination + $250 appraisal + $150 wire
//                                  + $500 processing + $783.99 prepaid interest = $3,923.99
//   Lender title insurance:          $439.38
//   State mortgage stamps:           $392.00
//   Mortgage tax:                    $224.00
//   Purchase closing (title_closing_costs):
//     Owner title $445.62 + Notary $250 + Settlement $400 + Recording svc $10.50
//     + Recording fees $173 + Deed stamps $542.50 + Lien search $85 = $1,906.62
//   Seller tax credit:               $1,046.79

async function main() {
  // 1. Create the lead
  const { data: lead, error: leadErr } = await supabase
    .from('leads')
    .insert({
      workspace_id:  WORKSPACE_ID,
      address:       '9129 TAMWORTH Road',
      city:          'Jacksonville',
      state:         'FL',
      zip_code:      '32208',
      status:        'working_project',
      lead_source:   'direct',
    })
    .select()
    .single()

  if (leadErr) { console.error('Lead insert failed:', leadErr); process.exit(1) }
  console.log('Lead created:', lead.id)

  // 2. Create deal_financials
  const { data: fin, error: finErr } = await supabase
    .from('deal_financials')
    .insert({
      lead_id:         lead.id,
      workspace_id:    WORKSPACE_ID,
      project_strategy: 'brrrr',

      // Purchase
      purchase_price_actual:     77500,
      purchase_date:             '2026-06-10',

      // Acquisition loan (3 Shacks — covers purchase + reno escrow + closing costs)
      purchase_loan_amount:      112000,
      renovation_lender_amount:   40000,   // reno escrow (part of the loan)
      renovation_financing:      'HML',
      renovation_lender_pct:      1.0,
      loan_to_purchase_pct:       null,    // not applicable for rehab loan structure

      // Lender fees (mapped to existing HML fields)
      interest_portion:           3923.99, // origination $2,240 + appraisal $250 + wire $150 + processing $500 + prepaid interest $783.99
      title_lender_insurance:      439.38,
      doc_stamps_mortgage:          392.00, // state mortgage stamps
      intangible_tax:               224.00, // mortgage tax
      points_pct:                     0,
      interest_rate_annual:          null,  // 3 Shacks rate not provided — update when known

      // Purchase closing costs
      title_closing_costs:         1906.62, // owner title + notary + settlement + recording + deed stamps + lien search
      purchase_closing_costs_other:   0,

      // Seller credit
      seller_credits:              1046.79,

      // ARV
      expected_sell_price:       180000,

      // Hold period (renovation + stabilization before refi)
      hold_months:                    6,

      // Holding costs during renovation
      taxes_monthly:                180,  // ~$2,160/yr estimate on $180K property
      insurance_monthly:            100,  // estimate
      utilities_monthly:              0,
      hoa_monthly:                    0,
      misc_holding_monthly:           0,

      // BRRRR — Refinance plan
      refi_ltv_pct:               0.70,
      refi_interest_rate:         0.067,

      // BRRRR — Rental projections
      monthly_rent:               1600,
      vacancy_rate_pct:           0.05,
      property_mgmt_pct:          0.10,
      maintenance_monthly:         null,  // auto: 5% of rent
    })
    .select()
    .single()

  if (finErr) { console.error('Financials insert failed:', finErr); process.exit(1) }
  console.log('Financials created:', fin.id)
  console.log('Done! Lead ID:', lead.id)
  console.log()
  console.log('=== BRRRR Snapshot ===')
  console.log('Our cash in at closing: $11,339.20')
  console.log('Refi loan (70% × $180K ARV): $126,000')
  console.log('Cash back at refi: $14,000')
  console.log('Net cash in deal: −$2,661 (money pulled out — perfect BRRRR!)')
  console.log('Monthly rent: $1,600')
  console.log('Refi P&I (@6.7%, 30yr on $126K): ~$817/mo')
  console.log('Equity at refi: $54,000')
}

main()
