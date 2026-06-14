-- Agent-lead linking table and deal metrics view.
-- Separate from leads.listing_agent_email — captures all relationship types over a deal's lifecycle.

CREATE TABLE IF NOT EXISTS public.agent_leads (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id     UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  lead_id      UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'listing_agent'
    CHECK (role IN ('listing_agent','referral_source','wholesaler','buyer_agent','co_agent')),
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agent_id, lead_id, role)
);

CREATE INDEX IF NOT EXISTS agent_leads_agent_idx     ON public.agent_leads (agent_id);
CREATE INDEX IF NOT EXISTS agent_leads_lead_idx      ON public.agent_leads (lead_id);
CREATE INDEX IF NOT EXISTS agent_leads_workspace_idx ON public.agent_leads (workspace_id);

ALTER TABLE public.agent_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members can manage agent_leads"
  ON public.agent_leads FOR ALL
  USING (workspace_id IN (
    SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
  ));

CREATE OR REPLACE VIEW public.agent_deal_metrics AS
SELECT
  al.agent_id,
  al.workspace_id,
  COUNT(*)                                                                   AS deals_linked,
  COUNT(*) FILTER (WHERE l.status IN ('offer_sent','negotiating'))           AS offers_made,
  COUNT(*) FILTER (WHERE l.status = 'offer_signed')                         AS contracts_signed,
  COUNT(*) FILTER (WHERE l.status IN ('sold','flip_sold'))                   AS closings,
  MAX(al.created_at)                                                         AS last_deal_date
FROM public.agent_leads al
JOIN public.leads l ON l.id = al.lead_id
GROUP BY al.agent_id, al.workspace_id;
