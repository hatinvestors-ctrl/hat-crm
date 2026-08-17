# HAT Investors Acquisition Intelligence — Release Readiness Report

Checkpoint tag: `pre-release-readiness-regression-suite`. Branch: `feature/lead-workspace-redesign`. This capability added `test/`, `scripts/release-readiness-summary.mjs`, `docs/release-readiness/`, and three new npm scripts — nothing else. `git diff --stat pre-release-readiness-regression-suite -- src/ netlify/` was empty at that point: zero business-logic drift.

**Update — F1/F2 fixed:** a follow-up capability (checkpoint `pre-p2-findings-fix`, current commit noted in the fix's own changelog) implemented both P2 findings below in `src/lib/dealExplanation.js` only (`calculations.js` untouched). See §3 for exact before/after behavior. Findings F3–F5 remain open (out of scope, as originally documented).

Run the suite: `npm run test:release`

## 1. Automated results

**77 / 77 passing**, 5 test files, 0 failures (was 74/74 before the F1/F2 fix; +3 net new regression tests, 2 outdated "documents-the-bug" tests replaced).

| Category | Result |
|---|---|
| CALCULATION CERTIFICATION | PASS (34/34) |
| MUTATION / RECALCULATION | PASS (10/10) |
| CROSS-SCREEN CONSISTENCY | NOT COVERED — no browser in this environment |
| WORKFLOW (status transitions) | PARTIAL — terminal-status exclusion tested; full transition matrix not exercised |
| FOLLOW-UP | PASS (13/13) |
| ACTION CENTER | PARTIAL — explanations (5/5) and follow-up splitting tested; `classifyLeadV2()` itself not directly unit tested (page-component coupling, see below) |
| AI GUARDRAILS | PARTIAL — `isStoredOfferStale()` certified; no live-LLM consistency testing performed |
| LIVE COPILOT | NOT COVERED — requires browser/mic session |
| DATA INTEGRITY | PASS (12/12) |
| IMPORTS | NOT COVERED — requires live ingestion run |
| FAILURE HANDLING | PARTIAL — null/undefined/zero-edge inputs certified; network/API failure paths not exercised |
| BUILD | PASS — `npm run build` succeeds, 252 modules, no errors |
| DATABASE CHANGE | NO — confirmed, no schema/migration touched |
| PRODUCTION DEPLOY | NO — confirmed, local/test only throughout |

## 2. Golden Leads

30 fixtures defined (`test/fixtures/goldenLeads.js`), 17 with direct automated assertions. Full table: [golden-leads.md](./golden-leads.md).

**Update — D1/D2 fixed (Canonical Deal Values, Product Decision):** Action Center (`ActionCenterPage.jsx`) and the Leads table (`LeadsTable.jsx`) now derive Max Buy/projected profit from `computeFlipResult(lead)` at render/classification time, exactly like the Lead Workspace Deal tab — never from `lead.deal_analysis.profit` or legacy `lead.mao`. A field-provenance audit also found `lead.offer_price` (the real ACTUAL/SUBMITTED offer) was never reaching the canonical pipeline's "current price" question; `computeFlipResult`'s `evaluationPrice` now prefers `offer_price`, never `starting_offer` (which remains, correctly, the separate MAO-anchored RECOMMENDED-offer concept). See §3 below.

## 3. Findings

| ID | Severity | Area | Expected | Actual (before fix) | Reproduction | Fix implemented | Fixed? |
|---|---|---|---|---|---|---|---|
| F1 | P2 (Major) | Flip verdict pipeline (`computeFlipResult`, `getEffectiveOffer`) | An offer priced meaningfully above Max Buy should be able to resolve to "NO DEAL" | `computeFlipResult`'s own `currentOffer` was always re-anchored to at-or-below Max Buy via `getEffectiveOffer`'s clamp, so its own pipeline could never emit NO DEAL for a positive Max Buy | `test/calculations.test.js` → previously `"FINDING: computeFlipResult itself cannot produce NO DEAL..."` | `computeFlipResult` now evaluates the CURRENT DEAL verdict/profit at the real, actual price on the table (a stored offer when one is set, otherwise the asking price) — `evaluationPrice`, a new field — and never substitutes Max Buy for it. Max Buy (`mao`) is computed and returned separately and unconditionally, so the negotiation opportunity stays visible even when the current price is NO DEAL. The MAO-anchored negotiated offer (`currentOffer` — unchanged meaning) is still returned for "We Offer" UI. `marginOfSafety.why` now says e.g. "Could work around $118,400 or below." when the current price fails but Max Buy is real. | **YES** |
| F2 | P2 (Major) | Flip economics on extreme-rehab leads (`calculateFlipMAO`, `getEffectiveOffer`, `computeFlipBreakdown`) | A rehab cost that exceeds ARV enough to make the deal impossible should surface as clearly non-viable | Max Buy went negative, the offer-clamp then computed a negative dollar "current offer," and the linear cost model reported a *positive* profit at that negative price — producing a "WATCH" verdict for an economically nonsensical input | `test/calculations.test.js` → previously `"FINDING: extreme rehab (negative Max Buy) produces a NEGATIVE currentOffer..."`, uses `G29_EXTREME_REHAB` (ask $60K/ARV $150K/reno $450K) | `computeFlipResult` now treats a raw Max Buy `<= 0` as infeasible (`maoFeasible: false`): the exposed `mao` is `null` (never a negative number), `currentOffer` is `null` (no valid offer to recommend), `verdict` is forced to `'NO DEAL'` regardless of what any price evaluation produces, and `marginOfSafety.why`/`biggestRisk` explicitly state "Required purchase price is not economically feasible under the current rehab and ARV assumptions." No positive profit can reach the UI from a negative price — F1's fix (evaluating the real ask, never a derived/clamped price) independently closes the specific "negative price → positive profit" path, and the explicit `maoFeasible` guard closes it structurally regardless. | **YES** |
| F3 | P3 (Minor/documentation) | `lead.mao` field (Flip legacy formula) | A DB field for "the buy-side number" should be unambiguous | `lead.mao` is silently dual-purpose: auto-recalculated by `FinancialSection.jsx`'s ARV/Reno edit handlers on every save, AND writable via a "Set manual override" prompt to the exact same column — the DB cannot distinguish "auto-computed" from "Kevin typed this." Verified against two real production leads this session (Club Duclay, Hallock) — both are auto-values in current data, not manual overrides. | See `docs/release-readiness/source-of-truth-inventory.md` | Add a boolean column (e.g. `mao_is_manual_override`) so the two cases are distinguishable at write time; purely additive schema change, out of scope for this test-only capability. | NO |
| F4 | P3 (Minor/architecture) | Action Center categorization (`classifyLeadV2`) | Core classification logic should be independently unit-testable | Lives inside `src/pages/ActionCenterPage.jsx`, a page component with heavy React/UI imports, so it cannot be imported into a plain Vitest file without pulling in the whole UI tree | Attempted direct import in `test/actionReason.test.js` during this capability; abandoned in favor of testing its constituent parts (`followUpTiming.js`, `actionReason.js`) instead | Extract `classifyLeadV2` into a pure `src/lib/` module with no React imports, re-export from the page. Out of scope this pass (would touch a real source file, however mechanically). | NO |
| F5 | P4 (Informational) | `hold_months` field | UI-editable fields should persist somewhere real | No `hold_months` column exists in `leads`; every canonical function silently defaults it to 6 internally. If the UI exposes an editable "holding period" control, edits to it write nowhere. | Confirmed via live `column does not exist` errors earlier this session | Either add the column and thread it through, or remove/relabel the UI control as a what-if-only slider that doesn't persist. | NO |

No P0 or P1 (blocking/critical) findings were identified in this pass. F1 and F2 are now fixed; F3–F5 remain open and out of scope (see original rationale below, unchanged).

## 4. Release Severity Model

- **P0 (Blocking):** data loss, wrong money shown as final/authoritative, crash on core flow. None found.
- **P1 (Critical):** wrong calculation reaches a user-facing number silently. None found — F1/F2 are edge-case presentation gaps in a verdict *tier*, not wrong arithmetic; the underlying dollar math (`computeFlipBreakdown`) is independently certified correct in all 34 calculation tests.
- **P2 (Major):** confusing/misleading result in a reachable edge case. F1, F2.
- **P3 (Minor):** field/architecture ambiguity, no immediate user-facing harm. F3, F4.
- **P4 (Informational):** cleanup/consistency item. F5.

## 5. Release Gates

| Gate | Status | Basis |
|---|---|---|
| CALCULATION GATE | PASS | 34/34 independent certification tests against from-scratch re-derived formulas |
| DATA GATE | PASS | 12/12 — nulls never coerce to fake $0, zero is preserved as a real value, no crashes on missing/extreme data |
| WORKFLOW GATE | PARTIAL | terminal-status exclusion certified; full status-transition matrix and `classifyLeadV2` untested (F4) |
| CONSISTENCY GATE | PARTIAL | mutation/recalculation certified (10/10); cross-screen UI consistency requires a browser, not testable here |
| AI SAFETY GATE | PARTIAL | staleness detection certified; no live-LLM regression testing performed |
| BUILD GATE | PASS | `npm run build` succeeds cleanly |
| MANUAL QA GATE | NOT RUN | checklist authored (`manual-qa-checklist.md`, 23 items), execution requires a human and has not been performed |

## 6. Answers to the required questions

1. **Are Flip calculations certified?** Yes — independently re-derived and matched exactly, including sensitivity, null-safety, and the historical null-reno-to-$0 regression.
2. **Are BRRRR calculations certified?** Yes — cash-flow-gate-first behavior, cash-left-in cap, and missing-input protection all certified.
3. **Can changing ARV leave stale economics anywhere?** No evidence of it in the tested paths — Deal-tab numbers and staleness flags on AI analysis are recalculated together; not verified across every screen (no browser).
4. **Is the offer-vs-Max-Buy relationship always correct?** Yes — Finding F1 is now fixed: the current-deal verdict is evaluated at the real price on the table, independent of the MAO-anchored negotiated offer, so a priced-too-high deal correctly reads NO DEAL while Max Buy stays visible as the negotiation target.
5. **Does the tool ever fabricate a number for missing data?** No — every canonical function returns `null`/`available:false` rather than defaulting to $0, certified in Data Safety tests.
6. **Is zero handled correctly?** Yes — zero is treated as a distinct, real, known value, never conflated with "missing" (see also G30's rent=$0 BRRRR behavior).
7. **Does Human Override work correctly and only when intended?** Yes — forces PASS only for an active DO_NOT_PURSUE override; leaves the decision object byte-for-byte untouched (reference equality) otherwise.
8. **Are terminal statuses correctly excluded from Action Center?** Yes, structurally, at the constant-list level (all 6 expected values present).
9. **Are follow-up date classifications correct (Today/Overdue/Upcoming)?** Yes, including exact day-counts and business-timezone handling, with no guessing on unrecognized phrases.
10. **Do action-reason explanations ever contradict their category?** Not in the 5 tested paths (OVERDUE, RE_ENGAGE, HUMAN_OVERRIDE ×2, unknown-category).
11. **Is there any known edge case that produces a misleading result?** F1 and F2 (the two known misleading-result edge cases) are now fixed and regression-tested. F3–F5 remain open, none of them produce a misleading dollar figure — they're field-ownership/architecture ambiguities, documented, not silently resolved.
12. **Is `classifyLeadV2` itself tested?** No — architecturally coupled to a page component (F4); tested only indirectly via its dependencies.
13. **Was cross-screen visual consistency verified?** No — no browser/screenshot capability in this environment; explicitly NOT TESTED, not fabricated.
14. **Was Live Copilot tested?** No — requires a live session; NOT TESTED.
15. **Were imports/ingestion tested?** No — requires a live import run against real or sandbox data; NOT TESTED.
16. **What blocks Beta release right now?** Nothing at P0/P1, and F1/F2 (the only P2s) are now fixed and regression-tested. The remaining blocker is the MANUAL QA GATE — the 23-item checklist is authored but has not been executed by a human.

## 7. Recommended next step

1. A human executes `manual-qa-checklist.md` end-to-end on `localhost:8888`, paying particular attention to item 11 (Acquisition tab negotiation-gap language) given the F1 change to how "current price fails, Max Buy is still real" is now worded.
2. Once complete, re-run `npm run test:release` and flip this document's determination below to BETA READY.

## 8. Determination

**RELEASE READINESS: CONDITIONAL**

Justification: all automated, deterministic-calculation, data-integrity, and mutation/recalculation coverage achievable in this environment passes cleanly (77/77) with the change scoped to exactly `src/lib/dealExplanation.js` (verified via `git diff --stat` against the `pre-p2-findings-fix` checkpoint — `calculations.js` and every other business-logic file are untouched), and the build is green. It is not "NOT READY" — no P0/P1 defect exists anywhere in the tested surface, and both P2 findings (F1, F2) are now fixed. It is not yet "BETA READY" solely because the Manual QA Gate's 23-item checklist has not been executed by a human.
