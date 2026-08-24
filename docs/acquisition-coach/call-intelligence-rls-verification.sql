-- Capability #25.1 — RLS verification queries.
--
-- HONEST LIMITATION: these were written and reasoned through carefully,
-- but NOT executed against a live database in this session (no test-user
-- JWTs were minted, and this environment has no local Postgres RLS test
-- harness). Run this file in the Supabase SQL editor AFTER applying the
-- migration and AFTER seeding at least: 2 workspaces (A, B), 2 users in
-- workspace A (one admin, one regular member), 1 user in workspace B, and
-- one lead + one call_sessions row per workspace.
--
-- Each block uses Postgres's `SET LOCAL request.jwt.claims` trick (the
-- same mechanism Supabase's own PostgREST layer uses) to simulate a
-- specific authenticated user for the duration of one transaction, so you
-- can prove each policy without needing real browser sessions.

-- ── Test 1: workspace isolation — user in workspace A cannot read workspace B's calls ──
BEGIN;
  SELECT set_config('request.jwt.claims', json_build_object('sub', '<USER_A_ID>')::text, true);
  SET LOCAL ROLE authenticated;
  -- Expected: zero rows for workspace B's call_sessions, even though the row exists.
  SELECT count(*) AS should_be_zero FROM public.call_sessions WHERE workspace_id = '<WORKSPACE_B_ID>';
ROLLBACK;

-- ── Test 2: regular member sees only their own calls within their workspace ──
BEGIN;
  SELECT set_config('request.jwt.claims', json_build_object('sub', '<REGULAR_USER_ID>')::text, true);
  SET LOCAL ROLE authenticated;
  -- Expected: only rows where rep_id = REGULAR_USER_ID, even if other reps
  -- in the SAME workspace have calls.
  SELECT rep_id, count(*) FROM public.call_sessions WHERE workspace_id = '<WORKSPACE_A_ID>' GROUP BY rep_id;
ROLLBACK;

-- ── Test 3: admin sees every rep's calls in their workspace ──
BEGIN;
  SELECT set_config('request.jwt.claims', json_build_object('sub', '<ADMIN_USER_ID>')::text, true);
  SET LOCAL ROLE authenticated;
  -- Expected: rows from ALL reps in workspace A, not just the admin's own.
  SELECT rep_id, count(*) FROM public.call_sessions WHERE workspace_id = '<WORKSPACE_A_ID>' GROUP BY rep_id;
ROLLBACK;

-- ── Test 4: a regular user cannot insert a call attributed to someone else ──
BEGIN;
  SELECT set_config('request.jwt.claims', json_build_object('sub', '<REGULAR_USER_ID>')::text, true);
  SET LOCAL ROLE authenticated;
  -- Expected: INSERT fails (RLS WITH CHECK violation) — rep_id does not equal auth.uid().
  INSERT INTO public.call_sessions (workspace_id, lead_id, rep_id, started_at)
  VALUES ('<WORKSPACE_A_ID>', '<SOME_LEAD_ID>', '<A_DIFFERENT_USER_ID>', now());
ROLLBACK;

-- ── Test 5: unauthenticated (anon) cannot read or write ──
BEGIN;
  SET LOCAL ROLE anon;
  -- Expected: zero rows (no request.jwt.claims set at all -> auth.uid() is null -> no policy matches).
  SELECT count(*) AS should_be_zero FROM public.call_sessions;
ROLLBACK;

-- ── Test 6: call_reviews cannot be attached to someone else's call_session ──
BEGIN;
  SELECT set_config('request.jwt.claims', json_build_object('sub', '<REGULAR_USER_ID>')::text, true);
  SET LOCAL ROLE authenticated;
  -- Expected: fails — the referenced call_session_id belongs to a DIFFERENT rep.
  INSERT INTO public.call_reviews (call_session_id, workspace_id, lead_id, rep_id)
  VALUES ('<A_CALL_SESSION_ID_OWNED_BY_SOMEONE_ELSE>', '<WORKSPACE_A_ID>', '<SOME_LEAD_ID>', '<REGULAR_USER_ID>');
ROLLBACK;

-- ── Test 7: call_sessions "finalize once" — a second outcome update is rejected ──
BEGIN;
  SELECT set_config('request.jwt.claims', json_build_object('sub', '<REGULAR_USER_ID>')::text, true);
  SET LOCAL ROLE authenticated;
  -- First update (on a row where outcome IS NULL) should succeed.
  UPDATE public.call_sessions SET outcome = 'spoke_follow_up' WHERE id = '<A_CALL_SESSION_ID_WITH_NULL_OUTCOME>';
  -- Second update on the SAME row should now match zero rows (USING clause
  -- requires outcome IS NULL, which is no longer true) — expect 0 rows affected.
  UPDATE public.call_sessions SET outcome = 'dead_lead' WHERE id = '<SAME_CALL_SESSION_ID>';
ROLLBACK;
