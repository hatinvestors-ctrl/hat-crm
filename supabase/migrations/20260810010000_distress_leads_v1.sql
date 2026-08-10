-- Real Distressed Leads Pilot — Duval Lis Pendens V1, Capability #10, Cycle 3.
--
-- Minimal, additive schema. Reuses existing Capability #9 columns
-- (owner_name, owner_mailing_address, owner_last_sale_date,
-- owner_last_sale_price, enrichment_data, enriched_at) for the actual
-- property/owner data — this migration only adds the two fields that are
-- genuinely new: one JSONB bag for distress-source-specific metadata
-- (filing date, case/instrument #, source party, owner match status,
-- absentee signal, provenance) and one boolean for cheap filtering
-- (Action Center badge, future views) without parsing JSONB every time.
--
-- Deliberately NOT a dedicated distress table — property_events (Capability
-- #3, already live) already provides an append-only, typed, per-property
-- event log (`type`, `content`, `metadata JSONB`) that a 'distress_signal'
-- event slots into with zero schema change. This migration only extends
-- `leads` because the mission's Lead Detail / Action Center UI requirements
-- need fast, indexed access to "is this lead distressed" without joining
-- property_events on every render.
--
-- Kept intentionally source-agnostic (distress_data.distress_source is a
-- free string, e.g. 'lispendens_duval_clerk') so future sources (tax
-- delinquency, code violations, probate, liens) reuse the same two columns
-- with no further migration, per the mission's explicit instruction.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS distress_data JSONB,
  ADD COLUMN IF NOT EXISTS is_distressed BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS leads_is_distressed_idx ON public.leads (workspace_id, is_distressed) WHERE is_distressed = true;

-- distress_data shape (documented here, not enforced — same convention as
-- the existing enrichment_data JSONB column):
-- {
--   "distress_type": "lis_pendens",
--   "distress_source": "lispendens_duval_clerk",
--   "distress_filing_date": "2026-08-10",
--   "distress_case_or_instrument": "2026184717",
--   "source_party": "HALL CONNOR MCKENZY",
--   "current_owner": "HALL CONNOR MCKENZY",
--   "owner_match_status": "MATCH" | "POSSIBLE_MATCH" | "DIFFERENT" | "UNKNOWN",
--   "absentee_owner": true | false | "unknown",
--   "source_reference": "https://or.duvalclerk.com/ (Official Records, Doc Type: LIS PENDENS)",
--   "enrichment_status": "enriched" | "no_match" | "ambiguous" | "error"
-- }
