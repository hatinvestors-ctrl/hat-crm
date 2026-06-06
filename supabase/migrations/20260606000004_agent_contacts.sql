-- supabase/migrations/20260606000004_agent_contacts.sql

-- Add address field to agents
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS address TEXT;

-- Multi-entry contacts: phones and emails with labels
CREATE TABLE IF NOT EXISTS public.agent_contacts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id     UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN ('phone', 'email')),
  value        TEXT NOT NULL,
  label        TEXT NOT NULL DEFAULT '',
  is_primary   BOOLEAN NOT NULL DEFAULT false,
  sort_order   INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_contacts_agent_idx
  ON public.agent_contacts (agent_id, type, sort_order);

ALTER TABLE public.agent_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members can manage agent_contacts"
  ON public.agent_contacts FOR ALL
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  );
