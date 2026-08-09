# /platform — Shared Runtime Platform

## Purpose

`/platform` is the future home of shared runtime infrastructure that sits between
the application's entry points (Netlify functions, and eventually agents) and both
the deterministic `/core` engines and the Anthropic API. Sprint 1 establishes only
the `ai/` subtree; other platform concerns (if any emerge) would be siblings here.

## Responsibilities

- House the AI Platform pipeline (`ai/`) — the layer every AI-calling function will
  eventually go through instead of independently building prompts and calling
  `fetch('https://api.anthropic.com/...')` (as all ~15 Netlify functions do today).

## What belongs here

- Runtime orchestration code that is shared across multiple functions/agents.
- No business logic (that's `/core`) and no business constants (that's `/config`).

## What must NEVER belong here

- Deterministic calculations — those live in `/core`, platform code only calls them.
- Business constants — those live in `/config`, platform code only reads them.
- Prompt *content* specific to one task (e.g. the Deal Score rubric prompt text) —
  that stays with the task until Prompt Builder (see `ai/prompt-builder/README.md`)
  formally owns templated prompt construction.

## Sprint 1 status

Interfaces only, no implementation, nothing wired into the running application.
See `ai/README.md` for the full pipeline design.
