-- supabase/migrations/20260825000000_continuous_coaching_v1.sql
-- Capability #25.2 — Continuous Coaching Intelligence
-- (coaching_focuses + coaching_focus_evaluations).
--
-- MANUAL STEP REQUIRED: NOT auto-applied. Only one Supabase project is
-- reachable in this environment (certified in #25.1 as production-
-- equivalent — no separate test/dev exists). Per explicit instruction,
-- this migration is NOT applied automatically; apply it the same way as
-- 20260824000000_call_intelligence_v1.sql (Supabase Studio SQL editor),
-- then request a live RLS certification pass identical to #25.1's before
-- treating this capability as COMPLETE.
--
-- Conventions reused from 20260824000000_call_intelligence_v1.sql
-- (certified live in #25.1): gen_random_uuid() PK, workspace_id FK ON
-- DELETE CASCADE, workspace_members-based per-rep RLS (admin sees whole
-- workspace, regular member sees only rep_id = auth.uid()), INSERT
-- WITH CHECK (rep_id = auth.uid()).

CREATE TABLE IF NOT EXISTS public.coaching_focuses (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  rep_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_call_id     UUID REFERENCES public.call_sessions(id) ON DELETE SET NULL,

  -- skill_key MUST be one of callCoaching.js's COACHING_DIMENSIONS keys —
  -- the SAME 9-dimension rubric #24/#25.1 already use. No second score
  -- model (Part 19/2 of the mission — "reuse the canonical existing rubric").
  skill_key          TEXT NOT NULL,
  title              TEXT NOT NULL,
  recommendation     TEXT NOT NULL,
  example_questions  JSONB,

  -- Deliberately simplified from the mission's ACTIVE/IMPROVING/MASTERED/
  -- REPLACED four-state suggestion (Part 5/13: "do not over-engineer
  -- status transitions"). IMPROVING is a TREND label, computed on read
  -- from coaching_focus_evaluations + call_reviews history — it is never
  -- a stored lifecycle state, so it can't drift out of sync with the real
  -- evidence. Only two real lifecycle states are persisted:
  --   ACTIVE   — currently being coached (at most one per rep, enforced
  --              at the application layer, not by a DB constraint, so a
  --              transitional double-ACTIVE moment during a status change
  --              never hard-fails a write)
  --   RESOLVED — no longer active; `resolution` says why
  status             TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RESOLVED')),
  resolution         TEXT CHECK (resolution IN ('MASTERED', 'REPLACED')),
  resolved_at        TIMESTAMPTZ,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS coaching_focuses_workspace_rep_status_idx
  ON public.coaching_focuses (workspace_id, rep_id, status);
CREATE INDEX IF NOT EXISTS coaching_focuses_workspace_rep_created_idx
  ON public.coaching_focuses (workspace_id, rep_id, created_at DESC);

-- Immutability guard (Part 16: "not allow historical coaching evidence to
-- be silently rewritten"). Postgres RLS is row-level, not column-level —
-- a single UPDATE policy can't by itself stop someone from also editing
-- `title`/`recommendation`/`skill_key`/`source_call_id` while legitimately
-- changing `status`. This trigger enforces that ONLY status/resolution/
-- resolved_at may ever change after insert; any attempt to alter the
-- historical content raises an error.
CREATE OR REPLACE FUNCTION public.coaching_focuses_guard_immutable_content()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.rep_id IS DISTINCT FROM OLD.rep_id
     OR NEW.source_call_id IS DISTINCT FROM OLD.source_call_id
     OR NEW.skill_key IS DISTINCT FROM OLD.skill_key
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.recommendation IS DISTINCT FROM OLD.recommendation
     OR NEW.example_questions IS DISTINCT FROM OLD.example_questions
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'coaching_focuses: only status/resolution/resolved_at may be updated after creation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS coaching_focuses_immutable_content ON public.coaching_focuses;
CREATE TRIGGER coaching_focuses_immutable_content
  BEFORE UPDATE ON public.coaching_focuses
  FOR EACH ROW EXECUTE FUNCTION public.coaching_focuses_guard_immutable_content();

ALTER TABLE public.coaching_focuses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "coaching_focuses select — admin sees workspace, member sees own"
  ON public.coaching_focuses FOR SELECT
  USING (
    workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())
    AND (
      rep_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.workspace_members wm
        WHERE wm.workspace_id = coaching_focuses.workspace_id AND wm.user_id = auth.uid() AND wm.role = 'admin'
      )
    )
  );

CREATE POLICY "coaching_focuses insert — only as self, only in own workspace"
  ON public.coaching_focuses FOR INSERT
  WITH CHECK (
    rep_id = auth.uid()
    AND workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())
  );

-- Status/resolution transitions only, by the owning rep — content columns
-- are protected by the trigger above regardless of this policy's row match.
CREATE POLICY "coaching_focuses update — status transitions by owning rep only"
  ON public.coaching_focuses FOR UPDATE
  USING (rep_id = auth.uid())
  WITH CHECK (rep_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.coaching_focus_evaluations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  rep_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  coaching_focus_id    UUID NOT NULL REFERENCES public.coaching_focuses(id) ON DELETE CASCADE,
  -- One evaluation per reviewed call (whichever focus was active at that
  -- time) — UNIQUE enforces this at the DB level, mirroring call_reviews'
  -- one-review-per-call guarantee from #25.1.
  call_session_id      UUID NOT NULL UNIQUE REFERENCES public.call_sessions(id) ON DELETE CASCADE,

  opportunity_existed  BOOLEAN NOT NULL,
  result               TEXT NOT NULL CHECK (result IN ('APPLIED', 'PARTIALLY_APPLIED', 'NOT_APPLIED', 'NOT_APPLICABLE')),
  why                  TEXT,
  -- Evidence — verified against the real transcript via the SAME
  -- verifyCoachingMoments()-style guard used for #24's coaching moments,
  -- BEFORE this row is ever inserted (never re-verified after the fact).
  seller_quote         TEXT,
  rep_quote            TEXT,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS coaching_focus_evaluations_focus_idx
  ON public.coaching_focus_evaluations (coaching_focus_id);
CREATE INDEX IF NOT EXISTS coaching_focus_evaluations_workspace_rep_created_idx
  ON public.coaching_focus_evaluations (workspace_id, rep_id, created_at DESC);

ALTER TABLE public.coaching_focus_evaluations ENABLE ROW LEVEL SECURITY;

-- No UPDATE policy at all — fully immutable, identical guarantee to
-- call_reviews in #25.1. An adherence determination must never drift.
CREATE POLICY "coaching_focus_evaluations select — admin sees workspace, member sees own"
  ON public.coaching_focus_evaluations FOR SELECT
  USING (
    workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())
    AND (
      rep_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.workspace_members wm
        WHERE wm.workspace_id = coaching_focus_evaluations.workspace_id AND wm.user_id = auth.uid() AND wm.role = 'admin'
      )
    )
  );

CREATE POLICY "coaching_focus_evaluations insert — only own session, own focus, only as self"
  ON public.coaching_focus_evaluations FOR INSERT
  WITH CHECK (
    rep_id = auth.uid()
    AND workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.call_sessions cs WHERE cs.id = call_session_id AND cs.rep_id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.coaching_focuses cf WHERE cf.id = coaching_focus_id AND cf.rep_id = auth.uid())
  );

COMMENT ON TABLE public.coaching_focuses IS 'Capability #25.2 — one row per coaching focus assigned to a rep. Content columns immutable after insert (trigger-enforced); only status/resolution/resolved_at may change, and only by the owning rep.';
COMMENT ON TABLE public.coaching_focus_evaluations IS 'Capability #25.2 — one immutable row per reviewed call, evaluating whether the rep applied their active coaching focus. No UPDATE policy exists at all.';
