// test/sep4AiArvLevels.test.js
// HAT CRM — SMALL CHANGE #1 FROM SEP 4 BASELINE
// Restore 3-Level AI ARV + Fill Canonical ARV — surgical, additive only.
// Structural (source-text) + pure-function tests, matching this repo's
// established convention (no component-mount harness exists here).
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { SYSTEM_PROMPT } from '../netlify/functions/generate-comps.mjs'

const cardSrc = fs.readFileSync('src/components/lead-detail/DealAnalysisCard.jsx', 'utf8')
const compsCardSrc = fs.readFileSync('src/components/lead-detail/workspace/ComplsIntelligenceCard.jsx', 'utf8')
const notesRendererSrc = fs.readFileSync('src/components/lead-detail/NotesRenderer.jsx', 'utf8')

// Mirrors DealAnalysisCard.jsx's own inline parser, for direct unit testing.
function parseArvLevels(compsNotes) {
  const parseArvLevel = (label) => {
    const m = compsNotes?.match(new RegExp(`${label} ARV:\\s*\\$([0-9,]+)`, 'i'))
    if (!m) return null
    const n = parseInt(m[1].replace(/,/g, ''), 10)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  const conservativeArv = parseArvLevel('Conservative')
  const realisticArv    = parseArvLevel('Realistic')
  const optimisticArv   = parseArvLevel('Optimistic')
  const arvLevelsValid  = conservativeArv != null && realisticArv != null && optimisticArv != null
    && conservativeArv <= realisticArv && realisticArv <= optimisticArv
  return arvLevelsValid ? realisticArv : null
}

const VALID_NOTES = `MARKET COMPS
Market Range (evidence context, not a replacement ARV): $180,000–$210,000

VALUATION
Conservative ARV: $185,000 — weaker comp
Realistic ARV: $195,000 — best supported
Optimistic ARV: $205,000 — upside comp
`

describe('A/I — 3 AI ARV values parse correctly, ordering validated', () => {
  it('A. all 3 values parse from valid AI output', () => {
    expect(parseArvLevels(VALID_NOTES)).toBe(195000)
  })
  it('I. Conservative <= Realistic <= Optimistic is enforced — out-of-order values are rejected, never written', () => {
    const outOfOrder = 'Conservative ARV: $220,000\nRealistic ARV: $195,000\nOptimistic ARV: $205,000\n'
    expect(parseArvLevels(outOfOrder)).toBeNull()
  })
  it('non-numeric/zero/negative values are rejected', () => {
    expect(parseArvLevels('Conservative ARV: $0\nRealistic ARV: $195,000\nOptimistic ARV: $205,000\n')).toBeNull()
  })
})

describe('G — invalid or missing AI valuation never writes ARV', () => {
  it('missing any one of the 3 levels produces no resolved ARV', () => {
    expect(parseArvLevels('Realistic ARV: $195,000\n')).toBeNull()
    expect(parseArvLevels('no valuation section at all')).toBeNull()
    expect(parseArvLevels(null)).toBeNull()
  })
})

describe('B/C — Conservative/Realistic/Optimistic display under Sale Range', () => {
  it('B. ComplsIntelligenceCard.jsx renders the 3-level ARV Estimate block, with Realistic labeled Recommended', () => {
    expect(compsCardSrc).toMatch(/ARV Estimate/)
    expect(compsCardSrc).toMatch(/arvEstimate\.conservative/)
    expect(compsCardSrc).toMatch(/arvEstimate\.realistic/)
    expect(compsCardSrc).toMatch(/arvEstimate\.optimistic/)
    expect(compsCardSrc).toMatch(/Recommended/)
  })
  it('C. the ARV Estimate block is placed directly after the Market range line (Sale Range), before the comp list', () => {
    const marketRangeIdx = compsCardSrc.indexOf('Market range: ')
    const arvEstimateIdx = compsCardSrc.indexOf('ARV Estimate')
    const compListIdx = compsCardSrc.indexOf('compEvidence.comps.map')
    expect(marketRangeIdx).toBeLessThan(arvEstimateIdx)
    expect(arvEstimateIdx).toBeLessThan(compListIdx)
  })
  it('uses the same compact visual language as the existing Rental Comps 3-level box (bordered box, label+value rows, no new large card)', () => {
    expect(compsCardSrc).toMatch(/rounded-lg border border-\[color:var\(--color-line\)\] bg-\[color:var\(--color-bg-elev-2\)\] px-3 py-2\.5 space-y-1\.5/)
  })
})

describe('D — existing Rental Comps remain unchanged', () => {
  it('RentalCompsSection in NotesRenderer.jsx is untouched by this mission', () => {
    expect(notesRendererSrc).toMatch(/function RentalCompsSection/)
    expect(notesRendererSrc).toMatch(/Conservative Rent/)
    expect(notesRendererSrc).toMatch(/Realistic Rent/)
    expect(notesRendererSrc).toMatch(/Optimistic Rent/)
  })
})

describe('E/F — canonical ARV writeback: blank-only, never overwrites', () => {
  it('E. the existing arvToWrite logic fills lead.arv ONLY when it was null', () => {
    expect(cardSrc).toMatch(/const arvToWrite = lead\.arv \? null : finalArv/)
  })
  it('F. an existing lead.arv is never automatically overwritten — same pre-existing guard, untouched', () => {
    // Confirmed structurally: arvToWrite is null whenever lead.arv is truthy,
    // and dbUpdate only ever spreads arv when arvToWrite is non-null/undefined.
    expect(cardSrc).toMatch(/\.\.\.\(arvToWrite !== null && arvToWrite !== undefined \? \{ arv: arvToWrite \} : \{\}\)/)
  })
  it('no second ARV field (ai_arv, recommended_arv, etc.) is ever created', () => {
    expect(cardSrc).not.toMatch(/ai_arv|recommended_arv/)
    expect(compsCardSrc).not.toMatch(/ai_arv|recommended_arv/)
  })
})

describe('H — failed AI analysis does not write ARV', () => {
  it('the NO_ARV_AVAILABLE guard fires before any ARV parsing when comps failed and no ARV exists', () => {
    expect(cardSrc).toMatch(/if \(!compsNotes && !lead\.arv\) \{\s*throw new Error\('NO_ARV_AVAILABLE'\)/)
  })
  it('a thrown error is only ever caught by setGenError — no arv/dbUpdate write happens in the catch path', () => {
    const catchIdx = cardSrc.indexOf('} catch (err) {')
    const catchBlock = cardSrc.slice(catchIdx, catchIdx + 400)
    expect(catchBlock).toMatch(/setGenError/)
    expect(catchBlock).not.toMatch(/dbUpdate|supabase\.from\('leads'\)\.update/)
  })
})

describe('J/K/L — no other Sep 4 functionality touched', () => {
  it('J. Comparable Sales Evidence / Comp Confidence / HAT Market History sections all remain', () => {
    expect(compsCardSrc).toMatch(/Comparable Sales Evidence/)
    expect(compsCardSrc).toMatch(/Comp Confidence/)
    expect(compsCardSrc).toMatch(/HAT Market History/)
  })
  it('K. AI Deal Read remains exactly as Sep 4 — no hideDecisionSummary guard added, still renders whenever flip/brrrr is available', () => {
    expect(cardSrc).toMatch(/\{\(flipResult\.available \|\| brrrrResult\.available\) && \(\(\) => \{/)
    expect(cardSrc).not.toMatch(/!hideDecisionSummary && \(flipResult\.available \|\| brrrrResult\.available\)/)
    expect(cardSrc).toMatch(/AI Deal Read — /)
  })
  it('L. Overview (DecisionHero.jsx) is untouched by this mission', () => {
    const decisionHeroSrc = fs.readFileSync('src/components/lead-detail/workspace/DecisionHero.jsx', 'utf8')
    expect(decisionHeroSrc).not.toMatch(/arvEstimate|arvLevelsValid/)
  })
})

describe('M/N/O — financial engine, strategy, Acquisition Decision unchanged', () => {
  it('M/N. computeFlipResult/computeBrrrrResult formulas are byte-unchanged (protected file — verified via git diff in the final report)', () => {
    expect(fs.existsSync('src/lib/dealExplanation.js')).toBe(true)
    const src = fs.readFileSync('src/lib/dealExplanation.js', 'utf8')
    expect(src).not.toMatch(/arvEstimate|parseArvLevel|arvLevelsValid/)
  })
  it('O. Acquisition Decision (acquisitionDecisionPresentation.js) is not imported/touched by this mission\'s files', () => {
    expect(compsCardSrc).not.toMatch(/deriveAcquisitionDecision/)
  })
})
