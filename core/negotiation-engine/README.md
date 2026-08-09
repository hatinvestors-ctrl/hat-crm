# negotiation-engine

## Purpose

Single source of truth for the "smart anchor" negotiation-room model — starting
offer, target price, max walk-away, and seller-motivation scoring. Today this logic
exists in exactly one file (`generate-core-analysis.mjs`) but is duplicated *twice
inside that same file* (once in `buildPrompt()`, once in the response handler) —
this engine collapses that to one implementation (architecture doc Step 1, §1.14).

## Responsibilities

- Score seller motivation from deal signals (DOM, price-drop %, keyword matches
  against `config/negotiation.config.ts`'s weighted keyword list).
- Compute starting offer / target price / max walk-away using the room-factor and
  credibility-floor model, bounded by MAO (from `financial-engine`).
- Return a human-readable reasoning trace so AI narration can faithfully explain the
  numbers instead of re-deriving or restating them.

## What belongs here

- `computeMotivationScore(signals, config) → MotivationResult`
- `computeAnchor(inputs, maoResult, motivationResult, config) → AnchorResult`

## What must NEVER belong here

- MAO calculation itself — takes `MaoResult` from `financial-engine` as an input.
- Persuasion framing / doctrine text (Voss, Klaff, Cardone, etc.) — that content
  stays in prompt text (`netlify/functions/lib/negotiation-core.mjs` today,
  eventually `platform/ai/prompt-builder`), not in this engine. This engine produces
  *numbers*, never words.
- Any LLM call.

## Sprint 1 status

`index.ts` contains interface/type definitions only. No implementation.
