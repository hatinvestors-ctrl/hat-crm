-- Property Appraiser & Statewide Cadastral Enrichment Layer V1 — Capability #9, Cycle 3.
--
-- Reuses Capability #3's `properties` table — "ONE PROPERTY, MANY SOURCES,
-- MANY SIGNALS." Enrichment data attaches to the same property identity
-- every other signal (Property Intelligence events, Rediscovery snapshots)
-- already lives on. No new table, no parallel property universe.
--
-- Purely additive — no existing column, table, or constraint is touched.

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS parcel_id TEXT,
  ADD COLUMN IF NOT EXISTS enrichment_data JSONB,
  ADD COLUMN IF NOT EXISTS enrichment_source TEXT,
  ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMPTZ;

-- Cheap lookup by parcel ID (mirrors the existing normalized_address index's
-- role) — nullable/sparse since not every property will have a parcel_id yet.
CREATE INDEX IF NOT EXISTS properties_parcel_id_idx ON public.properties (parcel_id) WHERE parcel_id IS NOT NULL;
