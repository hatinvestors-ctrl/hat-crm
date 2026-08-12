import { supabase } from '../lib/supabase'
import { logChanges } from '../lib/activityLogger'
import { calculateMAO } from '../lib/calculations'
import { fireLeadNotifications, fireLeadNotification } from '../lib/leadNotifications'
import { maybeRecalculateDecisionV2 } from '../lib/decisionV2Persistence'

export function useLeadUpdate(lead, userId, members, onUpdated) {
  return async function update(patch) {
    const next = { ...lead, ...patch }

    // Auto-recalc MAO if ARV or renovation_cost changed and user didn't manually set MAO.
    // Exception: auto-imported leads (Redfin etc.) before their first AI analysis — their ARV is
    // unvalidated until comps run, so we don't want a premature MAO showing. MAO gets set by the
    // AI analysis (AINotesSection) once comps confirm the ARV.
    const isPreAnalysisAutoImport = lead.auto_imported && !lead.deal_analysis
    if ('mao' in patch === false && ('arv' in patch || 'renovation_cost' in patch) && !isPreAnalysisAutoImport) {
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
      fireLeadNotifications(lead, updated, lead.workspace_id, userId).catch(() => {})

      // assigned
      if ('assigned_to' in patch && patch.assigned_to !== lead.assigned_to) {
        fireLeadNotification('assigned', lead.id, lead.workspace_id, userId).catch(() => {})
      }

      // follow_up_date
      if ('follow_up_date' in patch && patch.follow_up_date !== lead.follow_up_date) {
        fireLeadNotification('follow_up_date', lead.id, lead.workspace_id, userId, {
          new_value: patch.follow_up_date || '(cleared)',
        }).catch(() => {})
      }

      onUpdated?.(updated)

      // Capability #15.5.1, Section 5 — deterministic V2 recalculation on
      // every real structured edit through the ONE hook every field edit
      // in the app already goes through. shouldTriggerV2Recalc() (#15.2)
      // decides whether this specific patch actually matters (asking_price/
      // arv/renovation_cost/rent_estimate/zip_code/property_type/bedrooms/
      // bathrooms/sqft/status/etc.) — never fires for cosmetic fields, never
      // calls an LLM. Fire-and-forget: never delays the UI update.
      maybeRecalculateDecisionV2(supabase, lead, updated).catch(() => {})
    }
    return updated
  }
}
