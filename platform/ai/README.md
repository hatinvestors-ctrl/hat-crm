# platform/ai — AI Platform Pipeline

## Purpose

The AI Platform is the future single integration point between HatCRM and the
Anthropic API, replacing today's pattern of ~15 independent Netlify functions each
building their own prompt strings and calling `fetch(...)` directly. Full design
rationale: `docs/architecture/HAT_AI_OS.md` (Step 4) and
`documantation/HatCRM_NextGen_Architecture_Design.docx`.

## Responsibilities

**Sprint 1.1 correction:** Sprint 1 originally described this pipeline as one
linear chain ending `...Logging → Memory → Response`, which incorrectly implied
Memory is simply a stage that runs after Logging on every call. Architecture
review corrected this: Memory is a **read path** that runs *before* a call
(feeding Context Builder), while Logging is the **write path** that runs *after*
a call. They are not sequential steps in one chain — see the two-path diagram
below, and `history/README.md`'s "Read Path vs Write Path" section for the full
explanation.

```
READ PATH  (before a model call, feeds Context Builder):

  History (ai_runs) / Knowledge (verified comps)
        ↓
  Memory / Retrieval  (platform/ai/memory)
        ↓
  Context Builder
        ↓
  ... rest of the request pipeline (below)


REQUEST PIPELINE  (per AI call, in order):

  Context Builder → platform/analysis → Prompt Builder → Model Router →
  (Anthropic API) → Structured Output → Validators → Response


WRITE PATH  (after a model call, runs in parallel with returning the Response):

  AI response
        ↓
  Validators   (validation_status/notes attached)
        ↓
  Logging      (writes the ai_runs row — history/README.md)
```

- **context-builder/** — assembles all context a task is entitled to (lead,
  property, financial, market context, historical comps, prior AI runs — see its
  own README for the typed domain contexts) into one typed `Context` object. Reads
  from Memory as part of assembly; does not call `/core` engines itself (see
  `platform/analysis/README.md`).
- **prompt-builder/** — turns `Context + AnalysisResult` (the latter produced by
  `platform/analysis`, not by prompt-builder) into the actual prompt strings, using
  already-computed engine outputs for numbers (never recomputing them) and
  versioned prompt templates. See Sprint 1.1 correction in its own README.
- **model-router/** — resolves task → model/settings from `config/ai.config.ts`,
  replacing hard-coded model strings in every function.
- **validators/** — checks structured output against the engine ground truth it was
  built from (makes "do not recalculate" enforceable, not just requested) and
  against expected schema/enum values. Feeds the write path (below).
- **logging/** — write path only: writes the request/response/cost/latency/
  validation record described in `history/README.md`. Does not read history back —
  that's `memory`'s job.
- **memory/** — read path only: reads prior AI runs (via `history/`) and hands them
  to Context Builder for a new request. Does not write new history — that's
  `logging`'s job.

(See also `platform/analysis/README.md` — the orchestration layer added in
Sprint 1.1 that sits between Context Builder and Prompt Builder and is the only
place `/core` engines are decided on and executed.)

## What belongs here

- Pipeline orchestration interfaces and stage contracts.
- No task-specific business logic — a specific task's prompt *content* is
  configuration/template data the Prompt Builder consumes, not code living here.

## What must NEVER belong here

- Deterministic calculations (`/core`'s job).
- Business constants (`/config`'s job).
- Direct Supabase/database writes of final business records (a Netlify function or
  future agent orchestrates that; the AI Platform's job ends at returning a
  validated, logged Response).

## Sprint 1 status

Every subfolder contains an interface-only `index.ts` (or `types.ts`) and a README.
No implementation. No existing function has been modified to use any of this yet —
`netlify/functions/*.mjs` continues to call the Anthropic API directly, exactly as
it does today.
