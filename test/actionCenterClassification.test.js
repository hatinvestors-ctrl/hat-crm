// test/actionCenterClassification.test.js
// System Validation / Regression Review — Action Center classification
// (mission Part 6/15). `classifyLeadV2` (src/pages/ActionCenterPage.jsx)
// was previously flagged (Finding F4, source-of-truth-inventory.md) as
// "not directly unit-testable — lives in a page component with heavy UI
// imports." That turned out to be overly conservative: it's a pure
// function with no JSX evaluated at import time (JSX only runs inside
// component bodies when THEY are called, not on module load), so vitest
// can import and exercise it directly, exactly like any other lib
// function. This file closes that gap with real, direct coverage.
import { describe, it, expect } from 'vitest'
import { classifyLeadV2 } from '../src/pages/ActionCenterPage.jsx'
import { todayInBusinessTz } from '../src/lib/followUpTiming.js'
import { getGoldenLead, resolveFollowUpDates } from './fixtures/goldenLeads.js'

const decisionV2 = (overrides) => ({
  recommendation: 'MONITOR', next_best_action: 'MONITOR_PROPERTY',
  opportunity: { score: 20, reasons: [] },
  confidence: { score: 80, missing: [], reasons: [] },
  urgency: { level: 'LOW', reasons: [] },
  fit: { status: 'FIT', missing: [], reasons: [], conflicts: [] },
  why: [], calculated_at: new Date().toISOString(), version: '2.0-shadow',
  ...overrides,
})

describe('classifyLeadV2 — worklist inclusion/exclusion', () => {
  it('returns null when the lead has no decision_v2 at all (never invents a classification)', () => {
    expect(classifyLeadV2({ decision_v2: null })).toBeNull()
    expect(classifyLeadV2({})).toBeNull()
  })

  it('MONITOR and PASS recommendations are excluded from the active worklist', () => {
    expect(classifyLeadV2({ status: 'new_lead', decision_v2: decisionV2({ recommendation: 'MONITOR' }) })).toBeNull()
    expect(classifyLeadV2({ status: 'new_lead', decision_v2: decisionV2({ recommendation: 'PASS' }) })).toBeNull()
  })

  it('a Human Override (which always resolves to recommendation=PASS upstream) is excluded, never resurrected', () => {
    const lead = {
      status: 'new_lead',
      decision_v2: decisionV2({ recommendation: 'PASS', next_best_action: 'HUMAN_OVERRIDE' }),
    }
    expect(classifyLeadV2(lead)).toBeNull()
  })

  it('ACT_NOW/REVIEW_TODAY/RESEARCH map to the documented categories', () => {
    const actNow = classifyLeadV2({ status: 'new_lead', decision_v2: decisionV2({ recommendation: 'ACT_NOW' }) })
    expect(actNow.category).toBe('ACT_NOW')

    const reviewToday = classifyLeadV2({ status: 'new_lead', decision_v2: decisionV2({ recommendation: 'REVIEW_TODAY' }) })
    expect(reviewToday.category).toBe('REVIEW_TODAY')

    // RESEARCH folds into REVIEW_TODAY — no separate bucket/UI section.
    const research = classifyLeadV2({ status: 'new_lead', decision_v2: decisionV2({ recommendation: 'RESEARCH' }) })
    expect(research.category).toBe('REVIEW_TODAY')
  })

  it('FOLLOW_UP recommendation splits into OVERDUE/FOLLOW_UP_TODAY/UPCOMING by follow_up_date', () => {
    resolveFollowUpDates(todayInBusinessTz())
    const overdueLead = getGoldenLead('G21_OVERDUE')
    overdueLead.decision_v2 = decisionV2({ recommendation: 'FOLLOW_UP' })
    expect(classifyLeadV2(overdueLead).category).toBe('OVERDUE')

    const todayLead = getGoldenLead('G20_FOLLOW_UP_TODAY')
    todayLead.decision_v2 = decisionV2({ recommendation: 'FOLLOW_UP' })
    expect(classifyLeadV2(todayLead).category).toBe('FOLLOW_UP_TODAY')

    const upcomingLead = getGoldenLead('G22_UPCOMING')
    upcomingLead.decision_v2 = decisionV2({ recommendation: 'FOLLOW_UP' })
    expect(classifyLeadV2(upcomingLead).category).toBe('UPCOMING')
  })

  it('RE_ENGAGE fires only for a genuine HIGH-urgency signal, never for mere "Follow-up overdue"', () => {
    resolveFollowUpDates(todayInBusinessTz())
    // A genuine signal (price drop) on a follow-up-status lead -> RE_ENGAGE
    const reEngageLead = getGoldenLead('G23_RE_ENGAGE')
    const classified = classifyLeadV2(reEngageLead)
    expect(classified.category).toBe('RE_ENGAGE')
    expect(classified.reason).toMatch(/price reduced/i)

    // The SAME lead shape, but the only HIGH-urgency reason is "Follow-up
    // overdue" itself — must fall through to OVERDUE, not double-count as
    // RE_ENGAGE (dealExplanation.js's own documented guardrail).
    const overdueOnlyLead = getGoldenLead('G21_OVERDUE')
    overdueOnlyLead.decision_v2 = decisionV2({
      recommendation: 'FOLLOW_UP',
      urgency: { level: 'HIGH', reasons: ['Follow-up overdue'] },
    })
    expect(classifyLeadV2(overdueOnlyLead).category).toBe('OVERDUE')
  })

  it('a dead_lead status is never resurrected into RE_ENGAGE even with a HIGH urgency signal', () => {
    const lead = {
      status: 'dead_lead',
      follow_up_date: null,
      decision_v2: decisionV2({
        recommendation: 'FOLLOW_UP',
        urgency: { level: 'HIGH', reasons: ['Price reduced $50,000'] },
      }),
    }
    const classified = classifyLeadV2(lead)
    // dead_lead is not in FOLLOW_UP_STATUSES, so this can't reach the
    // RE_ENGAGE branch at all — falls through the FOLLOW_UP mapping.
    expect(classified?.category).not.toBe('RE_ENGAGE')
  })
})

describe('classifyLeadV2 — expectedProfit/maxOffer field provenance (documents current behavior — see RELEASE-READINESS.md Defect D1)', () => {
  // Confirmed by code inspection (System Validation Review, Part 9): Action
  // Center's "Expected Profit" / "Maximum Offer" read lead.deal_analysis.profit
  // and lead.mao — the AI-generated deal_analysis figure and the LEGACY flat
  // 0.75xARV-Reno-2450 formula (calculateMAO) — NOT the canonical, F1/F2-fixed
  // computeFlipResult(lead).projectedProfit/.mao that the Lead Workspace's
  // Deal tab shows. This test locks in that this is the CURRENT real
  // behavior (so a future silent change is caught), not an endorsement.
  it('expectedProfit reads lead.deal_analysis.profit verbatim, not a live Flip/BRRRR recalculation', () => {
    const lead = {
      status: 'new_lead',
      arv: 999999, renovation_cost: 1, // if this were canonical-recalculated, profit would be enormous
      deal_analysis: { profit: 12345, strategy: 'flip' },
      mao: 50000,
      decision_v2: decisionV2({ recommendation: 'ACT_NOW' }),
    }
    const classified = classifyLeadV2(lead)
    expect(classified.expectedProfit).toBe(12345)
    expect(classified.maxOffer).toBe(50000)
  })

  it('expectedProfit/maxOffer are null (never fabricated) when neither field is populated', () => {
    const lead = { status: 'new_lead', decision_v2: decisionV2({ recommendation: 'ACT_NOW' }) }
    const classified = classifyLeadV2(lead)
    expect(classified.expectedProfit).toBeNull()
    expect(classified.maxOffer).toBeNull()
  })
})
