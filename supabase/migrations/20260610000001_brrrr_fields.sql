-- BRRRR strategy fields on deal_financials
-- Run in Supabase SQL Editor

ALTER TABLE deal_financials
  ADD COLUMN IF NOT EXISTS project_strategy  VARCHAR DEFAULT 'flip',
  ADD COLUMN IF NOT EXISTS monthly_rent      DECIMAL,
  ADD COLUMN IF NOT EXISTS refi_ltv_pct      DECIMAL,
  ADD COLUMN IF NOT EXISTS refi_interest_rate DECIMAL,
  ADD COLUMN IF NOT EXISTS vacancy_rate_pct  DECIMAL,
  ADD COLUMN IF NOT EXISTS property_mgmt_pct DECIMAL,
  ADD COLUMN IF NOT EXISTS maintenance_monthly DECIMAL,
  ADD COLUMN IF NOT EXISTS seller_credits    DECIMAL DEFAULT 0;
