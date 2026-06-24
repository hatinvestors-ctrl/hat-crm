-- Add screened flag to distinguish Screener-promoted leads from Kevin's pipeline
ALTER TABLE leads ADD COLUMN IF NOT EXISTS screened BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS leads_screened_idx
  ON leads(workspace_id, screened)
  WHERE screened = TRUE;
