import { supabase } from '../lib/supabase'
import { logChanges } from '../lib/activityLogger'
import { calculateMAO } from '../lib/calculations'

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
      onUpdated?.(updated)
    }
    return updated
  }
}
