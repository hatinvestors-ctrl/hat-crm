# /history — AI History System (Documentation Only, Sprint 1)

## Status

**Documentation only. No table, no migration, no code exists yet.** This README
describes the future AI History system design so it can be implemented in a later
sprint against an agreed schema. Full context:
`docs/architecture/HAT_AI_OS.md` (Step 6) and
`documantation/HatCRM_NextGen_Architecture_Design.docx`.

## Purpose

Every AI execution in HatCRM today (all ~15 Netlify functions calling Claude) is
recorded nowhere except an overwritten field on the `leads` row and ephemeral
`console.log` output. This means: no way to see what the AI said last time, no way
to know if a prompt change made analysis better or worse, and no way to compare an
AI prediction to what actually happened once a deal closes — despite that outcome
data (`deal_financials.actual_sale_price`, `deal_renovation_items.actual_cost`,
`leads.status`, `leads.offer_price`) already existing in the database.

`/history` is the system that closes that loop. It is the single most important
addition in the entire HAT AI OS design — nearly every other capability (proper
memory, evaluation, safe agents) depends on it existing first.

## Read Path vs Write Path (Sprint 1.1 correction)

Sprint 1's `platform/ai/README.md` originally described Memory as the last stage
in one linear pipeline (`...Logging → Memory → Response`), which incorrectly
implied Memory always runs after Logging, within the same call. Architecture
review corrected this: `/history` is accessed via **two separate, independent
paths**, not one sequential chain.

```
READ PATH   (runs BEFORE a model call, feeds Context Builder):

  History (ai_runs) / Knowledge (outcome-verified comps)
        ↓
  Memory / Retrieval           (platform/ai/memory)
        ↓
  Context Builder              (platform/ai/context-builder)
        ↓
  AI request                   (rest of the pipeline — see platform/ai/README.md)


WRITE PATH  (runs AFTER a model call, independent of any future call's read path):

  AI response
        ↓
  Validation                   (platform/ai/validators)
        ↓
  Logging / History            (platform/ai/logging → writes the ai_runs row below)
```

The two paths share the same underlying store (`ai_runs`) but are otherwise
decoupled: a given AI call's write path does not block or gate that same call's
response, and the read path for a *future* call may or may not see a given row
depending on timing — there is no assumption of synchronous consistency between
"just logged" and "immediately recallable." This distinction matters for
`platform/ai/memory` and `platform/ai/logging`, which are documented as two
separate modules for exactly this reason (see both modules' READMEs).

## Responsibilities (future)

- Record one row per AI execution — every call through `platform/ai/model-router`,
  eventually every agent `decision()` step too.
- Capture enough to answer, months later: what did the AI say, with what inputs,
  under what config/prompt version, how much did it cost, was it validated, what
  did a human do about it, and what actually happened to the deal.
- Support the read path `platform/ai/memory` needs to recall prior runs.
- Support the join path a future evaluation job needs to compare AI predictions to
  real outcomes.

## Target schema (design only — not yet migrated)

```
ai_runs
  run_id            UUID (PK)
  task_id           TEXT            -- 'core-analysis' | 'comps' | 'negotiation-plan' | agent id, etc.
  lead_id           UUID NULL       -- FK to leads
  agent_id          UUID NULL       -- FK to agents table, when applicable
  workspace_id      UUID
  timestamp         TIMESTAMPTZ
  model             TEXT            -- resolved from Model Router at call time
  prompt_version    TEXT            -- ties to config/ai.config.ts versioning
  config_snapshot   JSONB           -- the resolved market/financial/scoring config USED for this run
  input_hash        TEXT            -- hash of the Context object, for cache/dedup and drift detection
  input_summary     JSONB           -- key fields only, not full context (cost/size control)
  output            JSONB           -- structured output or free text
  output_raw        TEXT            -- unparsed model response, for debugging parse failures
  confidence        NUMERIC NULL    -- populated once agents (see /agents) report confidence
  latency_ms        INTEGER
  input_tokens      INTEGER
  output_tokens     INTEGER
  cost_usd          NUMERIC
  validation_status TEXT            -- 'passed' | 'failed' | 'not_applicable'
  validation_notes  JSONB
  human_decision    TEXT NULL       -- 'approved' | 'rejected' | 'edited' | 'ignored' | null
  human_decision_by UUID NULL
  human_decision_at TIMESTAMPTZ NULL
  outcome_ref       JSONB NULL      -- populated later: links to deal_financials/leads.status once known
```

## What belongs here (once implemented)

- The `ai_runs` table/migration.
- Read/write access functions consumed by `platform/ai/logging` and
  `platform/ai/memory`.
- The async job that joins `outcome_ref` back to `deal_financials`/
  `deal_renovation_items`/`leads.status` once a deal's outcome is known.

## What must NEVER belong here

- Any business calculation — history only records what engines/AI produced, it
  never recomputes anything.
- Prompt construction or model-calling logic — those stay in `platform/ai`.
- Retention/access-policy decisions have **not** been made — `ai_runs` will contain
  potentially sensitive data (seller PII, agent contact info in logged context) and
  needs an explicit retention/RLS policy pass before implementation, flagged
  explicitly as an open risk in the architecture doc (Step 9, risk #5).

## Dependency note

`human_decision*` fields require the frontend to emit an event when a user acts on
an AI output (approves a draft, accepts/edits a verdict, marks a lead dead after
seeing a recommendation) — this is a UI-layer change outside this backend-only
scaffold's scope, flagged as an explicit dependency for whichever sprint implements
this table.

## Sprint 1 status

Documentation only, as above. No `ai_runs` table, no migration file, no code.
