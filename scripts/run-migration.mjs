// Applies the draw management migration
const PAT = 'sbp_781ad2a5c682ee39cd1c2855409c7352bd6c4d9f'
const PROJECT_REF = 'pyrgotfotmwazigewlke'

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  if (!r.ok) {
    const text = await r.text()
    throw new Error(`SQL failed ${r.status}: ${text}`)
  }
  return r.json()
}

// Run each table separately to stay under request size limits

console.log('Creating project_loans...')
await sql(`
CREATE TABLE IF NOT EXISTS project_loans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  lender_name TEXT, lender_contact TEXT, loan_label TEXT DEFAULT 'Primary HML',
  loan_type TEXT DEFAULT 'hard_money', loan_status TEXT DEFAULT 'active',
  purchase_loan_amount DECIMAL(12,2), rehab_escrow_amount DECIMAL(12,2),
  total_loan_amount DECIMAL(12,2), borrower_cash_at_close DECIMAL(12,2),
  interest_rate_annual DECIMAL(6,4) DEFAULT 0.12, interest_calc_method TEXT DEFAULT 'monthly',
  loan_term_months INTEGER DEFAULT 12, is_interest_only BOOLEAN DEFAULT TRUE,
  origination_points_pct DECIMAL(5,4) DEFAULT 0.02,
  loan_start_date DATE, maturity_date DATE, extended_maturity_date DATE, paid_off_date DATE,
  origination_fee DECIMAL(10,2) DEFAULT 0, appraisal_fee DECIMAL(10,2) DEFAULT 0,
  processing_fee DECIMAL(10,2) DEFAULT 0, legal_fee DECIMAL(10,2) DEFAULT 0,
  wire_fee DECIMAL(10,2) DEFAULT 0, draw_inspection_fee DECIMAL(10,2) DEFAULT 0,
  extension_fee DECIMAL(10,2) DEFAULT 0, other_fees DECIMAL(10,2) DEFAULT 0,
  current_principal_balance DECIMAL(12,2), notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
)
`)
await sql(`CREATE INDEX IF NOT EXISTS project_loans_lead_id_idx ON project_loans(lead_id)`)
await sql(`CREATE INDEX IF NOT EXISTS project_loans_workspace_id_idx ON project_loans(workspace_id)`)
console.log('✓ project_loans')

console.log('Creating lender_draws...')
await sql(`
CREATE TABLE IF NOT EXISTS lender_draws (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_loan_id UUID NOT NULL REFERENCES project_loans(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  draw_number INTEGER NOT NULL,
  draw_status TEXT DEFAULT 'draft',
  amount_requested DECIMAL(10,2) NOT NULL DEFAULT 0,
  amount_funded DECIMAL(10,2),
  inspection_fee_charged DECIMAL(10,2) DEFAULT 0,
  net_funded DECIMAL(10,2),
  date_submitted DATE, date_inspected DATE, date_funded DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (project_loan_id, draw_number)
)
`)
await sql(`CREATE INDEX IF NOT EXISTS lender_draws_lead_id_idx ON lender_draws(lead_id)`)
await sql(`CREATE INDEX IF NOT EXISTS lender_draws_project_loan_id_idx ON lender_draws(project_loan_id)`)
console.log('✓ lender_draws')

console.log('Creating contractor_payments...')
await sql(`
CREATE TABLE IF NOT EXISTS contractor_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contractor_name TEXT NOT NULL,
  contractor_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  payment_date DATE NOT NULL,
  amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  payment_method TEXT DEFAULT 'check',
  reference_number TEXT,
  lender_draw_id UUID REFERENCES lender_draws(id) ON DELETE SET NULL,
  reimbursed BOOLEAN DEFAULT FALSE,
  reimbursed_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
)
`)
await sql(`CREATE INDEX IF NOT EXISTS contractor_payments_lead_id_idx ON contractor_payments(lead_id)`)
await sql(`CREATE INDEX IF NOT EXISTS contractor_payments_lender_draw_id_idx ON contractor_payments(lender_draw_id)`)
console.log('✓ contractor_payments')

console.log('Creating draw_scope_items...')
await sql(`
CREATE TABLE IF NOT EXISTS draw_scope_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  renovation_item_id UUID NOT NULL REFERENCES deal_renovation_items(id) ON DELETE CASCADE,
  contractor_payment_id UUID REFERENCES contractor_payments(id) ON DELETE CASCADE,
  lender_draw_id UUID REFERENCES lender_draws(id) ON DELETE CASCADE,
  amount_in_draw DECIMAL(10,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
)
`)
await sql(`CREATE INDEX IF NOT EXISTS draw_scope_items_renovation_item_id_idx ON draw_scope_items(renovation_item_id)`)
console.log('✓ draw_scope_items')

console.log('Extending deal_renovation_items...')
const alterCols = [
  `ALTER TABLE deal_renovation_items ADD COLUMN IF NOT EXISTS contractor_name TEXT`,
  `ALTER TABLE deal_renovation_items ADD COLUMN IF NOT EXISTS contractor_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL`,
  `ALTER TABLE deal_renovation_items ADD COLUMN IF NOT EXISTS amount_invoiced DECIMAL(10,2) DEFAULT 0`,
  `ALTER TABLE deal_renovation_items ADD COLUMN IF NOT EXISTS amount_paid DECIMAL(10,2) DEFAULT 0`,
  `ALTER TABLE deal_renovation_items ADD COLUMN IF NOT EXISTS amount_reimbursed DECIMAL(10,2) DEFAULT 0`,
  `ALTER TABLE deal_renovation_items ADD COLUMN IF NOT EXISTS approved_change_order DECIMAL(10,2) DEFAULT 0`,
  `ALTER TABLE deal_renovation_items ADD COLUMN IF NOT EXISTS start_date DATE`,
  `ALTER TABLE deal_renovation_items ADD COLUMN IF NOT EXISTS expected_completion DATE`,
  `ALTER TABLE deal_renovation_items ADD COLUMN IF NOT EXISTS actual_completion DATE`,
  `ALTER TABLE deal_renovation_items ADD COLUMN IF NOT EXISTS lender_draw_id UUID REFERENCES lender_draws(id) ON DELETE SET NULL`,
  `ALTER TABLE deal_renovation_items ADD COLUMN IF NOT EXISTS pct_complete INTEGER DEFAULT 0`,
]
for (const stmt of alterCols) {
  await sql(stmt)
}
console.log('✓ deal_renovation_items extended')

console.log('\nAll migrations complete ✓')
