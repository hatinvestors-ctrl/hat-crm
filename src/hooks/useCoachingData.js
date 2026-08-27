// src/hooks/useCoachingData.js
// Capability #25.3 — Coaching Center data access layer. Four bounded
// queries (Part 24: "avoid N+1, fetch team-level datasets in bounded
// queries, aggregate client-side"), never per-rep/per-call round trips.
// No transcript, no raw audio, no AI calls — pure reads of the tables
// already certified live in #25.1/#25.2. RLS does all workspace/role
// scoping; this hook adds no filtering logic of its own beyond workspace_id.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const SESSIONS_LIMIT = 500
const REVIEWS_LIMIT = 500
const EVALS_LIMIT = 1000

export function useCoachingData(workspaceId) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [sessions, setSessions] = useState([])
  const [reviews, setReviews] = useState([])
  const [evaluations, setEvaluations] = useState([])
  const [activeFocuses, setActiveFocuses] = useState([])
  // Coaching Agent Profile / Manager Coaching Workspace V2, Part 2/6 —
  // additive read only. The "Coaching Progress" (previous focus → this
  // call → current focus) story requires the REP'S RESOLVED coaching
  // focuses too, which no page previously fetched (only ACTIVE ones).
  // This is a second, separate query — it does NOT change the meaning or
  // contents of `activeFocuses` above, so every existing consumer
  // (CoachingTeamPage, CoachingAgentsPage, the old Agent Profile
  // behavior) is completely unaffected. Same table, same RLS scoping,
  // just also reading rows with status='RESOLVED'.
  const [resolvedFocuses, setResolvedFocuses] = useState([])

  const load = useCallback(async () => {
    if (!workspaceId) return
    setLoading(true)
    setError(null)
    try {
      const [sessionsRes, reviewsRes, evalsRes, focusesRes, resolvedFocusesRes] = await Promise.all([
        supabase.from('call_sessions')
          .select('id,lead_id,rep_id,started_at,outcome,duration_seconds,coverage_snapshot,leads(address,city)')
          .eq('workspace_id', workspaceId).order('started_at', { ascending: false }).limit(SESSIONS_LIMIT),
        supabase.from('call_reviews')
          // Context-Aware Coaching Hardening V1 — call_context (frozen at
          // review time) added, additive/nullable, legacy rows read as
          // null. Everything else in this select is unchanged.
          .select('id,call_session_id,rep_id,overall_score,dimension_scores,coverage,strengths,missed_opportunity,coaching_moments,strong_moves,max_buy_snapshot,seller_price_snapshot,call_context,created_at')
          .eq('workspace_id', workspaceId).order('created_at', { ascending: true }).limit(REVIEWS_LIMIT),
        supabase.from('coaching_focus_evaluations')
          .select('rep_id,coaching_focus_id,call_session_id,result,opportunity_existed,why,seller_quote,rep_quote,created_at')
          .eq('workspace_id', workspaceId).order('created_at', { ascending: true }).limit(EVALS_LIMIT),
        supabase.from('coaching_focuses')
          .select('id,rep_id,skill_key,title,recommendation,example_questions,status,created_at')
          .eq('workspace_id', workspaceId).eq('status', 'ACTIVE'),
        supabase.from('coaching_focuses')
          .select('id,rep_id,skill_key,title,recommendation,example_questions,status,resolution,resolved_at,created_at')
          .eq('workspace_id', workspaceId).eq('status', 'RESOLVED')
          .order('resolved_at', { ascending: false }).limit(EVALS_LIMIT),
      ])
      const firstError = sessionsRes.error || reviewsRes.error || evalsRes.error || focusesRes.error || resolvedFocusesRes.error
      if (firstError) throw firstError
      setSessions(sessionsRes.data || [])
      setReviews(reviewsRes.data || [])
      setEvaluations(evalsRes.data || [])
      setActiveFocuses(focusesRes.data || [])
      setResolvedFocuses(resolvedFocusesRes.data || [])
    } catch (err) {
      setError(err.message || 'Could not load coaching data.')
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => { load() }, [load])

  return { loading, error, sessions, reviews, evaluations, activeFocuses, resolvedFocuses, reload: load }
}

// Groups already-fetched rows by rep_id — a plain client-side partition,
// not a query. Used by every Coaching page so the "per-rep history" shape
// is computed once, consistently.
// `resolvedFocuses` is optional (5th param) and purely additive — every
// existing 4-arg call site (CoachingTeamPage, CoachingAgentsPage) is
// unaffected; only Agent Profile passes it, to derive `previousFocus`
// (the rep's most recently RESOLVED focus, if any) for the Coaching
// Progress story. No new coaching-focus model — same rows, same table.
export function groupByRep(sessions, reviews, evaluations, activeFocuses, resolvedFocuses = []) {
  const repIds = new Set([
    ...sessions.map(s => s.rep_id),
    ...reviews.map(r => r.rep_id),
  ])
  const byRep = {}
  for (const repId of repIds) {
    const repResolved = resolvedFocuses.filter(f => f.rep_id === repId) // already ordered resolved_at desc
    byRep[repId] = {
      repId,
      sessions: sessions.filter(s => s.rep_id === repId),
      reviews: reviews.filter(r => r.rep_id === repId),
      evaluations: evaluations.filter(e => e.rep_id === repId),
      activeFocus: activeFocuses.find(f => f.rep_id === repId) || null,
      previousFocus: repResolved[0] || null,
    }
  }
  return byRep
}
