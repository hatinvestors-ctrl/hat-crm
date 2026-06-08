-- supabase/migrations/20260608000000_deal_financials.sql
-- Full project financial tracker for fix-and-flip deals.

CREATE TABLE IF NOT EXISTS public.deal_financials (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     UUID NOT NULL UNIQUE REFERENCES public.leads(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,

  -- Assumptions & Settings
  selling_cost_pct        DECIMAL DEFAULT 0.07,
  loan_to_purchase_pct    DECIMAL DEFAULT 0.90,
  renovation_financing    TEXT    DEFAULT 'Financed',   -- 'Cash' | 'Financed'
  points_charged_on       TEXT    DEFAULT 'Full Loan',  -- 'Purchase Only' | 'Full Loan'

  -- Property / Purchase
  purchase_price_actual   DECIMAL,
  purchase_loan_amount    DECIMAL,   -- null = auto-calculated

  -- Hard Money Loan
  renovation_lender_amount  DECIMAL DEFAULT 0,
  interest_rate_annual      DECIMAL DEFAULT 0.12,
  points_pct                DECIMAL DEFAULT 0.02,
  title_lender_insurance    DECIMAL DEFAULT 500,
  interest_portion          DECIMAL DEFAULT 283,
  doc_stamps_mortgage       DECIMAL DEFAULT 200,
  intangible_tax            DECIMAL DEFAULT 150,
  extension_fee             DECIMAL DEFAULT 0,

  -- Purchase Closing Costs
  title_closing_costs             DECIMAL DEFAULT 1691,
  purchase_closing_costs_other    DECIMAL DEFAULT 0,

  -- Hold
  hold_months           INTEGER DEFAULT 5,
  insurance_monthly     DECIMAL DEFAULT 0,
  utilities_monthly     DECIMAL DEFAULT 0,
  taxes_monthly         DECIMAL DEFAULT 0,
  hoa_monthly           DECIMAL DEFAULT 0,
  misc_holding_monthly  DECIMAL DEFAULT 0,

  -- Selling Prices
  conservative_sell_price   DECIMAL,
  expected_sell_price       DECIMAL,
  optimistic_sell_price     DECIMAL,
  actual_sale_price         DECIMAL,
  sold_date                 DATE,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS deal_financials_workspace_idx
  ON public.deal_financials (workspace_id);

ALTER TABLE public.deal_financials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members can manage deal_financials"
  ON public.deal_financials FOR ALL
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  );

-- Renovation line items per deal
CREATE TABLE IF NOT EXISTS public.deal_renovation_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id      UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  category     TEXT NOT NULL DEFAULT 'Other',
  description  TEXT,
  estimated_cost  DECIMAL DEFAULT 0,
  actual_cost     DECIMAL,        -- NULL = not yet incurred
  status          TEXT DEFAULT 'planned',  -- 'planned' | 'in_progress' | 'complete'
  sort_order      INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS deal_renovation_items_lead_idx
  ON public.deal_renovation_items (lead_id, sort_order);

ALTER TABLE public.deal_renovation_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members can manage deal_renovation_items"
  ON public.deal_renovation_items FOR ALL
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  );
