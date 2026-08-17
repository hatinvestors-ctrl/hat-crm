# Golden Lead Expectation Table

Fixtures live in `test/fixtures/goldenLeads.js`. All 30 requested IDs (G01–G30) are defined as in-memory fixtures — none touch the database. **17 of 30** have direct numeric/behavioral assertions in the automated suite (`test/*.test.js`); the remaining 13 are defined and available for future test-writing but are not yet independently asserted beyond "does not crash." Values below were computed directly against the real `computeFlipResult`/`computeBrrrrResult`/`computeStrategyRecommendation` functions (not hand-guessed).

✅ = has a direct automated assertion. — = fixture defined, not yet asserted.

| ID | Inputs (ask/ARV/reno/rent) | Flip result | BRRRR result | Strategy | Automated? |
|---|---|---|---|---|---|
| G01 STRONG FLIP | 95K / 270K / 50K / — | STRONG, profit $90,962 | N/A — rent missing | FLIP | ✅ |
| G02 SOLID FLIP | 126K / 220K / 25K / — | PASS ("SOLID"), profit $38,230 | N/A — rent missing | FLIP | ✅ |
| G03 WATCH FLIP | 118K / 185K / 10K / — | WATCH, profit $30,456 | N/A — rent missing | FLIP | ✅ |
| G04 (reserved for above-Max-Buy) | 204K / 185K / 10K / — | WATCH, profit $30,670 (see Finding #1) | N/A | FLIP | ✅ (via computeFlipBreakdown directly) |
| G05 OFFER ABOVE MAX BUY | 130K / 185K / 10K, offer=130K | WATCH, currentOffer clamped ≤ MAO | N/A | FLIP | ✅ |
| G06 LARGE ASK-GAP (Hallock analog) | 204K / 185K / 10K, offer=115.7K | WATCH, profit $32,922 | N/A | FLIP | — |
| G07 MISSING ARV | 220K / — / 5K / — | N/A — ARV missing | N/A — ARV missing | NONE | ✅ |
| G08 MISSING RENO | 220K / 250K / — / — | N/A — reno missing | N/A — reno missing | NONE | — |
| G09 MISSING RENT ONLY | 150K / 220K / 15K / — | WATCH, profit $33,057 | N/A — rent missing | FLIP | ✅ |
| G10 STRONG BRRRR | 100K / 270K / 50K / 2200 | STRONG, profit $85,602 | STRONG, cash left in $0 | BOTH | — |
| G11 BRRRR FAILS CASH FLOW | 150K / 150K / 20K / 400 | WATCH, profit $30,415 | NO DEAL, cash left in $84,848 | FLIP | — |
| G12 BRRRR FAILS CASH-LEFT-IN | 300K / 200K / 40K / 1800 | WATCH, profit $30,552 | WATCH, cli $29,404 | BOTH | — |
| G13 BOTH WORK (Club Duclay analog) | 100K / 270K / 50K / 1600 | STRONG, profit $85,602 | PASS, cli $0 | BOTH | ✅ |
| G14 BOTH / FLIP PREFERRED | 80K / 260K / 40K / 1500 | STRONG, profit $108,542 | NO DEAL | FLIP | — |
| G15 BOTH / BRRRR PREFERRED | 115K / 185K / 10K / 2400 | WATCH, profit $33,672 | STRONG, cli $12,763 | BOTH (BRRRR preferred) | — |
| G16 PRELIMINARY | 220K / — / 5K, synthetic decision_v2 (confidence 45, missing ARV) | N/A — ARV missing | N/A | NONE | — |
| G17 REFINED | 204K/185K/10K, synthetic decision_v2 (confidence 100) | WATCH, profit $30,670 | N/A | FLIP | — |
| G18 ON-MARKET | 200K/260K/30K | WATCH, profit $33,582 | N/A | FLIP | — |
| G19 OFF-MARKET/DISTRESSED | no ask, ARV 200K/reno 30K | available=true, currentOffer/profit **null** (no ask, no stored offer) | N/A | NONE | — |
| G20 FOLLOW-UP TODAY | status=follow_up, date=today | classifies TODAY | — | — | ✅ |
| G21 OVERDUE | status=follow_up, date=-7d | classifies OVERDUE, day count exactly 7 | — | — | ✅ |
| G22 UPCOMING | status=follow_up, date=+7d | classifies UPCOMING | — | — | ✅ |
| G23 RE-ENGAGE | status=follow_up + synthetic HIGH urgency (price-drop reason) | evidence includes the real signal text | — | — | ✅ |
| G24 TERMINAL/DEAD | status=dead_lead | confirmed in TERMINAL_STATUSES | — | — | ✅ |
| G25 HUMAN OVERRIDE | acquisition_override.active=true, decision=DO_NOT_PURSUE | applyHumanOverride forces PASS/HUMAN_OVERRIDE regardless of underlying strength | — | — | ✅ |
| G26 STALE AI ANALYSIS (Hallock analog) | deal_analysis.inputs.reno=50K vs current reno=10K | isStoredOfferStale() = true | — | — | ✅ |
| G27 MISSING CONTACT | no owner_name, no listing_agent_name | WATCH, profit $31,462 (contact absence doesn't affect economics — correct, different concerns) | N/A | FLIP | — |
| G28 LEGACY MAO PRESENT (Club Duclay analog) | mao=150,050 stored, canonical Flip MAO=$151,868 | STRONG, profit $85,602 — legacy field not read by this path | N/A | FLIP | ✅ (calculations.test.js) |
| G29 EXTREME REHAB | 60K/150K/450K | WATCH, profit $31,906, **negative Max Buy ($-355,222) and negative currentOffer ($-357,000)** — see Finding #2 | N/A | FLIP | ✅ |
| G30 ZERO/EDGE VALUES | ask=0/arv=150K/reno=0/rent=0 | STRONG, profit $135,202 (ask=$0 is unrealistic but handled without crashing) | NO DEAL (rent=0 treated as a real known zero, not "unknown" — consistent with the codebase's explicit null-vs-zero distinction) | FLIP | ✅ |

**Not created as separate fixtures (would require live Anthropic/Netlify function calls, not deterministic unit-test material):** AI Deal Brief generation, Live Copilot transcript/extraction, Redfin/Zillow import parsing. These are covered by the Manual QA checklist instead.
