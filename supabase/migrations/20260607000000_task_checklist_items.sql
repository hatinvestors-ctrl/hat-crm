-- supabase/migrations/20260607000000_task_checklist_items.sql

CREATE TABLE IF NOT EXISTS public.task_checklist_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  done        BOOLEAN NOT NULL DEFAULT false,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS task_checklist_items_task_idx
  ON public.task_checklist_items (task_id, sort_order ASC);

ALTER TABLE public.task_checklist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace members can manage task_checklist_items"
  ON public.task_checklist_items FOR ALL
  USING (
    task_id IN (
      SELECT id FROM public.tasks
      WHERE workspace_id IN (
        SELECT workspace_id FROM public.workspace_members
        WHERE user_id = auth.uid()
      )
    )
  );
