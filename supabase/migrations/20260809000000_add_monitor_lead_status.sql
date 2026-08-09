-- Add 'monitor' status for the acquisition-engine upgrade.
--
-- Properties that are interesting but don't justify Kevin's attention yet
-- (overpriced today, no motivation signal yet, etc.) are inserted with
-- status='monitor' instead of 'triage' so they do NOT show up in the Inbox
-- (InboxPage.jsx filters status='triage' explicitly — this is additive and
-- changes no existing query). They reuse the existing `snooze_until` column
-- as their wake-up timer; the daily agent re-checks monitored leads whose
-- snooze_until has passed and promotes them to 'triage' if something
-- meaningful changed (price cut, back on market, DOM threshold, etc.).
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_status_check;

ALTER TABLE public.leads
  ADD CONSTRAINT leads_status_check CHECK (status IN (
    'triage',
    'monitor',
    'new_lead',
    'mao_calculated',
    'offer_pending_hat_signing',
    'offer_signed',
    'offer_sent',
    'negotiating',
    'follow_up',
    'offer_accepted',
    'rejected_not_accepted',
    'sold',
    'flip_sold',
    'rented',
    'dead_lead',
    'move_to_sequence',
    'sequence_completed',
    'working_project',
    'automated_offers',
    'not_in_buy_box',
    'agent_rel',
    'imported'
  ));
