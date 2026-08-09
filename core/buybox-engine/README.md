# buybox-engine

## Purpose

Single source of truth for "is this property even eligible for HAT to pursue" —
blocked ZIPs, property-type skips, and the financial sense-check gate. Today this
check exists in exactly one enforcement path (the Redfin daily importer) and is
bypassed entirely by every other insertion path (manual scripts, `enrich-lead.mjs`,
manual CRM entry) — one manual script has already inserted a lead into a blocked ZIP
(architecture doc Step 1, §1.1). This engine is what the future Distressed Lead
Engine (see `docs/architecture/HAT_AI_OS.md`) will call from every collector, so
there is only one buy-box check regardless of source.

## Responsibilities

- Determine ZIP eligibility (blocked / preferred / neutral) from
  `config/buybox.config.ts`.
- Determine property-type eligibility (skip condos, new construction, etc.).
- Run the financial sense-check (gross spread vs `config/buybox.config.ts`
  thresholds).
- Return a single pass/fail result with reasons, not a silent boolean.

## What belongs here

- `checkZipEligibility(zip, config) → ZipEligibilityResult`
- `checkPropertyType(propertyType, config) → boolean`
- `checkFinancialSenseCheck(askingPrice, estimatedArv, zip, config) → SenseCheckResult`
- `evaluateBuyBox(inputs, config) → BuyBoxResult` (composes the above)

## What must NEVER belong here

- ARV/reno estimation — those are inputs, sourced from `financial-engine`/AI, not
  computed here.
- Any LLM call — this engine is deliberately deterministic so buy-box eligibility
  is never a matter of model interpretation.
- Insertion/persistence logic — this engine only answers "eligible or not," it does
  not write to the database.

## Sprint 1 status

`index.ts` contains interface/type definitions only. No implementation.
