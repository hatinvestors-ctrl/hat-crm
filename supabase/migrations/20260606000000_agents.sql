-- supabase/migrations/20260606000000_agents.sql
-- Agents table: deduplicates listing agents from leads per workspace.
-- agent_outreach table: tracks every email sent to an agent.

CREATE TABLE IF NOT EXISTS public.agents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name            TEXT,
  email           TEXT,
  phone           TEXT,
  brokerage       TEXT,
  notes           TEXT,
  last_contacted_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique agent per workspace by email (case-insensitive)
CREATE UNIQUE INDEX agents_workspace_email_idx
  ON public.agents (workspace_id, LOWER(email))
  WHERE email IS NOT NULL AND email <> '';

-- RLS: workspace members can read/write their workspace agents
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members can manage agents"
  ON public.agents
  FOR ALL
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  );

CREATE TABLE IF NOT EXISTS public.agent_outreach (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id     UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL,
  template     TEXT NOT NULL,
  subject      TEXT NOT NULL,
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.agent_outreach ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members can manage agent_outreach"
  ON public.agent_outreach
  FOR ALL
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  );
