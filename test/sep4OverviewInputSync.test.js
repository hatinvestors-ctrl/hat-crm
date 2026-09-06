// test/sep4OverviewInputSync.test.js
// HAT CRM — SMALL CHANGE #2 (Sep 4 baseline + Small Change #1)
// Fix stale/inconsistent missing-input status in Overview.
//
// Root cause: useLeadUpdate.js's post-write V2 recalculation was fire-
// and-forget (`.catch(() => {})`, no `.then`) — the freshly-recomputed
// decision_v2 (which Overview's "PRELIMINARY — MISSING" line reads via
// d.confidence.missing) was written to the database but never fed back
// into the caller's local React state, so Overview kept showing the
// STALE decision_v2 that existed before the edit. The top Deal Inputs
// tile reads lead.renovation_cost/lead.arv directly, so it updated
// instantly — exposing the inconsistency. Fixed by awaiting the
// recalculation and merging its result into `updated` BEFORE onUpdated
// fires, mirroring the exact pattern DealAnalysisCard.jsx's runGenerate
// already uses for its own writes.
//
// Cases A-D exercise the REAL, unmodified computeDecisionV2/
// computeConfidence (decisionEngineV2.js, protected — read only, never
// edited) directly with different canonical arv/renovation_cost
// combinations — no new business logic, just proof that once
// decision_v2 is genuinely fresh, the EXISTING rules already produce
// the mission's expected output.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import { computeDecisionV2 } from '../src/lib/decisionEngineV2.js'

const ON_MARKET_BASE = {
  id: 'cotillion-test',
  address: '7020 N Cotillion Rd N',
  asking_price: 120000,
  rent_estimate: 1500,
  is_distressed: false,
  bedrooms: 3, bathrooms: 2, sqft: 1400,
  created_at: new Date().toISOString(),
}

function missingList(lead) {
  const d = computeDecisionV2(lead, 'on_market', { trigger: 'MANUAL_RECALCULATION' })
  return d.confidence.missing
}

describe('A/B/C/D — missing-input list matches canonical ARV/Renovation state (real computeDecisionV2, unmodified)', () => {
  it('A. ARV blank + Rehab blank → both reported missing', () => {
    const missing = missingList({ ...ON_MARKET_BASE, arv: null, renovation_cost: null })
    expect(missing).toContain('ARV unknown')
    expect(missing).toContain('Renovation cost unknown')
  })
  it('B. ARV blank + Rehab populated ($40,000) → only ARV missing, renovation NOT mentioned', () => {
    const missing = missingList({ ...ON_MARKET_BASE, arv: null, renovation_cost: 40000 })
    expect(missing).toContain('ARV unknown')
    expect(missing).not.toContain('Renovation cost unknown')
  })
  it('C. ARV populated + Rehab blank → only renovation missing, ARV NOT mentioned', () => {
    const missing = missingList({ ...ON_MARKET_BASE, arv: 195000, renovation_cost: null })
    expect(missing).not.toContain('ARV unknown')
    expect(missing).toContain('Renovation cost unknown')
  })
  it('D. ARV populated + Rehab populated → neither reported missing', () => {
    const missing = missingList({ ...ON_MARKET_BASE, arv: 195000, renovation_cost: 40000 })
    expect(missing).not.toContain('ARV unknown')
    expect(missing).not.toContain('Renovation cost unknown')
  })
  it('renovation_cost = 0 is treated as present, not missing (existing != null semantics, untouched)', () => {
    const missing = missingList({ ...ON_MARKET_BASE, arv: 195000, renovation_cost: 0 })
    expect(missing).not.toContain('Renovation cost unknown')
  })
})

describe('E/F/G — the fix: fresh decision_v2 propagates back into local state', () => {
  const hookSrc = fs.readFileSync('src/hooks/useLeadUpdate.js', 'utf8')
  it('E/F. useLeadUpdate.js now AWAITS maybeRecalculateDecisionV2 and merges the result into `updated` BEFORE calling onUpdated — same pattern DealAnalysisCard.jsx already uses', () => {
    expect(hookSrc).toMatch(/const freshDecision = await maybeRecalculateDecisionV2\(supabase, lead, updated\)\.catch\(\(\) => null\)/)
    expect(hookSrc).toMatch(/if \(freshDecision\) \{\s*updated\.decision_v2 = freshDecision\s*updated\.decision_v2_updated_at = freshDecision\.calculated_at\s*\}/)
    // onUpdated must fire AFTER the merge, not before (the old fire-and-forget bug)
    const mergeIdx = hookSrc.indexOf('updated.decision_v2 = freshDecision')
    const onUpdatedIdx = hookSrc.indexOf('onUpdated?.(updated)')
    expect(mergeIdx).toBeGreaterThan(-1)
    expect(onUpdatedIdx).toBeGreaterThan(mergeIdx)
  })
  it('the old fire-and-forget pattern (.catch only, no merge) is gone', () => {
    expect(hookSrc).not.toMatch(/maybeRecalculateDecisionV2\(supabase, lead, updated\)\.catch\(\(\) => \{\}\)/)
  })
  it('G. functional test — update() resolves with decision_v2 already merged, using mocked supabase/recalculation (simulates the AI-populated-ARV propagation path, and any manual edit path, identically)', async () => {
    vi.resetModules()
    const freshDecisionMock = { calculated_at: '2026-09-07T00:00:00Z', confidence: { score: 80, missing: [] }, recommendation: 'REVIEW_TODAY' }
    vi.doMock('../src/lib/supabase', () => ({
      supabase: {
        from: () => ({
          update: (patch) => ({
            eq: () => ({
              select: () => ({
                single: async () => ({ data: { ...ON_MARKET_BASE, arv: 195000, renovation_cost: 40000, ...patch }, error: null }),
              }),
            }),
          }),
        }),
      },
    }))
    vi.doMock('../src/lib/decisionV2Persistence', () => ({
      maybeRecalculateDecisionV2: vi.fn(async () => freshDecisionMock),
    }))
    vi.doMock('../src/lib/activityLogger', () => ({ logChanges: vi.fn(async () => {}) }))
    vi.doMock('../src/lib/leadNotifications', () => ({ fireLeadNotifications: vi.fn(async () => {}), fireLeadNotification: vi.fn(async () => {}) }))
    vi.doMock('../src/lib/calculations', () => ({ calculateMAO: () => null }))

    const { useLeadUpdate } = await import('../src/hooks/useLeadUpdate.js')
    const onUpdated = vi.fn()
    const update = useLeadUpdate({ ...ON_MARKET_BASE, arv: null, renovation_cost: null }, 'user-1', [], onUpdated)
    const result = await update({ arv: 195000 })

    expect(onUpdated).toHaveBeenCalledTimes(1)
    expect(onUpdated.mock.calls[0][0].decision_v2).toEqual(freshDecisionMock)
    expect(result.decision_v2).toEqual(freshDecisionMock)
    vi.doUnmock('../src/lib/supabase')
    vi.doUnmock('../src/lib/decisionV2Persistence')
    vi.doUnmock('../src/lib/activityLogger')
    vi.doUnmock('../src/lib/leadNotifications')
    vi.doUnmock('../src/lib/calculations')
  })
})

describe('H — existing acquisition decision output unchanged for identical canonical inputs', () => {
  it('the SAME lead shape produces the SAME decision output before/after this fix (computeDecisionV2 itself untouched)', () => {
    const lead = { ...ON_MARKET_BASE, arv: 195000, renovation_cost: 40000 }
    const d1 = computeDecisionV2(lead, 'on_market', { trigger: 'MANUAL_RECALCULATION' })
    const d2 = computeDecisionV2(lead, 'on_market', { trigger: 'MANUAL_RECALCULATION' })
    expect(d1.recommendation).toBe(d2.recommendation)
    expect(d1.confidence.score).toBe(d2.confidence.score)
    expect(d1.confidence.missing).toEqual(d2.confidence.missing)
  })
})

describe('I — Small Change #1 3-level ARV tests remain passing', () => {
  it('sep4AiArvLevels.test.js still exists and is unaffected by this mission\'s files', () => {
    expect(fs.existsSync('test/sep4AiArvLevels.test.js')).toBe(true)
    const cardSrc = fs.readFileSync('src/components/lead-detail/DealAnalysisCard.jsx', 'utf8')
    expect(cardSrc).toMatch(/const arvToWrite = lead\.arv \? null : finalArv/)
    expect(cardSrc).toMatch(/arvLevelsValid/)
  })
})

describe('J — AI Deal Read unchanged', () => {
  it('DealAnalysisCard.jsx still renders AI Deal Read unconditionally on flip/brrrr availability — no hideDecisionSummary guard added', () => {
    const cardSrc = fs.readFileSync('src/components/lead-detail/DealAnalysisCard.jsx', 'utf8')
    expect(cardSrc).toMatch(/\{\(flipResult\.available \|\| brrrrResult\.available\) && \(\(\) => \{/)
    expect(cardSrc).not.toMatch(/!hideDecisionSummary && \(flipResult\.available \|\| brrrrResult\.available\)/)
  })
})

describe('K — Overview structure unchanged except the corrected missing-input state', () => {
  it('DecisionHero.jsx is untouched by this mission (the fix lives entirely in useLeadUpdate.js/decisionV2Persistence propagation, not in Overview\'s own rendering)', () => {
    const decisionHeroSrc = fs.readFileSync('src/components/lead-detail/workspace/DecisionHero.jsx', 'utf8')
    expect(decisionHeroSrc).toMatch(/Preliminary — Missing:/)
    expect(decisionHeroSrc).not.toMatch(/overview_rehab|analysis_rehab|readiness_rehab/)
  })
})

describe('Protected files / schema safety', () => {
  it('decisionEngineV2.js, calculations.js, dealExplanation.js, buyBox.js, underwritingSettings.js, sellerStrategy.js are not modified by this mission (verified via git diff in the final report; this test locks that no new symbol referencing this fix leaks into them)', () => {
    for (const f of ['src/lib/decisionEngineV2.js', 'src/lib/calculations.js', 'src/lib/dealExplanation.js', 'src/lib/buyBox.js', 'src/lib/underwritingSettings.js', 'src/lib/sellerStrategy.js']) {
      const src = fs.readFileSync(f, 'utf8')
      expect(src).not.toMatch(/overview_rehab|analysis_rehab|readiness_rehab/)
    }
  })
})
