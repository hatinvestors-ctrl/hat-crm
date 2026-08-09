-- Per-deal holding period override (months). Null means "use the default" (6 months),
-- which every calculation in the app now assumes instead of the old 3-month flip default.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS hold_months INTEGER;
