# memory

## Purpose

Reads prior AI runs and outcome-verified knowledge back into a new `Context` so a
Context Builder call for "analyze this lead again" can see the *previous* run's
output, not just raw DB fields. Today, no AI call in the system has memory of any
kind — each regeneration overwrites `ai_notes`/`deal_analysis` with no history, and
`generate-comps.mjs`'s reuse of prior `ai_notes` text is the only (crude,
unverified) precedent for this pattern.

## Sprint 1.1 correction — Memory is a read path, not a pipeline stage after Logging

Sprint 1's `platform/ai/README.md` originally listed this module as the last step
in one linear chain (`...Logging → Memory → Response`), which incorrectly implied
Memory runs *after* Logging on every call. That is wrong: Memory and Logging are
two **separate, independent paths** that both touch `history/`'s `ai_runs` table
but at opposite ends of a request, and neither depends on the other running first
within the same call:

```
READ PATH   (this module):  History/Knowledge → Memory/Retrieval → Context Builder → AI request
WRITE PATH  (logging/):      AI response → Validation → Logging/History
```

Memory belongs conceptually *before* a request even reaches Prompt Builder — it is
consumed by `context-builder`, not chained after `logging`. See
`platform/ai/README.md` and `history/README.md` for the corrected two-path
diagram.

## Responsibilities

- Fetch prior `ai_runs` rows relevant to a given `leadId`/`agentId`/`taskId`.
- Distinguish outcome-verified history (a closed deal, a confirmed comp) from
  unverified prior AI narrative — per the "Data Confidence" principle carried over
  from the Distressed Lead Engine design (`docs/architecture/HAT_AI_OS.md` Step 7)
  and the trust distinction described in `knowledge/README.md` — so Context
  Builder can choose to trust one over the other.

## What belongs here

- Read/query functions against AI History and (future) `/knowledge`.

## What must NEVER belong here

- Any calculation.
- Writing new history (that's `logging`'s job — the separate write path).

## Sprint 1 status

`index.ts` contains interface definitions only. No implementation.
