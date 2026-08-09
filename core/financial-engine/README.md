# financial-engine

## Purpose

Single source of truth for the foundational money math every other engine builds on:
Maximum Allowable Offer (MAO), HML (hard-money-lender) loan costs, purchase/closing
costs, and monthly/total holding costs.

## Responsibilities

- Compute MAO from ARV, renovation cost, and the active `financial.config.ts` formula
  parameters (currently 3 different formulas exist across the codebase — this engine
  will become the one).
- Compute HML loan sizing, points, and fixed closing-cost line items from a
  `LenderProfile` (see `config/lender.config.ts`).
- Compute monthly and total holding costs (loan payment + taxes + insurance + HOA +
  utilities) for a given hold period.
- Return itemized, explainable results (not just a final number) so downstream AI
  narration can faithfully describe *why* a number is what it is.

## What belongs here

- `computeMao(inputs, config) → MaoResult`
- `computeHmlLoan(inputs, lenderProfile) → HmlLoanResult`
- `computeHoldingCosts(inputs, config, holdMonths) → HoldingCostResult`
- `computeAllInCost(...)`

## What must NEVER belong here

- Flip-specific exit math (sale proceeds, net profit) — that's `flip-engine`.
- BRRRR-specific refinance math — that's `brrrr-engine`.
- Any LLM call or prompt text.
- Hard-coded rates/percentages — always accept a config object as a parameter.

## Sprint 1 status

`index.ts` contains interface/type definitions only. No implementation.
