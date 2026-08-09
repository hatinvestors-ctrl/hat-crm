-- Capability #6.1 — Lead Source Expansion (Cycle 3).
--
-- NOT APPLIED. This file is a reviewable artifact only — per the mission,
-- no database change was executed and no production data was touched.
--
-- Background: Capability #6 discovered (empirically, by testing every
-- candidate value against the live database) that leads.lead_source is
-- restricted by a CHECK constraint named `leads_lead_source_check` to
-- exactly the 10 values in src/lib/constants.js LEAD_SOURCES:
--   direct_mail, cold_call, mls, wholesaler, referral,
--   driving_for_dollars, web, imported, redfin_auto, other
--
-- This blocks every future automated source named in the Cycle 3 mission
-- (zillow_auto, realtor_auto, probate_auto, tax_auto, water_auto,
-- code_auto, mls_auto, gmail_agent, facebook_auto, ...) from ever being
-- written to lead_source — importLead() (Capability #6) already works
-- around this today by defaulting to 'other', which is safe but loses the
-- ability to tell sources apart once several of them are live.
--
-- Approach chosen: widen the constraint to a PATTERN, not an ever-growing
-- explicit list. Every value already in production keeps working exactly
-- as today (all 10 are included verbatim), AND any future connector whose
-- identifier ends in `_auto` or `_agent` (matching the naming convention
-- every source named in the mission background already follows) is
-- automatically valid — with zero further migrations required as new
-- sources are added. Garbage/typo'd/empty values are still rejected; NULL
-- is still allowed (CHECK constraints pass on NULL in Postgres, unchanged
-- behavior).
--
-- Alternatives considered (see explanation in the accompanying report for
-- full trade-offs):
--   (a) DROP the constraint entirely (free text) — simplest, but loses
--       all validation, including catching a typo like 'zilllow_auto'.
--   (b) Add each new source as an explicit literal — safest per-value
--       validation, but requires a migration for every single future
--       source, defeating the "minimal engineering effort" goal.
-- This migration implements the pattern-based middle ground.

BEGIN;

ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_lead_source_check;

ALTER TABLE public.leads ADD CONSTRAINT leads_lead_source_check CHECK (
  lead_source IS NULL
  OR lead_source IN (
    'direct_mail', 'cold_call', 'mls', 'wholesaler', 'referral',
    'driving_for_dollars', 'web', 'imported', 'redfin_auto', 'other'
  )
  OR lead_source ~ '^[a-z][a-z0-9]*_(auto|agent)$'
);

COMMIT;

-- Verification queries to run manually after applying (not part of the
-- migration itself):
--
--   -- Every existing row must still satisfy the new constraint (should
--   -- return 0 rows — if it doesn't, STOP, something unexpected is in
--   -- production that this migration doesn't account for):
--   SELECT id, lead_source FROM public.leads
--   WHERE lead_source IS NOT NULL
--     AND lead_source NOT IN (
--       'direct_mail','cold_call','mls','wholesaler','referral',
--       'driving_for_dollars','web','imported','redfin_auto','other'
--     )
--     AND lead_source !~ '^[a-z][a-z0-9]*_(auto|agent)$';
--
--   -- New values that are now accepted (should all succeed with no error,
--   -- then be rolled back / deleted — do not leave test rows behind):
--   -- 'zillow_auto', 'realtor_auto', 'probate_auto', 'tax_auto',
--   -- 'water_auto', 'code_auto', 'mls_auto', 'gmail_agent', 'facebook_auto'


-- ── ROLLBACK ─────────────────────────────────────────────────────────────
-- Restores the exact original constraint (the 10-value literal list,
-- confirmed empirically during Capability #6 verification). Safe to run
-- even if some new-pattern values have since been written — existing rows
-- are never touched or deleted by a constraint change, but any INSERT/
-- UPDATE using a newly-allowed value after rollback would then fail again,
-- exactly as it did before this migration.
--
-- BEGIN;
-- ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_lead_source_check;
-- ALTER TABLE public.leads ADD CONSTRAINT leads_lead_source_check CHECK (
--   lead_source IS NULL
--   OR lead_source IN (
--     'direct_mail', 'cold_call', 'mls', 'wholesaler', 'referral',
--     'driving_for_dollars', 'web', 'imported', 'redfin_auto', 'other'
--   )
-- );
-- COMMIT;
