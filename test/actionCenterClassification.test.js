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
import { computeFlipResult } from '../src/lib/dealExplanation.js'
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

describe('classifyLeadV2 — expectedProfit/maxOffer field provenance (Defect D1 — FIXED, Product Decision: canonical deal values)', () => {
  // Was Defect D1 (see RELEASE-READINESS.md): Action Center's "Expected
  // Profit" / "Maximum Offer" used to read lead.deal_analysis.profit (AI-
  // generated) and lead.mao (legacy flat formula) — NOT the canonical
  // computeFlipResult(lead) the Lead Workspace Deal tab shows. FIXED: both
  // are now derived fresh from computeFlipResult at classification time,
  // ignoring deal_analysis.profit/lead.mao entirely for these two fields.
  it('expectedProfit/maxOffer are derived live from computeFlipResult, completely ignoring deal_analysis.profit and lead.mao', () => {
    const lead = {
      status: 'new_lead',
      arv: 220000, renovation_cost: 25000, asking_price: 126000, // canonical: profit=$38,230, Max Buy≈$133,677
      // Deliberately WRONG/stale stored figures — if these leaked through,
      // the test would see them instead of the canonical numbers below.
      deal_analysis: { profit: 12345, strategy: 'flip' },
      mao: 50000,
      decision_v2: decisionV2({ recommendation: 'ACT_NOW' }),
    }
    const canonical = computeFlipResult(lead)
    const classified = classifyLeadV2(lead)
    expect(classified.expectedProfit).toBe(canonical.projectedProfit)
    expect(classified.expectedProfit).not.toBe(12345) // never the stale AI figure
    expect(classified.maxOffer).toBe(canonical.mao)
    expect(classified.maxOffer).not.toBe(50000) // never the legacy lead.mao
  })

  it('expectedProfit/maxOffer are null (never fabricated, never falling back to stale fields) when Flip itself is unavailable', () => {
    const lead = {
      status: 'new_lead',
      deal_analysis: { profit: 99999 }, // must NOT leak through even as a fallback
      mao: 88888,
      decision_v2: decisionV2({ recommendation: 'ACT_NOW' }),
    }
    const classified = classifyLeadV2(lead)
    expect(classified.expectedProfit).toBeNull()
    expect(classified.maxOffer).toBeNull()
  })

  it('expectedProfit/maxOffer are null (never fabricated) when neither field is populated', () => {
    const lead = { status: 'new_lead', decision_v2: decisionV2({ recommendation: 'ACT_NOW' }) }
    const classified = classifyLeadV2(lead)
    expect(classified.expectedProfit).toBeNull()
    expect(classified.maxOffer).toBeNull()
  })
})
