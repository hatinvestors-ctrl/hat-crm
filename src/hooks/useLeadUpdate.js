import { supabase } from '../lib/supabase'
import { logChanges } from '../lib/activityLogger'
import { calculateMAO } from '../lib/calculations'
import { fireLeadNotifications } from '../lib/leadNotifications'

// Returns a function `update(patch)` that updates the lead in Supabase,
// auto-recalculates MAO when ARV or renovation_cost change, and logs
// tracked changes to the activity timeline.
export function useLeadUpdate(lead, userId, members, onUpdated) {
  return async function update(patch) {
    const next = { ...lead, ...patch }

    // Auto-recalc MAO if ARV or renovation_cost changed and user didn't manually set MAO
    if ('mao' in patch === false && ('arv' in patch || 'renovation_cost' in patch)) {
      const mao = calculateMAO(next.arv, next.renovation_cost)
      if (mao !== null) patch.mao = mao
    }

    // Auto-clear follow_up_date when status moves to a terminal/closed state
    const TERMINAL = ['sold','dead_lead','rejected_not_accepted','not_in_buy_box','sequence_completed']
    if ('status' in patch && TERMINAL.includes(patch.status)) {
      patch.follow_up_date = null
    }

    const { data: updated, error } = await supabase
      .from('leads')
      .update(patch)
      .eq('id', lead.id)
      .select()
      .single()

    if (error) {
      console.error('[useLeadUpdate] failed', error)
      throw error
    }

    if (updated) {
      const userLookup = Object.fromEntries((members || []).map(m => [m.user_id, m.profiles]))
      await logChanges(lead.id, userId, lead, updated, userLookup).catch(() => {})
      console.log('[useLeadUpdate] firing notifications', { status_before: lead.status, status_after: updated.status, workspace_id: lead.workspace_id })
      fireLeadNotifications(lead, updated, lead.workspace_id, userId).catch((e) => console.error('[useLeadUpdate] fireLeadNotifications error', e))
      onUpdated?.(updated)
    }
    return updated
  }
}
