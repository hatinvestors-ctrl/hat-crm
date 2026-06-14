-- Extend agents table with relationship profile fields.
-- All columns additive with safe defaults — existing upserts that don't set these columns are unaffected.

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS agent_type            TEXT DEFAULT 'realtor'
    CHECK (agent_type IN ('realtor','wholesaler','lender','title','insurance','contractor','property_manager')),
  ADD COLUMN IF NOT EXISTS relationship_status   TEXT DEFAULT 'new'
    CHECK (relationship_status IN ('new','contacted','active','warm','high_value','dormant','do_not_contact')),
  ADD COLUMN IF NOT EXISTS source                TEXT,
  ADD COLUMN IF NOT EXISTS preferred_contact     TEXT DEFAULT 'email'
    CHECK (preferred_contact IN ('email','text','call','linkedin')),
  ADD COLUMN IF NOT EXISTS market_areas          TEXT[],
  ADD COLUMN IF NOT EXISTS deal_types_sent       TEXT[],
  ADD COLUMN IF NOT EXISTS is_strategic          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tags                  TEXT[],
  ADD COLUMN IF NOT EXISTS last_replied_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS do_not_contact_reason TEXT,
  ADD COLUMN IF NOT EXISTS linkedin_url          TEXT;

CREATE INDEX IF NOT EXISTS agents_rel_status_idx ON public.agents (workspace_id, relationship_status);
CREATE INDEX IF NOT EXISTS agents_type_idx        ON public.agents (workspace_id, agent_type);
CREATE INDEX IF NOT EXISTS agents_strategic_idx   ON public.agents (workspace_id, is_strategic) WHERE is_strategic = true;
