-- Replace partial unique index with a plain unique index so that
-- PostgREST ON CONFLICT (workspace_id, email) works without a WHERE clause.
-- App code already guarantees email is non-null and non-empty before upsert.
DROP INDEX IF EXISTS public.agents_workspace_email_idx;

CREATE UNIQUE INDEX agents_workspace_email_idx
  ON public.agents (workspace_id, email);
