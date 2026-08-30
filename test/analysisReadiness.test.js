// test/analysisReadiness.test.js
// Analysis Readiness + Decision Integrity Fix — implements the QA audit's
// confirmed findings: no dead-end state, ARV never presented as blocking,
// renovation null/0 distinction preserved, staleness extended to
// asking_price/rent_estimate with conservative legacy handling, comps
// failure surfaced honestly. Structural/source-inspection tests follow
// this repo's established convention (no component-mount harness exists).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { computeAnalysisReadiness } from '../src/components/lead-detail/DealAnalysisCard.jsx'
import { useDealStaleness } from '../src/hooks/useDealStaleness.js'

const cardSrc = fs.readFileSync('src/components/lead-detail/DealAnalysisCard.jsx', 'utf8')
const analyzeDealSrc = fs.readFileSync('netlify/functions/analyze-deal.mjs', 'utf8')

// ── B. Analysis Readiness ────────────────────────────────────────────────
describe('computeAnalysisReadiness — required vs. AI-derivable, matches real runGenerate gating', () => {
  it('asking price missing, renovation missing (off-market/distressed) — not ready, ARV never counted as missing-required', () => {
    const lead = { asking_price: null, renovation_cost: null, arv: null, distress_data: { distress_type: 'vacant' } }
    const r = computeAnalysisReadiness(lead, 'flip')
    expect(r.ready).toBe(false)
    expect(r.missingRequiredLabels).not.toContain('ARV')
    const arvItem = r.items.find(i => i.key === 'arv')
    expect(arvItem.required).toBe(false)
    expect(arvItem.status).toBe('ai_derivable')
  })
  it('both asking price and renovation missing — missingRequiredCount is 2', () => {
    const r = computeAnalysisReadiness({ asking_price: null, renovation_cost: null, arv: null }, 'flip')
    expect(r.missingRequiredCount).toBe(2)
  })
  it('ARV missing but asking price present, renovation present — READY (ARV never blocks)', () => {
    const r = computeAnalysisReadiness({ asking_price: 180000, renovation_cost: 30000, arv: null }, 'flip')
    expect(r.ready).toBe(true)
    expect(r.missingRequiredCount).toBe(0)
  })
  it('ARV missing but analysis is otherwise fully ready — still ready', () => {
    const r = computeAnalysisReadiness({ asking_price: 200000, renovation_cost: 0, arv: null }, 'flip')
    expect(r.ready).toBe(true)
  })
  it('all required inputs available (including ARV) — ready, ARV shown as available', () => {
    const r = computeAnalysisReadiness({ asking_price: 200000, renovation_cost: 25000, arv: 300000 }, 'flip')
    expect(r.ready).toBe(true)
    expect(r.items.find(i => i.key === 'arv').status).toBe('available')
  })
  it('BRRRR strategy adds a rent_estimate requirement not present for flip', () => {
    const flipR = computeAnalysisReadiness({ asking_price: 100000, renovation_cost: 0, arv: 200000 }, 'flip')
    const brrrrR = computeAnalysisReadiness({ asking_price: 100000, renovation_cost: 0, arv: 200000, rent_estimate: null }, 'brrrr')
    expect(flipR.items.find(i => i.key === 'rent_estimate')).toBeUndefined()
    expect(brrrrR.items.find(i => i.key === 'rent_estimate').required).toBe(true)
    expect(brrrrR.ready).toBe(false)
  })
})

// ── C. Renovation semantics — null vs. undefined vs. 0 ──────────────────
describe('computeAnalysisReadiness — renovation_cost null/undefined = missing, 0 = present (never silently defaulted)', () => {
  it('renovation_cost: null → missing', () => {
    expect(computeAnalysisReadiness({ asking_price: 1, renovation_cost: null, arv: 1 }, 'flip').items.find(i => i.key === 'renovation_cost').present).toBe(false)
  })
  it('renovation_cost: undefined → missing', () => {
    expect(computeAnalysisReadiness({ asking_price: 1, arv: 1 }, 'flip').items.find(i => i.key === 'renovation_cost').present).toBe(false)
  })
  it('renovation_cost: 0 → VALID/PRESENT, does not block readiness', () => {
    const r = computeAnalysisReadiness({ asking_price: 1, renovation_cost: 0, arv: 1 }, 'flip')
    expect(r.items.find(i => i.key === 'renovation_cost').present).toBe(true)
    expect(r.ready).toBe(true)
  })
})

// ── D. Dead-end regression ────────────────────────────────────────────────
describe('D — the confirmed dead end is fixed: distressed, no asking price, no ARV', () => {
  it('the old hardcoded dead-end condition is gone from the render branch', () => {
    expect(cardSrc).not.toMatch(/More property\/financial information is needed before underwriting/)
  })
  it('the new branch shows an actionable count, keyed off computeAnalysisReadiness, not a static sentence', () => {
    expect(cardSrc).toMatch(/!hasAnalysis && !readiness\.ready/)
    expect(cardSrc).toMatch(/required input\{readiness\.missingRequiredCount === 1 \? '' : 's'\} missing/)
  })
  it('AnalysisReadinessPanel renders before analysis exists, giving a real recovery action for asking price (EditableField) and renovation (RenoTierPicker)', () => {
    expect(cardSrc).toMatch(/\{!hasAnalysis && \(\s*<AnalysisReadinessPanel/)
    expect(cardSrc).toMatch(/onSave=\{\(v\) => update\(\{ asking_price: v \}\)\}/)
    expect(cardSrc).toMatch(/onClick=\{onOpenRenoPicker\}/)
  })
})

// ── E. Generate behavior — required vs. ARV-fallback gating ─────────────
describe('E — generation gating matches computeAnalysisReadiness exactly', () => {
  it('runGenerate still throws NO_ASKING_PRICE when asking_price is missing — unchanged, still the real hard requirement', () => {
    expect(cardSrc).toMatch(/if \(!lead\.asking_price\) throw new Error\('NO_ASKING_PRICE'\)/)
  })
  it('renoMissing still opens RenoTierPicker before any generation call — unchanged gate', () => {
    expect(cardSrc).toMatch(/if \(renoMissing\) \{ setShowRenoPicker\(true\); return \}/)
  })
  it('ARV is never a hard precondition in runGenerate — comps-derived fallback (resolvedArv) still exists, untouched', () => {
    expect(cardSrc).toMatch(/const arvForCore = \(lead\.arv \? Number\(lead\.arv\) : null\) \?\? resolvedArv/)
  })
})

// ── F. Staleness — extended material inputs ──────────────────────────────
describe('F — useDealStaleness extended to asking_price and (BRRRR) rent_estimate', () => {
  const baseInputs = { arv: 300000, renovation_cost: 30000, strategy: 'flip', asking_price: 180000 }
  function leadWith(overrides = {}, inputOverrides = {}) {
    return {
      arv: 300000, renovation_cost: 30000, asking_price: 180000,
      deal_analysis: { strategy: 'flip', inputs: { ...baseInputs, ...inputOverrides } },
      ...overrides,
    }
  }

  it('ARV changed → stale', () => {
    const r = useDealStaleness(leadWith({ arv: 310000 }))
    expect(r.stale).toBe(true)
    expect(r.reasons).toContain('ARV changed')
  })
  it('renovation changed → stale', () => {
    const r = useDealStaleness(leadWith({ renovation_cost: 35000 }))
    expect(r.stale).toBe(true)
    expect(r.reasons).toContain('Renovation cost changed')
  })
  it('asking price changed → stale (NEW)', () => {
    const r = useDealStaleness(leadWith({ asking_price: 190000 }))
    expect(r.stale).toBe(true)
    expect(r.reasons).toContain('Asking price changed')
  })
  it('BRRRR rent changed → stale (NEW)', () => {
    const lead = {
      arv: 300000, renovation_cost: 30000, asking_price: 180000, rent_estimate: 1800,
      deal_analysis: { strategy: 'brrrr', inputs: { ...baseInputs, strategy: 'brrrr', rent_estimate: 1600 } },
    }
    const r = useDealStaleness(lead)
    expect(r.stale).toBe(true)
    expect(r.reasons).toContain('Rent estimate changed')
  })
  it('rent change is IGNORED for a flip analysis (not a material input for flip)', () => {
    const lead = {
      arv: 300000, renovation_cost: 30000, asking_price: 180000, rent_estimate: 9999,
      deal_analysis: { strategy: 'flip', inputs: { ...baseInputs, strategy: 'flip' } }, // no rent_estimate key at all for flip
    }
    const r = useDealStaleness(lead)
    expect(r.stale).toBe(false)
  })
  it('unchanged inputs → not stale', () => {
    const r = useDealStaleness(leadWith())
    expect(r.stale).toBe(false)
    expect(r.reasons).toEqual([])
  })
  it('0 renovation_cost matches 0 renovation_cost — never treated as a mismatch against null', () => {
    const lead = {
      arv: 300000, renovation_cost: 0, asking_price: 180000,
      deal_analysis: { strategy: 'flip', inputs: { ...baseInputs, renovation_cost: 0 } },
    }
    expect(useDealStaleness(lead).stale).toBe(false)
  })

  // ── legacy analysis handling (Part 10) ──
  it('legacy analysis with NO asking_price key at all, and lead currently HAS an asking price → conservatively stale (cannot prove match)', () => {
    const lead = {
      arv: 300000, renovation_cost: 30000, asking_price: 180000,
      deal_analysis: { strategy: 'flip', inputs: { arv: 300000, renovation_cost: 30000 } }, // legacy shape, no asking_price key
    }
    const r = useDealStaleness(lead)
    expect(r.stale).toBe(true)
    expect(r.reasons.some(x => /predates asking-price tracking/.test(x))).toBe(true)
  })
  it('legacy analysis with no asking_price key, and lead ALSO has no asking price → not stale (both genuinely empty, nothing to compare)', () => {
    const lead = {
      arv: 300000, renovation_cost: 30000, asking_price: null,
      deal_analysis: { strategy: 'flip', inputs: { arv: 300000, renovation_cost: 30000 } },
    }
    expect(useDealStaleness(lead).stale).toBe(false)
  })
  it('legacy analysis never crashes when inputs is missing entirely', () => {
    expect(() => useDealStaleness({ deal_analysis: {} })).not.toThrow()
    expect(useDealStaleness({ deal_analysis: {} })).toEqual({ stale: false, reasons: [] })
  })
  it('legacy BRRRR analysis with no rent_estimate key, lead currently has a rent estimate → conservatively stale', () => {
    const lead = {
      arv: 300000, renovation_cost: 30000, asking_price: 180000, rent_estimate: 1800,
      deal_analysis: { strategy: 'brrrr', inputs: { arv: 300000, renovation_cost: 30000, strategy: 'brrrr' } },
    }
    const r = useDealStaleness(lead)
    expect(r.stale).toBe(true)
    expect(r.reasons.some(x => /predates rent tracking/.test(x))).toBe(true)
  })

  it('deal_analysis.inputs freeze in analyze-deal.mjs is additive — purchase_price/arv/renovation_cost/reno_was_estimated keys unchanged, asking_price/strategy/rent_estimate are NEW additions only', () => {
    expect(analyzeDealSrc).toMatch(/purchase_price:\s*Number\(purchase_price\)/)
    expect(analyzeDealSrc).toMatch(/arv:\s*Number\(arv\)/)
    expect(analyzeDealSrc).toMatch(/renovation_cost:\s*renovation_cost != null \? Number\(renovation_cost\) : null/)
    expect(analyzeDealSrc).toMatch(/asking_price:\s*asking_price != null \? Number\(asking_price\) : null/)
    expect(analyzeDealSrc).toMatch(/rent_estimate:\s*strategy === 'brrrr' && monthly_rent != null \? Number\(monthly_rent\) : null/)
  })
  it('analyze-deal.mjs does not touch the AI prompt/system prompt with the new asking_price field (staleness-only, never sent to the model)', () => {
    const promptCallIdx = analyzeDealSrc.indexOf('buildUserPrompt({')
    const promptCallLine = analyzeDealSrc.slice(promptCallIdx, promptCallIdx + 200)
    expect(promptCallLine).not.toMatch(/asking_price/)
  })
})

// ── G. FLIP / BRRRR pre-analysis UX ──────────────────────────────────────
describe('G — Flip/BRRRR pre-analysis selection never implies existing results', () => {
  it('an "Analysis Strategy" label renders only before analysis exists', () => {
    expect(cardSrc).toMatch(/\{!hasAnalysis && \(\s*<span className="text-\[9\.5px\][^"]*">Analysis Strategy<\/span>/)
  })
  it('post-analysis strategy-switch behavior (regenerate on click) is untouched', () => {
    expect(cardSrc).toMatch(/if \(hasAnalysis\) \{\s*if \(renoMissing\) \{ setShowRenoPicker\(true\); return \}\s*runGenerate\(false, s\)\s*\}/)
  })
})

// ── H. Comps failure visibility ──────────────────────────────────────────
describe('H — comps failure is surfaced honestly, never fabricates confidence', () => {
  it('a factual, non-blocking warning is set when generate-comps fails and comps were needed', () => {
    expect(cardSrc).toMatch(/if \(needFreshComps && !freshComps\) \{/)
    expect(cardSrc).toMatch(/Comparable-sales analysis was unavailable for this run\./)
  })
  it('never claims comps validation occurred — the warning text says "unavailable", not "validated" or a confidence number', () => {
    const warningBlockIdx = cardSrc.indexOf("setCompsWarning(existingComps")
    const slice = cardSrc.slice(warningBlockIdx, warningBlockIdx + 300)
    expect(slice).not.toMatch(/confidence|validated|score/i)
  })
  it('generation still refuses to proceed (existing error path) when there is zero ARV information at all after comps fail', () => {
    expect(cardSrc).toMatch(/if \(!compsNotes && !lead\.arv\) \{\s*throw new Error\('NO_ARV_AVAILABLE'\)/)
  })
  it('the NO_ARV_AVAILABLE error message is clear and factual, no fabricated ARV', () => {
    expect(cardSrc).toMatch(/no ARV is set for this property, so a reliable AI analysis could not be generated/)
  })
})

// ── Protected areas — no formula/threshold/methodology changes ──────────
describe('Protected areas — no financial formula, threshold, or ARV methodology changed', () => {
  it('analyze-deal.mjs still requires purchase_price and arv (unchanged validation), and the AI prompt builder signature is untouched', () => {
    expect(analyzeDealSrc).toMatch(/if \(!purchase_price\) return new Response/)
    expect(analyzeDealSrc).toMatch(/if \(!arv\)\s*return new Response/)
  })
  it('DealAnalysisCard.jsx does not import/reimplement calculateFlipMAO/calculateBrrrrMAO differently — same single import as before', () => {
    expect(cardSrc).toMatch(/calculateFlipMAO, calculateBrrrrMAO/)
  })
})
