# /knowledge — Future Knowledge / Retrieval Layer (Documentation Only, Sprint 1)

## Status

**Documentation only. No code, no data store, nothing implemented.** This folder
was not explicitly designed in the prior architecture document
(`documantation/HatCRM_NextGen_Architecture_Design.docx`) but is scaffolded here as
a placeholder for the retrieval/RAG capability that document's Step 22 target
architecture and Step 7 Distressed Lead Engine both anticipate needing.

## Purpose (future)

Today, `generate-comps.mjs` implements a crude, flat SQL "RAG" — pulling historical
`leads` rows by ZIP-cluster adjacency and re-injecting their *unverified* prior
`ai_notes` text into new prompts. The architecture doc (Step 9, risk area; and
Step 22's target flow) calls for this to evolve into proper retrieval that
distinguishes **outcome-verified** historical deals (closed, `deal_financials`
populated) from raw, unverified AI narrative — only the former should be trusted as
grounding for new AI analysis.

`/knowledge` is the anticipated future home for that retrieval layer: comp
selection policy, outcome-verified deal indexing, and (eventually, if warranted) a
real vector/semantic retrieval mechanism to replace today's flat ZIP-cluster SQL
filter.

## Responsibilities (future)

- Define what counts as "trustworthy" retrievable knowledge (outcome-verified
  deals) vs. what does not (unverified AI notes) — see `platform/ai/memory`'s
  `onlyOutcomeVerified` flag, which this layer would ultimately back.
- Provide the retrieval interface `platform/ai/context-builder` calls for
  historical comps, instead of `context-builder` doing its own SQL filtering.

## What belongs here (once implemented)

- Retrieval/indexing logic and interfaces.
- Comp-trust/verification policy.

## What must NEVER belong here

- Business calculations (`/core`'s job).
- Prompt construction (`platform/ai/prompt-builder`'s job).
- Unverified AI-generated text presented as ground truth — the explicit purpose of
  this layer is to prevent exactly that compounding-hallucination pattern already
  observed in `generate-comps.mjs` today.

## Sprint 1 status

Documentation only. This capability is not part of the Step 1–10 design document's
explicit scope and requires its own design pass before implementation — flagged
here only as a placeholder so the future retrieval layer has an agreed home.
