import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://pyrgotfotmwazigewlke.supabase.co'
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB5cmdvdGZvdG13YXppZ2V3bGtlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODQ0Mjc5MSwiZXhwIjoyMDk0MDE4NzkxfQ.9PjYMel7EAA4UApOliE0y4p49eEETCIxnx1aep99vSU'

const sb = createClient(SUPABASE_URL, SERVICE_KEY)

const WORKSPACE_ID = 'd854b1e3-b174-45f7-b11d-1b92d8e7b87d'
const ADDRESS = '8764 Darlington'
const PURCHASE_PRICE = 120000
const RENO_COST = 85000
const ARV = 254000
const HOLD_MONTHS = 9

async function main() {
  // Step 1: Create the lead
  const { data: lead, error: leadError } = await sb
    .from('leads')
    .insert({
      address: ADDRESS,
      workspace_id: WORKSPACE_ID,
      status: 'working_project',
      offer_price: PURCHASE_PRICE,
      arv: ARV,
      renovation_cost: RENO_COST,
    })
    .select()
    .single()

  if (leadError) { console.error('Lead insert error:', leadError); process.exit(1) }
  console.log('Lead created:', lead.id, lead.address)

  // Step 2: Insert deal_financials — all-cash deal, no HML
  const { error: finError } = await sb.from('deal_financials').insert({
    lead_id:      lead.id,
    workspace_id: WORKSPACE_ID,

    // Assumptions
    selling_cost_pct:         0.07,
    loan_to_purchase_pct:     0,        // all cash
    renovation_financing:     'Cash',
    points_charged_on:        'Full Loan',

    // Deal inputs
    purchase_price_actual:    PURCHASE_PRICE,
    hold_months:              HOLD_MONTHS,
    conservative_sell_price:  ARV,
    expected_sell_price:      ARV,
    optimistic_sell_price:    ARV,

    // Renovation
    renovation_lender_amount: RENO_COST,

    // HML — all zero (cash deal)
    interest_rate_annual:     0,
    points_pct:               0,
    title_lender_insurance:   0,
    interest_portion:         0,
    doc_stamps_mortgage:      0,
    intangible_tax:           0,
    extension_fee:            0,

    // Purchase closing costs (from screenshot: $3,378)
    title_closing_costs:             3378,
    purchase_closing_costs_other:    0,

    // Holding costs — all zero per calculator
    insurance_monthly:    0,
    utilities_monthly:    0,
    taxes_monthly:        0,
    hoa_monthly:          0,
    misc_holding_monthly: 0,
  })

  if (finError) { console.error('deal_financials insert error:', finError); process.exit(1) }
  console.log('deal_financials created successfully')
  console.log(`\nDone! Navigate to project: /w/${WORKSPACE_ID}/projects/${lead.id}`)
}

main()
