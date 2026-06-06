-- supabase/migrations/20260607000001_task_reminders.sql

CREATE TABLE IF NOT EXISTS public.task_reminders (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id              UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  workspace_id         UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  event_title          TEXT NOT NULL,
  event_description    TEXT,
  event_date           TIMESTAMPTZ NOT NULL,
  invitee_ids          UUID[] NOT NULL DEFAULT '{}',
  reminder_days_before INTEGER NOT NULL DEFAULT 1,
  invited_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reminder_sent_at     TIMESTAMPTZ,
  created_by           UUID NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS task_reminders_task_idx
  ON public.task_reminders (task_id);

CREATE INDEX IF NOT EXISTS task_reminders_pending_idx
  ON public.task_reminders (workspace_id, event_date)
  WHERE reminder_sent_at IS NULL;

ALTER TABLE public.task_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members can manage task_reminders"
  ON public.task_reminders FOR ALL
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid()
    )
  );
