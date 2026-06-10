-- Add refi_closing_costs to deal_financials for BRRRR strategy
ALTER TABLE deal_financials
  ADD COLUMN IF NOT EXISTS refi_closing_costs DECIMAL DEFAULT 2000;
