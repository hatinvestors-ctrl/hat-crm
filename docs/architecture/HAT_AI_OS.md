# HAT AI OS — Architecture Overview

**Status: Sprint 1.1 — foundation scaffold, architecture-corrected. This document
describes the target architecture. As of this sprint, none of it is wired into the
running application. The live system is still 100% `netlify/functions/*.mjs` +
`src/`, unchanged.**

Full design rationale and evidence base:
`documantation/HatCRM_NextGen_Architecture_Design.docx` (the 10-step design document
this scaffold implements the skeleton of) and
`documantation/HatCRM_AI_Architecture_Report.docx` (the original current-state audit).

---

## Why this exists

The current HatCRM AI system works, but its business rules are duplicated across
~45 locations in ~15 independently-built Netlify functions, with at least 12
confirmed live inconsistencies already in production (e.g. the MAO formula gives
three different dollar answers depending which endpoint runs it; flip selling costs
are 7% in one function and 8% in another). There is no shared calculation layer, no
shared AI integration layer, no history of what the AI has said, and no agents —
only isolated one-shot LLM calls. HAT AI OS is the target architecture that fixes
this, built incrementally and non-breaking. Sprint 1 laid the folder structure,
interfaces, and documentation this will be built into. Sprint 1.1 is an
architecture-review correction pass over that scaffold — still no implementation,
still no behavior change — see "Sprint 1.1 corrections" below for what changed and
why.

## Sprint 1.1 corrections (summary)

An architecture review of the Sprint 1 scaffold approved it in principle but
identified six contract-level issues, all corrected in this pass:

1. **Orchestration was not separated from prompt building.** `prompt-builder`'s
   Sprint 1 interface implied it could decide which `/core` engines to run and
   call them. A new layer, **`platform/analysis`**, now owns that decision
   exclusively, sitting between Context Builder and Prompt Builder. Prompt
   Builder now only transforms `Context + AnalysisResult` into prompt text.
2. **Context typing was too generic.** `platform/ai/context-builder`'s `Context`
   previously typed its domain fields as `Record<string, unknown> | null`. It now
   composes typed, partial domain interfaces: `LeadContext`, `PropertyContext`,
   `FinancialContext`, `MarketContext`, `HistoricalContext`, `AiHistoryContext`.
3. **Rehab config was missing.** `core/rehab-engine` needed renovation cost
   brackets that `config/financial.config.ts` was never designed to hold. Added
   **`config/rehab.config.ts`** and corrected `rehab-engine`'s dependency.
4. **Memory was documented as a linear pipeline stage after Logging.** It is not.
   Corrected to document two separate paths: a **read path**
   (History/Knowledge → Memory/Retrieval → Context Builder) and a **write path**
   (AI response → Validation → Logging/History).
5. **No Capability vs Tool distinction existed.** `/tools` now documents and
   interface-defines the difference: a **Capability** is a reusable ability
   (almost always a reference to a `/core` engine or other existing layer); a
   **Tool** is an agent-accessible wrapper around exactly one capability, never a
   reimplementation of it.
6. **Config versioning was `effectiveFrom`-only.** Added a shared
   **`config/config-metadata.ts`** (`ConfigMetadata`: `configVersion`,
   `effectiveFrom`, `market`, optional `description`/`reason`), now embedded by
   every top-level config interface, so a historical AI run's logged
   `config_snapshot` can be traced to the exact config version that produced it.

See each affected folder's README for the full "Sprint 1.1 correction" section
with detailed rationale. Sprint 1.1 made **zero** changes to any existing
production file, prompt, calculation, or database behavior — see "What Sprint 1.1
explicitly did NOT do" below.

## Folder map

```
HatCRM/
├── core/                     Deterministic calculation engines (pure functions)
│   ├── financial-engine/     MAO, HML costs, closing costs, holding costs
│   ├── flip-engine/          Sale proceeds, net profit, ROI
│   ├── brrrr-engine/         Refinance math, cash flow, cash-on-cash
│   ├── negotiation-engine/   Anchor/target/walk-away, motivation scoring
│   ├── rehab-engine/         Reno budget bracketing, max-reno solving (now reads
│   │                         config/rehab.config.ts — Sprint 1.1 correction #3)
│   ├── scoring-engine/       Deal Score rubric, verdict determination
│   └── buybox-engine/        ZIP eligibility, property-type filter, sense-check
│
├── config/                   Business constants — TYPES ONLY, no real values
│   ├── config-metadata.ts    Shared ConfigMetadata contract (Sprint 1.1 correction #6)
│   ├── market.config.ts      ZIP tiers, ARV/rent bands, adjacency
│   ├── financial.config.ts   Selling costs, closing costs, MAO params, hold months
│   ├── buybox.config.ts      Blocked ZIPs, property skips, distress keywords
│   ├── lender.config.ts      HML lender profiles, BRRRR refi profiles
│   ├── negotiation.config.ts Anchor model params, motivation keyword weights
│   ├── scoring.config.ts     Deal Score weights/bands, verdict vocabulary
│   ├── ai.config.ts          Per-task model/settings, prompt versioning
│   ├── rehab.config.ts       Renovation condition-tier cost brackets (Sprint 1.1, #3)
│   └── distress.config.ts    (Future) distress-signal weights, source reliability
│
├── platform/
│   ├── analysis/              NEW Sprint 1.1 (correction #1) — orchestration layer
│   │                          between Context Builder and Prompt Builder; decides
│   │                          which /core engines a task needs and runs them
│   └── ai/                   The AI Platform pipeline
│       ├── context-builder/  Assembles typed Context objects for a task
│       │                     (typed domain contexts — Sprint 1.1 correction #2)
│       ├── prompt-builder/   Context + AnalysisResult → prompt strings ONLY
│       │                     (corrected input contract — Sprint 1.1 correction #1)
│       ├── model-router/     Resolves model/settings, executes the API call
│       ├── validators/       Diffs model output against engine ground truth
│       ├── logging/          WRITE path only — writes to the future AI History store
│       └── memory/           READ path only — reads prior AI runs into new Context
│                             (read/write path correction — Sprint 1.1 correction #4)
│
├── history/                  AI History system — DOCUMENTATION ONLY (no table yet)
├── agents/                   Agent Platform — DOCUMENTATION ONLY (no agents yet)
├── knowledge/                Future retrieval/RAG layer — DOCUMENTATION ONLY
├── tools/                    Future agent tool registry — now interface-defined
│                             with Capability vs Tool distinction (Sprint 1.1, #5)
│
└── docs/architecture/        This document and future ADRs
```

## How the pieces relate

`/config` and `/core` are the foundation: `/core` engines take typed inputs plus a
`/config` object and return typed results — no engine ever hard-codes a business
constant, and no config file ever contains logic. Every other layer depends on
these two, never the reverse. Every top-level `/config` interface now embeds a
`metadata: ConfigMetadata` field (Sprint 1.1) so any config object can be traced to
an exact, identifiable version.

`platform/analysis` (Sprint 1.1) is the orchestration layer that decides which
`/core` engines a given AI task needs and executes them, producing a typed
`AnalysisResult`. It is the *only* place this decision is made — `platform/ai`'s
other stages never call a `/core` engine directly.

`/platform/ai` is the layer that will eventually sit between the application's
entry points (today: Netlify functions; future: agents) and the Anthropic API.
Context Builder assembles a typed `Context` (composed of `LeadContext`,
`PropertyContext`, `FinancialContext`, `MarketContext`, `HistoricalContext`,
`AiHistoryContext` — Sprint 1.1) → that `Context` is handed to `platform/analysis`,
which produces `AnalysisResult` → Prompt Builder transforms `Context +
AnalysisResult` into prompt text (and *only* that — Sprint 1.1 correction) → Model
Router calls Claude → Validators check the response against the `AnalysisResult`
ground truth. Logging (write path) and Memory (read path) are two independent
paths against `/history`, not sequential pipeline stages — see the dependency
diagram below.

`/history` is the record of every AI execution — the prerequisite for
`platform/ai/memory`'s read path and for any future evaluation of whether the AI
was right, because it is the only place an AI prediction and its eventual
real-world outcome can be joined together.

`/agents` and `/tools` build on top of everything above: an agent's `context()`
calls Context Builder, its `decision()` calls Model Router, and every entry in its
`tools` array wraps exactly one named **Capability** (Sprint 1.1) — almost always a
reference to a `/core` engine, `/knowledge`, or an external integration — never a
reimplementation. An agent introduces no new integration surface — it is a
disciplined consumer of the platform that already exists by the time one is built.

`/knowledge` is the anticipated home for retrieval/comp-trust logic that
`platform/ai/context-builder` and `platform/ai/memory`'s read path will eventually
call, replacing today's flat, unverified ZIP-cluster comp lookup.

## Dependency diagram (corrected, Sprint 1.1)

```
                         ┌─────────────────┐
                         │     /config      │   (types only; every interface now
                         │  business data   │    embeds ConfigMetadata — #6)
                         └────────┬─────────┘
                                  │ read by
                                  ▼
                         ┌─────────────────┐
                         │      /core       │   (interfaces only)
                         │  calc engines    │   (rehab-engine now reads
                         │                  │    config/rehab.config.ts — #3)
                         └────────┬─────────┘
                                  │ called ONLY by platform/analysis  ◀── #1
                                  ▼
                    ┌───────────────────────────┐
                    │     platform/analysis      │  NEW in Sprint 1.1 (#1)
                    │  decides required engines  │  NO LLM calls in this layer
                    │  executes /core engines    │
                    │  produces AnalysisResult   │
                    └──────────────┬──────────────┘
                                   │ Context + AnalysisResult
                                   ▼
        ┌──────────────────────────────────────────────────────────┐
        │                       platform/ai                         │
        │                                                             │
        │   context-builder ──▶ [platform/analysis] ──▶ prompt-builder│
        │   (typed Context,        (above)              (transforms   │
        │    domain interfaces                            ONLY —#1)  │
        │    — #2)                                            │       │
        │        ▲                                            ▼       │
        │        │                                    model-router    │
        │        │                                            │       │
        │        │                                            ▼       │
        │        │                                  (Anthropic API)   │
        │        │                                            │       │
        │        │                                            ▼       │
        │        │                                       validators   │
        │        │                                            │       │
        │        │                            ┌───────────────┘       │
        │        │                            ▼                       │
        │        │                        logging  ──writes──▶ ┌─────────────┐
        │        │                     (WRITE PATH — #4)       │  /history   │
        │        │                                             │   ai_runs   │
        │      memory  ◀──reads────────────────────────────────┤             │
        │  (READ PATH — #4)                                    └─────────────┘
        └──────────────────────────────────────────────────────────┘
                                  ▲
                                  │ consumed by
                    ┌─────────────────────────┐
                    │        /agents           │  (docs only)
                    │  Agent interface, uses   │
                    │  context-builder +       │
                    │  model-router + tools    │
                    └────────────┬─────────────┘
                                 │ tools array — each wraps ONE Capability (#5)
                                 ▼
                    ┌─────────────────────────┐
                    │         /tools           │  interface-defined (#5):
                    │  Tool → wraps exactly    │  CapabilityDefinition,
                    │  one CapabilityDefinition│  CapabilityRegistry, Tool
                    │  never reimplements it   │
                    └───────────────────────────┘

                    ┌─────────────────────────┐
                    │       /knowledge         │  (docs only)
                    │  future retrieval layer, │
                    │  consumed by             │
                    │  context-builder/memory  │
                    └───────────────────────────┘

  ── existing, unchanged in Sprint 1.1 ──────────────────────────────────
  netlify/functions/*.mjs  ──still calls──▶  api.anthropic.com directly
  src/lib/calculations.js  ──still used by──▶  React UI directly
  (Neither imports anything above yet.)
```

## What Sprint 1.1 explicitly did NOT do

- Did not move, copy, or alter any prompt text from `netlify/functions/*.mjs`.
- Did not change any calculation, formula, or constant value anywhere.
- Did not change any API response shape, database write, or UI behavior.
- Did not migrate any existing function to use `/core`, `/config`, `/platform/ai`,
  or the new `platform/analysis`.
- Did not populate any `/config` file with real values — every file (including the
  new `rehab.config.ts` and `config-metadata.ts`) exports types only. Reconciling
  the real, correct values remains an explicit business decision deferred to a
  future sprint.
- Did not create the `ai_runs` table, any agent, any capability/tool
  implementation, or any knowledge-layer code — `history/`, `agents/`,
  `knowledge/` remain documentation only; `tools/` gained interface definitions
  only, nothing executes.
- Did not implement any logic in the new `platform/analysis` layer — interfaces
  only, per the same Sprint 1 discipline.

The application continues to run, build, and behave exactly as it did at snapshot
tag `snapshot-2026-08-09-baseline` — nothing in this sprint or this correction
pass is imported by any file that was part of the running application before
Sprint 1 began. See the Sprint 1.1 review report for build verification results.

## What comes next (not part of this sprint)

See the Migration Strategy (Step 8) in
`documantation/HatCRM_NextGen_Architecture_Design.docx` for the full phased plan.
In short: Phase 1 (Sprint 1, corrected in Sprint 1.1) → Phase 2 reconciles real
config values as an explicit business decision → Phase 3 implements engines
against historical data as a regression baseline → Phase 4 switches functions over
one at a time → later phases build out the AI Platform, History, and eventually the
Distressed Lead Engine and first real agent. **Per explicit instruction, Sprint 2
does not begin as part of this pass.**
