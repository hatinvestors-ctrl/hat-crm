# model-router

## Purpose

Single place that resolves `taskId → model / max_tokens / temperature / timeout`
from `config/ai.config.ts`, and executes the actual Anthropic API call — replacing
today's pattern where all ~15 Netlify functions independently hard-code
`'claude-haiku-4-5-20251001'` and their own settings.

## Responsibilities

- Resolve model/settings per task from config, not literals.
- Execute the API call (the one place `fetch('https://api.anthropic.com/...')`
  should eventually live).
- Support fallback routing (e.g. retry on a different model on timeout) — not
  present anywhere in the codebase today.
- Enforce per-task/per-agent cost ceilings (from `config/ai.config.ts`'s
  `AgentTaskConfig.costCeilingUsd`).

## What belongs here

- Model/provider resolution and the outbound API call itself.

## What must NEVER belong here

- Prompt construction (that's `prompt-builder`'s job — Model Router receives a
  already-built `BuiltPrompt`).
- Output parsing/validation (that's `validators`'s job).
- Business logic of any kind.

## Sprint 1 status

`index.ts` contains interface definitions only. No implementation. **No existing
function's Anthropic API call has been touched** — every `netlify/functions/*.mjs`
file continues to call `fetch()` directly, exactly as today.
