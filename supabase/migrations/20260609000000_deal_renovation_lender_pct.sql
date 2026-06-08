ALTER TABLE public.deal_financials
  ADD COLUMN IF NOT EXISTS renovation_lender_pct DECIMAL DEFAULT 1.0;
