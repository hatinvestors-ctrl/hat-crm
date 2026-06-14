-- scheduled_messages: queue of messages the cron engine manages
CREATE TABLE IF NOT EXISTS public.scheduled_messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id      UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  enrollment_id UUID REFERENCES public.scenario_enrollments(id) ON DELETE SET NULL,
  step_id       UUID REFERENCES public.scenario_steps(id) ON DELETE SET NULL,
  scheduled_for DATE NOT NULL,
  channel       TEXT NOT NULL DEFAULT 'email',
  status        TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','draft_created','approved','sent','skipped','cancelled','failed')),
  skip_reason   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS scheduled_messages_due_idx
  ON public.scheduled_messages (workspace_id, scheduled_for, status)
  WHERE status IN ('pending','draft_created');

-- message_drafts: generated email content awaiting approval
CREATE TABLE IF NOT EXISTS public.message_drafts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  scheduled_message_id UUID REFERENCES public.scheduled_messages(id) ON DELETE CASCADE,
  agent_id             UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  subject              TEXT NOT NULL,
  body                 TEXT NOT NULL,
  generated_by         TEXT NOT NULL DEFAULT 'ai',
  generation_context   JSONB,
  approved_by          UUID,
  approved_at          TIMESTAMPTZ,
  edited_subject       TEXT,
  edited_body          TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS message_drafts_workspace_idx    ON public.message_drafts (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS message_drafts_scheduled_idx    ON public.message_drafts (scheduled_message_id);

-- send_log: full audit trail of all sends
CREATE TABLE IF NOT EXISTS public.send_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id        UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  draft_id        UUID REFERENCES public.message_drafts(id) ON DELETE SET NULL,
  sent_by         UUID,
  subject         TEXT NOT NULL,
  body            TEXT NOT NULL,
  to_email        TEXT NOT NULL,
  channel         TEXT NOT NULL DEFAULT 'email',
  scenario_id     UUID REFERENCES public.outreach_scenarios(id) ON DELETE SET NULL,
  step_id         UUID REFERENCES public.scenario_steps(id) ON DELETE SET NULL,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  smtp_message_id TEXT,
  error           TEXT
);

CREATE INDEX IF NOT EXISTS send_log_agent_idx     ON public.send_log (agent_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS send_log_workspace_idx ON public.send_log (workspace_id, sent_at DESC);

-- opt_outs: unsubscribe registry
CREATE TABLE IF NOT EXISTS public.opt_outs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  agent_id     UUID REFERENCES public.agents(id) ON DELETE SET NULL,
  reason       TEXT,
  opted_out_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, email)
);

-- RLS
ALTER TABLE public.scheduled_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_drafts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.send_log           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opt_outs           ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members can manage scheduled_messages"
  ON public.scheduled_messages FOR ALL
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

CREATE POLICY "workspace members can manage message_drafts"
  ON public.message_drafts FOR ALL
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

CREATE POLICY "workspace members can view send_log"
  ON public.send_log FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

CREATE POLICY "workspace members can manage opt_outs"
  ON public.opt_outs FOR ALL
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
