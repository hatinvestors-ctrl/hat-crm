ALTER TABLE public.deal_financials
  ADD COLUMN IF NOT EXISTS agent_commission_pct  DECIMAL DEFAULT 0.03,
  ADD COLUMN IF NOT EXISTS buyer_agent_pct       DECIMAL DEFAULT 0.03,
  ADD COLUMN IF NOT EXISTS selling_closing_pct   DECIMAL DEFAULT 0.01,
  ADD COLUMN IF NOT EXISTS selling_other_pct     DECIMAL DEFAULT 0.00;
