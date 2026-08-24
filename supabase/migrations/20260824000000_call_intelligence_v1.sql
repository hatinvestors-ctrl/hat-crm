-- supabase/migrations/20260824000000_call_intelligence_v1.sql
-- Capability #25.1 — Persistent Call Intelligence (call_sessions + call_reviews).
--
-- MANUAL STEP REQUIRED: not auto-applied. Run in Supabase Studio's SQL
-- editor (or `supabase db push` if the CLI is linked). This migration was
-- NOT executed by the assistant — schema changes require explicit human
-- approval per this project's standing rule.
--
-- Conventions reused from 20260608000000_deal_financials.sql (the closest
-- existing precedent — a per-lead table with workspace RLS):
--   - id UUID PRIMARY KEY DEFAULT gen_random_uuid()
--   - workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE
--   - created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
--   - ON DELETE CASCADE from lead_id (a call record has no meaning once its lead is deleted)
--   - workspace_members-based RLS (`workspace_id IN (SELECT ... WHERE user_id = auth.uid())`)
--
-- Deliberate DEPARTURE from that precedent's RLS: deal_financials grants
-- every workspace member full read/write (it's shared team data). Call
-- records are personal coaching/performance data — RLS here is per-rep
-- (a regular member sees only their own calls; an admin sees the whole
-- workspace), matching Capability #25's V1 product decision ("workspace
-- ADMIN acts as Coaching Manager, no new role"). See Part 6 of the
-- mission and the final report's RLS section for the verification queries
-- this can't be auto-tested without live user sessions.

CREATE TABLE IF NOT EXISTS public.call_sessions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id             UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  lead_id                  UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  rep_id                   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  started_at               TIMESTAMPTZ NOT NULL,
  ended_at                 TIMESTAMPTZ,
  duration_seconds         INTEGER,

  outcome                  TEXT,
  follow_up_date           DATE,
  summary                  TEXT,

  seller_price_initial     NUMERIC,
  seller_price_final       NUMERIC,
  seller_price_movement    NUMERIC,

  objections                JSONB,
  -- Part 17 decision: coverage IS computed deterministically (no AI) from
  -- seller_intelligence at End Call time (getCallCoverage() — Capability
  -- #24, already exists) — persisting it here means an unreviewed call
  -- still shows real Coverage on the Calls page instead of "—".
  coverage_snapshot          JSONB,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS call_sessions_workspace_rep_started_idx
  ON public.call_sessions (workspace_id, rep_id, started_at DESC);
CREATE INDEX IF NOT EXISTS call_sessions_lead_idx
  ON public.call_sessions (lead_id);
CREATE INDEX IF NOT EXISTS call_sessions_workspace_started_idx
  ON public.call_sessions (workspace_id, started_at DESC);

ALTER TABLE public.call_sessions ENABLE ROW LEVEL SECURITY;

-- SELECT: admins see every call in their workspace; regular members see
-- only calls where they are the rep (rep_id = auth.uid()). Never cross-workspace.
CREATE POLICY "call_sessions select — admin sees workspace, member sees own"
  ON public.call_sessions FOR SELECT
  USING (
    workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())
    AND (
      rep_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.workspace_members wm
        WHERE wm.workspace_id = call_sessions.workspace_id AND wm.user_id = auth.uid() AND wm.role = 'admin'
      )
    )
  );

-- INSERT: rep_id MUST equal the inserting user's own auth.uid() — a client
-- can never write a call attributed to someone else (Part 6: "rep_id
-- cannot be supplied arbitrarily from client and trusted blindly").
-- Idempotency against a double "End Call" click is handled at the
-- application layer (catch the unique-id conflict on retry).
CREATE POLICY "call_sessions insert — only as self, only in own workspace"
  ON public.call_sessions FOR INSERT
  WITH CHECK (
    rep_id = auth.uid()
    AND workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())
  );

-- UPDATE — deliberately narrow "finalize once" policy, NOT general
-- mutability. The row is inserted the moment the rep clicks End Call
-- (identity/timing/seller-state fields all final at that point), but
-- outcome/follow_up_date/summary are only chosen afterward in the Save &
-- Schedule step. USING (outcome IS NULL) means this can only ever fire
-- once per row — once outcome is set, the row can never be targeted by
-- this policy again, which is what keeps this from becoming general
-- mutability. call_reviews has NO update policy at all — that table stays
-- fully immutable forever, which is the stronger guarantee Part 29 cares
-- about (a rep's coaching score must never drift).
CREATE POLICY "call_sessions update — rep may finalize outcome exactly once"
  ON public.call_sessions FOR UPDATE
  USING (rep_id = auth.uid() AND outcome IS NULL)
  WITH CHECK (rep_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.call_reviews (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_session_id          UUID NOT NULL UNIQUE REFERENCES public.call_sessions(id) ON DELETE CASCADE,
  workspace_id             UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  lead_id                  UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  rep_id                   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  overall_score            INTEGER,
  dimension_scores         JSONB,
  coverage                 JSONB,
  strengths                JSONB,
  missed_opportunity       JSONB,
  coaching_moments         JSONB,
  strong_moves             JSONB,

  -- Historical snapshots (Part 12/29) — frozen at review time. A later
  -- ARV/rehab edit that changes the LIVE canonical Max Buy must never
  -- alter what this row says the rep saw during the actual call.
  max_buy_snapshot         NUMERIC,
  seller_price_snapshot    NUMERIC,

  recommended_focus        TEXT,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS call_reviews_workspace_rep_created_idx
  ON public.call_reviews (workspace_id, rep_id, created_at DESC);
-- call_session_id already has a UNIQUE constraint (implicit index) —
-- enforces "one frozen review per call" (Part 11) at the database level,
-- not just in application logic.

ALTER TABLE public.call_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "call_reviews select — admin sees workspace, member sees own"
  ON public.call_reviews FOR SELECT
  USING (
    workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())
    AND (
      rep_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.workspace_members wm
        WHERE wm.workspace_id = call_reviews.workspace_id AND wm.user_id = auth.uid() AND wm.role = 'admin'
      )
    )
  );

-- INSERT: rep_id must be the caller's own id, AND the referenced
-- call_session must ALSO belong to that same caller (prevents attaching a
-- review to someone else's call_session even if workspace_id/rep_id on
-- the review row itself were spoofed to match).
CREATE POLICY "call_reviews insert — only own session, only as self"
  ON public.call_reviews FOR INSERT
  WITH CHECK (
    rep_id = auth.uid()
    AND workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.call_sessions cs
      WHERE cs.id = call_session_id AND cs.rep_id = auth.uid() AND cs.workspace_id = call_reviews.workspace_id
    )
  );

COMMENT ON TABLE public.call_sessions IS 'Capability #25.1 — one row per completed Live Copilot call, inserted at End Call. No full transcript, no raw audio. May be updated exactly once by its own rep to finalize outcome/follow_up_date/summary (RLS: only while outcome IS NULL) — never general mutability.';
COMMENT ON TABLE public.call_reviews IS 'Capability #25.1 — at most one immutable row per call_session (enforced by the UNIQUE constraint on call_session_id). Frozen historical snapshot — never recalculated when canonical ARV/Max Buy changes later.';
