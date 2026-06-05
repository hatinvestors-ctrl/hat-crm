-- Fix: replace expression index with plain unique index for PostgREST onConflict support.
-- All agent emails are stored lowercased in application code.
DROP INDEX IF EXISTS public.agents_workspace_email_idx;

CREATE UNIQUE INDEX agents_workspace_email_idx
  ON public.agents (workspace_id, email)
  WHERE email IS NOT NULL AND email <> '';
