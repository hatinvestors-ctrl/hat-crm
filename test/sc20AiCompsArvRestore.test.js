// test/sc20AiCompsArvRestore.test.js
// HAT INVESTORS — SMALL CHANGE #20: Restore always-available AI Comps
// valuation (Conservative/Realistic/Optimistic ARV + ARV Conclusion).
//
// SC19.2/SC19.3 diagnosed two real defects, both fixed here with the
// MINIMUM authorized change:
//  1. generate-comps.mjs's prompt only produced the VALUATION block
//     (Conservative/Realistic/Optimistic ARV) when canonical ARV was
//     "Unknown" — so for any lead with an ARV already on file (the
//     common case), the AI never wrote those fields at all.
//  2. Even when it WAS written (ARV: Unknown case), it was its own
//     separate "=====VALUATION=====" header. NotesRenderer.jsx's
//     parseNotes() splits notes into named sections by "=====" header,
//     and neither SECTION_META nor any TABS matcher ever had an entry
//     for a standalone "VALUATION" section name — so it silently never
//     rendered anywhere, in any lead, ever. This is the literal reason
//     automated (fixture-based) tests reported success while real
//     production screenshots did not show the hierarchy.
//
// The fix folds the VALUATION content into the MARKET COMPS section body
// (immediately before "Market Range:") and makes it unconditional. This
// reuses the EXACT existing field names the parser (MarketCompsSection,
// SECTION_FIELDS regex) already expected — zero parser change. The AI's
// valuation opinion remains explicitly evidence-only and informational;
// canonical lead.arv / SC1's writeback guard are untouched.
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { SYSTEM_PROMPT } from '../netlify/functions/generate-comps.mjs'

const cardSrc = fs.readFileSync('src/components/lead-detail/DealAnalysisCard.jsx', 'utf8')
const notesRendererSrc = fs.readFileSync('src/components/lead-detail/NotesRenderer.jsx', 'utf8')

// Mirrors NotesRenderer.jsx's own parseNotes()/TABS wiring, for direct
// unit testing without a component-mount harness (no such harness exists
// in this repo — same convention as test/sep4AiArvLevels.test.js).
function parseNotes(text) {
  const firstSep = text.search(/={5,}/)
  const clean = firstSep > 0 ? text.slice(firstSep) : text
  const chunks = clean.split(/={5,}/).map(c => c.trim()).filter(Boolean)
  const sections = []
  for (let i = 0; i + 1 < chunks.length; i += 2) {
    const name = chunks[i].trim()
    const body = (chunks[i + 1] || '').trim()
    if (name && body) sections.push({ name, body })
  }
  return sections
}
const COMPS_TAB_MATCH = n => /^COMPARABLE SALES|^MARKET COMPS|^RENTAL COMPS|^CRM COMPS USED|^BEDROOM ADD|^ARV ANALYSIS/.test(n)

// Mirrors MarketCompsSection's own field extraction, for direct unit
// testing (same convention as above).
function extractMarketCompsFields(body) {
  const allLines = body.split('\n').filter(Boolean)
  const conclusion = allLines.find(l => /^ARV Conclusion:/i.test(l.trim()))?.replace(/^ARV Conclusion:\s*/i, '').trim()
  const conservativeARV = allLines.find(l => /^Conservative ARV:/i.test(l.trim()))?.replace(/^Conservative ARV:\s*/i, '').trim()
  const realisticARV    = allLines.find(l => /^Realistic ARV:/i.test(l.trim()))?.replace(/^Realistic ARV:\s*/i, '').trim()
  const optimisticARV   = allLines.find(l => /^Optimistic ARV:/i.test(l.trim()))?.replace(/^Optimistic ARV:\s*/i, '').trim()
  return { conservativeARV, realisticARV, optimisticARV, conclusion }
}

describe('CASE A/B — the AI output contract always requests all 4 fields, regardless of canonical ARV state', () => {
  it('the prompt no longer gates VALUATION behind "ARV: Unknown" — it is unconditional inside MARKET COMPS', () => {
    expect(SYSTEM_PROMPT).not.toMatch(/Include VALUATION only when CANONICAL FINANCIALS below shows "ARV: Unknown"/)
    expect(SYSTEM_PROMPT).not.toMatch(/omit entirely when a canonical ARV is already provided/)
    const marketCompsSection = SYSTEM_PROMPT.slice(SYSTEM_PROMPT.indexOf('MARKET COMPS\n====='), SYSTEM_PROMPT.indexOf('RENTAL COMPS\n====='))
    expect(marketCompsSection).toMatch(/Conservative ARV: \$\[X\]/)
    expect(marketCompsSection).toMatch(/Realistic ARV:\s+\$\[X\]/)
    expect(marketCompsSection).toMatch(/Optimistic ARV:\s+\$\[X\]/)
    expect(marketCompsSection).toMatch(/ARV Conclusion: /)
  })
  it('the VALUATION content is evidence-only — explicitly forbidden from anchoring to canonical ARV, asking price, or Max Buy', () => {
    expect(SYSTEM_PROMPT).toMatch(/never derived from the canonical ARV above, from asking price, or from Max Buy/i)
    expect(SYSTEM_PROMPT).toMatch(/never a fixed percentage spread/i)
  })
})

describe('CASE E (structural fix) — VALUATION now lives INSIDE the MARKET COMPS section, not a separate ===== header, so it actually renders', () => {
  it('a real AI-shaped notes string with the new merged structure routes into the "comps" tab and MarketCompsSection extracts all 4 fields', () => {
    const REAL_SHAPE_NOTES = `Generated: Sep 16, 2026

=====================================
MARKET COMPS
=====================================
Conservative ARV: $230,000 — 3519 College St, smaller lot, dated kitchen
Realistic ARV: $245,000 — best-supported by 328 Laurina St, comparable size/condition
Optimistic ARV: $255,000 — 7139 Hallock St, fully renovated comp
ARV Conclusion: The comps evidence broadly agrees with the canonical $250,000 ARV, landing slightly below it.

Market Range (evidence context, not a replacement ARV): $230,000–$255,000 — ZIP benchmark + bed/bath adjustments
COMP: 3519 College St, ZIP 32208 | 3BR/2BA | 1,169 sqft | Sold $228,000 | $195/sqft | 3 months ago | dated
Why relevant: closest comp by size and condition.
COMP: 328 Laurina St, ZIP 32208 | 3BR/2BA | 1,200 sqft | Sold $246,000 | $205/sqft | 2 months ago | renovated
Why relevant: best overall match.
Evidence Read: This evidence broadly agrees with the canonical ARV.

=====================================
RENTAL COMPS
=====================================
Conservative Rent: $1,400/mo — below-average condition
Realistic Rent: $1,500/mo — most likely for this bed/bath/ZIP
Optimistic Rent: $1,600/mo — fully updated
RENTAL: same block, ZIP 32208 | 3BR/2BA | 1,150 sqft | $1,500/mo | at property level
1% Rule: 0.9% at ask all-in | 1.0% at MAO all-in
Rent Verdict: MEETS THRESHOLD — rent supports BRRRR at MAO.
`
    const sections = parseNotes(REAL_SHAPE_NOTES)
    const compsSections = sections.filter(s => COMPS_TAB_MATCH(s.name))
    const marketComps = compsSections.find(s => s.name === 'MARKET COMPS')
    expect(marketComps).toBeTruthy()

    const fields = extractMarketCompsFields(marketComps.body)
    expect(fields.conservativeARV).toBe('$230,000 — 3519 College St, smaller lot, dated kitchen')
    expect(fields.realisticARV).toBe('$245,000 — best-supported by 328 Laurina St, comparable size/condition')
    expect(fields.optimisticARV).toBe('$255,000 — 7139 Hallock St, fully renovated comp')
    expect(fields.conclusion).toMatch(/broadly agrees with the canonical \$250,000 ARV/)

    // regression guard: the OLD (broken) shape — VALUATION as its own
    // ===== section — would never have reached the "comps" tab at all.
    const orphanedSections = sections.filter(s => s.name === 'VALUATION')
    expect(orphanedSections.length).toBe(0)
  })
})

describe('CASE C — AI valuation can disagree with canonical lead.arv; display only, no writeback', () => {
  it('SC1\'s writeback guard is untouched — arvToWrite stays null whenever lead.arv is already set, regardless of what the AI Realistic ARV says', () => {
    expect(cardSrc).toMatch(/const arvToWrite = lead\.arv \? null : finalArv/)
    expect(cardSrc).toMatch(/\.\.\.\(arvToWrite !== null && arvToWrite !== undefined \? \{ arv: arvToWrite \} : \{\}\)/)
  })
  it('DealAnalysisCard.jsx is untouched by SC20 (zero diff preferred/achieved)', () => {
    expect(cardSrc).toMatch(/const conservativeArv = parseArvLevel\('Conservative'\)/)
    expect(cardSrc).toMatch(/const arvLevelsValid  = conservativeArv != null && realisticArv != null && optimisticArv != null/)
  })
})

describe('CASE D — historical notes without the new fields still render safely, nothing fabricated', () => {
  it('a MARKET COMPS body with only COMP:/Why relevant: lines (old shape, no VALUATION) yields all four fields undefined, not fabricated', () => {
    const OLD_SHAPE_BODY = `COMP: 3519 College St, ZIP 32208 | 3BR/2BA | 1,169 sqft | Sold $228,000 | $195/sqft | 3 months ago | dated
Why relevant: closest comp by size and condition.`
    const fields = extractMarketCompsFields(OLD_SHAPE_BODY)
    expect(fields.conservativeARV).toBeUndefined()
    expect(fields.realisticARV).toBeUndefined()
    expect(fields.optimisticARV).toBeUndefined()
    expect(fields.conclusion).toBeUndefined()
  })
  it('MarketCompsSection\'s hero/verdict render gates are conditional — no fallback/default value is ever substituted', () => {
    expect(notesRendererSrc).toMatch(/\{\(conservativeARV \|\| realisticARV \|\| optimisticARV\) && \(/)
    expect(notesRendererSrc).toMatch(/\{conclusion && \(/)
  })
})

describe('Protected files / no scope creep', () => {
  it('no protected file references any SC20 symbol', () => {
    for (const f of ['src/lib/calculations.js', 'src/lib/decisionEngineV2.js', 'src/lib/buyBox.js', 'src/lib/underwritingSettings.js', 'src/lib/dealExplanation.js', 'src/lib/sellerStrategy.js']) {
      const protectedSrc = fs.readFileSync(f, 'utf8')
      expect(protectedSrc).not.toMatch(/ARV Conclusion|VALUATION content|arvLevelsValid/)
    }
  })
  it('NotesRenderer.jsx (MarketCompsSection parsing + presentation) is untouched by SC20 — same parser, same UI, only the AI now supplies the data', () => {
    expect(notesRendererSrc).toMatch(/const conclusion = allLines\.find\(l => \/\^ARV Conclusion:\/i\.test\(l\.trim\(\)\)\)\?\.replace\(\/\^ARV Conclusion:\\s\*\/i, ''\)\.trim\(\)/)
    expect(notesRendererSrc).toMatch(/<span>HAT AI Verdict<\/span>/)
  })
})
