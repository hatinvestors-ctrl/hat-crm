-- Opportunity Rediscovery Engine V1 — Capability #4, Cycle 2.
--
-- Reuses Capability #3's `properties` table — no new Property model.
-- Adds two small columns to hold the last evaluated snapshot and the last
-- rediscovery verdict, so the Lead Detail banner can be a cheap read
-- instead of recomputing anything. Purely additive — no existing column,
-- table, or constraint is touched.

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS last_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS last_rediscovery_status TEXT,
  ADD COLUMN IF NOT EXISTS last_rediscovery_reason TEXT;
