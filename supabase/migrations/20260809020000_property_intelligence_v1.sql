-- Property Intelligence Engine V1 — Capability #3, Cycle 2.
--
-- The same physical property should never become two isolated
-- opportunities. This adds one property record per (workspace, address)
-- and an append-only event log against it, so re-encountering the same
-- address later accumulates history instead of losing it. MVP only — no
-- Timeline UI yet, no changes to existing `leads` table or workflow.

CREATE TABLE IF NOT EXISTS public.properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  normalized_address TEXT NOT NULL,
  address TEXT,
  city TEXT,
  state TEXT,
  zip_code TEXT,
  current_lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  event_count INT NOT NULL DEFAULT 0,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One property per normalized address per workspace — mirrors the existing
-- leads_workspace_address_unique_idx normalization exactly.
CREATE UNIQUE INDEX IF NOT EXISTS properties_workspace_normalized_address_idx
  ON public.properties (workspace_id, normalized_address);

CREATE TABLE IF NOT EXISTS public.property_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  type TEXT NOT NULL,      -- 'lead_created' | 'duplicate_attempt' | 'lead_reencountered' | ...
  content TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS property_events_property_id_idx
  ON public.property_events (property_id);
CREATE INDEX IF NOT EXISTS property_events_workspace_id_idx
  ON public.property_events (workspace_id);

ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members can access their properties"
  ON public.properties FOR ALL
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()))
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

CREATE POLICY "workspace members can access their property events"
  ON public.property_events FOR ALL
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()))
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
