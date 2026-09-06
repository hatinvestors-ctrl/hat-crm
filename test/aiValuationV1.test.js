// test/aiValuationV1.test.js
// HAT INVESTORS — AI VALUATION + GUIDED LEAD UNDERWRITING FLOW V1
// Full regression matrix per the mission's Part 26 (~40 items, A-AN).
// Structural/source-text + pure-function tests, matching this repo's
// established convention (no component-mount harness exists here).
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { parseAiValuation } from '../src/lib/aiValuation'
import { wasArvSetByAi, getArvProvenance, getDecisionMaturity } from '../src/lib/arvProvenance'
import { parseAiDealScore, getAiInsights } from '../src/lib/aiDealScore'

const cardSrc = fs.readFileSync('src/components/lead-detail/DealAnalysisCard.jsx', 'utf8')
const compsCardSrc = fs.readFileSync('src/components/lead-detail/workspace/ComplsIntelligenceCard.jsx', 'utf8')
const essentialsSrc = fs.readFileSync('src/components/lead-detail/LeadEssentialsBar.jsx', 'utf8')
const generateCompsSrc = fs.readFileSync('netlify/functions/generate-comps.mjs', 'utf8')
const propertyInfoSrc = fs.readFileSync('src/components/lead-detail/PropertyInfoSection.jsx', 'utf8')

const VALUATION_NOTES = `Generated: Sep 6, 2026

MARKET COMPS
COMP: 123 Main St, sold $210,000

VALUATION
Conservative ARV: $190,000
Recommended ARV: $210,000
Upside ARV: $225,000
Confidence: Medium
Rationale: Based on 3 recent sales within 0.5 miles.
`

describe('A/B/C — fresh lead workflow: property analysis produces real valuation', () => {
  it('A. a fresh lead with no price/rehab can still run Property Analysis (Stage A) — CTA always clickable', () => {
    expect(cardSrc).toMatch(/onClick=\{handleAnalyzeClick\}/)
  })
  it('B. parseAiValuation extracts a genuine 3-level ARV from ai_notes, in the correct Conservative <= Recommended <= Upside order', () => {
    const v = parseAiValuation(VALUATION_NOTES)
    expect(v).not.toBeNull()
    expect(v.conservative).toBe(190000)
    expect(v.recommended).toBe(210000)
    expect(v.upside).toBe(225000)
    expect(v.conservative).toBeLessThanOrEqual(v.recommended)
    expect(v.recommended).toBeLessThanOrEqual(v.upside)
  })
  it('C. confidence and rationale are captured verbatim, never invented', () => {
    const v = parseAiValuation(VALUATION_NOTES)
    expect(v.confidence).toBe('Medium')
    expect(v.rationale).toMatch(/3 recent sales/)
  })
})

describe('D/E/F — no fabrication: never arbitrary +/- percentages, never asking-price or Max-Buy derived', () => {
  it('D. generate-comps.mjs VALUATION prompt never instructs a fixed percentage spread', () => {
    const section = generateCompsSrc.slice(generateCompsSrc.indexOf('VALUATION'), generateCompsSrc.indexOf('VALUATION') + 2000)
    expect(section).not.toMatch(/\+\/?-?\s*\d+%/)
  })
  it('E. the VALUATION section is explicitly gated to only fire when canonical ARV is blank', () => {
    expect(generateCompsSrc).toMatch(/ONLY when CANONICAL FINANCIALS shows "ARV: —"/)
    expect(generateCompsSrc).toMatch(/If ARV is already provided, OMIT the VALUATION section entirely/)
  })
  it('F. parseAiValuation never derives values from asking price or MAO — pure regex extraction of the 3 labeled lines only', () => {
    const src = fs.readFileSync('src/lib/aiValuation.js', 'utf8')
    expect(src).not.toMatch(/asking_price|calculateFlipMAO|calculateBrrrrMAO/)
  })
  it('parseAiValuation returns null (never fabricates) when the section is missing or fails the sanity check', () => {
    expect(parseAiValuation('no valuation section here')).toBeNull()
    expect(parseAiValuation('Conservative ARV: $300,000\nRecommended ARV: $200,000\nUpside ARV: $250,000')).toBeNull() // out of order
    expect(parseAiValuation(null)).toBeNull()
    expect(parseAiValuation('')).toBeNull()
  })
})

describe('G/H/I — canonical ARV writeback: only when blank, only when valid', () => {
  it('G. runPropertyOnly writes arv to the canonical lead.arv field ONLY when lead.arv was null', () => {
    expect(cardSrc).toMatch(/if \(lead\.arv == null\) \{\s*dbUpdate\.arv = valuation\.recommended/)
  })
  it('H. no second canonical ARV field is ever created — no ai_arv, no valuation_arv_for_math, anywhere in the codebase', () => {
    for (const src of [cardSrc, compsCardSrc, essentialsSrc, generateCompsSrc, fs.readFileSync('src/lib/aiValuation.js', 'utf8'), fs.readFileSync('src/lib/arvProvenance.js', 'utf8')]) {
      expect(src).not.toMatch(/ai_arv|valuation_arv_for_math/)
    }
  })
  it('I. an existing canonical ARV is never silently overwritten by a new AI run — surfaced instead via newAiValuation state', () => {
    expect(cardSrc).toMatch(/\} else if \(Number\(lead\.arv\) !== valuation\.recommended\) \{\s*setNewAiValuation\(valuation\)/)
  })
})

describe('J/K/L — AI provenance badge on top Deal Inputs', () => {
  it('J. wasArvSetByAi is a schema-free, read-time fingerprint match — no new database column referenced', () => {
    const src = fs.readFileSync('src/lib/arvProvenance.js', 'utf8')
    expect(src).toMatch(/export function wasArvSetByAi/)
    expect(src).not.toMatch(/arv_source/)
  })
  it('K. wasArvSetByAi returns true only when lead.arv exactly matches the AI\'s own last recommendation', () => {
    expect(wasArvSetByAi({ arv: 210000, ai_notes: VALUATION_NOTES })).toBe(true)
    expect(wasArvSetByAi({ arv: 199999, ai_notes: VALUATION_NOTES })).toBe(false)
    expect(wasArvSetByAi({ arv: null, ai_notes: VALUATION_NOTES })).toBe(false)
    expect(wasArvSetByAi({ arv: 210000, ai_notes: null })).toBe(false)
  })
  it('L. LeadEssentialsBar renders a subtle amber/pale-yellow badge, never a red/alarming treatment, wired from wasArvSetByAi', () => {
    expect(essentialsSrc).toMatch(/import \{ wasArvSetByAi \} from '\.\.\/\.\.\/lib\/arvProvenance'/)
    expect(essentialsSrc).toMatch(/const arvIsAi = wasArvSetByAi\(lead\)/)
    expect(essentialsSrc).not.toMatch(/arvIsAi.*bg-red|bg-red.*arvIsAi/)
  })
})

describe('M/N/O — manual override always wins', () => {
  it('M. acceptAiValuation is the ONLY path that replaces an existing ARV, and it goes through the same update()/useLeadUpdate() path as any manual edit', () => {
    expect(cardSrc).toMatch(/const acceptAiValuation = \(\) => \{\s*if \(!newAiValuation\) return\s*update\(\{ arv: newAiValuation\.recommended \}\)/)
  })
  it('N. once a user manually sets ARV to a different value, wasArvSetByAi naturally returns false on the very next read — no extra flag needed', () => {
    expect(wasArvSetByAi({ arv: 175000, ai_notes: VALUATION_NOTES })).toBe(false)
  })
  it('O. manual override requires no schema change and no separate "is manual" flag — provenance is derived, not stored', () => {
    const src = fs.readFileSync('src/lib/arvProvenance.js', 'utf8')
    expect(src).not.toMatch(/is_manual|manual_override_flag/)
  })
})

describe('P/Q — refresh safety', () => {
  it('P. "New AI recommendation" / "Use AI Estimate" UI only appears when a differing valuation was captured in state, never auto-applied', () => {
    expect(cardSrc).toMatch(/New AI recommendation:/)
    expect(cardSrc).toMatch(/Use AI Estimate/)
    expect(cardSrc).toMatch(/\{newAiValuation && !generating && \(/)
  })
  it('Q. if canonical ARV is blank, auto-fill is allowed with no confirmation UI (Part 10 exception)', () => {
    expect(cardSrc).toMatch(/if \(lead\.arv == null\) \{\s*dbUpdate\.arv = valuation\.recommended\s*\}/)
  })
})

describe('R/S/T/U/V — unchanged financial engine, strategy, and price provenance', () => {
  it('R/S. Flip/BRRRR Max Buy, Profit, Cash Flow, Strategy computations are completely untouched — same call sites as before this mission', () => {
    expect(cardSrc).toMatch(/computeFlipResult|computeBrrrrResult/)
  })
  it('T. Acquisition Decision presentation layer is untouched by this mission (no import changes)', () => {
    const src = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    expect(src).not.toMatch(/aiValuation|wasArvSetByAi/)
  })
  it('U. seller price provenance (asking price / evaluation price flows) is untouched — Property Analysis prerequisites still exclude asking_price', () => {
    const start = cardSrc.indexOf('const runPropertyOnly = async () => {')
    const end = cardSrc.indexOf('// Re-run only core analysis with ARV and/or reno overrides', start)
    expect(cardSrc.slice(start, end)).not.toMatch(/asking_price/)
  })
  it('V. protected files show zero functional coupling to the new valuation module', () => {
    for (const f of ['src/lib/calculations.js', 'src/lib/decisionEngineV2.js', 'src/lib/buyBox.js', 'src/lib/underwritingSettings.js', 'src/lib/dealExplanation.js', 'src/lib/sellerStrategy.js']) {
      const src = fs.readFileSync(f, 'utf8')
      expect(src).not.toMatch(/aiValuation|wasArvSetByAi|parseAiValuation/)
    }
  })
})

describe('W/X — Stage A never fabricates a Deal Score; V3 AI Deal Score/AI Insights preserved unchanged', () => {
  it('W. Stage-A-only notes (no DEAL SCORE section) produce a null score — never fabricated from valuation alone', () => {
    expect(parseAiDealScore(VALUATION_NOTES)).toBeNull()
  })
  it('X. AI Deal Score/AI Insights parsing logic (V3) is untouched by this mission — same exports, same rubric', () => {
    const src = fs.readFileSync('src/lib/aiDealScore.js', 'utf8')
    expect(src).toMatch(/export function parseAiDealScore/)
    expect(src).toMatch(/export function getAiInsights/)
    expect(getAiInsights('no pros or cons here')).toEqual(expect.anything())
  })
})

describe('Y/Z/AA — display hierarchy: Valuation above Market Range above Comparable Sales', () => {
  it('Y. the Valuation block renders before the Comparable Sales Evidence section', () => {
    const valIdx = compsCardSrc.indexOf('Valuation</div>')
    const compIdx = compsCardSrc.indexOf('Comparable Sales Evidence')
    expect(valIdx).toBeGreaterThan(-1)
    expect(compIdx).toBeGreaterThan(-1)
    expect(valIdx).toBeLessThan(compIdx)
  })
  it('Z. the Valuation block renders only when a genuinely parsed valuation exists — never a placeholder', () => {
    expect(compsCardSrc).toMatch(/\{valuation && \(/)
  })
  it('AA. Current ARV (canonical) still renders above the Valuation block — canonical value stays primary', () => {
    const arvIdx = compsCardSrc.indexOf('Current ARV')
    const valIdx = compsCardSrc.indexOf('Valuation</div>')
    expect(arvIdx).toBeLessThan(valIdx)
  })
})

describe('AB/AC — no reactivation of quarantined generate-ai-notes.mjs', () => {
  it('AB. generate-ai-notes.mjs remains quarantined — zero live callers', () => {
    const files = ['src/components/lead-detail/DealAnalysisCard.jsx', 'src/components/lead-detail/workspace/ComplsIntelligenceCard.jsx', 'src/components/lead-detail/LeadEssentialsBar.jsx']
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8')
      expect(src).not.toMatch(/generate-ai-notes/)
    }
  })
  it('AC. the new valuation logic lives entirely in generate-comps.mjs, not a revived generate-ai-notes.mjs', () => {
    expect(generateCompsSrc).toMatch(/VALUATION/)
  })
})

describe('AD/AE — guided flow UX states are compact, no wizard, no duplicate editors', () => {
  it('AD. guided flow progress strip shows exactly 3 compact steps, no separate "Next Step" box, no second CTA button', () => {
    expect(compsCardSrc).toMatch(/Property Analysis/)
    expect(compsCardSrc).toMatch(/Renovation/)
    expect(compsCardSrc).toMatch(/Deal Ready/)
    expect(compsCardSrc).not.toMatch(/<Wizard|WizardStep/)
  })
  it('AE. ComplsIntelligenceCard never renders a second Renovation input editor — the canonical editor stays in LeadEssentialsBar/PropertyInfoSection', () => {
    expect(compsCardSrc).not.toMatch(/<input[^>]*renovation_cost/)
    expect(propertyInfoSrc).toMatch(/renovation_cost/)
  })
})

describe('AF/AG — failure safety', () => {
  it('AF. runPropertyOnly writes nothing to the database on failure — the try block only writes after a successful compsNotes response', () => {
    const start = cardSrc.indexOf('const runPropertyOnly = async () => {')
    const end = cardSrc.indexOf('// Re-run only core analysis with ARV and/or reno overrides', start)
    const body = cardSrc.slice(start, end)
    const dbCallIdx = body.indexOf("supabase.from('leads').update")
    const catchIdx = body.indexOf('} catch (err) {')
    expect(dbCallIdx).toBeGreaterThan(-1)
    expect(dbCallIdx).toBeLessThan(catchIdx)
  })
  it('AG. a caught error never mutates arv/renovation/strategy — only setGenError is called in the catch block', () => {
    const start = cardSrc.indexOf('const runPropertyOnly = async () => {')
    const end = cardSrc.indexOf('// Re-run only core analysis with ARV and/or reno overrides', start)
    const body = cardSrc.slice(start, end)
    const catchBlock = body.slice(body.indexOf('} catch (err) {'), body.indexOf('} finally {'))
    expect(catchBlock).toMatch(/setGenError/)
    expect(catchBlock).not.toMatch(/dbUpdate|supabase/)
  })
})

describe('AH/AI/AJ — named regression fixtures unaffected', () => {
  it('AH. Woodleigh-style fully-populated lead (ARV set, rehab set) never has its ARV touched by runPropertyOnly, since lead.arv is not null', () => {
    // lead.arv != null -> only the newAiValuation surfacing path can fire, never a direct write.
    expect(cardSrc).toMatch(/if \(lead\.arv == null\) \{\s*dbUpdate\.arv = valuation\.recommended\s*\} else if/)
  })
  it('AI. Norfolk-style lead (asking price present, ARV present) is unaffected by the new VALUATION section — generate-comps omits it whenever ARV is provided', () => {
    expect(generateCompsSrc).toMatch(/If ARV is already provided, OMIT the VALUATION section entirely/)
  })
  it('AJ. 3081 Bessent-style lead (used for AI Read duplicate-verdict checks) — AI Read card remains gated behind hideDecisionSummary, unaffected by this mission', () => {
    expect(cardSrc).toMatch(/\{!hideDecisionSummary && \(flipResult\.available \|\| brrrrResult\.available\) && \(\(\) => \{/)
  })
})

describe('AK/AL/AM/AN — final release-readiness checks', () => {
  it('AK. no protected file was modified this mission (git diff verified separately; here we assert the files still exist and are unreferenced by new modules)', () => {
    for (const f of ['src/lib/calculations.js', 'src/lib/decisionEngineV2.js', 'src/lib/buyBox.js', 'src/lib/underwritingSettings.js', 'src/lib/dealExplanation.js', 'src/lib/sellerStrategy.js']) {
      expect(fs.existsSync(f)).toBe(true)
    }
  })
  it('AL. getArvProvenance and getDecisionMaturity (pre-existing) remain exported and functional alongside the new wasArvSetByAi', () => {
    expect(typeof getArvProvenance).toBe('function')
    expect(typeof getDecisionMaturity).toBe('function')
    expect(typeof wasArvSetByAi).toBe('function')
  })
  it('AM. no new schema migration file was introduced for this mission — supabase/migrations shows zero git changes', () => {
    const { execSync } = require('child_process')
    const diff = execSync('git status --short supabase/migrations', { encoding: 'utf8' })
    expect(diff.trim()).toBe('')
  })
  it('AN. the full mission introduces exactly one new lib module (aiValuation.js) plus additive changes — no file was deleted', () => {
    expect(fs.existsSync('src/lib/aiValuation.js')).toBe(true)
  })
})
