# Source-of-Truth Inventory

One canonical function/field per concept, and every place the same concept is duplicated. Compiled from code (not assumption) across this and prior sessions' audits.

## Property Inputs (raw `leads` columns — no computation)
`asking_price`, `arv`, `renovation_cost`, `rent_estimate`, `bedrooms`, `bathrooms`, `sqft`. **No `hold_months` column exists** — every canonical function defaults it to `6` internally (confirmed via live `column does not exist` errors this session). `hold_months` as a UI-editable field writes nowhere real; flag for review.

## Flip
| Concept | Canonical source |
|---|---|
| Max Buy (Flip) | `calculateFlipMAO(arv, reno, holdMonths)` — `src/lib/calculations.js` |
| Projected profit / full P&L | `computeFlipBreakdown(pp, arv, reno, holdMonths)` — same file |
| Current offer (what's evaluated) | `getEffectiveOffer(lead, canonicalMao)` — clamps to `mao*0.995`, never above |
| Starting offer (raw, may be stale) | `lead.starting_offer` (raw column, distinct concept from Current Offer) |
| Effective offer | same as Current Offer — one function, `getEffectiveOffer` |
| Margin of Safety / verdict/tier | `computeFlipResult(lead)` — `src/lib/dealExplanation.js`, wraps the above |
| Target profit | `FLIP_MIN_PROFIT_TARGET = 30000` — `calculations.js` |
| Tier thresholds | `FLIP_STRONG_PROFIT = 40000`, `FLIP_PASS_MARGIN = 5000` — `calculations.js` |
| Sale/financing assumptions | hardcoded inside `computeFlipBreakdown`: 90% HML + 100% reno financed, 2% points, 1%/mo interest, $2,450 fixed closing, $208/mo tax + $100/mo insurance holding, sale at 93% of ARV |

**Legacy/overloaded field:** `lead.mao` — the OLDER flat `calculateMAO()` formula (`0.75×ARV − Reno − 2450`). Auto-recomputed by `FinancialSection.jsx`'s own ARV/Reno edit handlers on every save, AND writable via a "Set manual override" prompt to the exact same column. **The database cannot distinguish "auto-recalculated" from "Kevin typed this."** Confirmed via two real leads this session (7614 Club Duclay: stored `$150,050` = exactly `calculateMAO(270000,50000)`; 7109 Hallock: stored `$126,300` = exactly `calculateMAO(185000,10000)`) — both are auto-values, not manual overrides, in current production data.

## BRRRR
| Concept | Canonical source |
|---|---|
| Max Buy (BRRRR) | `calculateBrrrrMAO(arv, reno, rent, holdMonths, maxCashLeftIn)` |
| Cash left in / cash flow | `computeBrrrrBreakdown(pp, arv, reno, rent, holdMonths)` |
| Limiting constraint | `calculateBrrrrMAO`'s returned `limitingFactor` — always `'CASH_LEFT_IN'` in the current model (cash flow is a pass/fail gate, not price-dependent — refi loan is fixed at 70% of ARV regardless of purchase price, per an explicit bugfix comment in the code) |
| Cap requirement | `BRRRR_MAX_CASH_LEFT_IN = 30000` |
| Refi assumptions | hardcoded in `computeBrrrrBreakdown`: refi at 70% ARV, 3% refi closing costs, 30yr/6.9% mortgage |

## Decisioning (V2)
`decisionEngineV2.js` — `computeDecisionV2()` is the single top-level entry point; `computeRecommendation()` is the exact precedence chain (FOLLOW_UP status → NOT_FIT gate → dead_lead → strong/promising/weak thresholds → ACT_NOW/REVIEW_TODAY/RESEARCH/MONITOR/PASS). `applyHumanOverride()` runs last, unconditionally forcing `PASS`/`HUMAN_OVERRIDE` when `lead.acquisition_override.active && decision === 'DO_NOT_PURSUE'`. Preliminary/Refined: `getDecisionMaturity()` (`arvProvenance.js`) — reuses V2's own `confidence.missing`/`confidence.score`, no separate score. ActionZone's own next-action (`PLAYBOOKS[lead.status]`) is a **separate, status-workflow-driven** concept from V2's `next_best_action` — both are real, intentionally different questions (Action-First UX capability made this explicit rather than merging them).

## Workflow
`lead.status`, `lead.follow_up_date`. `TERMINAL_STATUSES` (`src/lib/constants.js`) structurally excludes leads from Action Center at the query level. `classifyFollowUpDate()`/`daysOverdue()` (`followUpTiming.js`) — `America/New_York`, date-only comparison, no UTC drift. Action Center category: `classifyLeadV2()` (`src/pages/ActionCenterPage.jsx`) — **lives in a page component, not a pure lib module**; not directly unit-testable without pulling in React/UI dependencies (flagged as a P3 refactor candidate, not fixed this pass).

## AI
`lead.deal_analysis` (AI-generated verdict/profit/ROI text+JSON, a DIFFERENT vocabulary — BUY NOW/MAKE OFFER/etc — from the deterministic Flip/BRRRR tier), `lead.ai_notes` (raw AI narrative text, parsed by `NotesRenderer.jsx`), `lead.deal_brief` (`generate-deal-brief` output), `isStoredOfferStale()`/staleness banners (compares `deal_analysis.inputs` against current arv/reno). Off-market: `lead.distress_data` (Seller Intelligence, deterministic, `sellerStrategy.js` — no LLM). Live Copilot: `extract-seller-facts` (the only automatic LLM call in the app).

## History
`lead_activities` (type: comment/status_change/enrichment/etc, `content` free text written by `activityLogger.js`'s `describeField()`/`logOutcome()`/`logDealAnalysis()`), `deal_financials` (post-acquisition project financials, separate table).
