-- Capability #10.1 — adds 'off_market' as an explicit allowed lead_source
-- value. Doesn't match the '^[a-z][a-z0-9]*_(auto|agent)$' pattern the
-- 20260809040000 migration allows (that migration is also still NOT
-- applied — this one stands alone and doesn't depend on it), so it needs
-- an explicit literal. ONE generic value for every current/future
-- off-market/distress feed — the specific signal (Lis Pendens, tax
-- delinquency, code violation, probate, lien, ...) lives in distress_data,
-- not in a new lead_source per feed. Purely additive: every value already
-- in production keeps working exactly as today.

BEGIN;

ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_lead_source_check;

ALTER TABLE public.leads ADD CONSTRAINT leads_lead_source_check CHECK (
  lead_source IS NULL
  OR lead_source IN (
    'direct_mail', 'cold_call', 'mls', 'wholesaler', 'referral',
    'driving_for_dollars', 'web', 'imported', 'redfin_auto', 'other',
    'off_market'
  )
  OR lead_source ~ '^[a-z][a-z0-9]*_(auto|agent)$'
);

COMMIT;

-- Verification (run manually, not part of the migration):
--   SELECT id, lead_source FROM public.leads
--   WHERE lead_source IS NOT NULL
--     AND lead_source NOT IN (
--       'direct_mail','cold_call','mls','wholesaler','referral',
--       'driving_for_dollars','web','imported','redfin_auto','other','off_market'
--     )
--     AND lead_source !~ '^[a-z][a-z0-9]*_(auto|agent)$';
--   -- should return 0 rows

-- ── ROLLBACK ─────────────────────────────────────────────────────────────
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
