# platform/analysis — Analysis Orchestration Layer

## Status

**Added in Sprint 1.1 (architecture correction). Interfaces only, no implementation.**

## Why this exists

Sprint 1's original design of `platform/ai/prompt-builder` implied that Prompt
Builder itself could decide which `/core` engines to run and call them directly
(its `buildPrompt()` interface took a `Context` and a loose `Record<string,
unknown>` of "engine results" with no clear owner of *producing* those results).
Architecture review flagged this as a violation of separation of concerns: prompt
construction (turning data into text for an LLM) and orchestration (deciding what
deterministic work needs to happen and running it) are different responsibilities
and should not live in the same module. Conflating them would have made Prompt
Builder implicitly own business-logic decisions ("which engines does this task
need?"), which contradicts the core HAT AI OS principle that **AI never calculates
business numbers** — a principle that applies just as much to the orchestration
code around the AI as to the AI itself.

`platform/analysis` is the new layer that owns that decision. It sits strictly
between Context Builder and Prompt Builder.

## Responsibilities

Given a `Context` (from `platform/ai/context-builder`) and a `taskId`:

1. Determine which `/core` engines are required for this task (e.g. `core-analysis`
   requires `financial-engine` + `scoring-engine` + `negotiation-engine`; `comps`
   requires none — it's narrative-only over historical data).
2. Execute those engines, in the correct dependency order (e.g. `financial-engine`
   before `flip-engine`/`brrrr-engine`, both before `scoring-engine`, per the
   engine dependency chain documented in each engine's own interface file).
3. Assemble a single typed `AnalysisResult` from their outputs.
4. Return `{ context, analysisResult }` for Prompt Builder to consume.

**No LLM calls happen in this layer.** It is pure orchestration over deterministic
engines — itself deterministic, itself unit-testable independent of any prompt or
model.

## What belongs here

- Task → required-engines mapping.
- Engine execution ordering/composition logic.
- The `AnalysisResult` type that normalizes different engines' outputs into one
  shape Prompt Builder can rely on regardless of which task produced it.

## What must NEVER belong here

- Any Anthropic API call, or any LLM call of any kind — this is a strictly
  pre-AI, deterministic stage.
- Prompt text or prompt construction of any kind — that is exclusively
  `prompt-builder`'s responsibility, which this layer feeds but does not perform.
- New business calculations — this layer only *decides which engines to call and
  calls them*; it must never reimplement or shortcut what an engine in `/core`
  already owns.

## Corrected pipeline (supersedes the Sprint 1 diagram)

```
Context Builder
      ↓  (Context)
platform/analysis        ← NEW in Sprint 1.1
      ↓  determines required engines for this task
      ↓  executes /core engines (financial/flip/brrrr/negotiation/rehab/scoring/buybox)
      ↓  (Context + AnalysisResult)
Prompt Builder            ← now ONLY transforms Context + AnalysisResult into prompt text
      ↓
Model Router → ... (unchanged from Sprint 1)
```

`platform/ai/prompt-builder`'s interface has been corrected accordingly (see its
`README.md`/`index.ts`) — it no longer accepts a loose `engineResults` blob or
implies it may call engines; it now accepts a typed `AnalysisResult` produced
exclusively by this layer.

## Sprint 1.1 status

`index.ts` contains interface/type definitions only. No implementation. Nothing in
the existing application calls this layer.
