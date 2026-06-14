-- outreach_scenarios: scenario definitions
CREATE TABLE IF NOT EXISTS public.outreach_scenarios (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  type         TEXT NOT NULL DEFAULT 'introduction'
    CHECK (type IN ('introduction','reactivation','post_close','check_in','custom')),
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_by   UUID NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- scenario_steps: ordered steps within a scenario
CREATE TABLE IF NOT EXISTS public.scenario_steps (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id                 UUID NOT NULL REFERENCES public.outreach_scenarios(id) ON DELETE CASCADE,
  workspace_id                UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  step_number                 INT NOT NULL,
  day_offset                  INT NOT NULL DEFAULT 0,
  channel                     TEXT NOT NULL DEFAULT 'email'
    CHECK (channel IN ('email','task','note')),
  ai_scenario_type            TEXT,
  subject_override            TEXT,
  body_override               TEXT,
  use_ai                      BOOLEAN NOT NULL DEFAULT true,
  requires_approval           BOOLEAN NOT NULL DEFAULT true,
  auto_send                   BOOLEAN NOT NULL DEFAULT false,
  min_days_since_last_contact INT NOT NULL DEFAULT 7,
  stop_on_reply               BOOLEAN NOT NULL DEFAULT true,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (scenario_id, step_number)
);

CREATE INDEX IF NOT EXISTS scenario_steps_scenario_idx ON public.scenario_steps (scenario_id, step_number);

-- scenario_enrollments: one active enrollment per agent per scenario
CREATE TABLE IF NOT EXISTS public.scenario_enrollments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id      UUID NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  scenario_id   UUID NOT NULL REFERENCES public.outreach_scenarios(id) ON DELETE CASCADE,
  enrolled_by   UUID NOT NULL,
  enrolled_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  current_step  INT NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','paused','completed','cancelled','stopped_reply')),
  completed_at  TIMESTAMPTZ,
  cancelled_at  TIMESTAMPTZ,
  cancel_reason TEXT
);

-- Only one ACTIVE enrollment per agent per scenario
CREATE UNIQUE INDEX scenario_enrollments_active_idx
  ON public.scenario_enrollments (agent_id, scenario_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS scenario_enrollments_workspace_idx ON public.scenario_enrollments (workspace_id, status);
CREATE INDEX IF NOT EXISTS scenario_enrollments_agent_idx     ON public.scenario_enrollments (agent_id);

-- RLS
ALTER TABLE public.outreach_scenarios   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scenario_steps       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scenario_enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members can manage outreach_scenarios"
  ON public.outreach_scenarios FOR ALL
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

CREATE POLICY "workspace members can manage scenario_steps"
  ON public.scenario_steps FOR ALL
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));

CREATE POLICY "workspace members can manage scenario_enrollments"
  ON public.scenario_enrollments FOR ALL
  USING (workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()));
