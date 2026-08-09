# /core — Deterministic Calculation Engines

## Purpose

`/core` is the future home of **every deterministic business calculation** in HatCRM —
MAO, flip profit, BRRRR cash flow, negotiation anchors, rehab budgets, deal scores,
buy-box eligibility. Today (pre-Sprint-1) these calculations live duplicated inline
inside ~15 Netlify functions in `netlify/functions/*.mjs`, which is why the same
formula (e.g. MAO, selling costs) currently produces different answers depending on
which endpoint runs it. See `docs/architecture/HAT_AI_OS.md` and
`documantation/HatCRM_NextGen_Architecture_Design.docx` (Step 1) for the full inventory
of duplication this folder exists to resolve.

## Responsibilities

- Own the single, canonical implementation of every dollar figure, score, and
  threshold decision used anywhere in the app.
- Be pure, deterministic, and side-effect-free: `(inputs, config) → result`.
- Be fully unit-testable in isolation, with no network/DB/AI calls.
- Be the only thing `/platform/ai` and future `/agents` are allowed to call for
  business arithmetic — AI never calculates business numbers, it only interprets
  engine output (see `docs/architecture/HAT_AI_OS.md` for the enforced boundary).

## What belongs here

- Pure calculation functions and their type signatures (inputs/outputs).
- Engine-specific interfaces describing what an engine consumes and returns.
- Unit tests (once implementation begins) run against real historical deals in
  `deal_financials`.

## What must NEVER belong here

- Anthropic/Claude API calls, or any LLM call of any kind.
- Prompt text or prompt construction logic (that belongs in `/platform/ai/prompt-builder`).
- Database reads/writes (engines take plain inputs, they don't fetch their own data —
  that's `/platform/ai/context-builder`'s job).
- Hard-coded business constants (ZIP bands, rates, thresholds) — those live in
  `/config` and are passed in as a parameter, never inlined.
- UI/formatting concerns (currency formatting, display strings) — engines return
  typed numbers/objects, not display-ready text.

## Sprint 1 status

Every subfolder currently contains **interface definitions only** (`index.ts`), no
implementation. Nothing here is imported by the running application yet — the
existing `netlify/functions/*.mjs` and `src/lib/calculations.js` continue to be the
live, authoritative calculation code until a future migration sprint explicitly
switches a function over (see the Migration Strategy, Step 8, in the architecture doc).

## Subfolders

| Folder | Owns |
|---|---|
| `financial-engine/` | MAO, HML loan costs, closing costs, holding costs, all-in cost |
| `flip-engine/` | Sale proceeds, net flip profit, ROI, annualized ROI |
| `brrrr-engine/` | Refinance math, cash-left-in, cash flow, cash-on-cash return |
| `negotiation-engine/` | Starting offer / target price / walk-away anchor, motivation scoring |
| `rehab-engine/` | Renovation budget bracketing, max-reno-for-strategy solving |
| `scoring-engine/` | Deal Score rubric evaluation, verdict determination |
| `buybox-engine/` | ZIP eligibility, property-type filter, financial sense-check |
