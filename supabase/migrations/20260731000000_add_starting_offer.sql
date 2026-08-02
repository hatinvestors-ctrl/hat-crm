-- Add starting_offer field to leads
-- Stores the offer price (set by AI analysis or manually overridden by user)
-- Separate from MAO (which is the ceiling); this is what we actually send the seller

ALTER TABLE leads ADD COLUMN IF NOT EXISTS starting_offer numeric;
