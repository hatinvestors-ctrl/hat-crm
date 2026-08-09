# context-builder

## Purpose

Assembles all context a given AI task is entitled to into a single typed `Context`
object, replacing today's ad hoc per-function data-gathering (e.g.
`generate-comps.mjs`'s inline `fetchComps()`, `generate-core-analysis.mjs`'s direct
field reads from the request body).

## Responsibilities

- Given a `taskId` and a `leadId`/`agentId`, fetch and assemble: lead fields,
  relevant `deal_financials` rows, historical comps (per a defined retrieval
  policy — see `docs/architecture/HAT_AI_OS.md` Step 7's "Data Confidence" concept
  for how this should eventually be trust-weighted), prior AI runs on this same
  lead (via `platform/ai/memory`, once `history/` exists), and resolved
  market/config metadata for this lead's ZIP.
- Return one typed object (`Context`) regardless of which task consumes it.

## What belongs here

- Data-assembly/retrieval orchestration only.

## What must NEVER belong here

- Prompt text construction (that's `prompt-builder`'s job).
- Any Anthropic API call.
- Business calculations of any kind — Context Builder hands the assembled
  `Context` to `platform/analysis` (see Sprint 1.1 correction below), which is
  the layer responsible for deciding which `/core` engines to run and running
  them. Context Builder itself never calls a `/core` engine.

## Sprint 1.1 corrections

**Typed domain contexts (replacing `Record<string, unknown>`).** Sprint 1's
`Context` typed its domain fields as generic `Record<string, unknown> | null`.
Architecture review flagged this as unsuitable to stand as the permanent contract.
`index.ts` now defines explicit, partial domain interfaces — `LeadContext`,
`PropertyContext`, `FinancialContext`, `MarketContext`, `HistoricalContext`,
`AiHistoryContext` — composed into `Context`. Every field on every one of these
interfaces is optional, and interfaces stay deliberately partial: the
authoritative database schema for `leads`/`deal_financials`/etc. has not been
formally migrated into TypeScript, and no field was invented here that isn't
already referenced by name elsewhere in this codebase's scaffold or architecture
documentation (see `index.ts`'s header comment for the full rationale). Some
loosely-typed fields remain by deliberate choice, not oversight — e.g.
`HistoricalComp.summary` and `PriorAiRun.outputSummary` stay
`Record<string, unknown>` because their shape is genuinely task-specific/display
data, not a fixed domain object.

**Corrected downstream flow.** Sprint 1's description above previously said
"Context Builder passes raw facts to `/core` engines via Prompt Builder" — this
was imprecise and has been corrected. Context Builder passes the assembled
`Context` to the new `platform/analysis` orchestration layer, which decides which
`/core` engines a task needs and executes them; only *then* does Prompt Builder
receive `Context + AnalysisResult`. See `platform/analysis/README.md` for the
full corrected pipeline diagram.

## Sprint 1 status

`index.ts` contains interface definitions only. No implementation.
