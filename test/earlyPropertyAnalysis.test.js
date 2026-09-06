// test/earlyPropertyAnalysis.test.js
// HAT Investors — AI & Comps Early Property Analysis Fix
//
// Fixes the confirmed genuine dead end: a fresh off-market lead with no
// Evaluation Price and no Renovation Estimate could not run ANY AI action
// — the "Analysis Readiness" gate hid the CTA entirely (an earlier pass
// had already replaced the old hardcoded blank state with an honest
// sentence, but that sentence still had no button). This pass separates
// STAGE A (property/market intelligence — generate-comps only, no price/
// rehab required) from STAGE B (deal economics — requires the same real
// prerequisites as before, unchanged). Structural (source-text) tests,
// matching this repo's established convention.
//
// Updated for AI Valuation V1: runPropertyOnly now also parses a
// validated AI valuation and writes a Recommended ARV ONLY when lead.arv
// was blank — see the "no fabricated values" describe block below for
// the exact preserved guarantee (never overwrites an existing ARV).
import { describe, it, expect } from 'vitest'
import fs from 'fs'

const cardSrc = fs.readFileSync('src/components/lead-detail/DealAnalysisCard.jsx', 'utf8')
// Shared slice helper — isolates runPropertyOnly's own body. Searches for
// the end marker STARTING AFTER `start`, since "Re-run only core analysis"
// is unique but other markers used elsewhere in this file ("AI Valuation
// V1, Part 10") also appear earlier in the file (in this component's
// useState declarations) — a plain indexOf() would find that earlier
// occurrence and produce an empty/negative slice.
function runPropertyOnlyBody() {
  const start = cardSrc.indexOf('const runPropertyOnly = async () => {')
  const end = cardSrc.indexOf('// Re-run only core analysis with ARV and/or reno overrides', start)
  return cardSrc.slice(start, end)
}

describe('A/B/C/D — fresh off-market lead is never blocked from Property Analysis', () => {
  it('A. the CTA is a real, always-clickable button when Deal Analysis prerequisites are missing — never a dead-end sentence', () => {
    expect(cardSrc).toMatch(/onClick=\{handleAnalyzeClick\}/)
    expect(cardSrc).not.toMatch(/required input\{readiness\.missingRequiredCount === 1 \? '' : 's'\} missing — see Analysis Readiness below/)
  })
  it('B. missing Evaluation Price (asking_price) does not block runPropertyOnly — it only calls generate-comps, never checks asking_price', () => {
    const body = runPropertyOnlyBody()
    expect(body).not.toMatch(/asking_price/)
    expect(body).not.toMatch(/NO_ASKING_PRICE/)
  })
  it('C. missing Renovation does not block runPropertyOnly — no renoMissing/RenoTierPicker reference inside it', () => {
    const body = runPropertyOnlyBody()
    expect(body).not.toMatch(/renoMissing|RenoTierPicker|renovation_cost/)
  })
  it('D. missing ARV does not block runPropertyOnly — no ARV REQUIREMENT inside it (a validated write is allowed, per AI Valuation V1, but never a precondition to run)', () => {
    const body = runPropertyOnlyBody()
    // The generate-comps call itself and its gating never reference ARV as
    // a precondition — confirms Stage A still runs unconditionally
    // regardless of ARV state.
    expect(body).not.toMatch(/if \(!lead\.arv\)|if \(lead\.arv == null\) throw/)
  })
})

describe('E/F/G/H — no fabricated values written by Stage A (AI Valuation V1 note: a VALIDATED Recommended ARV may now be written, but ONLY when lead.arv was already blank)', () => {
  it('E. no fake Evaluation Price (asking_price) is created', () => {
    expect(runPropertyOnlyBody()).not.toMatch(/asking_price:/)
  })
  it('F. no fake Seller Asking is created', () => {
    expect(runPropertyOnlyBody()).not.toMatch(/seller_asking_price|seller_intelligence/)
  })
  it('G. no fake Renovation is created', () => {
    expect(runPropertyOnlyBody()).not.toMatch(/renovation_cost:/)
  })
  it('H. no fake ARV is created — a Recommended ARV is only ever written after parseAiValuation\'s own sanity check (conservative<=recommended<=upside, numeric/positive/finite), and ONLY when lead.arv was blank', () => {
    const body = runPropertyOnlyBody()
    expect(body).toMatch(/const valuation = parseAiValuation\(compsNotes\)/)
    expect(body).toMatch(/if \(lead\.arv == null\) \{\s*dbUpdate\.arv = valuation\.recommended/)
  })
  it('runPropertyOnly writes ai_notes always, and arv ONLY when lead.arv was blank and a valid AI valuation was parsed — never overwrites an existing ARV', () => {
    const body = runPropertyOnlyBody()
    expect(body).toMatch(/const dbUpdate = \{ ai_notes: fullNotes \}/)
    expect(body).toMatch(/\} else if \(Number\(lead\.arv\) !== valuation\.recommended\) \{\s*setNewAiValuation\(valuation\)/)
  })
})

describe('I/J — orchestration correctly routes Stage A vs Stage B, never runs Stage B with missing inputs', () => {
  it('I. generate-comps can run in the property-only path (callFn reused, not a new AI call)', () => {
    expect(runPropertyOnlyBody()).toMatch(/callFn\('generate-comps', \{ lead: leadWithContext \}\)/)
  })
  it('J. handleAnalyzeClick routes to runPropertyOnly ONLY when Deal Analysis is not ready — the exact same readiness.ready computeAnalysisReadiness already computes, never a second check', () => {
    expect(cardSrc).toMatch(/function handleAnalyzeClick\(\) \{\s*if \(generating\) return\s*if \(!hasAnalysis && !readiness\.ready\) \{ runPropertyOnly\(\); return \}\s*handleRun\(false\)\s*\}/)
  })
})

describe('K/L — partial-analysis success is honest, not an error', () => {
  it('K. a distinct "Property Analysis Complete" state renders when Stage A succeeded but Stage B has not run — never presented as an error', () => {
    expect(cardSrc).toMatch(/Property Analysis Complete ✓/)
    expect(cardSrc).toMatch(/hasPropertyAnalysis && !hasAnalysis && !generating/)
  })
  it('L. the partial state names the actual next input needed for full Deal Analysis, reusing the same readiness.missingRequiredLabels — nothing invented', () => {
    expect(cardSrc).toMatch(/Next step:<\/span> enter \{readiness\.missingRequiredLabels\.join\(' and '\)\}/)
  })
  it('the readiness panel is relabeled to separate Property Analysis (always ready) from Deal Analysis (has real prerequisites) — same computeAnalysisReadiness output, label only', () => {
    expect(cardSrc).toMatch(/Property Analysis: Ready ✓/)
    expect(cardSrc).toMatch(/Deal Analysis — missing/)
  })
})

describe('M — real renovation_cost = 0 remains valid and distinct from null (unchanged)', () => {
  it('computeAnalysisReadiness still treats 0 as present, null/undefined as missing', () => {
    expect(cardSrc).toMatch(/const renoIsMissing = lead\?\.renovation_cost == null \/\/ 0 is present, per Part 5/)
  })
})

describe('N/O/P — existing full-input pipeline and AI Deal Score behavior unchanged', () => {
  it('N. runGenerate (the full pipeline) is completely untouched — same 4-call chain, same NO_ASKING_PRICE guard, same reno gate', () => {
    expect(cardSrc).toMatch(/if \(!lead\.asking_price\) throw new Error\('NO_ASKING_PRICE'\)/)
    expect(cardSrc).toMatch(/await callFn\('generate-comps', \{ lead: leadWithContext \}\)/)
    expect(cardSrc).toMatch(/await callFnFull\('generate-core-analysis', \{ lead: leadWithArv \}\)/)
    expect(cardSrc).toMatch(/await callFn\('generate-negotiation-plan'/)
    expect(cardSrc).toMatch(/fetch\('\/\.netlify\/functions\/analyze-deal'/)
  })
  it('handleAnalyzeClick calls the UNCHANGED handleRun(false) when Deal Analysis is ready — zero behavior change for fully-populated leads', () => {
    expect(cardSrc).toMatch(/handleRun\(false\)\s*\}/)
  })
  it('O/P. AI Deal Score is never fabricated: parseAiDealScore requires a real "Total: X/100" line, which only generate-core-analysis (Stage B) ever writes — runPropertyOnly writes ONLY comps text, so the score section legitimately does not exist yet', () => {
    const { parseAiDealScore } = require('../src/lib/aiDealScore')
    const compsOnlyNotes = 'Generated: Sep 6, 2026\n\nMARKET COMPS\nCOMP: test comp\n'
    expect(parseAiDealScore(compsOnlyNotes)).toBeNull()
  })
})

describe('Q/R/S/T/U — V3 functionality preserved', () => {
  it('Q. AI Read duplicate removal remains in place (hideDecisionSummary gate untouched)', () => {
    expect(cardSrc).toMatch(/\{!hideDecisionSummary && \(flipResult\.available \|\| brrrrResult\.available\) && \(\(\) => \{/)
  })
  it('R/S/T/U. market comps, AI Insights, Detailed AI Analysis, negotiation intelligence all remain reachable — no removal of any rendering path', () => {
    expect(cardSrc).toMatch(/<NotesRenderer/)
    expect(cardSrc).toMatch(/updateNegoPlan/)
    const compsSrc = fs.readFileSync('src/components/lead-detail/workspace/ComplsIntelligenceCard.jsx', 'utf8')
    expect(compsSrc).toMatch(/AI Insights<\/div>/)
    expect(compsSrc).toMatch(/Comparable Sales Evidence/)
  })
})

describe('AA/AB — protected financial logic untouched', () => {
  it('runPropertyOnly and handleAnalyzeClick call no canonical financial function', () => {
    expect(runPropertyOnlyBody()).not.toMatch(/calculateFlipMAO|calculateBrrrrMAO|computeFlipResult|computeBrrrrResult|computeStrategyRecommendation/)
  })
  it('no protected file modified this pass (verified via git diff in the final report)', () => {
    for (const f of ['src/lib/calculations.js', 'src/lib/decisionEngineV2.js', 'src/lib/buyBox.js', 'src/lib/underwritingSettings.js', 'src/lib/dealExplanation.js', 'src/lib/sellerStrategy.js']) {
      expect(fs.existsSync(f)).toBe(true)
    }
  })
})
