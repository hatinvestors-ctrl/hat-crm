// test/actionReason.test.js
// Release Readiness — explanation/classification consistency (Section 7,
// "classification explanations remain consistent with category").
import { describe, it, expect } from 'vitest'
import { getActionReason } from '../src/lib/actionReason.js'
import { todayInBusinessTz } from '../src/lib/followUpTiming.js'
import { getGoldenLead, resolveFollowUpDates } from './fixtures/goldenLeads.js'

describe('getActionReason — never contradicts the category it explains', () => {
  it('OVERDUE explanation includes an exact day count consistent with the category', () => {
    resolveFollowUpDates(todayInBusinessTz())
    const lead = getGoldenLead('G21_OVERDUE')
    const reason = getActionReason(lead, { category: 'OVERDUE' })
    expect(reason.bucket).toBe('OVERDUE')
    expect(reason.dayCount).toBeGreaterThan(0)
    expect(reason.reason).toMatch(/overdue/i)
  })

  it('RE_ENGAGE explanation surfaces the real urgency signal text, never a generic placeholder', () => {
    const lead = getGoldenLead('G23_RE_ENGAGE')
    const reason = getActionReason(lead, { category: 'RE_ENGAGE' })
    expect(reason.bucket).toBe('RE_ENGAGE')
    expect(reason.reason).not.toMatch(/^re-engagement signal$/i)
    expect(reason.evidence.length).toBeGreaterThan(0)
  })

  it('HUMAN_OVERRIDE explanation shows the real recorded reason, never fabricates one', () => {
    const lead = getGoldenLead('G25_HUMAN_OVERRIDE')
    lead.decision_v2 = { human_override: { active: true, reason: lead.acquisition_override.reason } }
    const reason = getActionReason(lead, { category: 'ACT_NOW' })
    expect(reason.reasonCode).toBe('HUMAN_OVERRIDE')
    expect(reason.reason).toContain(lead.acquisition_override.reason)
  })

  it('HUMAN_OVERRIDE with no recorded reason falls back to the exact literal, never an invented reason', () => {
    const lead = getGoldenLead('G25_HUMAN_OVERRIDE')
    lead.decision_v2 = { human_override: { active: true, reason: null } }
    const reason = getActionReason(lead, { category: 'ACT_NOW' })
    expect(reason.reason).toBe('Manually excluded — no reason recorded')
  })

  it('unknown/unsupported category returns null rather than a guessed explanation', () => {
    const lead = getGoldenLead('G01_STRONG_FLIP')
    expect(getActionReason(lead, { category: 'NOT_A_REAL_CATEGORY' })).toBeNull()
    expect(getActionReason(lead, null)).toBeNull()
  })
})
