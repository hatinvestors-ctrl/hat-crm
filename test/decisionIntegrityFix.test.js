// test/decisionIntegrityFix.test.js
// P0/P1 Decision Integrity Fix — AI analysis must use canonical deal
// values and underwriting assumptions (2026-08-30).
//
// Confirmed defect (traced, not guessed): generate-core-analysis.mjs
// computed its own `computed_mao` API-response field with an entirely
// separate legacy 0.75×ARV−reno−2450 formula, independent of the
// canonical calculateFlipMAO value it had already computed and told the
// LLM to use in the very same request. For Woodleigh (ARV $200K, reno
// $39K) that legacy formula produced $108,550 — persisted into lead.mao
// — while the canonical Flip MAO (and the AI's own written narrative)
// said $102,222. Separately, DealAnalysisCard.jsx fed a locally
// re-derived copy of the SAME legacy formula into analyze-deal.mjs's
// `purchase_price` — a parameter that semantically means "the price
// we're evaluating the deal at" (Woodleigh's actual $100,000 asking
// price), not a Max Buy ceiling of any kind.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { buildPrompt } from '../netlify/functions/generate-core-analysis.mjs'
import { buildUserPrompt } from '../netlify/functions/analyze-deal.mjs'
import { computeBrrrrBreakdown } from '../src/lib/calculations.js'
import { DEFAULT_UNDERWRITING_SETTINGS } from '../src/lib/underwritingSettings.js'

const WOODLEIGH = {
  address: '1963 W Woodleigh Dr', asking_price: 100000, arv: 200000, renovation_cost: 39000,
  rent_estimate: 1350, hold_months: 6, bedrooms: 3, bathrooms: 2, sqft: 1500, zip_code: '32210',
}
const SETTINGS_75 = { ...DEFAULT_UNDERWRITING_SETTINGS, refi_ltv_pct: 75 }

const dealAnalysisCardSrc = fs.readFileSync('src/components/lead-detail/DealAnalysisCard.jsx', 'utf8')
const generateCoreAnalysisSrc = fs.readFileSync('netlify/functions/generate-core-analysis.mjs', 'utf8')
const analyzeDealSrc = fs.readFileSync('netlify/functions/analyze-deal.mjs', 'utf8')

// ── Part 2/4 — current evaluation price reaches every AI stage ────────────
describe('Part 2/4 — the CURRENT EVALUATION PRICE ($100,000), not any MAO, reaches every AI stage', () => {
  it('generate-core-analysis prompt states "Ask: $100,000" as the deal\'s current price', () => {
    const { prompt } = buildPrompt(WOODLEIGH, DEFAULT_UNDERWRITING_SETTINGS)
    expect(prompt).toMatch(/Ask: \$100,000/)
  })
  it('analyze-deal prompt states "Purchase Price: $100,000" — the actual evaluation price, not a derived MAO', () => {
    const prompt = buildUserPrompt({
      address: WOODLEIGH.address, purchase_price: 100000, arv: 200000, renovation_cost: 39000,
      monthly_rent: 1350, strategy: 'flip', hold_months: 6, underwriting_settings: DEFAULT_UNDERWRITING_SETTINGS,
    })
    expect(prompt).toMatch(/Purchase Price: \$100,000/)
  })
  it('the DealAnalysisCard client sends `purchase_price: lead.asking_price` to analyze-deal — not a locally re-derived MAO value', () => {
    expect(dealAnalysisCardSrc).toMatch(/purchase_price: lead\.asking_price,/)
    // the old defect (freshMao, a client-side legacy MAO copy) is gone
    expect(dealAnalysisCardSrc).not.toMatch(/const freshMao/)
    expect(dealAnalysisCardSrc).not.toMatch(/purchase_price: freshMao/)
  })
})

// ── Part 1/3 — legacy $108,550 fully removed from the AI pipeline ─────────
describe('Part 1/3 — the legacy 0.75×ARV−reno−2450 "computed_mao" defect is fixed, canonical Flip MAO used instead', () => {
  it('Woodleigh: buildPrompt\'s canonical computedMao is $102,222 — never the legacy $108,550', () => {
    const { computedMao } = buildPrompt(WOODLEIGH, DEFAULT_UNDERWRITING_SETTINGS)
    expect(computedMao).toBe(102222)
  })
  it('generate-core-analysis.mjs no longer independently recomputes computed_mao with the legacy formula — it reuses buildPrompt\'s own canonical value', () => {
    expect(generateCoreAnalysisSrc).not.toMatch(/const computedMaoForResponse = _arv \? Math\.round\(_arv \* 0\.75 - _reno - 2450\) : null/)
    expect(generateCoreAnalysisSrc).toMatch(/computedMao: computedMaoForResponse, computedStartingOffer\s*\}\s*=\s*buildPrompt/)
  })
  it('the literal legacy formula pattern (0.75×ARV−reno−2450) appears nowhere in live code in generate-core-analysis.mjs or DealAnalysisCard.jsx — only in explanatory comments', () => {
    for (const src of [generateCoreAnalysisSrc, dealAnalysisCardSrc]) {
      const liveCodeLines = src.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      const liveCode = liveCodeLines.join('\n')
      expect(liveCode).not.toMatch(/\* 0\.75 -.*- 2450/)
    }
  })
  it('Woodleigh: the prompt to the LLM separately and correctly labels the canonical MAO as the ceiling, distinct from the evaluation price', () => {
    const { prompt } = buildPrompt(WOODLEIGH, DEFAULT_UNDERWRITING_SETTINGS)
    expect(prompt).toMatch(/Our MAO \(canonical Flip Max Buy.*\): \$102,222/)
    expect(prompt).not.toMatch(/108,550/)
  })
})

// ── Part 5/6 — BRRRR consolidated onto the canonical engine ───────────────
describe('Part 5/6 — analyze-deal.mjs BRRRR path consolidated onto computeBrrrrBreakdown, settings-aware', () => {
  it('analyze-deal.mjs imports and delegates to the canonical computeBrrrrBreakdown (the STOP CONDITION from the prior task is explicitly lifted by this task)', () => {
    expect(analyzeDealSrc).toMatch(/import \{ computeFlipBreakdown, computeBrrrrBreakdown \} from '\.\.\/\.\.\/src\/lib\/calculations\.js'/)
    expect(analyzeDealSrc).toMatch(/const b = computeBrrrrBreakdown\(pp, arv, reno, monthlyRent, holdMonths, \{ settings \}\)/)
    // the old hand-coded flat-multiplier/clamped-cash-invested formula is
    // gone from LIVE CODE (it's still named in an explanatory comment
    // above the new function, describing what was removed and why)
    const liveCode = analyzeDealSrc.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    expect(liveCode).not.toMatch(/refiLoan \* 0\.006607/)
    expect(liveCode).not.toMatch(/Math\.max\(0, totalCashNeeded - refiCashOut\)/)
  })
  it('Woodleigh at 70% (default): analyze-deal\'s BRRRR prompt states refi loan $140,000, matching the Deal page', () => {
    const prompt = buildUserPrompt({
      address: WOODLEIGH.address, purchase_price: 100000, arv: 200000, renovation_cost: 39000,
      monthly_rent: 1350, strategy: 'brrrr', hold_months: 6, underwriting_settings: DEFAULT_UNDERWRITING_SETTINGS,
    })
    expect(prompt).toMatch(/Refi Loan \(70% ARV\): \$140,000/)
  })
  it('Woodleigh at 75%: analyze-deal\'s BRRRR prompt states refi loan $150,000 and the "75%" label — matching the Deal page and the frozen snapshot, not a stale 70%', () => {
    const prompt = buildUserPrompt({
      address: WOODLEIGH.address, purchase_price: 100000, arv: 200000, renovation_cost: 39000,
      monthly_rent: 1350, strategy: 'brrrr', hold_months: 6, underwriting_settings: SETTINGS_75,
    })
    expect(prompt).toMatch(/Refi Loan \(75% ARV\): \$150,000/)
    expect(prompt).not.toMatch(/Refi Loan \(70% ARV\)/)
    expect(prompt).not.toMatch(/\$140,000/)
  })
  it('Woodleigh at 75%: analyze-deal\'s computed refi loan matches computeBrrrrBreakdown exactly (same engine, same inputs, same settings)', () => {
    const direct = computeBrrrrBreakdown(100000, 200000, 39000, 1350, 6, { settings: SETTINGS_75 })
    const prompt = buildUserPrompt({
      address: WOODLEIGH.address, purchase_price: 100000, arv: 200000, renovation_cost: 39000,
      monthly_rent: 1350, strategy: 'brrrr', hold_months: 6, underwriting_settings: SETTINGS_75,
    })
    expect(prompt).toMatch(new RegExp(`Refi Loan \\(75% ARV\\): \\$${Math.round(direct.refiLoan).toLocaleString()}`))
  })
})

// ── Part 8 — cross-setting isolation (no cross-strategy leakage) ──────────
describe('Part 8 — 70%/75% LTV and 7%/8% selling-cost cross-system tests, no cross-strategy leakage', () => {
  it('70% LTV → analyze-deal BRRRR prompt uses 70%; 75% LTV → uses 75%', () => {
    const p70 = buildUserPrompt({ address: 'x', purchase_price: 100000, arv: 200000, renovation_cost: 39000, monthly_rent: 1350, strategy: 'brrrr', hold_months: 6, underwriting_settings: DEFAULT_UNDERWRITING_SETTINGS })
    const p75 = buildUserPrompt({ address: 'x', purchase_price: 100000, arv: 200000, renovation_cost: 39000, monthly_rent: 1350, strategy: 'brrrr', hold_months: 6, underwriting_settings: SETTINGS_75 })
    expect(p70).toMatch(/70% ARV/)
    expect(p75).toMatch(/75% ARV/)
  })
  it('changing refi LTV does NOT change the Flip prompt\'s computedMao (cross-strategy isolation)', () => {
    const r70 = buildPrompt(WOODLEIGH, DEFAULT_UNDERWRITING_SETTINGS)
    const r75 = buildPrompt(WOODLEIGH, SETTINGS_75)
    expect(r75.computedMao).toBe(r70.computedMao)
  })
  it('7% vs 8% selling cost → Flip MAO changes in both generate-core-analysis and analyze-deal, consistently, without touching BRRRR', () => {
    const s7 = DEFAULT_UNDERWRITING_SETTINGS
    const s8 = { ...DEFAULT_UNDERWRITING_SETTINGS, flip_selling_cost_pct: 8 }
    const core7 = buildPrompt(WOODLEIGH, s7)
    const core8 = buildPrompt(WOODLEIGH, s8)
    expect(core8.computedMao).toBeLessThan(core7.computedMao)

    const flip7 = buildUserPrompt({ address: 'x', purchase_price: 100000, arv: 200000, renovation_cost: 39000, strategy: 'flip', hold_months: 6, underwriting_settings: s7 })
    const flip8 = buildUserPrompt({ address: 'x', purchase_price: 100000, arv: 200000, renovation_cost: 39000, strategy: 'flip', hold_months: 6, underwriting_settings: s8 })
    expect(flip7).not.toBe(flip8) // profit numbers differ

    // BRRRR refi loan is untouched by selling-cost changes
    const brrrr7 = buildUserPrompt({ address: 'x', purchase_price: 100000, arv: 200000, renovation_cost: 39000, monthly_rent: 1350, strategy: 'brrrr', hold_months: 6, underwriting_settings: s7 })
    const brrrr8 = buildUserPrompt({ address: 'x', purchase_price: 100000, arv: 200000, renovation_cost: 39000, monthly_rent: 1350, strategy: 'brrrr', hold_months: 6, underwriting_settings: s8 })
    expect(brrrr7.match(/Refi Loan \(70% ARV\): \$[\d,]+/)[0]).toBe(brrrr8.match(/Refi Loan \(70% ARV\): \$[\d,]+/)[0])
  })
})

// ── Part 6 — underwriting settings snapshot alignment ──────────────────────
describe('Part 6 — hold_months now actually reaches analyze-deal (previously a documented, unfixed gap)', () => {
  it('analyze-deal.mjs destructures hold_months from the request body and forwards it to buildUserPrompt', () => {
    expect(analyzeDealSrc).toMatch(/hold_months = null \} = body/)
    expect(analyzeDealSrc).toMatch(/buildUserPrompt\(\{ address, purchase_price, arv, renovation_cost, monthly_rent, strategy, hold_months, underwriting_settings \}\)/)
  })
  it('a 9-month hold changes analyze-deal\'s Flip holding-cost line vs. the 6-month default', () => {
    const p6 = buildUserPrompt({ address: 'x', purchase_price: 100000, arv: 200000, renovation_cost: 39000, strategy: 'flip', hold_months: 6, underwriting_settings: DEFAULT_UNDERWRITING_SETTINGS })
    const p9 = buildUserPrompt({ address: 'x', purchase_price: 100000, arv: 200000, renovation_cost: 39000, strategy: 'flip', hold_months: 9, underwriting_settings: DEFAULT_UNDERWRITING_SETTINGS })
    expect(p6).not.toBe(p9)
    expect(p6).toMatch(/Total holding \(6 months\)/)
    expect(p9).toMatch(/Total holding \(9 months\)/)
  })
})

// ── Part 7 — business policy unchanged ─────────────────────────────────────
describe('Part 7 — business thresholds/verdict rules untouched by this data-alignment fix', () => {
  it('analyze-deal.mjs Flip/BRRRR verdict thresholds ($30,000 / cash-flow-positive-and-under-$30K) unchanged', () => {
    expect(analyzeDealSrc).toMatch(/const verdict = m\.totalProfit >= 30000 \? 'BUY' : 'PASS'/)
    expect(analyzeDealSrc).toMatch(/const verdict = \(m\.monthlyCF \?\? 0\) > 0 && \(m\.totalCashInvested \?\? Infinity\) < 30000 \? 'BUY' : 'PASS'/)
  })
  it('calculations.js — the canonical engine this task threads settings through — is untouched by this task (no new edits)', () => {
    const src = fs.readFileSync('src/lib/calculations.js', 'utf8')
    expect(src).not.toMatch(/P0\/P1 Decision Integrity Fix/)
  })
  it('Action Center\'s decisionEngineV2.js and its legacy calculateMAO remain completely untouched — explicitly out of scope', () => {
    const src = fs.readFileSync('src/lib/decisionEngineV2.js', 'utf8')
    expect(src).not.toMatch(/P0\/P1 Decision Integrity Fix/)
    expect(src).toMatch(/calculateMAO\(arv, reno/)
  })
})
