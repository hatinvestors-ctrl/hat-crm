-- Capability #16 — AI Acquisition Copilot / Deal Brief. ADDITIVE ONLY.
-- MANUAL STEP REQUIRED: run in Supabase Studio's SQL editor.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS deal_brief jsonb,
  ADD COLUMN IF NOT EXISTS deal_brief_updated_at timestamptz;

COMMENT ON COLUMN leads.deal_brief IS
  'Capability #16 — cached AI Acquisition Copilot output. Shape: {input_hash, summary, why[], missing[], questions[], objective, message_sms, message_email, risk_notes[], generated_at}. Manually generated (never automatic), reused until computeDealBriefInputHash() changes.';
