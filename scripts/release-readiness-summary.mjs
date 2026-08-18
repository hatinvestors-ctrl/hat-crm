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
