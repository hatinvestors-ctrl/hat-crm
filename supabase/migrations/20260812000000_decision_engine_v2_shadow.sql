-- Capability #15.2 — Decision Engine V2 shadow persistence.
-- ADDITIVE ONLY. No existing column touched, no data migrated, no V1
-- behavior changed. Safe to run at any time; the application already
-- degrades gracefully (see netlify/functions/batchdata-enrich.mjs) if
-- this migration has NOT yet been applied — decision_v2 writes are
-- caught and silently skipped, V1 continues unaffected either way.
--
-- MANUAL STEP REQUIRED: this file is not auto-applied. Run it in
-- Supabase Studio's SQL editor (or `supabase db push` if the CLI is
-- linked) before decision_v2 persistence will actually take effect.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS decision_v2 jsonb,
  ADD COLUMN IF NOT EXISTS decision_v2_updated_at timestamptz;

COMMENT ON COLUMN leads.decision_v2 IS
  'Capability #15.2 — Decision Engine V2 SHADOW output. Never read by production Action Center or any V1 scoring path. Shape: {fit, legacy_ingestion_buy_box_status, buy_box_conflict, buy_box_conflict_reason, opportunity, confidence, urgency, recommendation, next_best_action, why, risks_missing, data_conflicts, strategy, source, calculated_at, trigger, version}.';

COMMENT ON COLUMN leads.decision_v2_updated_at IS
  'Capability #15.2 — timestamp of the last V2 shadow recalculation, independent of leads.updated_at (which V1 writes continue to control).';
