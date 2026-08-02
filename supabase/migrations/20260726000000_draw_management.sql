-- Draw Management: project_loans, lender_draws, contractor_payments, draw_scope_items
-- Plus extensions to deal_renovation_items

-- ─── 1. project_loans ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_loans (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id                       UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  workspace_id                  UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  lender_name                   TEXT,
  lender_contact                TEXT,
  loan_label                    TEXT DEFAULT 'Primary HML',
  loan_type                     TEXT DEFAULT 'hard_money',   -- hard_money | bridge | private | seller | refi
  loan_status                   TEXT DEFAULT 'active',        -- active | paid_off | extended | in_default | closed

  purchase_loan_amount          DECIMAL(12,2),
  rehab_escrow_amount           DECIMAL(12,2),
  total_loan_amount             DECIMAL(12,2),
  borrower_cash_at_close        DECIMAL(12,2),

  interest_rate_annual          DECIMAL(6,4) DEFAULT 0.12,
  interest_calc_method          TEXT DEFAULT 'monthly',       -- daily | monthly
  loan_term_months              INTEGER DEFAULT 12,
  is_interest_only              BOOLEAN DEFAULT TRUE,
  origination_points_pct        DECIMAL(5,4) DEFAULT 0.02,

  loan_start_date               DATE,
  maturity_date                 DATE,
  extended_maturity_date        DATE,
  paid_off_date                 DATE,

  origination_fee               DECIMAL(10,2) DEFAULT 0,
  appraisal_fee                 DECIMAL(10,2) DEFAULT 0,
  processing_fee                DECIMAL(10,2) DEFAULT 0,
  legal_fee                     DECIMAL(10,2) DEFAULT 0,
  wire_fee                      DECIMAL(10,2) DEFAULT 0,
  draw_inspection_fee           DECIMAL(10,2) DEFAULT 0,
  extension_fee                 DECIMAL(10,2) DEFAULT 0,
  other_fees                    DECIMAL(10,2) DEFAULT 0,

  current_principal_balance     DECIMAL(12,2),
  notes                         TEXT,

  created_at                    TIMESTAMPTZ DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS project_loans_lead_id_idx ON project_loans(lead_id);
CREATE INDEX IF NOT EXISTS project_loans_workspace_id_idx ON project_loans(workspace_id);

ALTER TABLE project_loans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace members can manage project_loans"
  ON project_loans FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

-- ─── 2. lender_draws ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lender_draws (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_loan_id         UUID NOT NULL REFERENCES project_loans(id) ON DELETE CASCADE,
  lead_id                 UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  workspace_id            UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  draw_number             INTEGER NOT NULL,
  draw_status             TEXT DEFAULT 'draft',  -- draft | submitted | inspecting | approved | funded | rejected

  amount_requested        DECIMAL(10,2) NOT NULL DEFAULT 0,
  amount_funded           DECIMAL(10,2),
  inspection_fee_charged  DECIMAL(10,2) DEFAULT 0,
  net_funded              DECIMAL(10,2),          -- amount_funded - inspection_fee_charged

  date_submitted          DATE,
  date_inspected          DATE,
  date_funded             DATE,

  notes                   TEXT,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (project_loan_id, draw_number)
);

CREATE INDEX IF NOT EXISTS lender_draws_lead_id_idx ON lender_draws(lead_id);
CREATE INDEX IF NOT EXISTS lender_draws_project_loan_id_idx ON lender_draws(project_loan_id);

ALTER TABLE lender_draws ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace members can manage lender_draws"
  ON lender_draws FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

-- ─── 3. contractor_payments ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contractor_payments (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id                 UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  workspace_id            UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  contractor_name         TEXT NOT NULL,
  contractor_agent_id     UUID REFERENCES agents(id) ON DELETE SET NULL,

  payment_date            DATE NOT NULL,
  amount                  DECIMAL(10,2) NOT NULL DEFAULT 0,
  payment_method          TEXT DEFAULT 'check',  -- check | wire | zelle | cash | ach
  reference_number        TEXT,

  lender_draw_id          UUID REFERENCES lender_draws(id) ON DELETE SET NULL,
  reimbursed              BOOLEAN DEFAULT FALSE,
  reimbursed_date         DATE,

  notes                   TEXT,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS contractor_payments_lead_id_idx ON contractor_payments(lead_id);
CREATE INDEX IF NOT EXISTS contractor_payments_lender_draw_id_idx ON contractor_payments(lender_draw_id);

ALTER TABLE contractor_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "workspace members can manage contractor_payments"
  ON contractor_payments FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

-- ─── 4. draw_scope_items (junction) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS draw_scope_items (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  renovation_item_id      UUID NOT NULL REFERENCES deal_renovation_items(id) ON DELETE CASCADE,
  contractor_payment_id   UUID REFERENCES contractor_payments(id) ON DELETE CASCADE,
  lender_draw_id          UUID REFERENCES lender_draws(id) ON DELETE CASCADE,
  amount_in_draw          DECIMAL(10,2) DEFAULT 0,
  created_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS draw_scope_items_renovation_item_id_idx ON draw_scope_items(renovation_item_id);
CREATE INDEX IF NOT EXISTS draw_scope_items_lender_draw_id_idx ON draw_scope_items(lender_draw_id);

-- ─── 5. Extend deal_renovation_items ───────────────────────────────────────────
ALTER TABLE deal_renovation_items
  ADD COLUMN IF NOT EXISTS contractor_name       TEXT,
  ADD COLUMN IF NOT EXISTS contractor_agent_id   UUID REFERENCES agents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS amount_invoiced       DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amount_paid           DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amount_reimbursed     DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS approved_change_order DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS start_date            DATE,
  ADD COLUMN IF NOT EXISTS expected_completion   DATE,
  ADD COLUMN IF NOT EXISTS actual_completion     DATE,
  ADD COLUMN IF NOT EXISTS lender_draw_id        UUID REFERENCES lender_draws(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pct_complete          INTEGER DEFAULT 0;
