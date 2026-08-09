# validators

## Purpose

Makes today's "PRE-COMPUTED — do not recalculate" prompt instructions *enforceable*
rather than aspirational. Diffs the model's structured/parsed output against the
`/core` engine ground truth it was built from, and validates output shape against
expected schema/enum values (e.g. verdict must be one of `scoring.config.ts`'s
defined verdict vocabulary — resolving the two-competing-vocabularies problem in
architecture doc Step 1, §1.12, by construction).

## Responsibilities

- Given a parsed model output and the engine results it was supposed to reflect,
  detect and flag numeric mismatches (a real hallucination detector — does not
  exist anywhere in the codebase today).
- Validate structured output against its expected schema.
- Validate enum-like fields (verdict, status) against the single allowed
  vocabulary from `/config`.

## What belongs here

- Pure validation functions: `(engineTruth, modelOutput) → ValidationResult`.

## What must NEVER belong here

- Any network call.
- Any calculation — validators only compare, they never compute a "correct" value
  themselves (that's always `/core`'s job).

## Sprint 1 status

`index.ts` contains interface definitions only. No implementation.
