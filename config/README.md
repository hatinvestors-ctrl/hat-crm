# /config — Shared Business Configuration

## Purpose

`/config` is the future single source of truth for every business constant
currently duplicated across the codebase — ZIP tiers, ARV/rent bands, MAO formula
parameters, selling costs, lender terms, negotiation weights, scoring thresholds,
and AI model routing settings. See `docs/architecture/HAT_AI_OS.md` and the
Step 1 inventory in `documantation/HatCRM_NextGen_Architecture_Design.docx` for the
full list of duplications this folder exists to resolve (≈15 rule categories, ≈45
locations, 12+ confirmed live inconsistencies as of the Sprint 1 snapshot).

## Responsibilities

- Define the **shape** (TypeScript types/interfaces) of every business-constant
  category.
- Once populated with real values (a future sprint, not this one), be the *only*
  place those values are written down — every prompt, engine, and UI component
  reads from here instead of restating a literal.
- Support multiple markets, lenders, and strategies as data, not code branches.

## What belongs here

- Type/interface definitions describing a config category's shape.
- (Future sprint) the actual populated config values, reconciled from the Step 1
  inventory as an explicit, reviewed business decision per category.
- Config versioning fields (e.g. `effectiveFrom`) so historical AI runs can be
  interpreted against the assumptions that were live at the time.

## What must NEVER belong here

- Functions, calculation logic, or conditionals beyond simple lookups — config is
  data, not code. All logic lives in `/core`.
- Prompt text — prompts live in `/platform/ai/prompt-builder` (future) and today in
  `netlify/functions/*.mjs`.
- Anything requiring a network/DB call to resolve — config is static per deploy
  (or per version), not dynamically fetched at runtime from here.
- Secrets or credentials — those belong in environment variables, never in
  versioned config files.

## Sprint 1 status

Every file in this folder contains **type definitions only** — no populated values.
Reconciling the real values (e.g. "is selling cost 7% or 8%?") is a deliberate
business decision for Kevin/Tomer, explicitly deferred to a future sprint (see
Migration Strategy Phase 2 in the architecture doc) — Sprint 1 only establishes
the shape those decisions will be recorded in.

## Sprint 1.1 corrections

- Added **`config-metadata.ts`** — a shared `ConfigMetadata` contract
  (`configVersion`, `effectiveFrom`, `market`, optional `description`/`reason`)
  now embedded as a `metadata` field on every top-level config interface below,
  replacing each file's previous bare `effectiveFrom`/`market` fields. This is
  what lets a historical AI run's logged `config_snapshot` be traced to the exact
  config version that produced it (see `history/README.md`).
- Added **`rehab.config.ts`** — renovation condition-tier cost brackets, which
  `core/rehab-engine` was incorrectly implied to source from `financial.config.ts`
  in Sprint 1. See `core/rehab-engine/README.md`'s "Sprint 1.1 correction" section.

## Files

| File | Shape for |
|---|---|
| `config-metadata.ts` | Shared `ConfigMetadata` contract embedded by every config below |
| `market.config.ts` | ZIP tiers, ARV/rent bands, adjacency, per-market adjustments |
| `financial.config.ts` | Selling costs, closing costs, holding costs, MAO formula params, hold months |
| `buybox.config.ts` | Blocked ZIPs, property-type skips, distress keywords, financial sense-check thresholds |
| `lender.config.ts` | HML lender profiles, BRRRR refinance profiles |
| `negotiation.config.ts` | Anchor/room-factor model params, motivation keyword weights |
| `scoring.config.ts` | Deal Score rubric weights/bands, verdict vocabulary and thresholds |
| `ai.config.ts` | Per-task model selection, token/temperature settings, prompt versioning |
| `rehab.config.ts` | Renovation condition-tier cost brackets, $/sqft ranges, component categories |
| `distress.config.ts` | (Future — Distressed Lead Engine) signal weights, source reliability scores |
