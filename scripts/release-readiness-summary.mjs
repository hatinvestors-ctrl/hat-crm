// scripts/release-readiness-summary.mjs
// Release Readiness — reads vitest's own JSON report (never re-derives
// pass/fail itself) and prints a category-grouped summary. Run via
// `npm run test:release` (which runs vitest first, then this).
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const outFile = path.join(os.tmpdir(), 'hatcrm-release-readiness.json')

try {
  execSync(`npx vitest run --reporter=json --outputFile=${JSON.stringify(outFile)}`, { stdio: 'inherit' })
} catch {
  // vitest run exits non-zero on any failing test — still read the report
  // below so the summary reflects real failures instead of aborting blind.
}

if (!fs.existsSync(outFile)) {
  console.error('No vitest report found — the test run itself may have crashed before writing output.')
  process.exit(1)
}

const report = JSON.parse(fs.readFileSync(outFile, 'utf8'))

// Group by test FILE (each file maps to one release-readiness category —
// see the file header comments for which mission section each covers).
const CATEGORY_LABELS = {
  'calculations.test.js': 'CALCULATIONS',
  'mutation.test.js': 'MUTATION / RECALCULATION',
  'followUp.test.js': 'FOLLOW-UP',
  'actionReason.test.js': 'ACTION CENTER EXPLANATIONS',
  'dataIntegrity.test.js': 'DATA SAFETY',
  'actionCenterClassification.test.js': 'ACTION CENTER CLASSIFICATION (classifyLeadV2)',
  'crossScreenConsistency.test.js': 'CROSS-SCREEN CONSISTENCY',
  'canonicalDealValues.test.js': 'CANONICAL DEAL VALUES (D1/D2 product decision)',
  'decisionConsistency.test.js': 'DECISION-FLOW CONSISTENCY (Norfolk QA-01/02/03)',
  'brrrrFinancialAccuracy.test.js': 'BRRRR FINANCIAL ACCURACY (approved Issues #1/#4)',
  'allInAccuracy.test.js': 'ALL-IN ACCURACY (approved Objective A)',
  'priceClarity.test.js': 'PRICE CLARITY (Seller Gap / Max Buy consistency, Paschal QA)',
  'offMarketDashboard.test.js': 'OFF-MARKET DASHBOARD (funnel/filter aggregation)',
  'arvConfidence.test.js': 'COMPS INTELLIGENCE / ARV CONFIDENCE (decision sensitivity + HAT internal evidence)',
  'aiAuthority.test.js': 'AI AUTHORITY CONTRACT (canonical ARV/Max Buy authority in AI prompts)',
  'acquisitionCoach.test.js': 'HAT ACQUISITION COACH (conversation stage/coverage/already-asked/Deal Guardrail)',
  'callCoaching.test.js': 'CALL REVIEW (quote verification, scorecard validation, AI authority)',
  'callSessions.test.js': 'PERSISTENT CALL INTELLIGENCE (session identity, snapshot immutability, Calls History filtering)',
  'coachingMemory.test.js': 'CONTINUOUS COACHING INTELLIGENCE (adherence, adoption, trend, mastery, focus continuity)',
  'coachingAnalytics.test.js': 'HAT COACHING CENTER (team pulse, agent status, attention rules, trends)',
  'callReviewQuality.test.js': 'CALL REVIEW QUALITY (objection/moment dedup, transcript quality, contradiction protection)',
  'offmarketControlCenter.test.js': 'OFF-MARKET ENGINE CONTROL CENTER (criteria clamping, DocTypes honesty contract, HTTP surface)',
  'contactEnrichment.test.js': 'OFF-MARKET CONTACT ENRICHMENT (recommendation criteria, contact status, batch summary, no-auto-bill safety)',
  'contactProfile.test.js': 'RICH SKIP TRACE CONTACT PROFILE (multi-phone/email dedupe, associated people, non-destructive merge, no-inference safety)',
  'enrichmentResult.test.js': 'SKIP TRACE RESULT EXPLAINABILITY (real Ventnor/Woodstone regression, provider-called vs skipped, deterministic reason codes)',
  'leadEssentials.test.js': 'LEAD WORKSPACE ESSENTIALS & QUICK EDIT (canonical field sourcing, quick-edit save path, deal output reuse, contact summary)',
  'distressNextAction.test.js': 'DISTRESS NEXT ACTION STATE (owner/contact/workflow hierarchy, real Ventnor regression)',
  'leadWorkspacePolish.test.js': 'LEAD WORKSPACE FINAL UX POLISH (clickable Next Action, single enrichment path, contact status wording, distress card compaction)',
  'leadIntelligenceExplainability.test.js': 'LEAD INTELLIGENCE EXPLAINABILITY (real Ventnor contact-status bug fix, Opportunity/Confidence/Urgency tooltips, 85-vs-70 disambiguation)',
  'callReviewParser.test.js': 'CALL REVIEW JSON HARDENING (real production truncation bug, balanced-brace extraction, safe diagnostic logging, max_tokens fix)',
}

const byFile = {}
for (const fileResult of report.testResults) {
  const fileName = path.basename(fileResult.name)
  const label = CATEGORY_LABELS[fileName] || fileName
  const passed = fileResult.assertionResults.filter(a => a.status === 'passed').length
  const total = fileResult.assertionResults.length
  byFile[label] = (byFile[label] || { passed: 0, total: 0 })
  byFile[label].passed += passed
  byFile[label].total += total
}

console.log('\n' + '='.repeat(50))
console.log('HAT INVESTORS — RELEASE READINESS SUMMARY')
console.log('='.repeat(50))
for (const [label, { passed, total }] of Object.entries(byFile)) {
  console.log(`${label}: ${passed}/${total} ${passed === total ? 'PASS' : 'FAIL'}`)
}
console.log('-'.repeat(50))
console.log(`TOTAL: ${report.numPassedTests}/${report.numTotalTests} PASS`)
console.log(`BLOCKERS (failed tests): ${report.numFailedTests}`)
console.log('='.repeat(50))
console.log('\nNOT COVERED by this automated suite (see docs/release-readiness/RELEASE-READINESS.md):')
console.log('  - Rendered UI / browser interaction (requires browser rendering — not available in this environment; classifyLeadV2() itself IS directly unit tested)')
console.log('  - Live Copilot, AI/LLM calls, imports/ingestion, database-integration tests (require live services or a test DB — none provisioned this pass)')
console.log('  - Manual QA checklist (docs/release-readiness/manual-qa-checklist.md) — requires a human\n')

process.exit(report.numFailedTests > 0 ? 1 : 0)
