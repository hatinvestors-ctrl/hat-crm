# Golden Lead Expectation Table

Fixtures live in `test/fixtures/goldenLeads.js`. All 30 requested IDs (G01–G30) are defined as in-memory fixtures — none touch the database. Values below reflect the **F1/F2-fixed** `computeFlipResult` (see `RELEASE-READINESS.md` → Findings F1/F2) and were computed directly against the real `computeFlipResult`/`computeBrrrrResult`/`computeStrategyRecommendation` functions (not hand-guessed).

**Since the fix:** the Flip `verdict` and `projectedProfit` reflect the real evaluation price (a stored offer when one is on file, otherwise the asking price) — never Max Buy. Max Buy (`mao`) is a separate, always-visible negotiation ceiling; it reads `null` (not a negative number) when infeasible. `strategy` reflects whether the deal works **at the current price** — a `NONE` here does not mean the property is dead, only that it doesn't work as currently priced; check `mao` for the negotiation opportunity.

✅ = has a direct automated assertion. — = fixture defined, not yet asserted.

| ID | Inputs (ask/ARV/reno/rent) | Flip result (at real price) | Max Buy | BRRRR result | Strategy (at current price) | Automated? |
|---|---|---|---|---|---|---|
| G01 STRONG FLIP | 95K / 270K / 50K / — | STRONG, profit $90,962 (evaluated at $95K) | $151,868 | N/A — rent missing | FLIP | ✅ |
| G02 SOLID FLIP | 126K / 220K / 25K / — | PASS ("SOLID"), profit $38,230 (at $126K) | $133,677 | N/A — rent missing | FLIP | ✅ |
| G03 WATCH FLIP | 118K / 185K / 10K / — | WATCH, profit $30,456 (at $118K) | $118,425 | N/A — rent missing | FLIP | ✅ |
| G04 NO DEAL AT CURRENT PRICE | 204K ask / 185K / 10K, stored offer 150K | **NO DEAL, profit −$3,848** (evaluated at the $150K stored offer — the real number on the table) | $118,425 — negotiation opportunity remains | N/A | NONE (at current price) — negotiate toward ~$118K | ✅ |
| G05 OFFER ABOVE MAX BUY | 130K / 185K / 10K, offer 130K | NO DEAL, profit $17,592 (at $130K — below HAT's $30K target) | $118,425 | N/A | NONE (at current price) | ✅ |
| G06 LARGE ASK-GAP (Hallock analog) | 204K ask / 185K / 10K, stored offer 115.7K | WATCH, profit $32,922 (evaluated at the $115.7K stored offer) | $118,425 | N/A | FLIP | — |
| G07 MISSING ARV | 220K / — / 5K / — | N/A — ARV missing | N/A | N/A — ARV missing | NONE | ✅ |
| G08 MISSING RENO | 220K / 250K / — / — | N/A — reno missing | N/A | N/A — reno missing | NONE | — |
| G09 MISSING RENT ONLY | 150K / 220K / 15K / — | NO DEAL, profit $23,302 (at $150K — asking price is actually $6K above the $143,752 Max Buy) | $143,752 | N/A — rent missing | NONE (at current price) | ✅ |
| G10 STRONG BRRRR | 100K / 270K / 50K / 2200 | STRONG, profit $85,602 | $151,868 | STRONG, cash left in $0 | BOTH | — |
| G11 BRRRR FAILS CASH FLOW | 150K / 150K / 20K / 400 | NO DEAL, profit −$47,198 (asking $150K vs. $77,987 Max Buy) | $77,987 | NO DEAL, cash left in $84,848 | NONE | — |
| G12 BRRRR FAILS CASH-LEFT-IN | 300K / 200K / 40K / 1800 | NO DEAL, profit −$183,098 (asking $300K vs. $101,215 Max Buy) | $101,215 | WATCH, cli $29,404 | BRRRR | — |
| G13 BOTH WORK (Club Duclay analog) | 100K / 270K / 50K / 1600 | STRONG, profit $85,602 | $151,868 | PASS, cli $0 | BOTH | ✅ |
| G14 BOTH / FLIP PREFERRED | 80K / 260K / 40K / 1500 | STRONG, profit $108,542 | $153,267 | NO DEAL | FLIP | — |
| G15 BOTH / BRRRR PREFERRED | 115K / 185K / 10K / 2400 | WATCH, profit $33,672 | $118,425 | STRONG, cli $12,763 | BOTH (BRRRR preferred) | — |
| G16 PRELIMINARY | 220K / — / 5K, synthetic decision_v2 (confidence 45, missing ARV) | N/A — ARV missing | N/A | N/A | NONE | — |
| G17 REFINED | 204K/185K/10K, synthetic decision_v2 (confidence 100) | NO DEAL, profit −$61,736 (asking $204K vs. $118,425 Max Buy) | $118,425 | N/A | NONE (at current price) | — |
| G18 ON-MARKET | 200K/260K/30K | NO DEAL, profit −$9,298 (asking $200K vs. $163,341 Max Buy) | $163,341 | N/A | NONE (at current price) | — |
| G19 OFF-MARKET/DISTRESSED | no ask, no stored offer, ARV 200K/reno 30K | available=true, no real price to evaluate → profit/verdict stay N/A/NO DEAL by default | $111,289 | N/A | NONE | — |
| G20 FOLLOW-UP TODAY | status=follow_up, date=today | classifies TODAY | — | — | — | ✅ |
| G21 OVERDUE | status=follow_up, date=-7d | classifies OVERDUE, day count exactly 7 | — | — | — | ✅ |
| G22 UPCOMING | status=follow_up, date=+7d | classifies UPCOMING | — | — | — | ✅ |
| G23 RE-ENGAGE | status=follow_up + synthetic HIGH urgency (price-drop reason) | evidence includes the real signal text | — | — | — | ✅ |
| G24 TERMINAL/DEAD | status=dead_lead | confirmed in TERMINAL_STATUSES | — | — | — | ✅ |
| G25 HUMAN OVERRIDE | acquisition_override.active=true, decision=DO_NOT_PURSUE | applyHumanOverride forces PASS/HUMAN_OVERRIDE regardless of underlying strength | $151,868 | — | — | ✅ |
| G26 STALE AI ANALYSIS (Hallock analog) | deal_analysis.inputs.reno=50K vs current reno=10K | isStoredOfferStale() = true | $118,425 | — | — | ✅ |
| G27 MISSING CONTACT | no owner_name, no listing_agent_name | NO DEAL, profit −$698 (asking $150K vs. $121,364 Max Buy) | $121,364 | N/A | NONE (at current price — contact absence doesn't affect economics, correctly a separate concern) | — |
| G28 LEGACY MAO PRESENT (Club Duclay analog) | mao=150,050 stored, canonical Flip Max Buy=$151,868 | STRONG, profit $85,602 — legacy field not read by this path | $151,868 | N/A | FLIP | ✅ (calculations.test.js) |
| G29 EXTREME REHAB | 60K/150K/450K | **NO DEAL, profit −$415,118** (evaluated at the real $60K ask — enormously negative, correctly rejected) | **null — infeasible, no purchase price works** (see Finding #2, fixed) | N/A | NONE | ✅ |
| G30 ZERO/EDGE VALUES | ask=0/arv=150K/reno=0/rent=0 | NO DEAL — $0 is not a real evaluable acquisition price, no profit fabricated | $98,136 | NO DEAL (rent=0 treated as a real known zero, not "unknown" — consistent with the codebase's explicit null-vs-zero distinction) | NONE | ✅ |

**Not created as separate fixtures (would require live Anthropic/Netlify function calls, not deterministic unit-test material):** AI Deal Brief generation, Live Copilot transcript/extraction, Redfin/Zillow import parsing. These are covered by the Manual QA checklist instead.
