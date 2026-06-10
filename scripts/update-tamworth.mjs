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
      // Standard HML loan structure (same as flip projects)
      purchase_loan_amount:        null,     // computed: 90% of purchase price via loan_to_purchase_pct
      loan_to_purchase_pct:        0.90,
      renovation_lender_amount:    40000,
      renovation_lender_pct:       1.0,      // 100% financed by lender
      renovation_financing:        'HML',

      // HML terms
      points_pct:                  0.02,     // 2% points
      interest_rate_annual:        0.12,     // 12% annual

      // Closing cost fields (from closing statement)
      interest_portion:            783.99,   // prepaid interest only (not origination/appraisal/etc)
      title_lender_insurance:      439.38,
      doc_stamps_mortgage:         392.00,
      intangible_tax:              224.00,
      title_closing_costs:         1906.62,  // owner title + notary + settlement + recording + deed stamps + lien search
      purchase_closing_costs_other: 0,

      // Seller credit
      seller_credits:              1046.79,

      // Holding costs
      taxes_monthly:               180,
      insurance_monthly:           100,
      utilities_monthly:           0,
      hoa_monthly:                 0,
      misc_holding_monthly:        0,

      // Refi plan
      refi_ltv_pct:                0.70,
      refi_interest_rate:          0.067,
      refi_closing_costs:          2000,

      // Rental
      monthly_rent:                1600,
      vacancy_rate_pct:            0.05,
      property_mgmt_pct:           0.10,
      maintenance_monthly:         null,     // auto: 5% of rent = $80/mo
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
          purchase_loan_amount: null, loan_to_purchase_pct: 0.90,
          renovation_lender_amount: 40000, renovation_lender_pct: 1.0, renovation_financing: 'HML',
          points_pct: 0.02, interest_rate_annual: 0.12,
          interest_portion: 783.99, title_lender_insurance: 439.38,
          doc_stamps_mortgage: 392.00, intangible_tax: 224.00,
          title_closing_costs: 1906.62, purchase_closing_costs_other: 0,
          seller_credits: 1046.79,
          taxes_monthly: 180, insurance_monthly: 100,
          utilities_monthly: 0, hoa_monthly: 0, misc_holding_monthly: 0,
          refi_ltv_pct: 0.70, refi_interest_rate: 0.067,
          monthly_rent: 1600, vacancy_rate_pct: 0.05, property_mgmt_pct: 0.10,
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
  console.log('Loan structure:')
  console.log('  Purchase loan: 90% × $77,500 = $69,750')
  console.log('  Reno loan:    100% × $40,000 = $40,000')
  console.log('  Total HML:                    $109,750')
  console.log()
  console.log('Points (2% × $109,750): $2,195')
  console.log('Prepaid interest:         $784')
  console.log('Lender title insurance:   $439')
  console.log('Doc stamps:               $392')
  console.log('Intangible tax:           $224')
  console.log('HML closing subtotal:   $4,034')
  console.log()
  console.log('Down payment ($77,500 × 10%):  $7,750')
  console.log('+ HML closing:                 $4,034')
  console.log('+ Purchase closing:            $1,907')
  console.log('− Seller credit:              −$1,047')
  console.log('= Cash at Close:              ~$12,644')
}

main()
