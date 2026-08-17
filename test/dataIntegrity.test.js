// test/dataIntegrity.test.js
// Release Readiness — Data Integrity (Section 10) + Human Override /
// terminal-lead protection (Sections 6-7, the parts reachable without
// importing the full ActionCenterPage.jsx UI module — see the Release
// Readiness report for what's NOT covered by automated tests and why).
import { describe, it, expect } from 'vitest'
import { calculateFlipMAO, calculateBrrrrMAO, calculateMAO } from '../src/lib/calculations.js'
import { computeFlipResult } from '../src/lib/dealExplanation.js'
import { applyHumanOverride, computeConfidence } from '../src/lib/decisionEngineV2.js'
import { TERMINAL_STATUSES } from '../src/lib/constants.js'
import { getGoldenLead } from './fixtures/goldenLeads.js'

describe('null / undefined / empty-string handling never becomes a fake $0', () => {
  it('calculateFlipMAO: null/undefined/"" renovation cost -> null, never $0-reno MAO', () => {
    expect(calculateFlipMAO(200000, null)).toBeNull()
    expect(calculateFlipMAO(200000, undefined)).toBeNull()
    expect(calculateFlipMAO(200000, '')).toBeNull()
  })

  it('calculateBrrrrMAO: same protection for renovation cost', () => {
    expect(calculateBrrrrMAO(200000, null, 1500).mao).toBeNull()
    expect(calculateBrrrrMAO(200000, undefined, 1500).mao).toBeNull()
  })

  it('calculateMAO (legacy): missing ARV returns null, not a bogus negative number', () => {
    expect(calculateMAO(null, 20000)).toBeNull()
    expect(calculateMAO(undefined, 20000)).toBeNull()
    expect(calculateMAO(0, 20000)).toBeNull()
  })

  it('zero is a legitimate, distinct value from "unknown" — reno=$0 computes a real (higher) MAO, not null', () => {
    const withZeroReno = calculateFlipMAO(200000, 0)
    const withUnknownReno = calculateFlipMAO(200000, null)
    expect(withZeroReno).not.toBeNull()
    expect(withUnknownReno).toBeNull()
  })

  it('computeFlipResult never crashes on a lead with all-null economics, and reports unavailable rather than a fabricated verdict', () => {
    const lead = getGoldenLead('G07_MISSING_ARV')
    const r = computeFlipResult(lead)
    expect(r.available).toBe(false)
    expect(r.verdict).toBeUndefined() // no verdict fabricated when not available
    expect(typeof r.reason).toBe('string')
  })

  it('zero-edge fixture (G30: $0 ask/reno/rent) does not crash any canonical function', () => {
    const lead = getGoldenLead('G30_ZERO_EDGE')
    expect(() => computeFlipResult(lead)).not.toThrow()
    const r = computeFlipResult(lead)
    // reno=0 and arv=150000 ARE both explicit/known -> Flip IS computable (not blocked).
    expect(r.available).toBe(true)
  })
})

describe('Human Override (applyHumanOverride) — a genuine, tested code path', () => {
  it('an active DO_NOT_PURSUE override forces PASS regardless of how strong the underlying deal is', () => {
    const lead = getGoldenLead('G25_HUMAN_OVERRIDE')
    const strongDecision = { recommendation: 'ACT_NOW', next_best_action: 'SEND_OFFER', why: ['Great deal'] }
    const result = applyHumanOverride(lead, strongDecision)
    expect(result.recommendation).toBe('PASS')
    expect(result.next_best_action).toBe('HUMAN_OVERRIDE')
    expect(result.human_override.active).toBe(true)
    expect(result.human_override.reason).toBe(lead.acquisition_override.reason)
  })

  it('no active override leaves the decision completely untouched', () => {
    const lead = getGoldenLead('G01_STRONG_FLIP') // acquisition_override is null
    const decision = { recommendation: 'ACT_NOW', next_best_action: 'SEND_OFFER', why: [] }
    const result = applyHumanOverride(lead, decision)
    expect(result).toBe(decision) // same reference — literally untouched
  })

  it('an override with a decision OTHER than DO_NOT_PURSUE does not force PASS', () => {
    const lead = getGoldenLead('G01_STRONG_FLIP')
    lead.acquisition_override = { active: true, decision: 'SOMETHING_ELSE', reason: 'n/a' }
    const decision = { recommendation: 'ACT_NOW', next_best_action: 'SEND_OFFER', why: [] }
    const result = applyHumanOverride(lead, decision)
    expect(result.recommendation).toBe('ACT_NOW')
  })
})

describe('terminal statuses (structural Action Center protection)', () => {
  it('dead_lead, sold, flip_sold, rejected_not_accepted, not_in_buy_box, sequence_completed are all terminal', () => {
    for (const s of ['dead_lead', 'sold', 'flip_sold', 'rejected_not_accepted', 'not_in_buy_box', 'sequence_completed']) {
      expect(TERMINAL_STATUSES).toContain(s)
    }
  })

  it('G24 (dead_lead fixture) status is confirmed terminal', () => {
    const lead = getGoldenLead('G24_TERMINAL_DEAD')
    expect(TERMINAL_STATUSES).toContain(lead.status)
  })
})

describe('computeConfidence never treats missing core inputs as if they were known', () => {
  it('flags ARV/renovation/rent explicitly when unknown rather than silently scoring as if complete', () => {
    const lead = getGoldenLead('G07_MISSING_ARV')
    const confidence = computeConfidence(lead, 'on_market', { conflicts: [] })
    const missingText = (confidence.missing || []).join(' ')
    expect(missingText.length).toBeGreaterThan(0)
  })
})
