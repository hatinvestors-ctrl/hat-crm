-- supabase/migrations/20260606000003_agent_activities_comments.sql

-- Communication history: auto-logged email sends + manually logged calls/meetings/texts
CREATE TABLE IF NOT EXISTS public.agent_activities (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id     UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('email_sent', 'call', 'meeting', 'text', 'other')),
  note         TEXT,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_activities_agent_idx ON public.agent_activities (agent_id, occurred_at DESC);

ALTER TABLE public.agent_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members can manage agent_activities"
  ON public.agent_activities FOR ALL
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  );

-- Free-text comments from team members on an agent record
CREATE TABLE IF NOT EXISTS public.agent_comments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id     UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL,
  body         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_comments_agent_idx ON public.agent_comments (agent_id, created_at DESC);

ALTER TABLE public.agent_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members can manage agent_comments"
  ON public.agent_comments FOR ALL
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  );
