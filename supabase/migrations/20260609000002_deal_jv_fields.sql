-- JV (Joint Venture) deal support
ALTER TABLE public.deal_financials
  ADD COLUMN IF NOT EXISTS is_jv                  BOOLEAN  DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS jv_profit_split_pct    DECIMAL  DEFAULT 0.5,   -- our share (0.5 = 50%)
  ADD COLUMN IF NOT EXISTS jv_partner_purchase    DECIMAL  DEFAULT 0,     -- what partner paid for house + their closing
  ADD COLUMN IF NOT EXISTS jv_partner_loan        DECIMAL  DEFAULT 0,     -- amount partner lent us for reno
  ADD COLUMN IF NOT EXISTS jv_partner_loan_rate   DECIMAL  DEFAULT 0.12;  -- annual interest rate on that loan
