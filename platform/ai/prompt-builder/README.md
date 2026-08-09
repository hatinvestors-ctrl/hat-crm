# prompt-builder

## Purpose

Turns a `Context` object (from `context-builder`) plus a typed `AnalysisResult`
(from the new `platform/analysis` orchestration layer) into the actual system/user
prompt strings sent to Claude — replacing each function's inline
`buildPrompt()`/`buildUserPrompt()` (e.g. `generate-core-analysis.mjs`'s ~90-line
`SYSTEM_PROMPT` template literal).

## Responsibilities

- Serialize `AnalysisResult` fields (MAO, scores, anchors — already computed
  upstream) into "PRE-COMPUTED — do not recalculate" prompt blocks, consistently,
  in one place.
- Own prompt **versioning** — every prompt template has a `promptVersion` string
  tied to `config/ai.config.ts` and logged per-run (see `history/README.md`), so a
  prompt edit is a tracked, diffable event.
- Keep market-specific facts (ZIP/ARV/rent bands) out of the literal template text
  — Prompt Builder resolves them from `Context.market`/`AnalysisResult` at build
  time instead of the prompt string hard-coding Jacksonville numbers.

## What belongs here

- Prompt template functions and their versioning metadata.
- Formatting/serialization of already-computed `AnalysisResult` values into
  prompt text.

## What must NEVER belong here

- **Deciding which `/core` engines to run, or calling one.** This is the
  Sprint 1.1 correction — see below. Prompt Builder receives an already-complete
  `AnalysisResult`; it has no mechanism to produce or modify one.
- Any calculation of any kind — Prompt Builder only formats numbers it receives,
  it never derives them.
- Any network call — building a prompt string is pure; `model-router` is what
  actually calls the API.

## Sprint 1.1 correction

**Sprint 1's original interface implied Prompt Builder could call `/core` engines
directly** — `buildPrompt()` accepted a loose `Record<string, unknown>` labeled
"engine results" with no defined producer. Architecture review flagged this as a
separation-of-concerns violation: deciding *which* deterministic engines a task
needs, and executing them, is an orchestration decision, not a prompt-formatting
one. A new layer, `platform/analysis`, now owns that decision exclusively and sits
between Context Builder and Prompt Builder. Prompt Builder's `buildPrompt()` now
takes a typed `AnalysisResult` (defined in `platform/analysis/index.ts`) as an
input it can only read and format — it has no import path to any `/core` engine
and no way to trigger one. See `platform/analysis/README.md` for the full
corrected pipeline.

## Sprint 1 status

`index.ts` contains interface definitions only. No implementation. **No existing
prompt text has been moved, copied, or modified** — this folder does not yet
contain any of the real prompt content living in `netlify/functions/*.mjs`.
