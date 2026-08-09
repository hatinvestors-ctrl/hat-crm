# scoring-engine

## Purpose

Single source of truth for the Deal Score rubric and verdict determination. Today
two incompatible verdict vocabularies exist in production simultaneously —
`generate-core-analysis.mjs`'s 5-band MAKE OFFER/NEGOTIATE/LONG SHOT/WATCH/DEAD LEAD
vs `analyze-deal.mjs`'s 3-band BUY/CONDITIONAL/PASS — meaning the same deal can get
two different "answers" depending which endpoint scored it (architecture doc Step 1,
§1.12). This engine exists to make there be exactly one.

## Responsibilities

- Evaluate the weighted Deal Score rubric (Deal Return, Price Gap, Seller Signals,
  Market & Exit, Cash Flow, Data Quality) against `config/scoring.config.ts`.
- Determine the single canonical verdict from the total score and deal-math results
  (from `financial-engine`/`flip-engine`/`brrrr-engine`).
- Return per-subscore rationale so AI narration explains the score instead of
  re-deriving it.

## What belongs here

- `scoreDeal(inputs, financialResults, config) → DealScoreResult`
- `determineVerdict(score, dealWorksAtMao, config) → string`

## What must NEVER belong here

- Any of the underlying financial math (MAO, cash flow, flip profit) — those are
  inputs from other engines, not recomputed here.
- Any LLM call.
- A second, competing verdict vocabulary — `config/scoring.config.ts` defines the
  one allowed set of verdict values; nothing outside it should invent another.

## Sprint 1 status

`index.ts` contains interface/type definitions only. No implementation.
