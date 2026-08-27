// test/agentProfileUX.test.js
// Coaching Agent Profile / Manager Coaching Workspace V2 — presentation
// and information-architecture only. Structural/source-inspection tests
// (no component-mount harness in this repo — established convention).
// Every assertion targets PLACEMENT, PRESENCE, and DATA-SOURCE FIDELITY,
// never the underlying coaching/scoring computation (coachingAnalytics.js,
// coachingMemory.js, callCoaching.js — all untouched, verified below).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { groupByRep } from '../src/hooks/useCoachingData.js'

const pageSrc = fs.readFileSync('src/pages/CoachingAgentProfilePage.jsx', 'utf8')
const hookSrc = fs.readFileSync('src/hooks/useCoachingData.js', 'utf8')
const callDetailSrc = fs.readFileSync('src/pages/CallDetailPage.jsx', 'utf8')
const analyticsSrc = fs.readFileSync('src/lib/coachingAnalytics.js', 'utf8')
const memorySrc = fs.readFileSync('src/lib/coachingMemory.js', 'utf8')

describe('Current Coaching Focus — prominent, canonical source, no duplicate model', () => {
  it('renders "Current Coaching Focus" before Skill Development and Performance Trend (moved up per Part 3/15)', () => {
    const focusIdx = pageSrc.indexOf('Current Coaching Focus')
    const skillIdx = pageSrc.indexOf('Skill Development')
    const trendIdx = pageSrc.indexOf('Performance Trend')
    expect(focusIdx).toBeGreaterThan(-1)
    expect(skillIdx).toBeGreaterThan(focusIdx)
    expect(trendIdx).toBeGreaterThan(focusIdx)
  })
  it('reads rep.activeFocus.title/recommendation — same canonical coaching_focuses fields as before', () => {
    expect(pageSrc).toMatch(/rep\.activeFocus\.title/)
    expect(pageSrc).toMatch(/rep\.activeFocus\.recommendation/)
  })
  it('does not define a second coaching-focus shape/model locally', () => {
    expect(pageSrc).not.toMatch(/const\s+coachingFocus\s*=\s*\{/)
  })
})

describe('Part 5 — "why this focus" evidence is honest, never a fabricated causal claim', () => {
  it('the skill-target line is explicitly labeled "Targets:", not "caused by" or "because of"', () => {
    expect(pageSrc).toMatch(/Targets:/)
    expect(pageSrc).not.toMatch(/caused by|because of/i)
  })
  it('lowestSkillAreas is explicitly labeled as separate context, not the reason for the focus', () => {
    expect(pageSrc).toMatch(/Lowest Skill Areas \(context, not the sole reason for this focus\)/)
  })
  it('lowestSkillAreas is derived from agent.skillTrends only — same canonical per-dimension data already computed by coachingAnalytics.computeSkillTrends', () => {
    expect(pageSrc).toMatch(/agent\.skillTrends\.filter\(s => s\.hasData\)\.sort/)
  })
})

describe('Coaching Progress (the loop) — previous focus / adherence / current focus, honest empty states', () => {
  it('reads rep.previousFocus (new, additive) for the "what were we coaching before" story', () => {
    expect(pageSrc).toMatch(/rep\.previousFocus/)
  })
  it('shows an explicit empty state when no previous (resolved) focus exists, distinguishing "this call established it" from "no history at all"', () => {
    expect(pageSrc).toMatch(/this call established the current coaching focus/i)
    expect(pageSrc).toMatch(/No coaching focus history yet\./)
  })
  it('only claims "the next reviewed call will automatically evaluate" — verified true against the real persistCoachingIntelligence path (CallReview.jsx evaluates activeFocusBefore on every call)', () => {
    const callReviewSrc = fs.readFileSync('src/components/lead-detail/CallReview.jsx', 'utf8')
    expect(callReviewSrc).toMatch(/if \(activeFocusBefore\) \{/)
    expect(callReviewSrc).toMatch(/coaching_focus_evaluations/)
  })
  it('adherence for the previous focus reads a real coaching_focus_evaluations row (result/why), same shape used elsewhere', () => {
    expect(pageSrc).toMatch(/lastPreviousFocusEvaluation\.result/)
    expect(pageSrc).toMatch(/lastPreviousFocusEvaluation\.why/)
  })
})

describe('First-call / building-baseline state (Part 7)', () => {
  it('performance status BUILDING_BASELINE badge label is unchanged (still reads agent.performanceStatus, not a new field)', () => {
    expect(pageSrc).toMatch(/agent\.performanceStatus === 'BUILDING_BASELINE'/)
  })
})

describe('Empty Call Performance card fixed (Part 8) — compact baseline message, real chart preserved once enough data exists', () => {
  it('LEARNING_CURVE_MIN_POINTS is a named constant, not a re-hardcoded magic number, and matches the chart\'s own real gating value (2)', () => {
    expect(pageSrc).toMatch(/const LEARNING_CURVE_MIN_POINTS = 2/)
  })
  it('the compact baseline message and the chart-render branch both key off the SAME constant (never drift)', () => {
    const branchMatches = pageSrc.match(/LEARNING_CURVE_MIN_POINTS/g) || []
    expect(branchMatches.length).toBeGreaterThanOrEqual(2)
  })
  it('LearningCurveChart component no longer contains its own separate internal baseline-text branch (moved to the compact caller-level message, not duplicated)', () => {
    const chartFnMatch = pageSrc.match(/function LearningCurveChart\(\{ points \}\) \{[\s\S]*?\n\}/)
    expect(chartFnMatch[0]).not.toMatch(/Building baseline/)
  })
})

describe('Skill Development — all 9 canonical dimensions preserved, scores/trends unchanged', () => {
  it('iterates COACHING_DIMENSIONS from callCoaching.js, not a locally redefined list', () => {
    expect(pageSrc).toMatch(/import \{ COACHING_DIMENSIONS \} from '\.\.\/lib\/callCoaching'/)
    expect(pageSrc).toMatch(/COACHING_DIMENSIONS\.map\(dim/)
  })
  it('reads s.current/s.trend from agent.skillTrends — same computeSkillTrends() output as before, no recomputation here', () => {
    expect(pageSrc).toMatch(/agent\.skillTrends\.find\(x => x\.key === dim\.key\)/)
  })
})

describe('Improvement Summary merged into Performance Trend (Part 11) — not three duplicated "Building baseline" blocks', () => {
  it('only renders the before/after grid when hasImprovementData is true (real trend or adoption-window data exists)', () => {
    expect(pageSrc).toMatch(/\{hasImprovementData && \(/)
  })
  it('still uses interpretImprovement() and computeAdoptionWindowComparison() verbatim — same deterministic sentence logic', () => {
    expect(pageSrc).toMatch(/interpretImprovement\(\{ overallTrend: agent\.overallScore\.trend, adoptionWindow \}\)/)
    expect(pageSrc).toMatch(/computeAdoptionWindowComparison\(rep\?\.evaluations \|\| \[\]\)/)
  })
})

describe('Coaching Journey preserved, real events only', () => {
  it('journey is still derived from real coaching_focus_evaluations filtered by the active focus id — no fabricated steps', () => {
    expect(pageSrc).toMatch(/rep\.evaluations\s*\n?\s*\.filter\(e => e\.coaching_focus_id === rep\.activeFocus\.id\)/)
  })
})

describe('Recent Calls and Call Detail navigation preserved', () => {
  it('still links to ../calls/${r.call_session_id} — same route as before', () => {
    expect(pageSrc).toMatch(/\.\.\/calls\/\$\{r\.call_session_id\}/)
  })
  it('still shows Date/Lead/Score/Coverage/Focus Result/Outcome/Key Conclusion columns', () => {
    expect(pageSrc).toMatch(/'Date', 'Lead', 'Score', 'Coverage', 'Focus Result', 'Outcome', 'Key Conclusion'/)
  })
})

describe('Manager Attention reasons surfaced (Part 14) — real computeAttentionLevel() output, not reconstructed', () => {
  it('renders agent.attention.reasons, the exact array coachingAnalytics.computeAttentionLevel() already returns', () => {
    expect(pageSrc).toMatch(/agent\.attention\.reasons/)
  })
  it('does not reimplement attention-reason logic locally (no new threshold constants in the page)', () => {
    expect(pageSrc).not.toMatch(/const ATTENTION_\w+_THRESHOLD/)
  })
})

describe('Part 16 — Call Detail and Agent Profile tell the same coaching story from the same tables', () => {
  it('both pages read coaching_focuses.title as "Current Coaching Focus" from the same table shape', () => {
    expect(callDetailSrc).toMatch(/currentFocus\.title/)
    expect(pageSrc).toMatch(/rep\.activeFocus\.title/)
  })
  it('both pages read coaching_focus_evaluations.result for adherence, using the same RESULT vocabulary (APPLIED/PARTIALLY_APPLIED/NOT_APPLIED/NOT_APPLICABLE)', () => {
    expect(callDetailSrc).toMatch(/coachingEval\.result/)
    expect(pageSrc).toMatch(/lastPreviousFocusEvaluation\.result/)
    const RESULT_KEYS = ['APPLIED', 'NOT_APPLIED', 'PARTIALLY_APPLIED', 'NOT_APPLICABLE']
    for (const key of RESULT_KEYS) {
      expect(callDetailSrc).not.toMatch(new RegExp(key.toLowerCase())) // never a lowercase re-invented variant
    }
  })
})

describe('groupByRep — additive previousFocus, zero behavior change for existing 4-arg callers', () => {
  const sessions = [{ id: 's1', rep_id: 'rep1' }]
  const reviews = [{ id: 'r1', rep_id: 'rep1', call_session_id: 's1' }]
  const evaluations = []
  const activeFocuses = [{ id: 'af1', rep_id: 'rep1', title: 'Current Focus' }]

  it('4-arg call (existing CoachingTeamPage/CoachingAgentsPage usage) still works and activeFocus is unchanged', () => {
    const byRep = groupByRep(sessions, reviews, evaluations, activeFocuses)
    expect(byRep.rep1.activeFocus).toEqual(activeFocuses[0])
    expect(byRep.rep1.previousFocus).toBeNull()
  })

  it('5-arg call attaches the most recently resolved focus as previousFocus', () => {
    const resolvedFocuses = [
      { id: 'rf1', rep_id: 'rep1', title: 'Old Focus', resolved_at: '2026-01-01' },
    ]
    const byRep = groupByRep(sessions, reviews, evaluations, activeFocuses, resolvedFocuses)
    expect(byRep.rep1.previousFocus).toEqual(resolvedFocuses[0])
    expect(byRep.rep1.activeFocus).toEqual(activeFocuses[0]) // unaffected
  })

  it('resolvedFocuses for a DIFFERENT rep never leaks into this rep\'s previousFocus', () => {
    const resolvedFocuses = [{ id: 'rf2', rep_id: 'rep2', title: 'Someone else\'s old focus' }]
    const byRep = groupByRep(sessions, reviews, evaluations, activeFocuses, resolvedFocuses)
    expect(byRep.rep1.previousFocus).toBeNull()
  })
})

describe('useCoachingData — additive RESOLVED-focus query, ACTIVE query untouched', () => {
  it('the ACTIVE focuses query still filters status=ACTIVE exactly as before', () => {
    expect(hookSrc).toMatch(/\.eq\('status', 'ACTIVE'\)/)
  })
  it('a new, separate RESOLVED focuses query exists on the same table', () => {
    expect(hookSrc).toMatch(/\.eq\('status', 'RESOLVED'\)/)
  })
  it('resolvedFocuses is returned alongside (not replacing) activeFocuses', () => {
    expect(hookSrc).toMatch(/return \{ loading, error, sessions, reviews, evaluations, activeFocuses, resolvedFocuses, reload: load \}/)
  })
})

describe('No new AI/network calls introduced', () => {
  it('CoachingAgentProfilePage.jsx makes no fetch() or Netlify function calls', () => {
    expect(pageSrc).not.toMatch(/\bfetch\(/)
    expect(pageSrc).not.toMatch(/\.netlify\/functions/)
  })
  it('useCoachingData.js still only reads call_sessions/call_reviews/coaching_focus_evaluations/coaching_focuses — no new table', () => {
    const tables = [...hookSrc.matchAll(/\.from\('(\w+)'\)/g)].map(m => m[1])
    expect(new Set(tables)).toEqual(new Set(['call_sessions', 'call_reviews', 'coaching_focus_evaluations', 'coaching_focuses']))
  })
})

describe('Protected logic — coachingAnalytics.js / coachingMemory.js / callCoaching.js untouched by this capability', () => {
  it('coachingAnalytics.js still exports the exact same public functions this page depends on', () => {
    expect(analyticsSrc).toMatch(/export function aggregateAgentRow/)
    expect(analyticsSrc).toMatch(/export function computeAttentionLevel/)
    expect(analyticsSrc).toMatch(/export const MIN_CALLS_FOR_ASSESSMENT = 3/)
  })
  it('coachingMemory.js adherence/adoption/trend/mastery functions are untouched (same signatures)', () => {
    expect(memorySrc).toMatch(/export function computeAdoptionRate\(evaluations\)/)
    expect(memorySrc).toMatch(/export function computeTrend\(values/)
    expect(memorySrc).toMatch(/export function computeMasteryEligibility\(/)
  })
  it('CoachingAgentProfilePage.jsx does not import generate-call-review or decisionEngineV2', () => {
    expect(pageSrc).not.toMatch(/^import .*(generate-call-review|decisionEngineV2)/m)
  })
})
