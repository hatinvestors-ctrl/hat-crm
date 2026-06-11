-- supabase/migrations/20260612000000_member_notification_prefs.sql
ALTER TABLE public.workspace_members
  ADD COLUMN IF NOT EXISTS notification_prefs JSONB NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.workspace_members.notification_prefs IS
  'Per-user notification preferences. Keys: assigned, status_change, offer_signed, closed, dead, comment, file_attached, deal_analysis, offer_price, follow_up_date, enriched. Missing key = enabled (true by default).';
