# logging

## Purpose

Writes the request/response/cost/latency/validation record for every AI Platform
call to the future `ai_runs` table (see `history/README.md`). Today, none of this
is recorded anywhere except ephemeral `console.log` statements — this is flagged in
the architecture doc as the single highest-leverage, lowest-effort gap in the
current system.

## Responsibilities

- Write one row *before* the model call (request metadata) so even a
  timeout/failure is recorded.
- Update that row with response/tokens/cost/latency/validation status after the
  call completes.
- Never block or slow down the response path on logging failure — logging is
  best-effort and asynchronous where possible.

## What belongs here

- The write path to `ai_runs` (schema defined in `history/README.md`).

## What must NEVER belong here

- Any business logic or calculation.
- Reading history back for use in a new prompt — that is exclusively `memory`'s
  job. **Sprint 1.1 correction**: `logging` and `memory` are two separate,
  independent paths against `history/`'s `ai_runs` table — `logging` is the write
  path (this module, runs after a call), `memory` is the read path (runs before a
  call, feeding `context-builder`). Neither module calls into the other; see
  `platform/ai/README.md`'s corrected two-path diagram and
  `history/README.md`'s "Read Path vs Write Path" section.

## Sprint 1 status

`index.ts` contains interface definitions only. No implementation. No `ai_runs`
table exists yet — see `history/README.md` for the schema this will eventually
write to.
