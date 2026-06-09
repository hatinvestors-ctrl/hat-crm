ALTER TABLE public.deal_financials
  ADD COLUMN IF NOT EXISTS purchase_date DATE;
