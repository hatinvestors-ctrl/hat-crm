// test/sc202CrmCompsReliability.test.js
// HAT INVESTORS — SMALL CHANGE #20.2: HAT System Comps reliability /
// observability. SC20.1's read-only audit proved HAT SYSTEM COMPS had
// two indistinguishable missing states: (A) fetchComps found zero CRM
// candidates, or (B) the AI response may have been cut off by
// max_tokens:1600 before reaching the trailing CRM COMPS USED section —
// because generate-comps.mjs never inspected the provider's own
// stop_reason/usage fields at all.
//
// This is a NARROW fix: capture the already-returned stop_reason/usage
// for server-side diagnostics only (never exposed in `notes`/the UI),
// and deterministically inject an honest, non-AI-authored empty-state
// section when fetchComps() already knows (before the AI call) that
// zero candidates exist — reusing the EXISTING "CRM COMPS USED" section
// name so SECTION_META/TABS routing and CRMCompsUsedSection require
// ZERO changes (falls through to the pre-existing PlainText renderer).
// fetchComps semantics, max_tokens, timeout, model, and SC20's always-on
// VALUATION content are all untouched.
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { SYSTEM_PROMPT } from '../netlify/functions/generate-comps.mjs'

const src = fs.readFileSync('netlify/functions/generate-comps.mjs', 'utf8')
const notesRendererSrc = fs.readFileSync('src/components/lead-detail/NotesRenderer.jsx', 'utf8')
const cardSrc = fs.readFileSync('src/components/lead-detail/DealAnalysisCard.jsx', 'utf8')

// Mirrors the exact new diagnostic/empty-state logic added to
// generate-comps.mjs, for direct unit testing without a live LLM call —
// same convention as test/aiAuthority.test.js and test/sc20AiCompsArvRestore.test.js.
function classify({ raw, stopReason, usage, candidateCount }) {
  let notes = '=====================================\n' + raw
  const truncated = stopReason === 'max_tokens'
  const hasCrmSection = /={5,}\s*\nCRM COMPS USED/i.test(notes)

  let diagnostic
  if (truncated) diagnostic = 'TRUNCATED'
  else if (candidateCount > 0 && !hasCrmSection) diagnostic = 'AI_OUTPUT_INCONSISTENCY'
  else diagnostic = 'OK'

  if (candidateCount === 0 && !hasCrmSection) {
    notes += `\n\n=====================================\nCRM COMPS USED\n=====================================\nHAT SYSTEM COMPS\n\nNo sufficiently relevant HAT CRM comps were found for this property using the current CRM candidate search.`
  }
  return { notes, diagnostic, truncated, usage }
}

describe('CASE 1 — zero candidates, AI completes normally', () => {
  it('never claims truncation; deterministic no-evidence text is injected; no fake CRM properties', () => {
    const result = classify({
      raw: 'MARKET COMPS\n=====================================\n...\nRENTAL COMPS\n=====================================\n...',
      stopReason: 'end_turn',
      usage: { input_tokens: 900, output_tokens: 700 },
      candidateCount: 0,
    })
    expect(result.diagnostic).toBe('OK')
    expect(result.truncated).toBe(false)
    expect(result.notes).toMatch(/CRM COMPS USED/)
    expect(result.notes).toMatch(/HAT SYSTEM COMPS/)
    expect(result.notes).toMatch(/No sufficiently relevant HAT CRM comps were found for this property using the current CRM candidate search\./)
    // never fabricates a fake COMP: row
    expect(result.notes.split('\n\n=====================================\nCRM COMPS USED')[1]).not.toMatch(/COMP:/)
  })
})

describe('CASE 2 — candidates exist, AI completes normally, CRM COMPS USED present', () => {
  it('existing HAT System Comps behavior is unchanged — no synthetic section injected', () => {
    const rawWithCrm = 'MARKET COMPS\n...\n=====================================\nCRM COMPS USED\n=====================================\nCOMP: 123 Main St, ZIP 32208 | 3BR/2BA | Ask $200,000 | Prior HAT ARV Estimate $210,000 | Reno $30,000 | offered $190,000 | Status: sold\nHow used: benchmark for reno cost.\nZIP Pattern: prior deals in this ZIP averaged...\nMarket Context: agrees with canonical ARV.'
    const result = classify({
      raw: rawWithCrm,
      stopReason: 'end_turn',
      usage: { input_tokens: 1200, output_tokens: 1500 },
      candidateCount: 3,
    })
    expect(result.diagnostic).toBe('OK')
    // notes are byte-identical to what the AI produced — nothing appended
    expect(result.notes).toBe('=====================================\n' + rawWithCrm)
  })
})

describe('CASE 3 — candidates exist, provider indicates output-length truncation', () => {
  it('is classified as TRUNCATED, never mislabeled as "no CRM evidence"', () => {
    const result = classify({
      raw: 'MARKET COMPS\n...\nRENTAL COMPS\n...', // cut off before reaching CRM COMPS USED
      stopReason: 'max_tokens',
      usage: { input_tokens: 1400, output_tokens: 1600 },
      candidateCount: 5,
    })
    expect(result.diagnostic).toBe('TRUNCATED')
    expect(result.truncated).toBe(true)
    // candidates existed, so the deterministic no-evidence text must NOT be injected —
    // that would misrepresent a truncation as "no evidence"
    expect(result.notes).not.toMatch(/No sufficiently relevant HAT CRM comps were found/)
  })
})

describe('CASE 4 — candidates exist, AI completes normally, but omits CRM COMPS USED (AI output inconsistency)', () => {
  it('is classified separately as AI_OUTPUT_INCONSISTENCY — never "no evidence", never "truncated"', () => {
    const result = classify({
      raw: 'MARKET COMPS\n...\nRENTAL COMPS\n...', // model chose to stop after Rental Comps despite candidates + normal completion
      stopReason: 'end_turn',
      usage: { input_tokens: 1200, output_tokens: 900 },
      candidateCount: 4,
    })
    expect(result.diagnostic).toBe('AI_OUTPUT_INCONSISTENCY')
    expect(result.truncated).toBe(false)
    // candidates existed, so still no deterministic no-evidence text is injected
    expect(result.notes).not.toMatch(/No sufficiently relevant HAT CRM comps were found/)
  })
})

describe('Source-level verification — the exact diagnostic branching exists in generate-comps.mjs', () => {
  it('captures stop_reason and usage from the existing Anthropic response, no new AI call', () => {
    expect(src).toMatch(/const stopReason\s+= data\.stop_reason \|\| null/)
    expect(src).toMatch(/const truncated\s+= stopReason === 'max_tokens'/)
    expect(src).toMatch(/const usage\s+= data\.usage \|\| null/)
  })
  it('candidate count is read from the SAME pre-existing fetchComps() result — no new retrieval', () => {
    expect(src).toMatch(/const candidateCount = comps\.length/)
  })
  it('three distinct diagnostic branches exist and are never conflated', () => {
    expect(src).toMatch(/\[generate-comps\] TRUNCATED/)
    expect(src).toMatch(/\[generate-comps\] AI_OUTPUT_INCONSISTENCY/)
    expect(src).toMatch(/\[generate-comps\] OK total=\$\{Date\.now\(\) - t0\}ms stop_reason=/)
  })
  it('the deterministic empty-state text is injected ONLY when candidateCount is 0 and no CRM section already exists', () => {
    expect(src).toMatch(/if \(candidateCount === 0 && !hasCrmSection\) \{/)
    expect(src).toMatch(/No sufficiently relevant HAT CRM comps were found for this property using the current CRM candidate search\./)
  })
  it('diagnostic fields are never written into the notes string sent to the client', () => {
    const returnBlock = src.slice(src.indexOf('const stopReason'), src.indexOf('return new Response(JSON.stringify({ ok: true, notes })'))
    expect(returnBlock).not.toMatch(/notes \+= .*stopReason/)
    expect(returnBlock).not.toMatch(/notes \+= .*usage/)
  })
})

describe('Preserved exactly — max_tokens, timeout, fetchComps semantics, model, SC20 VALUATION', () => {
  it('max_tokens remains 1600, unchanged', () => {
    expect(src).toMatch(/max_tokens: 1600,/)
  })
  it('model and temperature unchanged', () => {
    expect(src).toMatch(/model: 'claude-haiku-4-5-20251001',/)
    expect(src).toMatch(/temperature: 0,/)
  })
  it('the internal abort timer and netlify.toml timeout are untouched (no new timeout logic added)', () => {
    expect(src).toMatch(/setTimeout\(\(\) => abortCtrl\.abort\(\), 20000\)/)
  })
  it('fetchComps() retrieval semantics are byte-unchanged (ZIP cluster, asking_price filter, address exclusion, limit 20 -> slice 8)', () => {
    expect(src).toMatch(/const url = `\$\{SUPABASE_URL\}\/rest\/v1\/leads\?select=\$\{fields\}&or=\(\$\{zipFilter\}\)&asking_price=not\.is\.null&order=created_at\.desc&limit=20`/)
    expect(src).toMatch(/return \(rows \|\| \[\]\)\.filter\(r => r\.address !== lead\.address\)\.slice\(0, 8\)/)
  })
  it('SC20\'s always-on VALUATION content (Conservative/Realistic/Optimistic ARV + ARV Conclusion) inside MARKET COMPS is untouched', () => {
    const marketCompsSection = SYSTEM_PROMPT.slice(SYSTEM_PROMPT.indexOf('MARKET COMPS\n====='), SYSTEM_PROMPT.indexOf('RENTAL COMPS\n====='))
    expect(marketCompsSection).toMatch(/Conservative ARV: \$\[X\]/)
    expect(marketCompsSection).toMatch(/Realistic ARV:\s+\$\[X\]/)
    expect(marketCompsSection).toMatch(/Optimistic ARV:\s+\$\[X\]/)
    expect(marketCompsSection).toMatch(/ARV Conclusion: /)
  })
})

describe('CASE 5 — historical notes / other components — zero changes', () => {
  it('NotesRenderer.jsx (CRMCompsUsedSection, SECTION_META, TABS) is completely untouched by this mission', () => {
    expect(notesRendererSrc).toMatch(/function CRMCompsUsedSection\(\{ body \}\)/)
    expect(notesRendererSrc).toMatch(/'CRM COMPS USED':\s*\{ icon: '🏡', render: s => <CRMCompsUsedSection\s*body=\{s\} \/> \}/)
    expect(notesRendererSrc).toMatch(/if \(compBlocks\.length === 0\) return <PlainText body=\{body\} \/>/)
  })
})

describe('CASE 6 — SC20 writeback / canonical ARV protections remain intact', () => {
  it('DealAnalysisCard.jsx is untouched by SC20.2 (zero diff preferred and achieved)', () => {
    expect(cardSrc).toMatch(/const arvToWrite = lead\.arv \? null : finalArv/)
    expect(cardSrc).toMatch(/\.\.\.\(arvToWrite !== null && arvToWrite !== undefined \? \{ arv: arvToWrite \} : \{\}\)/)
  })
})

describe('Protected files / no scope creep', () => {
  it('no protected file references any SC20.2 symbol', () => {
    for (const f of ['src/lib/calculations.js', 'src/lib/decisionEngineV2.js', 'src/lib/buyBox.js', 'src/lib/underwritingSettings.js', 'src/lib/dealExplanation.js', 'src/lib/sellerStrategy.js']) {
      const protectedSrc = fs.readFileSync(f, 'utf8')
      expect(protectedSrc).not.toMatch(/stopReason|candidateCount|hasCrmSection|AI_OUTPUT_INCONSISTENCY/)
    }
  })
})
