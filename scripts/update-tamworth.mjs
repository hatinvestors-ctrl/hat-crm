// Update Tamworth (9129 TAMWORTH Road) deal_financials to standard HML structure
// financials_id: 5be4457f-b9be-4505-838f-3e3687cb5dd6
// Run: node scripts/update-tamworth.mjs

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve } from 'path'

try {
  const env = readFileSync(resolve(process.cwd(), '.env'), 'utf8')
  for (const line of env.split('\n')) {
    const [k, ...v] = line.split('=')
    if (k && v.length) process.env[k.trim()] = v.join('=').trim()
  }
} catch {}

const SUPABASE_URL = 'https://pyrgotfotmwazigewlke.supabase.co'
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY

if (!SERVICE_KEY) {
  console.error('No service key found in .env (SUPABASE_SERVICE_ROLE_KEY)')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
})

const FINANCIALS_ID = '5be4457f-b9be-4505-838f-3e3687cb5dd6'

async function main() {
  const { error } = await supabase
    .from('deal_financials')
    .update({
      // Rob loan structure: $112K total = $72K purchase + $40K reno escrow
      purchase_loan_amount:        72000,    // 90% of purchase ($72K, not computed from pct)
      loan_to_purchase_pct:        null,     // not used — hardcoded loan amount above
      renovation_lender_amount:    50000,    // total reno budget ($50K — lender covers $40K, buyer covers $10K)
      renovation_lender_pct:       0.80,     // lender covers 80% = $40K; gap = $10K paid during reno
      renovation_financing:        'HML',

      // HML terms — 12% confirmed by $1,120/mo payment on $112K loan
      points_pct:                  0,        // origination already included in interest_portion below
      interest_rate_annual:        0.12,

      // Closing cost fields (from actual closing statement)
      // interest_portion includes: origination $2,240 + appraisal $250 + wire $150 + processing $500 + prepaid interest $783.99
      interest_portion:            3923.99,
      title_lender_insurance:      439.38,
      doc_stamps_mortgage:         392.00,
      intangible_tax:              224.00,
      title_closing_costs:         1906.62,  // owner title + notary + settlement + recording + deed stamps + lien search
      purchase_closing_costs_other: 0,

      // Seller credit
      seller_credits:              1046.79,

      // Holding costs — aligned with DealCheck analysis
      taxes_monthly:               180,
      insurance_monthly:           136,      // corrected from $100 — actual insurance per DealCheck
      utilities_monthly:           0,
      hoa_monthly:                 0,
      misc_holding_monthly:        0,

      // Refi plan
      refi_ltv_pct:                0.70,
      refi_interest_rate:          0.067,
      refi_closing_costs:          2000,

      // Rental — aligned with DealCheck rental comps ($1,350, not $1,600)
      monthly_rent:                1350,
      vacancy_rate_pct:            0.05,
      property_mgmt_pct:           0.10,
      maintenance_monthly:         null,     // auto: 5% of rent = $67.50/mo
    })
    .eq('id', FINANCIALS_ID)

  if (error) {
    // refi_closing_costs column may not exist yet — try without it
    if (error.message?.includes('refi_closing_costs')) {
      console.warn('refi_closing_costs column not found — run the migration first:')
      console.warn('  ALTER TABLE deal_financials ADD COLUMN IF NOT EXISTS refi_closing_costs DECIMAL DEFAULT 2000;')
      console.warn()
      console.warn('Retrying without refi_closing_costs...')
      const { error: e2 } = await supabase
        .from('deal_financials')
        .update({
          purchase_loan_amount: 72000, loan_to_purchase_pct: null,
          renovation_lender_amount: 50000, renovation_lender_pct: 0.80, renovation_financing: 'HML',
          points_pct: 0, interest_rate_annual: 0.12,
          interest_portion: 3923.99, title_lender_insurance: 439.38,
          doc_stamps_mortgage: 392.00, intangible_tax: 224.00,
          title_closing_costs: 1906.62, purchase_closing_costs_other: 0,
          seller_credits: 1046.79,
          taxes_monthly: 180, insurance_monthly: 136,
          utilities_monthly: 0, hoa_monthly: 0, misc_holding_monthly: 0,
          refi_ltv_pct: 0.70, refi_interest_rate: 0.067,
          monthly_rent: 1350, vacancy_rate_pct: 0.05, property_mgmt_pct: 0.10,
          maintenance_monthly: null,
        })
        .eq('id', FINANCIALS_ID)
      if (e2) { console.error('Update failed:', e2); process.exit(1) }
    } else {
      console.error('Update failed:', error)
      process.exit(1)
    }
  }

  console.log('Tamworth deal_financials updated successfully!')
  console.log()
  console.log('Loan structure (Rob / 3 Shacks):')
  console.log('  Purchase loan: $72,000  (90% — hardcoded, not computed from pct)')
  console.log('  Reno escrow:   $40,000  (80% of $50K total reno budget)')
  console.log('  Total HML:    $112,000')
  console.log('  Monthly pmt:   $1,120  (@12% on $112K)')
  console.log()
  console.log('Down payment ($77,500 − $72,000):  $5,500')
  console.log('+ HML fees (orig+appraisal+etc):   $3,924')
  console.log('+ Lender title insurance:            $439')
  console.log('+ Doc stamps:                        $392')
  console.log('+ Intangible tax:                    $224')
  console.log('+ Purchase closing:                $1,907')
  console.log('− Seller credit:                  −$1,047')
  console.log('= Cash at Close (ex-EMD):         ~$11,339')
  console.log()
  console.log('Reno gap ($10K) paid separately during renovation.')
  console.log('Rent: $1,350/mo | Insurance: $136/mo | Taxes: $180/mo')
}

main()
