# brrrr-engine

## Purpose

Single source of truth for BRRRR (Buy-Rehab-Rent-Refinance-Repeat) math: refinance
sizing, cash-left-in, monthly/annual cash flow, and cash-on-cash return. Today this
math is duplicated across `generate-core-analysis.mjs`, `lib/negotiation-core.mjs`,
`generate-comps.mjs`, and `generate-ai-notes.mjs`, with the refi rate (6.875% vs
6.9%) and payment-bracket rounding differing between copies (architecture doc Step 1,
§1.7).

## Responsibilities

- Compute refinance loan amount from ARV and a `RefiProfile` (see
  `config/lender.config.ts`).
- Compute refi closing costs, cash-out/cash-left-in at refinance.
- Compute post-refinance monthly and annual cash flow.
- Compute cash-on-cash return.

## What belongs here

- `computeRefinance(inputs, refiProfile) → RefiResult`
- `computeCashFlow(inputs, refiResult, config) → CashFlowResult`
- `computeCashOnCash(...)`

## What must NEVER belong here

- Purchase-side financing (HML) math — that's `financial-engine`.
- Flip exit math — that's `flip-engine`.
- Any LLM call or prompt text.
- Hard-coded refi rates/LTV — always read from `config/lender.config.ts`.

## Sprint 1 status

`index.ts` contains interface/type definitions only. No implementation.
