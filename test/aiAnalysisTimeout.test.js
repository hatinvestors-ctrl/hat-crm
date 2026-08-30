// test/aiAnalysisTimeout.test.js
// P0 Investigation & Fix — AI / Comps Analysis Timeout (2026-08-30).
//
// Root cause (confirmed, not guessed): `netlify api listAccountsForUser`
// showed this account's real Netlify platform ceiling for synchronous
// function execution is 26 seconds. netlify.toml requested MORE than that
// for every AI-calling function (30/45/50/120s) — values the platform
// silently clamps. generate-core-analysis's own internal AbortController
// (22s) looked safe against the requested-but-fictional 30s budget, but
// left almost no real margin against the true 26s kill; analyze-deal.mjs
// and generate-report.mjs had NO internal guard at all and were relying
// entirely on a 120s budget that never existed. When the platform's own
// hard kill fires first, it returns a non-JSON response, which is exactly
// what the client's `${name} timed out` check reports.
//
// These tests verify the fix at the source level (this repo has no
// component-mount harness — components are verified via structural
// source-inspection, the established convention here) and do NOT alter
// any financial formula, threshold, or verdict rule.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'

const netlifyToml = fs.readFileSync('netlify.toml', 'utf8')
const dealAnalysisCardSrc = fs.readFileSync('src/components/lead-detail/DealAnalysisCard.jsx', 'utf8')
const analyzeDealSrc = fs.readFileSync('netlify/functions/analyze-deal.mjs', 'utf8')
const generateReportSrc = fs.readFileSync('netlify/functions/generate-report.mjs', 'utf8')
const generateCoreAnalysisSrc = fs.readFileSync('netlify/functions/generate-core-analysis.mjs', 'utf8')
const generateCompsSrc = fs.readFileSync('netlify/functions/generate-comps.mjs', 'utf8')
const generateAiNotesSrc = fs.readFileSync('netlify/functions/generate-ai-notes.mjs', 'utf8')
const generateNegotiationPlanSrc = fs.readFileSync('netlify/functions/generate-negotiation-plan.mjs', 'utf8')

function tomlTimeoutFor(fnName) {
  const m = netlifyToml.match(new RegExp(`\\[functions\\."${fnName}"\\][\\s\\S]*?timeout = (\\d+)`))
  return m ? Number(m[1]) : null
}

// ── Root-cause config fix ─────────────────────────────────────────────────
describe('P0 root cause — netlify.toml requested timeouts never exceed the real 26s platform ceiling', () => {
  const aiCallingFunctions = [
    'batchdata-enrich', 'analyze-deal', 'generate-report', 'generate-ai-notes',
    'generate-core-analysis', 'generate-comps', 'generate-negotiation-plan',
    'generate-call-review', 'generate-communications', 'ask-deal-question',
  ]
  it.each(aiCallingFunctions)('%s: configured timeout <= 26s (the confirmed real ceiling)', (fn) => {
    const t = tomlTimeoutFor(fn)
    expect(t).not.toBeNull()
    expect(t).toBeLessThanOrEqual(26)
  })
})

// ── Every AI-calling function has an internal guard with real margin ──────
describe('every AI-calling Netlify function has its own AbortController with margin under the real 26s ceiling', () => {
  it('generate-core-analysis.mjs: internal abort <= 20s', () => {
    const m = generateCoreAnalysisSrc.match(/abortCtrl\.abort\(\), (\d+)\)/)
    expect(m).not.toBeNull()
    expect(Number(m[1])).toBeLessThanOrEqual(20000)
  })
  it('generate-comps.mjs: internal abort <= 20s', () => {
    const m = generateCompsSrc.match(/abortCtrl\.abort\(\), (\d+)\)/)
    expect(m).not.toBeNull()
    expect(Number(m[1])).toBeLessThanOrEqual(20000)
  })
  it('generate-negotiation-plan.mjs: internal abort already had real margin (18s), untouched', () => {
    const m = generateNegotiationPlanSrc.match(/abortCtrl\.abort\(\), (\d+)\)/)
    expect(m).not.toBeNull()
    expect(Number(m[1])).toBeLessThanOrEqual(20000)
  })
  it('generate-ai-notes.mjs: full-analysis abort lowered from the old 45s (which exceeded the real ceiling) to <= 20s', () => {
    const m = generateAiNotesSrc.match(/abortCtrl\.abort\(\), screener_mode \? \d+ : (\d+)\)/)
    expect(m).not.toBeNull()
    expect(Number(m[1])).toBeLessThanOrEqual(20000)
  })
  it('analyze-deal.mjs: previously had NO AbortController at all — now guarded, <= 20s', () => {
    expect(analyzeDealSrc).toMatch(/const abortCtrl = new AbortController\(\)/)
    const m = analyzeDealSrc.match(/abortCtrl\.abort\(\), (\d+)\)/)
    expect(m).not.toBeNull()
    expect(Number(m[1])).toBeLessThanOrEqual(20000)
    // the Anthropic fetch must actually use the new signal
    expect(analyzeDealSrc).toMatch(/signal: abortCtrl\.signal/)
  })
  it('generate-report.mjs: previously had NO AbortController at all — now guarded, <= 20s', () => {
    expect(generateReportSrc).toMatch(/const abortCtrl = new AbortController\(\)/)
    const m = generateReportSrc.match(/abortCtrl\.abort\(\), (\d+)\)/)
    expect(m).not.toBeNull()
    expect(Number(m[1])).toBeLessThanOrEqual(20000)
    expect(generateReportSrc).toMatch(/signal: abortCtrl\.signal/)
  })
})

// ── Diagnostics (Part 2) present, no secrets/prompt content logged ────────
describe('diagnostic timing instrumentation added without leaking secrets or full prompts', () => {
  it('generate-core-analysis.mjs logs stage timings on success, failure, and exception paths', () => {
    expect(generateCoreAnalysisSrc).toMatch(/\[generate-core-analysis\] OK/)
    expect(generateCoreAnalysisSrc).toMatch(/\[generate-core-analysis\] FAILED/)
    expect(generateCoreAnalysisSrc).toMatch(/\[generate-core-analysis\] EXCEPTION/)
  })
  it('generate-comps.mjs logs stage timings', () => {
    expect(generateCompsSrc).toMatch(/\[generate-comps\] OK/)
    expect(generateCompsSrc).toMatch(/\[generate-comps\] FAILED/)
    expect(generateCompsSrc).toMatch(/\[generate-comps\] EXCEPTION/)
  })
  it('none of the new log lines include the API key, the full prompt, or the raw AI response text', () => {
    for (const src of [generateCoreAnalysisSrc, generateCompsSrc]) {
      const logLines = src.match(/console\.log\(`\[[^\n]*`\)/g) || []
      for (const line of logLines) {
        expect(line).not.toMatch(/ANTHROPIC_API_KEY/)
        expect(line).not.toMatch(/builtPrompt|userPrompt|raw\b/)
      }
    }
  })
  it('client runGenerate marks each of the 4 pipeline stages by name, no prompt/secret content', () => {
    expect(dealAnalysisCardSrc).toMatch(/generate-comps done/)
    expect(dealAnalysisCardSrc).toMatch(/generate-core-analysis done/)
    expect(dealAnalysisCardSrc).toMatch(/generate-negotiation-plan done/)
    expect(dealAnalysisCardSrc).toMatch(/analyze-deal done/)
    expect(dealAnalysisCardSrc).toMatch(/total pipeline complete/)
  })
})

// ── Part 4 — user-facing error handling ────────────────────────────────────
describe('Part 4 — failure behavior: no internal names/errors surfaced, deterministic calcs unaffected', () => {
  it('friendlyAiError() exists and returns the exact mandated reassuring message', () => {
    expect(dealAnalysisCardSrc).toMatch(/function friendlyAiError\(err\)/)
    expect(dealAnalysisCardSrc).toMatch(/AI analysis couldn't be completed\. Your deal inputs and calculations\s*\n?\s*are safe\. Please try again\./)
  })
  it('friendlyAiError logs the real error to the console (kept in logs, not the primary UI)', () => {
    expect(dealAnalysisCardSrc).toMatch(/console\.error\('\[AI analysis\] pipeline failure:'/)
  })
  it('both runGenerate and reRunWithOverrides route their generic catch-all through friendlyAiError — the raw err.message never reaches setGenError directly for an unrecognized failure', () => {
    // runGenerate's catch: only NO_ASKING_PRICE / NO_ARV_AVAILABLE get bespoke
    // text; everything else goes through friendlyAiError.
    expect(dealAnalysisCardSrc).toMatch(/: friendlyAiError\(err\)\s*\n\s*\)/)
    // reRunWithOverrides' catch
    expect(dealAnalysisCardSrc).toMatch(/setGenError\(friendlyAiError\(err\)\)/)
  })
  it('the raw internal string "timed out" is never passed directly to setGenError anywhere in the file', () => {
    const setGenErrorCalls = dealAnalysisCardSrc.match(/setGenError\([^)]*\)/g) || []
    for (const call of setGenErrorCalls) {
      expect(call).not.toMatch(/err\.message\s*\)/) // bare err.message with no mapping
    }
  })
})

// ── Part 5 — stale UI copy ─────────────────────────────────────────────────
describe('Part 5 — empty-state CTA copy matches the actual button label', () => {
  it('the empty state no longer hardcodes "Run Analysis" — it mirrors the same decision_v2 condition the button itself uses', () => {
    const emptyStateBlock = dealAnalysisCardSrc.match(/No AI analysis yet\.<\/p>[\s\S]{0,700}/)[0]
    expect(emptyStateBlock).toMatch(/lead\.decision_v2 \? '✦ Get Comps & Detailed AI' : '✦ Run Analysis'/)
  })
  it('the button label logic and the empty-state logic use the identical condition (no drift between the two copies)', () => {
    const buttonLabelMatches = dealAnalysisCardSrc.match(/lead\.decision_v2 \? '✦ Get Comps & Detailed AI' : '✦ Run Analysis'/g) || []
    expect(buttonLabelMatches.length).toBeGreaterThanOrEqual(2) // one in the button, one in the empty state
  })
})

// ── Part 6 — duplicate request protection ──────────────────────────────────
describe('Part 6 — duplicate concurrent AI request protection', () => {
  it('handleRun has an explicit re-entrancy guard against `generating`', () => {
    const handleRunBlock = dealAnalysisCardSrc.match(/function handleRun\(forceRefreshComps\) \{[\s\S]{0,600}/)[0]
    expect(handleRunBlock).toMatch(/if \(generating\) return/)
  })
  it('the CTA is structurally replaced by a non-interactive loading indicator while generating (not just disabled) — no click target exists to double-fire', () => {
    const renderBlock = dealAnalysisCardSrc.match(/\{canEdit && \(\s*generating \? \(([\s\S]{0,600})/)[0]
    expect(renderBlock).toMatch(/animate-spin/)
    expect(renderBlock).not.toMatch(/onClick={handleRun/)
  })
})

// ── Part 8 — legacy computed_mao finding — FIXED by a later task ──────────
// This finding was confirmed-but-deliberately-NOT-fixed by the P0 Timeout
// Investigation & Fix (2026-08-30, this file's own task) per its explicit
// scope boundary. It was then fixed, on purpose, by the very next task —
// the P0/P1 Decision Integrity Fix (also 2026-08-30) — see
// test/decisionIntegrityFix.test.js for full coverage of that fix. These
// two tests now confirm the fix landed, superseding what this file
// originally asserted.
describe('Part 8 — legacy computed_mao formula: confirmed FIXED by the subsequent P0/P1 Decision Integrity Fix task', () => {
  it('generate-core-analysis.mjs no longer returns the legacy 0.75×ARV−reno−2450 as computed_mao — it reuses buildPrompt\'s own canonical calculateFlipMAO value', () => {
    const liveCode = generateCoreAnalysisSrc.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    expect(liveCode).not.toMatch(/_arv \* 0\.75 - _reno - 2450/)
    expect(generateCoreAnalysisSrc).toMatch(/computedMao: computedMaoForResponse, computedStartingOffer\s*\}\s*=\s*buildPrompt/)
  })
  it('the client no longer independently reproduces the legacy formula for analyze-deal\'s purchase_price — it now sends the actual current evaluation price (lead.asking_price)', () => {
    expect(dealAnalysisCardSrc).not.toMatch(/const freshMao/)
    expect(dealAnalysisCardSrc).toMatch(/purchase_price: lead\.asking_price,/)
  })
})

// ── Regression: financial engine untouched by this task ───────────────────
describe('financial engine files are byte-untouched by the timeout fix', () => {
  it('calculations.js has no P0-timeout-fix markers (this task never edited it)', () => {
    const src = fs.readFileSync('src/lib/calculations.js', 'utf8')
    expect(src).not.toMatch(/P0 Timeout Investigation/)
  })
  it('dealExplanation.js has no P0-timeout-fix markers', () => {
    const src = fs.readFileSync('src/lib/dealExplanation.js', 'utf8')
    expect(src).not.toMatch(/P0 Timeout Investigation/)
  })
})
