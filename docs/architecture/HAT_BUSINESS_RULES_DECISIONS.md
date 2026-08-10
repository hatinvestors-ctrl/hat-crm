# HAT Business Rules Decision Pack

**Sprint 2, Step 1–7. Status: DECISION PACK ONLY. No runtime code was changed to
produce this document. No canonical config value has been chosen — every
conflict below is presented as an open decision for Tomer, not resolved by this
document.**

This document is the reconciliation step required before `/config` can be
populated with real values (Migration Strategy Phase 2, referenced throughout
`docs/architecture/HAT_AI_OS.md`). It is grounded in the actual production code
as of commit `96980a6` (tag `hat-ai-os-foundation-v1`) — every "current value"
cited below is a direct quote or paraphrase of real code, not an assumption.

---

## How to use this document

For each of the 23 rule areas below, **do not treat any "Proposed Option" as a
recommendation to adopt** — they are presented as the distinct choices visible
in the current code, laid out so a decision can be made deliberately rather than
inherited by accident. Where this document expresses a *preference* about
process (e.g. "this should probably not be a hard block"), that is a
process/architecture opinion, not a business-value decision — the business
value itself is always left blank for Tomer to fill in.

---

## STEP 1 — BUSINESS RULE DECISION MATRIX

### 1. Blocked / restricted ZIPs

**RULE**: Certain ZIPs are excluded from the acquisition pipeline entirely.

**CURRENT VALUES**: `32206`, `32209`, `32254` — hard-blocked, "no exceptions, no
matter how good the deal looks."

**FILES / LOCATIONS**:
- `scripts/daily-redfin-import/index.mjs:20` — `BLOCKED_ZIPS` JS `Set`, enforced
  after ZIP geocoding, before insert.
- `scripts/daily-redfin-import/index.mjs:245` — restated inside the `HAT_CRITERIA`
  LLM prompt, Step 1.
- `scripts/daily-redfin-import/index.mjs:311` — restated a third time, Step 4.

**CURRENT LIVE EFFECT**: Enforced *only* in the daily Redfin importer. Every other
insertion path (manual scripts, `enrich-lead.mjs`, manual CRM entry) has no ZIP
gate at all.

**CONFLICT**: `scripts/insert-today.mjs:32` and
`scripts/insert-redfin-leads-2026-05-19.mjs:49` have already inserted leads with
`zip_code: '32206'` directly — a "hard-blocked, no exceptions" ZIP was bypassed by
a one-off manual script. The rule is not actually enforced system-wide today
despite being described as absolute.

**BUSINESS IMPACT**: If 32206/32209/32254 are truly unworkable ZIPs, every
non-Redfin ingestion path is currently a silent leak. If they are *not* truly
unworkable (see item 2's tier conflict — 32254 also appears as a scored, includable
C-tier ZIP elsewhere), the "hard block, no exceptions" framing may itself be wrong
and could be causing real deals to be permanently invisible to Kevin.

**RECOMMENDED ARCHITECTURAL OWNER**: `buybox.config.ts` (`blockedZips: string[]`).

**DECISION REQUIRED FROM TOMER**:
1. Are 32206/32209/32254 still the correct hard-blocked set today?
2. Should "blocked" mean *never insert the lead at all* (current de facto
   behavior), or *insert but flag as BLOCKED/RESTRICTED for a human to
   override* (see Step 3's exception policy)?
3. Should this list be enforced identically across every ingestion path (Redfin,
   manual, future MLS/tax-roll collectors), including manual CRM entry?

**PROPOSED OPTIONS** (not a recommendation — the choices visible in the code today):
- **A**: Keep as an absolute `HARD_BLOCK`, but enforce it consistently everywhere
  (close the bypass).
- **B**: Downgrade to `RESTRICTED` — send to a review queue instead of blocking
  insertion outright (aligns with Step 3's exception model).
- **C**: Leave as-is (Redfin-only enforcement, everything else ungated).

---

### 2. Preferred ZIPs / ZIP tiers

**RULE**: Some ZIPs are scored/treated as better than others.

**CURRENT VALUES** — three incompatible representations exist simultaneously:
- `generate-core-analysis.mjs:353` — numeric `ZIP_SCORES` map (3–8 points):
  `32205:8, 32216:8, 32210:6, 32244:6, 32211:6, 32218:6, 32219:6, 32208:4,
  32254:4, 32221:4`.
- `generate-ai-notes.mjs:68` — letter tiers in prompt text: A-tier (32205,32216)
  =15pts, B-tier (32210,32244,32211,32218,32219)=10pts, C-tier
  (32208,32254,32221)=6pts.
- `scripts/daily-redfin-import/index.mjs:292` — flat "preferred ZIP" list (no
  scoring, binary): 32210, 32244, 32221, 32222, 32218, 32208, 32205, 32216,
  32207, 32219, Clay County.

**FILES / LOCATIONS**: as above.

**CURRENT LIVE EFFECT**: A deal's ZIP score literally depends on which endpoint
analyzed it — `generate-core-analysis` and `generate-ai-notes` give 32210 a
different relative weight (6/8 vs 10/15), and the Redfin filter treats it as
simply "preferred" with no gradation at all.

**CONFLICT**: `32254` is scored as a *low-but-includable* C-tier ZIP in two
scoring tables (worth 4–6 points, not zero) while simultaneously being one of
the three permanently **hard-blocked** ZIPs in item 1. These two facts cannot
both be correct as currently coded — either 32254 should never have a nonzero
tier score (it's blocked), or it shouldn't be blocked (it has real, if modest,
scoring value elsewhere).

**BUSINESS IMPACT**: Deal Score totals — and therefore verdicts (MAKE
OFFER/NEGOTIATE/etc.) — are not comparable across endpoints for the same
property. A property scored via `generate-ai-notes` could show a materially
different total than the same property scored via `generate-core-analysis`
purely due to this table mismatch, independent of any real difference in the
deal.

**BUSINESS IMPACT**: Directly affects Deal Score consistency and, via item 1's
conflict, whether 32254 properties should ever be scored at all.

**RECOMMENDED ARCHITECTURAL OWNER**: `market.config.ts` (`ZipProfile.tier` +
whatever point value scheme is decided in item 17).

**DECISION REQUIRED FROM TOMER**:
1. What is the actual, current tier/point value for every ZIP HAT operates in?
2. Resolve the 32254 contradiction: hard-blocked, or a real (if weak) C-tier ZIP?
3. Should tier be a small closed set (A/B/C/blocked) or a continuous point value
   (3–8, or 6–15)? The two existing tables don't even agree on that shape.

**PROPOSED OPTIONS**:
- **A**: Adopt the `ZIP_SCORES` (3–8 point) shape — currently used by
  `generate-core-analysis.mjs`, the newer/more actively maintained of the two
  scoring files based on file size/recency.
- **B**: Adopt the letter-tier (A/B/C, 15/10/6 point) shape from
  `generate-ai-notes.mjs`.
- **C**: Design a new shape from scratch now that it's a single config file
  instead of three duplicated tables.

---

### 3. ZIP adjacency / comp clusters

**RULE**: Which ZIPs count as "nearby" for comp-pulling purposes.

**CURRENT VALUES**: Two independently-typed adjacency maps, structurally similar
but not verified byte-identical — e.g. `'32205': ['32205','32216','32254']` appears
in both.

**FILES / LOCATIONS**:
- `generate-comps.mjs:69` (`ZIP_CLUSTERS`)
- `generate-ai-notes.mjs:223` (`ZIP_CLUSTERS`, separately typed)

**CURRENT LIVE EFFECT**: Both files independently decide which historical CRM
deals get pulled in as comps for a given ZIP. If they drift (not currently
confirmed to have drifted, unlike other items — flagged as a duplication risk,
not a confirmed live conflict), comps shown to Kevin would differ by endpoint.

**CONFLICT**: Duplication risk, not a confirmed value conflict as of this review.

**BUSINESS IMPACT**: Comp quality/consistency for ARV justification.

**RECOMMENDED ARCHITECTURAL OWNER**: `market.config.ts`
(`ZipProfile.adjacentZips`).

**DECISION REQUIRED FROM TOMER**: Confirm the adjacency lists are correct as-is
(no active conflict to resolve, just consolidation), or take this opportunity to
revise which ZIPs should count as comparable to which.

**PROPOSED OPTIONS**:
- **A**: Consolidate as-is (no value change, pure deduplication).
- **B**: Revise the adjacency map while consolidating.

---

### 4. MAO (Maximum Allowable Offer) formula

**RULE**: The ceiling price HAT will pay, derived from ARV and renovation cost.

**CURRENT VALUES** — four distinct formulas:
- `generate-core-analysis.mjs:123,451` (**actually computed in JS**, the value
  used to lock offer numbers shown to Kevin): `0.75 × ARV − reno − 2450`
- `generate-core-analysis.mjs:26` (its own prompt text, restating a
  *simplified* version of its own formula): `0.75 × ARV − reno` (drops the −2450)
- `generate-ai-notes.mjs`, `generate-ai-notes-background.mjs`,
  `generate-report.mjs` (narrative-only, never computed in JS in these files):
  `0.75 × ARV − reno`
- `analyze-deal.mjs:129` (prompt text, never computed in JS anywhere in this
  file): `75% × ARV − Repairs − Closing costs − Minimum profit`
- `scripts/daily-redfin-import/index.mjs:298,329`:
  `0.75 × ARV − reno − 30000`

**FILES / LOCATIONS**: as above.

**CURRENT LIVE EFFECT**: The single most consequential number in the whole
system — the ceiling offer price — has three different real-dollar answers for
the identical property depending which function computed it: the $2,450 flat
deduction (core-analysis), the $30,000 deduction (Redfin importer), or no
deduction at all (every narrative-only restatement).

**CONFLICT**: Confirmed, severe. A property that just clears MAO under one
formula could fail under another (the $30,000 vs $2,450 gap alone is
material on a typical $150–300K JAX deal).

**BUSINESS IMPACT**: Directly determines whether a deal is pursued, what's
offered, and the deal's score/verdict. This is the highest-priority
reconciliation item in the entire document.

**RECOMMENDED ARCHITECTURAL OWNER**: `financial.config.ts`
(`MaoFormulaParams: { arvMultiplier, minimumProfit, includeClosingCostsInMao }`).

**DECISION REQUIRED FROM TOMER**:
1. What is the correct minimum-profit/closing-cost deduction in the MAO formula
   — $2,450 (implies "closing costs only"), $30,000 (implies "closing costs +
   real target profit margin"), or something else?
2. Is 75% of ARV still the correct multiplier, or has that drifted from an
   original 70%/75%/80% rule of thumb that should be revisited?
3. Does MAO differ by strategy (flip vs BRRRR), or is one formula meant to serve
   both, as it currently does everywhere except `analyze-deal.mjs`'s prompt
   text (which separately describes per-strategy math without ever computing a
   unified MAO)?

**PROPOSED OPTIONS**:
- **A**: $2,450 flat deduction (matches the number Kevin actually sees today on
  every Deal Score card, since `generate-core-analysis.mjs` is the primary
  analysis endpoint).
- **B**: $30,000 minimum-profit deduction (matches the number that determines
  which leads survive the *ingestion* filter in the first place).
- **C**: A new, explicitly reconciled number that isn't either of the above.

---

### 5. Minimum target flip profit

**RULE**: The minimum acceptable net profit for a flip to be worth pursuing.

**CURRENT VALUES**:
- `analyze-deal.mjs:121` (prompt text): "$30,000, or $10,000 per rehab month"
- `analyze-deal.mjs:398-399` (**actually computed**): `verdict = BUY if profit
  ≥ $40,000, CONDITIONAL if ≥ $30,000, else PASS`
- `generate-core-analysis.mjs:150,292`, `generate-ai-notes.mjs:213`,
  `generate-ai-notes-background.mjs:279` (all narrative labels, same bracket
  structure): `≥$40,000 = STRONG, ≥$25,000 = THIN, else FAILS`

**FILES / LOCATIONS**: as above.

**CURRENT LIVE EFFECT**: Two different minimum "acceptable" thresholds are live —
$25,000 (STRONG/THIN/FAILS narrative bracket) vs $30,000 (BUY/CONDITIONAL/PASS
JS threshold) — for what should be the same underlying business rule.

**CONFLICT**: Confirmed. $25,000 vs $30,000 minimum thresholds disagree by 20%.

**BUSINESS IMPACT**: Directly gates which flips are labeled viable at all.

**RECOMMENDED ARCHITECTURAL OWNER**: `scoring.config.ts` (verdict band
thresholds) — this is really a specific instance of item 17/18 (scoring
weighting and verdict vocabulary), broken out here because it's an independently
duplicated number.

**DECISION REQUIRED FROM TOMER**: Confirm the minimum acceptable net flip profit
— $25,000, $30,000, the "$10,000/rehab-month" alternative formulation, or a
number not currently in use anywhere.

**PROPOSED OPTIONS**:
- **A**: $30,000 flat (matches `analyze-deal.mjs`'s actually-computed logic).
- **B**: $25,000 flat (matches the narrative bracket most Kevin-facing text uses).
- **C**: $10,000/rehab-month (the only formulation that scales with hold period,
  currently only described in prose, never actually computed anywhere).

---

### 6. Selling cost %

**RULE**: Percentage of ARV/sale price consumed by selling costs at flip exit.

**CURRENT VALUES**:
- **7%** — `analyze-deal.mjs:352` (`arv × 0.93`), `generate-report.mjs:80`
  (`arv × 0.93`), `deal_financials.selling_cost_pct` DB default (`0.07`),
  `scripts/insert-darlington.mjs:39`, `scripts/portfolio-analysis.mjs:27`.
- **8%** — `generate-core-analysis.mjs:148,157,306` (`arv × 0.08` "carry+close"),
  `generate-ai-notes.mjs:206`, `generate-ai-notes-background.mjs:272`.

**FILES / LOCATIONS**: as above.

**CURRENT LIVE EFFECT**: The two most Kevin-facing analysis endpoints
(`generate-core-analysis.mjs`, the primary Deal Score card, and
`generate-ai-notes.mjs`) use **8%**, while the deterministic underwriting engine
(`analyze-deal.mjs`) *and the actual database default* (`deal_financials`) use
**7%**. This means the database's own stored assumption already disagrees with
what Kevin sees on the primary analysis card.

**CONFLICT**: Confirmed, live, and includes the database default — this is the
clearest example in the whole system of a config-vs-DB mismatch (see Step 5).

**BUSINESS IMPACT**: Every flip-profit number is off by 1% of ARV depending on
endpoint — on a $250K ARV deal, a $2,500 swing in displayed profit.

**RECOMMENDED ARCHITECTURAL OWNER**: `financial.config.ts` (`sellingCostPct`).

**DECISION REQUIRED FROM TOMER**: Is 7% or 8% the correct current assumption?
(Note: `deal_financials.selling_cost_pct` is a *per-deal, user-overridable*
column already — see item's DB conflict note in Step 5 — so the real question
may be "what should the *default* be," not "which is universally correct.")

**PROPOSED OPTIONS**:
- **A**: 7% (matches the database default and `analyze-deal.mjs`).
- **B**: 8% (matches the two most-used Kevin-facing narrative endpoints).

---

### 7. Purchase closing costs

**RULE**: Fixed-dollar closing costs on the purchase side (title, lender
insurance, doc stamps, intangible tax).

**CURRENT VALUES**:
- `analyze-deal.mjs` prompt text: Title closing $1,600 + lender insurance $500 +
  doc stamps $200 + intangible tax $150 (itemized, sums to $2,450 — but note
  this itemized total is *narrated*, not summed in code in this file).
- `deal_financials` table defaults: `title_closing_costs` = **$1,691**,
  `title_lender_insurance` = $500, `doc_stamps_mortgage` = $200,
  `intangible_tax` = $150.
- `generate-core-analysis.mjs`: the entire itemization collapses into a single
  flat **$2,450** constant subtracted in the MAO formula (see item 4) — not
  itemized at all in this file.

**FILES / LOCATIONS**: as above, plus `supabase/migrations/20260608000000_deal_financials.sql`.

**CURRENT LIVE EFFECT**: The lender-insurance/doc-stamps/intangible-tax figures
($500/$200/$150) are consistent everywhere they're itemized. The title closing
cost specifically is **not**: $1,600 (analyze-deal prompt) vs $1,691 (DB default)
vs folded into $2,450 (core-analysis, undifferentiated).

**CONFLICT**: Confirmed on the title-closing-cost figure specifically ($1,600 vs
$1,691); the other three line items are aligned.

**BUSINESS IMPACT**: Minor in isolation (~$91 difference) but compounds into
item 4's MAO conflict and item 8's total-cash-needed figures shown to Kevin.

**RECOMMENDED ARCHITECTURAL OWNER**: `financial.config.ts` (`ClosingCosts`).

**DECISION REQUIRED FROM TOMER**: Confirm the correct title closing cost —
$1,600, $1,691, or a different current figure (Florida title costs can be
scaled to purchase price, which neither current number appears to be doing —
worth confirming whether a flat number is even still appropriate).

**PROPOSED OPTIONS**:
- **A**: $1,600 flat.
- **B**: $1,691 flat (matches the DB default, which was presumably set from a
  real closing statement).
- **C**: Move to a scaled/percentage-based title cost if that better reflects
  reality.

---

### 8. Hard money assumptions

**RULE**: HML (hard-money lender) rate, points, and loan coverage.

**CURRENT VALUES**: Rate 12% annual interest-only, points 2% of total loan
(purchase + reno), 90% purchase / 100% reno coverage — **consistent** across
`lib/negotiation-core.mjs`, `analyze-deal.mjs`, and `deal_financials` defaults
(`interest_rate_annual: 0.12`, `points_pct: 0.02`).

**FILES / LOCATIONS**: `netlify/functions/lib/negotiation-core.mjs`,
`analyze-deal.mjs`, `supabase/migrations/20260608000000_deal_financials.sql`.

**CURRENT LIVE EFFECT**: Aligned — this is the one rule cluster in the whole
inventory that is *not* in active conflict.

**CONFLICT**: None confirmed on rate/points/coverage. (Title closing cost
specifically, part of the same lender-cost cluster, *is* in conflict — see item
7.)

**BUSINESS IMPACT**: N/A — flagged here for completeness of the config
ownership map, not because it needs reconciliation.

**RECOMMENDED ARCHITECTURAL OWNER**: `lender.config.ts` (`LenderProfile`,
id `'rob-3shacks'`-equivalent).

**DECISION REQUIRED FROM TOMER**: Simple confirmation only — is "Rob @ 3 Shacks,
12%/2%/90%+100%" still the live lender relationship and terms, or has it
changed since these numbers were written into the code?

**PROPOSED OPTIONS**: N/A — no conflicting values to choose between; only
confirm current accuracy.

---

### 9. BRRRR refinance LTV

**RULE**: Percentage of ARV the refinance loan covers.

**CURRENT VALUES**: **70% of ARV** — consistent across every file that touches
BRRRR math (`generate-core-analysis.mjs`, `lib/negotiation-core.mjs`,
`generate-comps.mjs`, `generate-ai-notes.mjs`, `generate-ai-notes-background.mjs`).

**FILES / LOCATIONS**: as above.

**CURRENT LIVE EFFECT**: Aligned — the one universal constant in the BRRRR math
across the entire codebase.

**CONFLICT**: None.

**BUSINESS IMPACT**: N/A.

**RECOMMENDED ARCHITECTURAL OWNER**: `lender.config.ts`
(`RefiProfile.ltvPct`).

**DECISION REQUIRED FROM TOMER**: Confirmation only — is 70% ARV still the
correct current DSCR/refi LTV assumption for the active lender relationship?

**PROPOSED OPTIONS**: N/A.

---

### 10. BRRRR refinance interest assumptions

**RULE**: The refinance loan's interest rate and resulting monthly-payment
lookup table.

**CURRENT VALUES**:
- `generate-core-analysis.mjs:135,296` — **6.875%**, fixed lookup table by loan
  bracket: ≤$150K→$985/mo, ≤$180K→$1,182/mo, ≤$200K→**$1,313**/mo,
  ≤$220K→$1,445/mo (comment: "FL DSCR rate").
- `lib/negotiation-core.mjs` (used by `analyze-deal.mjs`) — **6.9%**, factor
  `0.006607`.
- `generate-comps.mjs:151-152` — same bracket structure as core-analysis but
  ≤$200K→**$1,314**/mo (one dollar different, likely just independent rounding).

**FILES / LOCATIONS**: as above.

**CURRENT LIVE EFFECT**: Refi payment estimates (and therefore cash-flow/CoC
numbers) differ by rate and by rounding depending on endpoint — a small
per-dollar discrepancy individually, but a real one, and evidence the same
lookup table has been hand-copied at least twice.

**CONFLICT**: Confirmed — 6.875% vs 6.9%, plus a $1-level rounding
inconsistency even between the two 6.875%-based copies.

**BUSINESS IMPACT**: Minor per-deal (a few dollars/month), but signals the
underlying table is unmaintained/copy-drifted, which is a process risk beyond
just this number.

**RECOMMENDED ARCHITECTURAL OWNER**: `lender.config.ts` (`RefiProfile:
{ annualRatePct, amortYears }` — the monthly-payment lookup table itself should
become a *computed* function of rate/amort in `core/brrrr-engine`, not a
hand-typed bracket table, once implementation begins).

**DECISION REQUIRED FROM TOMER**: Confirm the current live DSCR refi rate —
6.875% or 6.9% (or a rate that has since moved and neither number reflects
today's market).

**PROPOSED OPTIONS**:
- **A**: 6.875% (matches the more detailed, bracket-table version).
- **B**: 6.9% (matches the simpler, formula-only version).
- **C**: Whatever the actual current rate quote is — both existing numbers may
  already be stale.

---

### 11. Hold months — flip

**RULE**: Assumed holding period (months) for flip holding-cost calculations.

**CURRENT VALUES**:
- `analyze-deal.mjs` prompt text: **3 months** default for flips.
- `lib/negotiation-core.mjs` functions: accept `holdMonths` param, but
  `analyze-deal.mjs`'s own `buildUserPrompt()` passes a **default of 6** to
  them regardless of strategy — contradicting its own prompt text's stated
  3-month flip default.
- `deal_financials.hold_months` DB default: **5** (user-overridable per deal).

**FILES / LOCATIONS**: as above.

**CURRENT LIVE EFFECT**: `analyze-deal.mjs` tells the model "flips default to 3
months" in its system prompt while its own code passes 6 months into the actual
math — the prompt's stated assumption and the code's actual behavior disagree
*within the same file*.

**CONFLICT**: Confirmed, and unusually direct (same file, prompt text vs code).

**BUSINESS IMPACT**: Holding costs (and therefore net flip profit) are
understated or overstated by up to 2 months' worth of loan payments + taxes +
insurance depending on which number is actually "true."

**RECOMMENDED ARCHITECTURAL OWNER**: `financial.config.ts`
(`HoldMonthsDefaults.flip`).

**DECISION REQUIRED FROM TOMER**: What is the realistic default flip hold
period today — 3, 5, or 6 months? (Real answer may be "it depends on rehab
scope," which `generate-core-analysis.mjs` gestures at via a comment describing
a light/medium/heavy scaling rule that — see item 11's related finding below —
is never actually implemented.)

**PROPOSED OPTIONS**:
- **A**: 3 months flat.
- **B**: 5 months flat (matches the DB default).
- **C**: 6 months flat (matches what the code actually computes with today).
- **D**: Reintroduce a condition-scaled hold period (light/medium/heavy →
  shorter/longer), which `generate-core-analysis.mjs:139` already has a
  descriptive comment for but never implements (`holdMo = 6` is hard-coded
  immediately below that comment, for all deals regardless of condition).

---

### 12. Hold months — BRRRR

**RULE**: Assumed holding period (months) before refinance in BRRRR deals.

**CURRENT VALUES**:
- `analyze-deal.mjs` prompt text: **6 months** default for BRRRR — this one
  *does* match what the code actually computes with (unlike the flip case
  above).
- `deal_financials.hold_months` DB default: **5** (shared column with flip;
  no separate BRRRR-specific default exists in the schema).

**FILES / LOCATIONS**: as above.

**CURRENT LIVE EFFECT**: `analyze-deal.mjs` is internally consistent for BRRRR
(prompt says 6, code uses 6). The DB default (5) disagrees with both, but that
column is described as user-overridable per deal, so this may be a soft
default rather than an active conflict.

**CONFLICT**: Minor — DB default (5) vs code default (6) for BRRRR specifically.

**BUSINESS IMPACT**: Same category as item 11 but the code is at least
internally consistent here, so the practical impact is smaller.

**RECOMMENDED ARCHITECTURAL OWNER**: `financial.config.ts`
(`HoldMonthsDefaults.brrrr`).

**DECISION REQUIRED FROM TOMER**: Confirm 6 months as the BRRRR default (or a
different number), and whether flip and BRRRR should continue sharing one DB
column (`deal_financials.hold_months`) or need to be split.

**PROPOSED OPTIONS**:
- **A**: 6 months (matches `analyze-deal.mjs`'s internally-consistent value).
- **B**: 5 months (matches the DB default).

---

### 13. Insurance assumptions

**RULE**: Assumed monthly homeowner's insurance cost during holding/post-refi.

**CURRENT VALUES**:
- `lib/negotiation-core.mjs` (analyze-deal path): **$100/mo** ($1,200/yr).
- `generate-core-analysis.mjs:147`: **$136/mo**, with an explicit comment
  ("actual avg from portfolio") indicating this number was deliberately updated
  from a real portfolio observation, in this one file only.
- `generate-comps.mjs:154`: **$100/mo**, but labeled "insurance+vacancy approx"
  — i.e. this file conflates two different cost types into one number, which is
  a distinct problem from the dollar-value conflict itself.

**FILES / LOCATIONS**: as above.

**CURRENT LIVE EFFECT**: `generate-core-analysis.mjs` (the primary Deal Score
endpoint) uses a real, portfolio-informed number that no other file was ever
updated to match — meaning every other cash-flow calculation in the system is
using a stale, lower insurance assumption.

**CONFLICT**: Confirmed, and unusual in that one file appears to hold more
accurate real-world data than the others, rather than all being equally
arbitrary.

**BUSINESS IMPACT**: Understates monthly holding/carry costs and overstates
BRRRR cash flow in every file except `generate-core-analysis.mjs`.

**RECOMMENDED ARCHITECTURAL OWNER**: `financial.config.ts`
(`HoldingCostDefaults.insuranceMonthly`).

**DECISION REQUIRED FROM TOMER**: Confirm $136/mo as the current real portfolio
average (propagate everywhere), or provide an updated figure if it's changed
since that comment was written. Separately: should insurance and vacancy be two
distinct config fields (they are conflated into one number in
`generate-comps.mjs` today)?

**PROPOSED OPTIONS**:
- **A**: $136/mo (matches the only file with a stated real-data source).
- **B**: $100/mo (matches the other two files).
- **C**: A newer number, if the portfolio average has moved since $136 was
  recorded.

---

### 14. Property tax assumptions

**RULE**: Assumed monthly property tax during holding/post-refi.

**CURRENT VALUES**: **$208/mo** ($2,500/yr) — consistent across every file that
references it (`lib/negotiation-core.mjs`, `generate-core-analysis.mjs`,
`generate-comps.mjs`, `generate-ai-notes.mjs`, `generate-ai-notes-background.mjs`).

**FILES / LOCATIONS**: as above.

**CURRENT LIVE EFFECT**: Aligned — no conflict.

**CONFLICT**: None.

**BUSINESS IMPACT**: N/A.

**RECOMMENDED ARCHITECTURAL OWNER**: `financial.config.ts`
(`HoldingCostDefaults.taxesMonthly`).

**DECISION REQUIRED FROM TOMER**: Confirmation only — is $2,500/yr still a
realistic flat assumption across HAT's target ZIPs, or does it vary enough by
ZIP/assessed value that it should become ZIP-aware (a `market.config.ts`
concern) rather than one flat number?

**PROPOSED OPTIONS**:
- **A**: Keep as one flat $208/mo system-wide.
- **B**: Make it ZIP/assessed-value aware.

---

### 15. ARV benchmark bands

**RULE**: Expected fully-renovated 3/2 sale price range, by ZIP.

**CURRENT VALUES**: Four independently-authored ZIP→price-band tables, no two
identical:
- `generate-core-analysis.mjs:22` — 5 ZIP groups.
- `generate-comps.mjs:20-24` — 5 ZIP groups, different bands, adds a CBS/brick
  adjustment the others don't have.
- `generate-ai-notes.mjs` (system prompt) — 6 ZIP groups, includes 32207/32204
  and Clay County, finer-grained bed/bath/sqft adjustments.
- `scripts/daily-redfin-import/index.mjs:277-283` — 5 ZIP groups, its own
  numbers, explicitly includes Clay County ZIP codes (32073/32065/32068).

**FILES / LOCATIONS**: as above.

**CURRENT LIVE EFFECT**: This is the single highest-risk duplication in the
system by financial consequence — ARV drives MAO, drives verdict, drives offer
price, and there is no external data source (comps API, MLS feed) backing any
of these four tables; they are pure LLM-prompt-embedded numbers, independently
maintained.

**CONFLICT**: Confirmed — no two of the four tables use identical bands for the
same ZIP, and their ZIP coverage isn't even the same set (Clay County and
32207/32204 appear in some but not all).

**BUSINESS IMPACT**: Highest in this entire document. ARV is the single most
consequential number AI estimates when no investor-provided ARV exists.

**RECOMMENDED ARCHITECTURAL OWNER**: `market.config.ts`
(`ZipProfile.arvBand`, `Adjustment[]`).

**DECISION REQUIRED FROM TOMER**: Provide (or approve consolidation of) the
single, current, correct ARV band per ZIP HAT operates in, plus the bed/bath/
sqft/construction-type adjustment rules to apply on top of the baseline 3/2
figure. This is the largest single reconciliation task in this document and may
warrant its own dedicated working session rather than a quick pick between the
four existing tables.

**PROPOSED OPTIONS**:
- **A**: Adopt `generate-ai-notes.mjs`'s table as the base (most ZIPs covered,
  most granular adjustments) and reconcile the other three against it.
- **B**: Adopt `generate-core-analysis.mjs`'s table as the base (drives the
  primary, most-used analysis endpoint today).
- **C**: Start fresh — none of the four tables may reflect current market
  pricing accurately enough to be worth choosing between as-is.

---

### 16. Rent benchmark bands

**RULE**: Expected monthly rent, by ZIP and bed/bath count, post-renovation.

**CURRENT VALUES**:
- `generate-core-analysis.mjs` — flat bedroom-count fallback (not ZIP-aware):
  2BR→$1,200, 3BR→$1,550, 4BR→$2,000/mo (stated in its prompt text), but its
  *actual JS fallback* (used 4 separate times inline in the same file) is a
  slightly different bracket: `bedrooms≥4?$2,000:bedrooms===3?$1,600:$1,300`.
- `generate-comps.mjs` — ZIP-segmented rental benchmark table, different bands
  entirely (e.g. 32208/32219 3/2: $1,350–$1,550).
- `generate-ai-notes.mjs` — its own JAX rent estimate table, yet another set of
  bands (e.g. 3/2 <1,400sqft: $1,400–$1,700).

**FILES / LOCATIONS**: as above.

**CURRENT LIVE EFFECT**: Two conflicts stacked: (1) `generate-core-analysis.mjs`
disagrees with *itself* — its prompt text says one set of numbers, its actual
JS fallback computes another; (2) all three files disagree with each other on
ZIP-segmented rent, and only two of the three are even ZIP-aware.

**CONFLICT**: Confirmed, on two independent axes (internal self-conflict, and
cross-file conflict).

**BUSINESS IMPACT**: Feeds the 1%-rule check, cash-flow estimates, and CoC
return for every BRRRR deal without an investor-provided rent figure.

**RECOMMENDED ARCHITECTURAL OWNER**: `market.config.ts`
(`ZipProfile.rentBand`).

**DECISION REQUIRED FROM TOMER**: Provide (or approve consolidation of) the
correct current rent band per ZIP + bed/bath profile. Also decide: should the
"no ZIP data available" fallback be a flat bedroom-count number at all, or
should every ZIP HAT operates in always have a rent band defined (removing the
need for an unaware fallback)?

**PROPOSED OPTIONS**:
- **A**: Adopt `generate-comps.mjs`'s ZIP-segmented table as the base.
- **B**: Adopt `generate-ai-notes.mjs`'s ZIP-segmented table as the base.
- **C**: Keep a flat bedroom-count fallback for ZIPs without a defined band, but
  fix `generate-core-analysis.mjs`'s internal self-conflict as part of
  reconciliation regardless of which table wins.

---

### 17. Deal Score weighting

**RULE**: How the 100-point Deal Score rubric allocates points across
categories.

**CURRENT VALUES**: `generate-core-analysis.mjs`'s system prompt defines: Deal
Return /30, Price Gap /20, Seller Signals /15, Market & Exit /15, Cash Flow /10,
Data Quality /10 (sums to 100). This rubric exists **only** in this one file —
no other endpoint computes a comparable weighted score (see item 18 for the
separate, incompatible verdict system in `analyze-deal.mjs`).

**FILES / LOCATIONS**: `generate-core-analysis.mjs` lines 49–58 (prompt text)
and 340–403 (the JS pre-computation feeding it).

**CURRENT LIVE EFFECT**: This is the only real "Deal Score" in the system —
`analyze-deal.mjs`'s numeric `score` field (0–100, item 18) is a *different*,
independently-computed number from a *different* formula, not another instance
of this same rubric.

**CONFLICT**: Not an internal duplication conflict (only one rubric exists) —
the conflict is architectural: two different "score" concepts exist in the
system under overlapping names, addressed together with item 18.

**BUSINESS IMPACT**: This rubric, plus the verdict bands it feeds (item 18), is
the primary lens Kevin/Tomer use to triage deals.

**RECOMMENDED ARCHITECTURAL OWNER**: `scoring.config.ts`
(`RubricCategory[]`).

**DECISION REQUIRED FROM TOMER**:
1. Are these six categories and their point allocations (30/20/15/15/10/10)
   still the right weighting, or does anything need rebalancing?
2. Should `analyze-deal.mjs`'s separate numeric score be retired in favor of
   this rubric, kept as a genuinely distinct second metric, or reconciled into
   one?

**PROPOSED OPTIONS**:
- **A**: Keep the current 30/20/15/15/10/10 weighting as canonical, formalize
  it in `scoring.config.ts` unchanged.
- **B**: Rebalance categories as part of this reconciliation.
- **C**: Merge with `analyze-deal.mjs`'s separate scoring formula into one
  unified score (larger change, addressed jointly with item 18).

---

### 18. Verdict vocabulary

**RULE**: The set of allowed "verdict" labels a deal can receive.

**CURRENT VALUES** — two incompatible vocabularies in production simultaneously:
- `generate-core-analysis.mjs` — 5-band: **MAKE OFFER / NEGOTIATE / LONG SHOT /
  WATCH / DEAD LEAD**, keyed off the Deal Score rubric total + whether the deal
  math works at MAO.
- `analyze-deal.mjs` — 3-band: **BUY / CONDITIONAL / PASS**, keyed off flip
  profit or BRRRR CoC/cash-flow thresholds directly (item 5's numbers).

**FILES / LOCATIONS**: as above.

**CURRENT LIVE EFFECT**: The exact same property can be labeled "MAKE OFFER" by
one endpoint and "CONDITIONAL" by another, with no defined mapping between the
two vocabularies — there is no shared understanding in the codebase of whether
"MAKE OFFER" and "BUY" mean the same thing.

**CONFLICT**: Confirmed, severe, architectural (not just a numeric drift like
most other items — two entirely separate concepts of "verdict" coexist).

**BUSINESS IMPACT**: Directly affects what status/priority Kevin sees and acts
on; ambiguity here is a workflow risk, not just a cosmetic inconsistency.

**RECOMMENDED ARCHITECTURAL OWNER**: `scoring.config.ts`
(`VerdictBand[]` — "ordered, single source of truth for verdict vocabulary").

**DECISION REQUIRED FROM TOMER**: Which vocabulary should become canonical —
the 5-band nuanced version, the 3-band simpler version, or a new vocabulary
that supersedes both? This decision is a prerequisite for reconciling item 5's
profit thresholds and item 17's rubric, since verdict bands are downstream of
both.

**PROPOSED OPTIONS**:
- **A**: 5-band (MAKE OFFER/NEGOTIATE/LONG SHOT/WATCH/DEAD LEAD) — more
  actionable granularity, matches the primary Deal Score endpoint.
- **B**: 3-band (BUY/CONDITIONAL/PASS) — simpler, matches the standalone
  underwriting tool.
- **C**: A new vocabulary designed fresh now that this is a single config
  decision instead of two competing hard-coded systems.

---

### 19. Seller motivation scoring

**RULE**: How free-text/listing signals translate into a "how motivated is this
seller" score.

**CURRENT VALUES** — two independently-weighted keyword systems:
- `generate-core-analysis.mjs:184-207` (`highMotivationKw`) — 21 keywords, each
  with a point value 1–3, capped at 10, feeds the Deal Score "Seller Signals"
  sub-score.
- `scripts/daily-redfin-import/index.mjs:260-269` (KEEP keywords) — ~35
  keywords, **binary** include/exclude only, no point weighting, feeds the
  ingestion filter decision (not a score at all).

**FILES / LOCATIONS**: as above.

**CURRENT LIVE EFFECT**: These two lists serve genuinely different purposes
(one scores an already-ingested lead; one decides whether to ingest it at all)
so this may be less of a "conflict" than items above and more a case of two
lists that *could* share a common weighted vocabulary but currently don't.

**CONFLICT**: Partial — not a value conflict on shared numbers (they don't
compute the same thing), but a duplication risk: many of the same underlying
concepts (estate, probate, as-is, motivated, etc.) are independently
enumerated in both places, and a term added/removed from one list has no
mechanism to propagate to the other.

**BUSINESS IMPACT**: Inconsistent distress-signal vocabulary between "should
this even become a lead" and "how motivated does this seller look" — a keyword
could be considered ingestion-worthy but not scored as a motivation signal, or
vice versa, purely from independent list maintenance rather than intentional
design.

**RECOMMENDED ARCHITECTURAL OWNER**: `buybox.config.ts`
(`distressKeywords: WeightedKeyword[]`) as the single weighted list — used both
by the ingestion filter (thresholded) and the motivation scorer (summed),
rather than two separate lists for what is conceptually one taxonomy of
distress language.

**DECISION REQUIRED FROM TOMER**: Should ingestion-filtering and
motivation-scoring share one canonical weighted keyword list (this document's
recommendation, since it removes duplication) or remain intentionally separate
because they really do serve different purposes? If shared, what should the
combined weight table look like — closer to the 21-keyword weighted list, the
35-keyword binary list, or a new merged list?

**PROPOSED OPTIONS**:
- **A**: Merge into one weighted list, used for both purposes with different
  thresholds per purpose.
- **B**: Keep two separate lists by design, but formalize both in
  `buybox.config.ts` so they're at least both documented/versioned together.

---

### 20. Negotiation anchor parameters

**RULE**: The room-factor / credibility-floor model that computes starting
offer, target price, and max walk-away.

**CURRENT VALUES**: Exists in exactly one production file,
`generate-core-analysis.mjs`, but is **implemented twice inside that same
file** — once in `buildPrompt()` (lines 214–273) and again, independently, in
the response-handler path (lines 452–482) — rather than one function called
twice. Key parameters as currently coded: base room factor 50% of gap, minus 2%
per motivation point (floor 20%); credibility floor 80% of ask, relaxed 0.8%
per motivation point (floor 72%, absolute floor 65% of ask); anchor never
exceeds 99.5% of MAO.

**FILES / LOCATIONS**: `generate-core-analysis.mjs:214-273` and `:452-482`.

**CURRENT LIVE EFFECT**: Not a cross-file value conflict (no other file
implements this model at all) — the risk here is purely maintenance: two
hand-synced copies of the same algorithm inside one file, which **have already
been kept in sync so far** (both copies currently produce the same math) but
have no structural guarantee of staying that way on the next edit.

**CONFLICT**: Structural/latent, not a currently-live numeric disagreement.

**BUSINESS IMPACT**: This directly sets the dollar figure told to Kevin as the
opening offer on every deal — low risk today, high risk the next time someone
edits one copy and forgets the other.

**RECOMMENDED ARCHITECTURAL OWNER**: `negotiation.config.ts`
(`RoomFactorModel`, `CredibilityFloorModel`).

**DECISION REQUIRED FROM TOMER**: Confirm the current parameters (50%/2%/20%
floor; 80%/0.8%/72%/65% floor) are the intended live negotiation posture, or
provide updated values. This is largely a confirmation item since only one
"real" implementation exists conceptually — the main open question is just
values, not which of two competing tables is correct.

**PROPOSED OPTIONS**:
- **A**: Confirm current parameters as-is.
- **B**: Adjust any of the four tunable constants (base room factor,
  motivation-reduction rate, base credibility floor, motivation-relax rate).

---

### 21. Property-type exclusions

**RULE**: Which property types are never pursued regardless of other signals.

**CURRENT VALUES**: `scripts/daily-redfin-import/index.mjs:239-245` (Step 1,
"HARD PROPERTY TYPE SKIPS") — condo, townhome/townhouse, apartment, any
HOA/gated community, new construction, commercial, land-only, multi-family
(*unless* clearly a duplex investment play — an explicit carve-out), luxury,
waterfront estate, golf community.

**FILES / LOCATIONS**: `scripts/daily-redfin-import/index.mjs` only — this
rule exists in exactly one place, unlike most items above.

**CURRENT LIVE EFFECT**: Enforced only by the AI filter step of the Redfin
importer (a prompt instruction, not deterministic code) — not enforced as a
hard, testable rule anywhere, and not enforced at all on any other insertion
path.

**CONFLICT**: No cross-file value conflict (single source), but a
process/architecture conflict: a "hard skip" list is currently entirely
AI-interpreted rather than deterministically checked, meaning model drift could
silently start admitting or rejecting property types without anyone noticing
(no test suite validates this list's enforcement).

**BUSINESS IMPACT**: Determines what enters the pipeline at all; the
"multi-family unless clearly a duplex" carve-out in particular is a judgment
call currently left entirely to the LLM's interpretation.

**RECOMMENDED ARCHITECTURAL OWNER**: `buybox.config.ts`
(`propertyTypeSkips: string[]`), enforced by `core/buybox-engine` deterministically
rather than left to prompt interpretation, once implementation begins.

**DECISION REQUIRED FROM TOMER**: Confirm the current exclusion list is
complete and correct, and specifically clarify the duplex carve-out: what
distinguishes "clearly a duplex investment play" from other multi-family that
should still be skipped? This needs a definition precise enough to become a
deterministic rule rather than remaining implicit AI judgment.

**PROPOSED OPTIONS**:
- **A**: Keep the list as-is, formalize it in `buybox.config.ts`.
- **B**: Revise the list, and/or add a precise, deterministic duplex-qualifying
  rule (e.g. "2 units, both residential, combined value supports the same
  ARV/reno math as a single-family flip").

---

### 22. Minimum beds/baths

**RULE**: Whether a minimum bedroom/bathroom count is required for a property to
qualify.

**CURRENT VALUES**: **No such rule exists anywhere in the current production
code.** This item was included in the requested inventory scope but a
targeted search of `scripts/daily-redfin-import/index.mjs` (the ingestion
filter) and every `generate-*`/`analyze-deal` function found no minimum
bed/bath threshold of any kind — only ARV adjustments *for* smaller/larger
bed/bath counts (item 15/16), never an exclusion based on them.

**FILES / LOCATIONS**: None found.

**CURRENT LIVE EFFECT**: A studio, 1BR, or 1BA property is not currently
excluded by any rule — it would simply receive the appropriate ARV/rent
downward adjustment (e.g. "1BA only −$20K") and proceed through scoring
normally.

**CONFLICT**: N/A — nothing to reconcile; this is a genuinely open design
question, not a duplication.

**BUSINESS IMPACT**: If HAT does not actually want to pursue very small
properties, this is a real gap, not a duplication bug — flagging explicitly per
instruction not to invent a rule that doesn't exist in code today.

**RECOMMENDED ARCHITECTURAL OWNER**: `buybox.config.ts`, as a new field (e.g.
`minBedrooms`/`minBathrooms`) if Tomer wants one introduced.

**DECISION REQUIRED FROM TOMER**: Should a minimum beds/baths threshold be
introduced at all? If so, what should it be, and should it be a hard exclusion
or a scoring penalty (see Step 2's classification)?

**PROPOSED OPTIONS**:
- **A**: No minimum — leave as-is (current behavior).
- **B**: Introduce a hard minimum (e.g. 2BR/1BA).
- **C**: Introduce a soft scoring penalty rather than a hard exclusion.

---

### 23. Financial sense-check thresholds

**RULE**: The minimum gross spread (asking price vs. estimated ARV) required
for a lead to survive ingestion on financial grounds alone.

**CURRENT VALUES**: `scripts/daily-redfin-import/index.mjs:290-294` — only skip
on financial grounds if **both** (a) asking price > 85% of estimated ARV
(< 15% gross spread) **and** (b) the ZIP is not on the preferred-ZIP list
(item 2). For preferred ZIPs, this check never applies — "never skip on
financial grounds... the investor will review and decide."

**FILES / LOCATIONS**: `scripts/daily-redfin-import/index.mjs` only.

**CURRENT LIVE EFFECT**: This is the ingestion-side survival gate that decides
whether a thin-spread deal ever reaches Kevin at all — and it's coupled to
item 2's preferred-ZIP list, so resolving item 2 (which ZIPs are "preferred")
directly changes how this threshold behaves.

**CONFLICT**: No duplication (single source), but a direct dependency on item
2's unresolved preferred-ZIP conflict — this rule cannot be finalized
independently of that decision.

**BUSINESS IMPACT**: Determines whether marginal-spread deals in good ZIPs ever
get a human look, or are auto-filtered before Kevin sees them.

**RECOMMENDED ARCHITECTURAL OWNER**: `buybox.config.ts`
(`FinancialSenseCheckRule: { maxSpreadPct, requiresPreferredZip }`).

**DECISION REQUIRED FROM TOMER**: Is 15% gross spread still the correct
threshold? Should the "preferred ZIP = never skip" carve-out remain absolute,
or should even preferred-ZIP deals have *some* floor (e.g. don't insert a deal
with negative or near-zero spread even in a great ZIP)?

**PROPOSED OPTIONS**:
- **A**: Keep 15%/preferred-ZIP-exempt as-is.
- **B**: Adjust the 15% threshold.
- **C**: Add a floor that applies even to preferred ZIPs.

---

## STEP 2 — HARD RULE vs SOFT RULE CLASSIFICATION

Per instruction, **no rule is automatically assumed to be a permanent exclusion**.
Classification below reflects what the rule *currently does* in code, with a
separate column for what this document suggests reconsidering — not deciding.

| # | Rule | Current de facto classification | Suggested reconsideration |
|---|---|---|---|
| 1 | Blocked ZIPs | `HARD_BLOCK` (Redfin path only; unenforced elsewhere) | Consider `RESTRICTED` — send to review instead of silent exclusion (see Step 3); the 32254 tier-vs-block contradiction in item 2 suggests this may be over-broad today |
| 2 | Preferred ZIPs / tiers | `SCORING_INPUT` | No change in kind — but values need reconciliation |
| 3 | ZIP adjacency | `ASSUMPTION` (data-shaping, not a gate) | No change in kind |
| 4 | MAO formula | `HARD_REQUIREMENT` (deal must clear MAO to proceed) | No change in kind — this should stay a hard requirement; the conflict is the *value*, not the *category* |
| 5 | Min target flip profit | `HARD_REQUIREMENT` (verdict gate) | No change in kind |
| 6 | Selling cost % | `ASSUMPTION` | No change in kind |
| 7 | Purchase closing costs | `ASSUMPTION` | No change in kind |
| 8 | HML assumptions | `ASSUMPTION` / `OVERRIDABLE_DEFAULT` (per-deal columns exist) | No change in kind |
| 9 | BRRRR refi LTV | `ASSUMPTION` | No change in kind |
| 10 | BRRRR refi rate | `ASSUMPTION` | No change in kind |
| 11 | Hold months — flip | `OVERRIDABLE_DEFAULT` (DB column exists) | No change in kind |
| 12 | Hold months — BRRRR | `OVERRIDABLE_DEFAULT` | No change in kind |
| 13 | Insurance assumption | `ASSUMPTION` | No change in kind |
| 14 | Property tax assumption | `ASSUMPTION` | No change in kind |
| 15 | ARV benchmark bands | `SCORING_INPUT` (feeds MAO, which is `HARD_REQUIREMENT`) | No change in kind, but given downstream weight, data quality here matters more than its own classification suggests |
| 16 | Rent benchmark bands | `SCORING_INPUT` | No change in kind |
| 17 | Deal Score weighting | `SCORING_INPUT` | No change in kind |
| 18 | Verdict vocabulary | `HARD_REQUIREMENT` in the sense that it gates workflow status | Needs to be singular regardless of category |
| 19 | Seller motivation scoring | `SCORING_INPUT` (motivation) / `SOFT_PREFERENCE` (ingestion keyword match) | Currently split across two categories for what may be one concept — see item 19's decision |
| 20 | Negotiation anchor params | `ASSUMPTION` feeding a `HARD_REQUIREMENT`-adjacent output (never exceeds MAO) | No change in kind |
| 21 | Property-type exclusions | `HARD_BLOCK` (by AI interpretation, not deterministic code) | Recommend converting to a deterministic `HARD_BLOCK` once in `buybox-engine` — currently soft in *enforcement mechanism* even though intended as hard in *policy* |
| 22 | Minimum beds/baths | **Does not exist** | If introduced: recommend `SOFT_PREFERENCE`/`SCORING_INPUT` over `HARD_BLOCK`, consistent with this document's general caution against silent hard exclusions |
| 23 | Financial sense-check | `HARD_BLOCK` for non-preferred ZIPs below threshold; `SOFT_PREFERENCE`-exempt for preferred ZIPs | Reasonable as designed — already avoids being a blanket hard block by carving out preferred ZIPs |

**General finding**: The codebase already leans away from blanket hard blocks in
several places (the preferred-ZIP carve-out in item 23, the duplex carve-out in
item 21) — the exception is item 1 (blocked ZIPs), which is described in its own
prompt text as absolute ("no exceptions, no matter how good the deal looks") while
simultaneously being the least consistently *enforced* rule in the system (item
1's bypass finding). This document recommends Tomer specifically revisit whether
"no exceptions" is still the intended policy, independent of the enforcement gap.

---

## STEP 3 — EXCEPTION POLICY DESIGN (CONTRACT ONLY — NOT IMPLEMENTED)

### Problem with today's implicit model

Today, "bad ZIP" effectively means "silently never becomes a lead" (Redfin path)
or "no check at all" (every other path) — there is no middle ground, and no
mechanism for an extraordinary deal to override a restriction and reach a human.

### Proposed outcome model

```ts
type BuyBoxOutcome = 'ELIGIBLE' | 'REVIEW' | 'RESTRICTED' | 'BLOCKED'

interface BuyBoxEvaluation {
  outcome: BuyBoxOutcome
  reasons: string[]
  triggeredRules: string[]           // which buybox.config.ts rules fired
  overrideEligible: boolean          // can an exceptional-deal override apply?
  overrideSignals?: ExceptionSignals // populated only when overrideEligible
}
```

- **ELIGIBLE** — passes every rule cleanly; proceeds through normal scoring.
- **REVIEW** — fails a soft/scoring-type rule (e.g. marginal financial
  sense-check) but is not disqualified; enters Kevin's queue with a flag
  explaining why, instead of being silently scored as if nothing were wrong.
- **RESTRICTED** — fails a rule that is *normally* disqualifying (e.g. a
  blocked ZIP, an excluded property type) but qualifies for override
  consideration because it triggers exceptional-deal signals (below). Sent to
  human review with an explicit "this would normally be excluded, here's why
  it's flagged for a second look" framing — never silently discarded.
- **BLOCKED** — fails a rule with no override path (reserved for cases Tomer
  explicitly designates as absolute — the exception policy does not assume any
  current rule belongs in this category; that's Tomer's call per Step 1/2).

### Exceptional-deal override signals (design only)

```ts
interface ExceptionSignals {
  distressScore?: number        // from future distress.config.ts (Step 7 of the
                                  // architecture doc) — very high distress can
                                  // justify a second look even in a restricted ZIP
  spreadPctAboveThreshold?: number  // exceptionally low price vs ARV
  equityPctAboveThreshold?: number  // unusually high seller equity position
  motivationScoreAboveThreshold?: number  // strong seller-motivation signals
                                            // (item 19)
  economicsMultipleOfThreshold?: number   // deal math materially exceeds normal
                                            // HAT minimums (item 5/17), not just
                                            // barely clearing them
}
```

**Design intent**: a property in a `RESTRICTED`-eligible category (e.g. a
blocked ZIP) is only promoted to `REVIEW` if its `ExceptionSignals` clear a
*separately configured* override threshold (in `buybox.config.ts`, alongside
the base rule) — never automatically, and never silently. The override always
produces a **REVIEW**-outcome lead with an explicit explanation, never a
straight-through `ELIGIBLE`. A human always makes the final call on an
override case; this policy only prevents such a case from being invisible.

**Explicitly not decided here**: which current rules (if any) should have an
override path at all, and what the numeric override thresholds should be —
these are Tomer decisions, deferred alongside the rest of this document's open
items.

---

## STEP 4 — CONFIG OWNERSHIP MAP

| Decision item | Canonical config owner |
|---|---|
| 1. Blocked ZIPs | `buybox.config.ts` |
| 2. Preferred ZIPs / tiers | `market.config.ts` |
| 3. ZIP adjacency | `market.config.ts` |
| 4. MAO formula | `financial.config.ts` |
| 5. Min target flip profit | `scoring.config.ts` (verdict band threshold) |
| 6. Selling cost % | `financial.config.ts` |
| 7. Purchase closing costs | `financial.config.ts` |
| 8. HML assumptions | `lender.config.ts` |
| 9. BRRRR refi LTV | `lender.config.ts` |
| 10. BRRRR refi rate | `lender.config.ts` |
| 11. Hold months — flip | `financial.config.ts` |
| 12. Hold months — BRRRR | `financial.config.ts` |
| 13. Insurance assumption | `financial.config.ts` |
| 14. Property tax assumption | `financial.config.ts` (or `market.config.ts` if made ZIP-aware per item 14's option B) |
| 15. ARV benchmark bands | `market.config.ts` |
| 16. Rent benchmark bands | `market.config.ts` |
| 17. Deal Score weighting | `scoring.config.ts` |
| 18. Verdict vocabulary | `scoring.config.ts` |
| 19. Seller motivation scoring | `buybox.config.ts` (if merged, per item 19 option A) or split across `buybox.config.ts` + `negotiation.config.ts` (if kept separate, option B) |
| 20. Negotiation anchor parameters | `negotiation.config.ts` |
| 21. Property-type exclusions | `buybox.config.ts` |
| 22. Minimum beds/baths (if introduced) | `buybox.config.ts` |
| 23. Financial sense-check thresholds | `buybox.config.ts` |

**Values that do NOT fit the existing config architecture — flagged:**

- **Renovation condition-tier cost brackets** (referenced narratively in items
  not explicitly numbered above, e.g. "light cosmetic $20-35K") are **not** one
  of the 23 items but are closely related to items 4/5/15 — these belong in
  `rehab.config.ts` (added in Sprint 1.1) and are called out here only to
  confirm no gap exists post-Sprint-1.1.
- **Item 22 (minimum beds/baths)**, if introduced, fits cleanly into
  `buybox.config.ts` as a new field — no architectural gap, just a config
  addition pending Tomer's decision on whether to introduce it at all.
- **No item in this inventory requires a new config file beyond the nine
  already scaffolded** (`market`, `financial`, `buybox`, `rehab`, `lender`,
  `negotiation`, `scoring`, `ai`, `distress`) — the Sprint 1/1.1 config
  architecture appears to fully cover the business-rule surface found in
  production code.
- **`ai.config.ts` and `distress.config.ts`** are not implicated by any of the
  23 items above — `ai.config.ts` governs model/prompt routing (an
  infrastructure concern, not a business rule) and `distress.config.ts` is
  explicitly future-scoped (Distressed Lead Engine, not yet built). Both remain
  correctly unpopulated and out of scope for this reconciliation pass.

---

## STEP 5 — DATABASE DEFAULT CONFLICTS

Comparing `deal_financials` table defaults (from
`supabase/migrations/20260608000000_deal_financials.sql` and related migrations)
against the config candidates surfaced in Step 1:

| DB column | DB default | Config candidate(s) in conflict | Notes |
|---|---|---|---|
| `selling_cost_pct` | `0.07` (7%) | `generate-core-analysis.mjs`/`generate-ai-notes.mjs` use 8% (item 6) | **Confirmed conflict** — the DB default itself disagrees with the primary Kevin-facing analysis endpoint, not just two prompt files disagreeing with each other |
| `title_closing_costs` | `1691` | `analyze-deal.mjs` prompt text says `1600`; `generate-core-analysis.mjs` folds it into an undifferentiated `2450` (item 7) | Confirmed conflict on the specific dollar figure |
| `interest_rate_annual` | `0.12` (12%) | Matches `lib/negotiation-core.mjs`/`analyze-deal.mjs` (item 8) | **Aligned**, no conflict |
| `points_pct` | `0.02` (2%) | Matches everywhere (item 8) | **Aligned**, no conflict |
| `title_lender_insurance` | `500` | Matches everywhere (item 7) | **Aligned**, no conflict |
| `doc_stamps_mortgage` | `200` | Matches everywhere (item 7) | **Aligned**, no conflict |
| `intangible_tax` | `150` | Matches everywhere (item 7) | **Aligned**, no conflict |
| `hold_months` | `5` | `analyze-deal.mjs` uses 3 (flip)/6 (BRRRR) depending on strategy (items 11/12) | Confirmed conflict, though this DB column is explicitly user-overridable per deal, softening the practical impact |
| *(no column)* | — | BRRRR refi LTV (70%), refi rate (6.875%/6.9%) — item 9/10 | **Gap**: `deal_financials` has no refi-specific columns at all; these live only in code/prompt text today, not in the database schema in any form |
| *(no column)* | — | Insurance/tax monthly holding defaults (items 13/14) | `deal_financials` has `insurance_monthly`/`taxes_monthly` columns but they default to `0`/unset, **not** to $100–136 or $208 — meaning the DB schema's own defaults don't even attempt to match the code's hard-coded fallback assumptions; every deal that doesn't explicitly set these columns is implicitly relying on the code-level fallback instead |

**Summary**: 5 of 9 comparable fields are aligned between DB defaults and code
(the HML/closing-cost cluster, item 8/part of item 7). 2 fields have a confirmed
value conflict (`selling_cost_pct`, `hold_months`). 1 field has a specific-dollar
conflict nested inside a larger aligned cluster (`title_closing_costs`). 2
categories (BRRRR refi terms, insurance/tax monthly defaults) have **no DB
representation at all** for the assumptions currently hard-coded in application
logic — these aren't "conflicts" so much as gaps that will need new
migrations (not written in this sprint) once `lender.config.ts` and
`financial.config.ts` are populated and a decision is made about whether config
values should also be mirrored into DB defaults or live only in `/config`.

**Not modified**: no migration file was written or altered to produce this
analysis, per instruction.

---

## STEP 6 — REGRESSION TEST PLAN (DESIGN ONLY)

### Principle

No production function may be migrated to `/core` + `/config` until it is
proven, for a representative set of real inputs, that:

```
OLD INPUT → OLD (current, live) OUTPUT
    must equal
SAME INPUT → NEW (core engine + config) OUTPUT
```

for every reconciled rule, **until Tomer explicitly approves a business-rule
change** — at which point the *new* output becomes the expected baseline for
that rule going forward, and the discrepancy is documented as an intentional,
approved change rather than a bug.

### What each engine's regression fixtures need to prove

| Engine | Must reproduce (old formula) exactly, per current live code | Reconciliation dependency |
|---|---|---|
| `financial-engine` (`computeMao`) | Whichever of the 3 MAO formulas (item 4) is chosen as canonical — but fixtures should capture **all three** old outputs so the regression suite can show "here's what changes, and by how much" when the canonical value is picked, not just silently adopt one | Item 4 decision |
| `flip-engine` | Both 7% and 8% selling-cost outputs (item 6), same rationale | Item 6 decision |
| `brrrr-engine` | Both 6.875% and 6.9% refi-rate outputs (item 10) | Item 10 decision |
| `negotiation-engine` | The room-factor/credibility-floor anchor math (item 20) — since only one real implementation exists (duplicated within one file), this is the most straightforward fixture set: prove the new engine matches `generate-core-analysis.mjs`'s current output bit-for-bit before touching anything | None — lowest-risk migration candidate |
| `scoring-engine` | Both the 5-band and 3-band verdict outputs (item 18) for the same inputs, so the regression suite documents the current divergence explicitly rather than picking a winner silently | Item 18 decision |
| `rehab-engine` | Current condition-tier narrative brackets are AI-generated today, not deterministically computed anywhere — there is **no old deterministic output to regress against** for this engine specifically; its "regression test" is necessarily a net-new behavior specification, not a reproduction, and should be flagged to Tomer as a different kind of validation (does the new bracket feel right, not does it match old code) | N/A — different validation approach needed |
| `buybox-engine` | Blocked-ZIP/property-type/financial-sense-check pass-fail outcomes (items 1, 21, 23) against the Redfin importer's current behavior | Items 1, 21, 23 decisions |

### Historical closed deals as regression fixtures

Per prior work in this project (see the CRM's own reconciled deal records), the
following closed/reconciled deals are known to have real, HUD-verified
financials on file and are strong regression-fixture candidates precisely
because their *actual* outcome (not just an AI estimate) is known:

- A Jacksonville flip with confirmed HUD cash-to-close reconciliation.
- A second Jacksonville flip with confirmed HUD cash-to-close reconciliation.
- Two additional properties on the same street with confirmed/near-confirmed
  HUD figures.
- A BRRRR deal with a confirmed loan structure, cash-at-close, and post-refi
  cash flow.

(Deliberately not naming addresses/exact figures in this document per the
instruction to avoid exposing sensitive data unnecessarily — the actual fixture
values should be pulled directly from `deal_financials`/HUD records at
implementation time, not transcribed into architecture documentation.)

**Recommended fixture selection criteria** for whichever specific deals are
used: prefer deals with `actual_sale_price` and/or `deal_renovation_items.actual_cost`
populated (closed, not just analyzed) so the regression suite can eventually
extend beyond "does new code match old code" into "does new code match
reality" (this second question is Step 6's forward-looking payoff, tying
directly into the AI History/Evaluation capability described in
`docs/architecture/HAT_AI_OS.md`).

### Test plan structure (design only)

```
For each engine:
  For each reconciled rule the engine depends on:
    Fixture = { input: <realistic deal data>, oldOutput: <computed from current
                live formula>, expectedNewOutput: <same as oldOutput, UNLESS
                Tomer has explicitly approved a value change for this rule,
                in which case expectedNewOutput reflects the approved new value
                and the fixture is annotated with which decision approved it> }
  Assert: engine(fixture.input, canonicalConfig) === fixture.expectedNewOutput
```

No fixtures, test files, or test runner configuration were created in this
sprint — this section is the design for a future implementation sprint.

---

## STEP 7 — CONFIG MIGRATION PLAN (SAFEST ORDER)

The instruction's suggested order (ZIP → lender → selling/holding costs → MAO →
negotiation → scoring → market/ARV/rent) is close to correct but has one
dependency-ordering issue worth flagging: **MAO depends on selling costs being
resolved first in one sense but not the other** — the MAO formula itself
(item 4) doesn't consume selling cost %, but the *verdict* that sits downstream
of MAO (item 18) does need flip-profit math, which does consume selling cost %.
Recommended order, adjusted for actual dependency chains found in Step 1:

1. **ZIP configuration** (items 1, 2, 3) — no dependencies on any other item;
   also the most self-contained (single config file, `market.config.ts` +
   `buybox.config.ts`), and unblocks the exception-policy design (Step 3) from
   becoming concrete. Lowest risk, do first.
2. **Lender assumptions** (items 8, 9, 10) — no dependencies on other items;
   item 8 specifically has zero live conflicts to resolve (pure confirmation),
   making it close to a "free" migration once `lender.config.ts` is populated.
3. **Purchase closing costs + selling/holding costs** (items 6, 7, 13, 14) —
   depends only on lender assumptions being settled (shares the same
   `financial.config.ts`/`lender.config.ts` boundary). Resolve *before* MAO
   since MAO's downstream verdict math needs these numbers anyway.
4. **Hold months** (items 11, 12) — depends on nothing above but is grouped
   here because it shares `financial.config.ts` and directly affects the same
   holding-cost calculations as step 3; bundling these reduces the number of
   separate `financial.config.ts` migrations from two to one.
5. **MAO formula + minimum target flip profit** (items 4, 5) — depends on
   items 6/7/13/14 being resolved (MAO's downstream flip/BRRRR math consumes
   them) — this is the highest-business-impact item in the whole document, so
   deliberately sequenced *after* its lower-risk dependencies are proven safe
   in production, not first.
6. **Rehab config** (not one of the 23 numbered items, but a Sprint 1.1
   addition with no populated values yet) — depends on nothing above
   structurally, but is more useful to migrate once MAO's "max reno budget"
   solver (item 4-adjacent) is stable, since they're consumed together in
   `generate-core-analysis.mjs`'s reno-unknown code path.
7. **Negotiation anchor parameters** (item 20) — depends on MAO being finalized
   (the anchor model's ceiling is MAO itself) — must come after step 5.
8. **ARV / rent benchmark bands** (items 15, 16) — technically has no hard
   dependency on the items above, but is deliberately sequenced late because
   it is the **largest reconciliation effort** in the document (four
   independent tables, most ZIPs, most adjustments) and benefits from the team
   having already been through 7 smaller, lower-controversy migrations first —
   both to build process confidence and because ARV/rent errors are the
   highest-consequence category (per item 15's business impact) and deserve
   the most scrutiny, not the least.
9. **Deal Score weighting + verdict vocabulary** (items 17, 18) — deliberately
   last, because both depend on nearly everything above (Deal Return sub-score
   needs flip/BRRRR math from steps 3-5; Market & Exit sub-score needs ZIP
   tiers from step 1 and ARV confidence from step 8) and represents the
   highest-visibility, most workflow-disruptive change (verdict vocabulary
   directly changes what Kevin sees as a deal's status) — should only ship
   once every input it depends on is already stable in production.
10. **Seller motivation scoring + financial sense-check + property-type
    exclusions + minimum beds/baths** (items 19, 21, 22, 23) — these are
    independent of the financial-math chain above and could technically be
    migrated in parallel with steps 3-9, but are sequenced last here simply
    because they are lower business-impact than the financial items and there
    is no benefit to rushing them ahead of the higher-value work.

**Each category above corresponds to one or more independently deployable,
independently reversible config-population + function-migration pairs** — per
instruction, no category's migration should require any other category's
functions to have already switched over, even though the *config values
themselves* have the dependency order described above (a config file can be
*populated* without every function that will eventually consume it having
*migrated* yet — population and consumption are separate, separately
reversible steps).

---

## STEP 8 — REPORT

### Files created

- `docs/architecture/HAT_BUSINESS_RULES_DECISIONS.md` (this document)

### Files modified

None. This sprint made zero changes to any existing file.

### Git status (before this document was written, i.e. current working state)

```
$ git status --short
(clean except for this new, untracked file once written)
```

Step 0 checkpoint already committed and tagged prior to this document being
written:
- Commit: `96980a6` — "chore: establish HAT AI OS foundation architecture"
- Tag: `hat-ai-os-foundation-v1`
- 51 files changed, 2,757 insertions, 0 deletions — exactly the Sprint 1 + 1.1
  scaffold plus its three `.docx` deliverables in `documantation/`.

### Build status

Not re-run in this step — no code was changed since the Sprint 1.1 build
verification (`npm run build` succeeded, 215 modules, two pre-existing
unrelated warnings). This document contains no code, so there is nothing new
to build or type-check.

### All decisions required from Tomer (consolidated)

1. **Blocked ZIPs** — confirm 32206/32209/32254, and choose enforcement model
   (absolute HARD_BLOCK vs RESTRICTED-with-override).
2. **Preferred ZIPs / tiers** — resolve the 3-way tier table conflict,
   including the 32254 blocked-vs-tiered contradiction.
3. **ZIP adjacency** — confirm or revise (low-conflict, consolidation-only).
4. **MAO formula** — choose the minimum-profit/closing-cost deduction
   ($2,450 / $30,000 / other) and confirm the 75% ARV multiplier.
5. **Minimum target flip profit** — choose $25,000 / $30,000 / a rehab-month-
   scaled formula.
6. **Selling cost %** — choose 7% (matches DB default) or 8% (matches primary
   Kevin-facing endpoint).
7. **Purchase closing costs** — choose $1,600 / $1,691 title closing cost, or
   revise to a scaled figure.
8. **HML assumptions** — confirm 12%/2%/90%+100% still reflects the live Rob @
   3 Shacks relationship.
9. **BRRRR refi LTV** — confirm 70% ARV still correct.
10. **BRRRR refi rate** — choose 6.875% / 6.9% / an updated current rate.
11. **Hold months — flip** — choose 3 / 5 / 6 months, or reintroduce
    condition-scaled hold periods.
12. **Hold months — BRRRR** — choose 5 / 6 months, and whether flip/BRRRR need
    separate DB columns.
13. **Insurance assumption** — confirm $136/mo (portfolio-sourced) as
    canonical, or provide an updated figure; decide whether vacancy should be
    split out as its own line item.
14. **Property tax assumption** — confirm $208/mo flat, or make ZIP-aware.
15. **ARV benchmark bands** — the largest single reconciliation task; provide
    or approve a consolidated ZIP→ARV table (likely needs its own working
    session).
16. **Rent benchmark bands** — similarly, provide or approve a consolidated
    ZIP→rent table; also fix `generate-core-analysis.mjs`'s internal
    self-conflict regardless of which table is chosen.
17. **Deal Score weighting** — confirm the 30/20/15/15/10/10 rubric or
    rebalance; decide the relationship to `analyze-deal.mjs`'s separate score.
18. **Verdict vocabulary** — choose the 5-band or 3-band system (or design a
    new one) as the single canonical verdict vocabulary.
19. **Seller motivation scoring** — decide whether ingestion-filter keywords
    and motivation-scoring keywords should merge into one weighted list.
20. **Negotiation anchor parameters** — confirm current room-factor/
    credibility-floor constants, or provide updated values.
21. **Property-type exclusions** — confirm the exclusion list; define the
    duplex carve-out precisely enough to be deterministic.
22. **Minimum beds/baths** — decide whether to introduce this rule at all, and
    if so, hard exclusion vs scoring penalty.
23. **Financial sense-check thresholds** — confirm 15% spread threshold and
    the preferred-ZIP exemption, or revise.
24. **(Step 3) Exception policy** — decide which current rules (if any) should
    ever have an override path to human review, and what the override
    thresholds should be.

**No canonical value has been chosen in this document for any of the above.**
Per instruction, this sprint stops here — implementation of canonical `/config`
values does not begin until these decisions are made and approved.
