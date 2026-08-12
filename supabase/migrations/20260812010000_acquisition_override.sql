-- Capability #15.5 — Human Acquisition Override. ADDITIVE ONLY.
-- Separate from canonical Buy Box (never overwrites leads.status or any
-- Buy Box field) — a reversible, auditable human judgment layer only.
-- Safe to run at any time; decisionEngineV2.js's applyHumanOverride()
-- already degrades to a no-op when this column is absent.
--
-- MANUAL STEP REQUIRED: not auto-applied. Run in Supabase Studio's SQL
-- editor (or `supabase db push` if the CLI is linked).
--
-- Also re-states the still-unapplied #15.2 migration below for
-- convenience — apply BOTH in the same session if you haven't already
-- applied 20260812000000_decision_engine_v2_shadow.sql.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS acquisition_override jsonb;

COMMENT ON COLUMN leads.acquisition_override IS
  'Capability #15.5 — reversible human judgment layer, SEPARATE from canonical Buy Box. Shape: {active: bool, decision: "DO_NOT_PURSUE", reason: string, created_by: string, created_at: timestamptz}. Never corrupts leads.status, distress_data, or any Buy Box field. Cleared by setting active:false or the column to null.';

-- Re-stated from Capability #15.2 (apply if not already applied):
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS decision_v2 jsonb,
  ADD COLUMN IF NOT EXISTS decision_v2_updated_at timestamptz;
