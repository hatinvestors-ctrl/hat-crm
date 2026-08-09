# flip-engine

## Purpose

Single source of truth for fix-and-flip exit math: sale proceeds, net profit, ROI,
and annualized ROI. Today this math is duplicated with two different selling-cost
assumptions (7% in `analyze-deal.mjs`/`generate-report.mjs` vs 8% in
`generate-core-analysis.mjs`/`generate-ai-notes.mjs`) — resolving that conflict is
an explicit goal of migrating to this engine (see architecture doc Step 1, §1.5).

## Responsibilities

- Compute sale proceeds from ARV and `financial.config.ts`'s selling-cost percentage.
- Compute total flip profit given all-in cost, financing costs, and holding costs
  (sourced from `financial-engine`, not recomputed here).
- Compute ROI and annualized ROI.

## What belongs here

- `computeSaleProceeds(arv, config) → number`
- `computeFlipProfit(inputs, financialResults, config) → FlipResult`
- `computeFlipRoi(...)`

## What must NEVER belong here

- MAO, loan, or holding-cost math — call `financial-engine` for those and take its
  output as an input.
- BRRRR/refinance math — that's `brrrr-engine`.
- Any LLM call or prompt text.
- Hard-coded selling-cost percentages — always read from `financial.config.ts`.

## Sprint 1 status

`index.ts` contains interface/type definitions only. No implementation.
