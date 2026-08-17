# HAT Investors Acquisition Intelligence — Release Readiness Report

Checkpoint tag: `pre-release-readiness-regression-suite`. Branch: `feature/lead-workspace-redesign`. This capability added `test/`, `scripts/release-readiness-summary.mjs`, `docs/release-readiness/`, and three new npm scripts — nothing else. `git diff --stat pre-release-readiness-regression-suite -- src/ netlify/` is empty: zero business-logic drift.

Run the suite: `npm run test:release`

## 1. Automated results

**74 / 74 passing**, 5 test files, 0 failures.

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

## 3. Findings

| ID | Severity | Area | Expected | Actual | Reproduction | Recommended fix | Fixed this pass? |
|---|---|---|---|---|---|---|---|
| F1 | P2 (Major) | Flip verdict pipeline (`computeFlipResult`, `getEffectiveOffer`) | An offer priced meaningfully above Max Buy should be able to resolve to "NO DEAL" | `computeFlipResult`'s own `currentOffer` is always re-anchored to at-or-below Max Buy via `getEffectiveOffer`'s clamp, so its own pipeline can never emit NO DEAL for a positive Max Buy — NO DEAL is only reachable by evaluating profit directly at an explicit above-MAO price via `computeFlipBreakdown`, bypassing the normal UI path | `test/calculations.test.js` → `"FINDING: computeFlipResult itself cannot produce NO DEAL..."` | Decide intentionally whether the UI should ever show a raw (unclamped) evaluated offer/verdict alongside the clamped one, or whether "NO DEAL" is meant to be unreachable through this path by design (i.e. the clamp *is* the guardrail, offers above Max Buy are never something the tool endorses evaluating). This is a business-rule decision, not a code defect — flagging per the mission's "stop on ambiguity" instruction rather than silently resolving it. | NO |
| F2 | P2 (Major) | Flip economics on extreme-rehab leads (`calculateFlipMAO`, `getEffectiveOffer`, `computeFlipBreakdown`) | A rehab cost that exceeds ARV enough to make the deal impossible should surface as clearly non-viable | Max Buy goes negative, the offer-clamp then computes a negative dollar "current offer," and the linear cost model reports a *positive* profit at that negative price — producing a "WATCH" (technically-still-monitorable) verdict for an economically nonsensical input, rather than an explicit error/blocked state | `test/calculations.test.js` → `"FINDING: extreme rehab (negative Max Buy) produces a NEGATIVE currentOffer..."`, uses `G29_EXTREME_REHAB` (ask $60K/ARV $150K/reno $450K) | Add an explicit guard in the presentation layer (not the protected calculation files) that treats a negative Max Buy as "not viable" rather than passing it through the normal WATCH/PASS/STRONG tiering — a UI-only decision, does not require touching `calculations.js`/`dealExplanation.js`. Left unfixed this pass since it touches verdict-tier logic and is squarely inside the protected-files list. | NO |
| F3 | P3 (Minor/documentation) | `lead.mao` field (Flip legacy formula) | A DB field for "the buy-side number" should be unambiguous | `lead.mao` is silently dual-purpose: auto-recalculated by `FinancialSection.jsx`'s ARV/Reno edit handlers on every save, AND writable via a "Set manual override" prompt to the exact same column — the DB cannot distinguish "auto-computed" from "Kevin typed this." Verified against two real production leads this session (Club Duclay, Hallock) — both are auto-values in current data, not manual overrides. | See `docs/release-readiness/source-of-truth-inventory.md` | Add a boolean column (e.g. `mao_is_manual_override`) so the two cases are distinguishable at write time; purely additive schema change, out of scope for this test-only capability. | NO |
| F4 | P3 (Minor/architecture) | Action Center categorization (`classifyLeadV2`) | Core classification logic should be independently unit-testable | Lives inside `src/pages/ActionCenterPage.jsx`, a page component with heavy React/UI imports, so it cannot be imported into a plain Vitest file without pulling in the whole UI tree | Attempted direct import in `test/actionReason.test.js` during this capability; abandoned in favor of testing its constituent parts (`followUpTiming.js`, `actionReason.js`) instead | Extract `classifyLeadV2` into a pure `src/lib/` module with no React imports, re-export from the page. Out of scope this pass (would touch a real source file, however mechanically). | NO |
| F5 | P4 (Informational) | `hold_months` field | UI-editable fields should persist somewhere real | No `hold_months` column exists in `leads`; every canonical function silently defaults it to 6 internally. If the UI exposes an editable "holding period" control, edits to it write nowhere. | Confirmed via live `column does not exist` errors earlier this session | Either add the column and thread it through, or remove/relabel the UI control as a what-if-only slider that doesn't persist. | NO |

No P0 or P1 (blocking/critical) findings were identified in this pass.

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
4. **Is the offer-vs-Max-Buy relationship always correct?** Mostly — the *underlying* math is correct, but see Finding F1: the clamp means the deterministic pipeline can't itself present a NO DEAL for a priced-too-high offer.
5. **Does the tool ever fabricate a number for missing data?** No — every canonical function returns `null`/`available:false` rather than defaulting to $0, certified in Data Safety tests.
6. **Is zero handled correctly?** Yes — zero is treated as a distinct, real, known value, never conflated with "missing" (see also G30's rent=$0 BRRRR behavior).
7. **Does Human Override work correctly and only when intended?** Yes — forces PASS only for an active DO_NOT_PURSUE override; leaves the decision object byte-for-byte untouched (reference equality) otherwise.
8. **Are terminal statuses correctly excluded from Action Center?** Yes, structurally, at the constant-list level (all 6 expected values present).
9. **Are follow-up date classifications correct (Today/Overdue/Upcoming)?** Yes, including exact day-counts and business-timezone handling, with no guessing on unrecognized phrases.
10. **Do action-reason explanations ever contradict their category?** Not in the 5 tested paths (OVERDUE, RE_ENGAGE, HUMAN_OVERRIDE ×2, unknown-category).
11. **Is there any known edge case that produces a misleading result?** Yes — F1 and F2, both fully documented, neither silently patched.
12. **Is `classifyLeadV2` itself tested?** No — architecturally coupled to a page component (F4); tested only indirectly via its dependencies.
13. **Was cross-screen visual consistency verified?** No — no browser/screenshot capability in this environment; explicitly NOT TESTED, not fabricated.
14. **Was Live Copilot tested?** No — requires a live session; NOT TESTED.
15. **Were imports/ingestion tested?** No — requires a live import run against real or sandbox data; NOT TESTED.
16. **What blocks Beta release right now?** Nothing at P0/P1. The MANUAL QA GATE has not been run (23-item checklist authored but unexecuted), and F1/F2 should get an explicit product decision (even if the decision is "leave as-is") before calling this Beta-ready, since both affect what an acquisitions user sees as a verdict in reachable (if uncommon) scenarios.

## 7. Recommended next step

1. A human executes `manual-qa-checklist.md` end-to-end on `localhost:8888`.
2. Product/Kevin makes an explicit call on F1 and F2 (documented, not silently coded around).
3. Once both are done, re-run `npm run test:release` and flip this document's determination below to BETA READY.

## 8. Determination

**RELEASE READINESS: CONDITIONAL**

Justification: all automated, deterministic-calculation, data-integrity, and mutation/recalculation coverage achievable in this environment passes cleanly (74/74) with zero business-logic drift from the checkpoint tag, and the build is green. It is not "NOT READY" — no P0/P1 defect exists anywhere in the tested surface. It is not yet "BETA READY" because (a) the Manual QA Gate has an authored but unexecuted checklist, and (b) two real P2 findings (F1, F2) are documented but await a product decision rather than being silently resolved, per this mission's explicit instructions.
