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

      // Small Change #2 — Overview input-sync fix. Root cause: this call
      // used to be fire-and-forget (`.catch(() => {})`, no `.then`), so the
      // freshly-recalculated decision_v2 (which is what Overview's
      // "PRELIMINARY — MISSING" line actually reads, via
      // d.confidence.missing) was written to the DATABASE but never fed
      // back into the caller's local React state. The top Deal Inputs tile
      // reads `lead.renovation_cost`/`lead.arv` directly so it updated
      // instantly, while Overview kept showing the STALE decision_v2 that
      // was in state before the edit — until an unrelated reload refetched
      // the lead. Same fix DealAnalysisCard.jsx's runGenerate already uses
      // for its own writes (await recalculateDecisionV2, merge the result
      // in before calling onUpdated) — no new engine, no new field, same
      // deterministic computeDecisionV2 call, just correctly awaited and
      // merged into the SAME update() this hook already returns/notifies
      // with. shouldTriggerV2Recalc() (#15.2) still decides whether this
      // specific patch even matters (asking_price/arv/renovation_cost/
      // rent_estimate/zip_code/property_type/bedrooms/bathrooms/sqft/
      // status/etc.) — never fires for cosmetic fields, never calls an LLM.
      const freshDecision = await maybeRecalculateDecisionV2(supabase, lead, updated).catch(() => null)
      if (freshDecision) {
        updated.decision_v2 = freshDecision
        updated.decision_v2_updated_at = freshDecision.calculated_at
      }

      onUpdated?.(updated)
    }
    return updated
  }
}
