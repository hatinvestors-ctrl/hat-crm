-- Drop and recreate leads_status_check to include all current status values
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_status_check;

ALTER TABLE public.leads
  ADD CONSTRAINT leads_status_check CHECK (status IN (
    'triage',
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
    'dead_lead',
    'move_to_sequence',
    'sequence_completed',
    'working_project',
    'automated_offers',
    'not_in_buy_box',
    'agent_rel',
    'imported'
  ));
