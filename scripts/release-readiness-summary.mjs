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
  'callReviewAbort.test.js': 'CALL REVIEW ABORT HANDLING (real "operation was aborted" incident, missing timeout config fix, error classification, idempotency)',
  'triageDecisionBar.test.js': 'COMPACT TRIAGE DECISION BAR (presentation/placement only — reused playbook, no duplicate control, button hierarchy)',
  'callDetailUX.test.js': 'COACHING CALL DETAIL UX (manager scanability — single score hero, win/miss/next-focus, skill breakdown, continuous coaching, progressive disclosure)',
  'agentProfileUX.test.js': 'COACHING AGENT PROFILE UX (current focus prominence, honest coaching-loop states, compact baseline, additive previousFocus, Call Detail consistency)',
  'contextAwareCoaching.test.js': 'CONTEXT-AWARE CALL COACHING (multi-call seller journey — call type/number derivation, dimension applicability, overall score N/A safety, skill trend N/A exclusion, legacy compatibility, no new AI call)',
  'contextAwareCoachingHardening.test.js': 'CONTEXT-AWARE COACHING HARDENING (frozen call context immutability, comparable-context overall trend, no false cross-context improvement, manager attention/team-improving safety)',
  'contextAwareCoachingFinalHardening.test.js': 'CONTEXT-AWARE COACHING FINAL HARDENING (deterministic comparable-cohort selection, recency tiebreak, honest no-claim, trend context labeling, migration review)',
  'analysisReadiness.test.js': 'ANALYSIS READINESS + DECISION INTEGRITY FIX (dead-end removed, ARV never blocking, reno null/0 semantics, staleness extended to asking price/rent, legacy-safe, comps-failure visibility)',
  'demoStabilization.test.js': 'DEMO STABILIZATION — DEAL PAGE UX/CONSISTENCY (Golden Lead 1963 W Woodleigh Dr financial outputs locked, $2,200 vs $2,222 rounding fix, Best Fit honesty, off-market terminology, Legacy data label)',
  'underwritingSettings.test.js': 'UNDERWRITING CONFIGURATION V1 (Woodleigh golden regression, hold_months zero-bug fix, resolver defaults/fallback safety, Flip/BRRRR/shared settings isolation, staleness drift detection, server-function consolidation, protected thresholds untouched)',
  'aiAnalysisTimeout.test.js': 'P0 AI/COMPS ANALYSIS TIMEOUT FIX (real 26s platform ceiling vs. fictional netlify.toml budgets, missing AbortControllers on analyze-deal/generate-report, friendly error mapping, stale "Run Analysis" copy fix, duplicate-request guard, legacy computed_mao finding confirmed unmodified)',
  'decisionIntegrityFix.test.js': 'P0/P1 DECISION INTEGRITY FIX (Woodleigh evaluation price $100K reaches every AI stage, canonical Flip MAO $102,222 replaces legacy $108,550, BRRRR consolidated onto computeBrrrrBreakdown at 70%/75% LTV, hold_months wiring gap closed, cross-setting isolation, business thresholds unchanged)',
  'brrrrRefiCostSettings.test.js': 'BRRRR REFINANCE COST SETTINGS INTEGRITY FIX (Deal page Full Breakdown tab wired to underwritingSettings, Woodleigh 75% LTV × 2%/3%/4% refi-cost regression, monotonic cash-left-in, zero/missing/malformed fallback safety, Flip isolation, cross-consumer consistency, Copilot brief pipeline classified out of scope)',
  'brrrrRenderedSettings.test.js': 'BRRRR RENDERED SETTINGS INTEGRITY FIX (DealDecisionCenter "View Calculation" card — real hardcoded refiLtvPct/taxesMonthly/insuranceMonthly return-object literals fixed, label always matches loan, Woodleigh A/B/C rendered-path regression, cross-screen consistency, Flip isolation)',
  'actionCenterUXIntegrity.test.js': 'ACTION CENTER DEMO-SAFE UX & INTEGRITY FIX (market-type badge sourced from decisionEngineV2\'s own resolver, negative-profit sign-aware styling, Expected Flip Profit/Flip Max Buy relabeling, off-market Act Now seller-opportunity qualifier, underwriting-settings threaded into displayed economics, scoring/thresholds/sortCategory proven byte-unchanged)',
  'marketTypeIntegrity.test.js': 'P1 MARKET TYPE INTEGRITY FIX (real production OFF-MARKET-section/ON-MARKET-badge contradiction traced to under-populated is_distressed flag, ONE canonical resolveMarketType built on existing isDistressedLead reused by badge/section/decisionV2Persistence scoring routing, no bulk data change, scoring thresholds/formulas byte-unchanged)',
  'acquisitionDecisionUX.test.js': 'LEAD WORKSPACE UX V2 (WATCH/NO DEAL replaced with plain-language GOOD AT ASKING/NEGOTIATE/NEEDS RESEARCH/PASS, Norfolk/Woodleigh golden UX, Flip/BRRRR Max Buy explicit labeling, price-context-always-shown, Priority separated from Acquisition Decision, Data Confidence wording, next-action price context, no financial/scoring logic changed)',
  'acquisitionDecisionUXv21.test.js': 'LEAD WORKSPACE UX V2.1 (ONE decision/ONE price target — Norfolk\'s primary-vs-secondary contradiction fixed, WITHIN BUY RANGE rename, ActionZone Next Best Action consolidated onto the shared strategy-aware price gap, secondary-strategy factual detail replaces raw NO DEAL exposure, Suggested Offer relabel, financial/scoring/thresholds byte-unchanged)',
  'acquisitionDecisionUXv22.test.js': 'LEAD WORKSPACE UX V2.2 (market-aware Acquisition Decision — DecisionHero off-market gating removed so Woodleigh gets a real decision, new READY_TO_PURSUE state for off-market/no-seller-price, genuine seller_asking_price field wired for off-market negotiate comparisons, RESEARCH BEFORE OFFERING wording, distress/MLS banners reordered below the decision, no opening-offer formula invented, financial/scoring/thresholds byte-unchanged)',
  'acquisitionDecisionUXv23.test.js': 'LEAD WORKSPACE UX V2.3 (off-market Seller Asking vs Evaluation Price vs Our Offer vs Max Buy/Walk-Away separation — resolveActualOffer trusts only lead.offer_price/FORMAL_OFFER call records, resolveAcquisitionPricePosition presentation resolver, no opening-offer formula, financial/scoring/thresholds byte-unchanged)',
  'acquisitionDecisionUXv24.test.js': 'LEAD WORKSPACE UX V2.4 (simplify the Overview to one decision/minimum cognitive load — Woodleigh strategy-disagreement wiring bug fixed [DecisionHero now threads underwritingSettings], We Offer -> Suggested Offer mislabel fixed on the Deal tab, WATCH/SOLID/NO DEAL replaced by Margin of Safety THIN/HEALTHY framing, strategy comparison collapsed to one primary + one optional alternative line, Priority reduced to compact canned subtext with full reason moved to tooltip, bottom economics collapsed to one compact line, READY_TO_PURSUE relabeled CONTACT SELLER, financial/scoring/thresholds byte-unchanged, nothing deleted — only moved/collapsed)',
  'acquisitionDecisionUXv25.test.js': 'LEAD WORKSPACE UX V2.5 (final simplification + cross-screen semantic consistency — REAL root cause of the Overview-FLIP/Deal-BRRRR contradiction found and fixed: computeStrategyRecommendation\'s BOTH-tie winner was computed but never structurally exposed, only in free text; additive resolveEffectiveStrategy resolver now shared by DecisionHero/DealDecisionCenter/LeadEssentialsBar so a fourth silently-disagreeing surface is impossible; Comps Intelligence Seller Asking/Seller Gap mislabel fixed with genuine seller-price provenance; MarginVisualization "our offer" mislabel fixed [was always a calculated suggestion, never a real offer]; header ASK/EVALUATION market-aware label; DistressBanner collapsed to progressive disclosure; MLS-paused banner de-emphasized to a muted strip; Deal Snapshot dedup [no longer recomputes economics]; Seller Snapshot collapses when all-unknown; DecisionHero Show Details disclosure; ranking logic/verdicts/thresholds byte-unchanged, additive-only dealExplanation.js change reported before applying)',
  'acquisitionDecisionUXv26.test.js': 'LEAD WORKSPACE UX V2.6 (canonical strategy comparison + Deal tab simplification — DealDecisionCenter rebuilt around ONE canonical buildStrategyComparison [same resolveEffectiveStrategy as Overview] producing one Recommended Strategy line + one explanation sentence + a compact always-visible BRRRR-vs-Flip comparison [strategy-specific WORKS/BELOW TARGET/UNAVAILABLE status, never a whole-property NO DEAL] + a strategy drill-down selector defaulting to the canonical recommendation, showing only the selected strategy\'s detail; standalone Best Fit/Margin of Safety card/Path to a Flip Deal/Path to a BRRRR Deal/Test Downside/Profit Cushion vs Price Cushion controls removed from the primary workflow [underlying FlipMarginOfSafety/FlipRealityCheck/BrrrrRealityCheck functions preserved, still exported for a future Advanced Analysis area]; price provenance from V2.3-V2.5 preserved verbatim; Woodleigh\'s mission-stated numbers reproduced exactly [Flip Max Buy ~$91.1K BELOW TARGET, BRRRR Max Buy ~$100.4K WORKS, BRRRR recommended]; Norfolk regression confirmed; financial/scoring/threshold logic byte-unchanged, zero further edits to dealExplanation.js)',
  'acquisitionDecisionUXv27.test.js': 'LEAD WORKSPACE UX V2.7 (Deal tab deduplication + canonical input ownership — the standalone "Financials" card removed from the Deal tab [duplicated Evaluation Price/Gap to Max Buy/Max Buy (Flip)/misleading "We Offer" already correctly shown by V2.6\'s canonical strategy comparison]; ARV/Renovation Cost [+ RenoTierPicker]/Rent Estimate/Holding Period/Suggested Offer [relabeled from the misleading "We Offer"]/legacy Max Offer override edit capability all preserved verbatim and consolidated into PropertyInfoSection, now the ONE canonical editable home for these inputs; FinancialSection.jsx itself untouched, simply unmounted; price provenance and V2.6 strategy architecture [buildStrategyComparison/resolveEffectiveStrategy/statusForResult, no Best Fit/Path sections] preserved; Woodleigh/Norfolk regressions confirmed; financial/scoring/threshold logic byte-unchanged, zero further edits to any protected file)',
  'acquisitionDecisionUXv28.test.js': 'LEAD WORKSPACE UX V2.8 (AI & Comps simplification — the tab returned to comparable-evidence / ARV validation; the accumulated underwriting-decision layer removed from Comps Intelligence [ROBUST DEAL / ARV SENSITIVE stress verdict, ±5% scenario table and explainer, stress-test recommendation box, and the "What Makes This Deal Work?" block with Evaluation Price / HAT Max Buy / Room to Max Buy / Seller Gap to Max Buy / Profit Shortfall — every one a restatement of an Overview/Deal conclusion, none of it comp evidence]; computeDecisionSensitivity/getValuationRecommendation preserved and still tested in arvConfidence.js [unmount, not deletion]; card rebuilt as "Comps & ARV" — Current ARV with getArvProvenance-backed caption, an honest "no detailed comp analysis has been run yet" state before analysis, and after analysis real Comparable Sales Evidence parsed verbatim from generate-comps.mjs\'s own MARKET COMPS output [market range, COMP: rows, evidence read] plus the existing honest comp-confidence state and a secondary, collapsed HAT Market History; no comp-confidence score fabricated and the ±5% stress test explicitly NOT relabeled as comp confidence; Analysis Readiness collapsed to "Analysis Ready ✓" when ready while keeping every editor for what is actually missing; Get Comps & Detailed AI remains the single CTA with generation logic untouched; Woodleigh/Norfolk economics, strategy recommendations, Max Buy, scoring and thresholds byte-unchanged; AI generation logic unchanged)',
  'aiCompsV3.test.js': 'AI PROPERTY ANALYSIS / AI & COMPS V3 (forensic-audit-driven pass — "AI Deal Read"/"AI Read" removed from the only place it ever mounted [DealAnalysisCard.jsx, gated by the existing hideDecisionSummary prop, always true at its sole LeadDetailPage.jsx call site] because it was confirmed NOT actually AI-generated [identical deterministic computeFlipResult/computeBrrrrResult already shown by Overview/Deal]; genuinely AI-generated AI Deal Score [total + real category breakdown parsed verbatim from ai_notes\' DEAL SCORE section, no new scoring/criteria/band language] and AI Insights [the AI\'s own PROS/CONS bullets, capped at 5] surfaced in AI & Comps via a new pure-parsing module [aiDealScore.js, zero calls into the financial engine]; explicitly distinguished from Overview\'s Acquisition Decision and Deal\'s Margin of Safety per an on-screen disclaimer; 3-level ARV/AI-recommended-ARV-to-canonical/manual-override-refresh-safety/Renovation Guidance explicitly NOT implemented this pass and reported as requiring further scoping, per the mission\'s own stop-if-unclear rule — no fabricated ARV values, no schema change, no protected-file change)',
  'earlyPropertyAnalysis.test.js': 'AI & COMPS EARLY PROPERTY ANALYSIS FIX (root-cause fix — a fresh off-market lead with no Evaluation Price/Renovation could not run ANY AI action at all [the readiness gate hid the CTA behind a static, unclickable sentence]; STAGE A [property/market intelligence — generate-comps only, reusing the existing callFn, no new AI call] now always runs via an always-clickable "Analyze Property with AI" button whenever STAGE B [deal economics — same real prerequisites as before, computeAnalysisReadiness unchanged] isn\'t ready yet; writes ONLY ai_notes, never fabricates Evaluation Price/Seller Asking/Renovation/ARV; a distinct honest "Property Analysis Complete" partial state replaces the old dead-end wording; Analysis Readiness panel relabeled Property Analysis [always ready] vs Deal Analysis [real prerequisites] with zero readiness-logic change; existing full-input pipeline, AI Deal Score fabrication-safety, AI Read removal, market comps/AI Insights/Detailed Analysis/negotiation intelligence all confirmed unchanged; financial/scoring/threshold/protected-file logic byte-unchanged; updated for AI Valuation V1\'s runPropertyOnly extension — see aiValuationV1.test.js)',
  'aiValuationV1.test.js': 'AI VALUATION + GUIDED LEAD UNDERWRITING FLOW V1 (3-level ARV restored inside the CURRENT generate-comps pipeline, never the quarantined generate-ai-notes.mjs — Conservative/Recommended/Upside, evidence-based, gated to fire ONLY when canonical ARV is genuinely blank, same proven pattern as the existing RENTAL COMPS 3-tier section; new pure-parsing module aiValuation.js [parseAiValuation, one sanity check: numeric/positive/finite + conservative<=recommended<=upside, never asking-price/Max-Buy-derived, never a fixed +/- spread]; a validated Recommended ARV safely populates canonical lead.arv ONLY when it was null — no ai_arv/valuation_arv_for_math second field ever created; schema-free AI-provenance detection [wasArvSetByAi, a read-time fingerprint match against lead.arv, no arv_source column] powers a subtle amber "AI Estimate" badge on the top Deal Inputs ARV tile; manual override always wins and is indistinguishable from acceptance the moment a user edits ARV to a different value; refresh safety — an existing canonical ARV is never silently replaced by a new AI run, surfaced instead via a "New AI recommendation… [Use AI Estimate]" banner requiring explicit action; AI & Comps card gains a compact 3-line guided-flow strip [Property Analysis → Renovation → Deal Ready, status only, no second CTA/no duplicate editor] and a 3-column Valuation block shown above Comparable Sales Evidence, below canonical Current ARV; V3\'s AI Deal Score/AI Insights parsing untouched and confirmed never fabricated from Stage A alone; Flip/BRRRR Max Buy/Profit/Cash Flow/Strategy/Acquisition Decision/seller price provenance and all six protected files [calculations.js, decisionEngineV2.js, buyBox.js, underwritingSettings.js, dealExplanation.js, sellerStrategy.js] confirmed byte-unchanged; no schema migration, no new environment variable; named regressions [Woodleigh/Norfolk/3081 Bessent/fully-populated lead] all confirmed unaffected)',
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
