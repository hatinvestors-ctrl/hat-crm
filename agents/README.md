# /agents — Agent Platform (Documentation Only, Sprint 1)

## Status

**Documentation only. No agent code exists yet.** This README describes the future
Agent Platform interface so a real agent can be implemented in a later sprint
against an agreed contract. Full context: `docs/architecture/HAT_AI_OS.md` (Step 5)
and `documantation/HatCRM_NextGen_Architecture_Design.docx`.

## Purpose

**No true agents exist in HatCRM today.** Every "agent" reference in the current
codebase (the "Deal Analysis Agent" prompt persona in `analyze-deal.mjs`, the
`agents` database table) is either a prompt label or a human real-estate-agent
contact record — not an autonomous AI agent with a goal/tool-loop/stop-condition.
The closest working analog is `process-agent-sequences.mjs` (cron → safety-gauntlet
checks → one LLM call → draft → human approval), which is a hand-coded state
machine, not an agent loop, but its **draft → approve → send** discipline is the
best pattern in the current system and is what this interface generalizes rather
than replaces.

## Why interfaces now, agents later

Rather than build a generic agent abstraction speculatively, this document defines
the *interface* a future agent must satisfy so that when the first real agent is
built — almost certainly the Distress Review Agent inside the future Distressed
Lead Engine — it plugs into the AI Platform (`platform/ai`) and AI History
(`history/`) that already exist by then, instead of becoming a 16th bespoke
integration, repeating the exact duplication problem the rest of HAT AI OS exists
to stop.

## The Agent interface (design)

```ts
interface Agent<TInput, TOutput> {
  id: string
  goal: string                                  // human-readable, fixed per agent

  // Context is assembled via platform/ai/context-builder — an agent does not
  // fetch its own data ad hoc.
  context: (input: TInput) => Promise<Context>

  // Tools are explicit, typed, and allow-listed — NOT arbitrary code execution.
  // Each Tool (see tools/index.ts, added Sprint 1.1) wraps exactly one named
  // Capability (a /core engine function, /knowledge retrieval, or an external
  // integration) — a tool never reimplements a capability inline. See
  // tools/README.md's "Capability vs Tool" section for the full distinction.
  // Early tools are read-only (query a /core engine, query lead/comp history).
  // Any write tool (insert lead, send email, change status) requires
  // humanReview() to pass first — no exceptions in early implementations.
  tools: Tool[]

  // Memory is backed by history/ (ai_runs) plus any agent-specific state —
  // NOT ad hoc DB reads scattered through the agent's own logic.
  memory: AgentMemory

  // decision() is the one place an agent "thinks" — calls model-router with a
  // tool-enabled request, gets back either a tool call or a final answer.
  decision: (context: Context, priorSteps: AgentStep[]) => Promise<AgentDecision>

  // confidence() is a REQUIRED, separate signal from decision() — an agent must
  // say how sure it is, distinct from what it decided. No verdict anywhere in
  // the current codebase carries a confidence score; this makes it mandatory.
  confidence: (decision: AgentDecision) => number   // 0–1

  // stopCondition() bounds the loop — max steps, budget cap, or goal-satisfied
  // check. Every agent MUST define this; there is no default "run until done."
  stopCondition: (priorSteps: AgentStep[]) => boolean

  // humanReview() is not optional plumbing — it's first-class. Mirrors the
  // pattern that already works well today (send-approved-draft.mjs's
  // draft → approve → send gate, including its re-validated safety checks).
  humanReview: {
    required: boolean
    reviewer: 'kevin' | 'tomer' | 'any_workspace_member'
    onApprove: (decision: AgentDecision) => Promise<void>
    onReject: (decision: AgentDecision, reason: string) => Promise<void>
  }
}
```

## How a future agent plugs into the rest of HAT AI OS

- `context()` calls `platform/ai/context-builder` — an agent is a *consumer* of the
  platform, not a parallel integration.
- `decision()` calls `platform/ai/model-router`, which resolves model/settings from
  `config/ai.config.ts`'s `AgentTaskConfig` per agent `id` (including a
  `costCeilingUsd`, since a multi-step decision loop can multiply cost versus a
  single-shot call — see architecture doc Step 9, risk #8).
- Every `tools` entry that touches business numbers must be one of the `/core`
  engines — an agent is explicitly forbidden by this design from doing its own
  arithmetic; it can only call engines and interpret/act on their output.
- Every decision, confidence score, and human-review outcome becomes a row in
  `history/`'s `ai_runs` table — an agent's memory of its own past runs *is* that
  history, not a separate store, keeping agent behavior as auditable as single-shot
  calls.
- `humanReview.required = true` is the default for any agent whose tools include a
  write action, until the agent has a proven track record.

## First candidate agent (named for future planning only — not built)

The **Distress Review Agent**, part of the future Distressed Lead Engine
(`docs/architecture/HAT_AI_OS.md` Step 7): goal = "recommend triage priority for a
new distress signal," tools = [query `buybox-engine`, query `scoring-engine`, query
historical outcomes for this ZIP], memory = prior distress-signal reviews for the
same property/owner, `humanReview.required = true` always (Kevin's review queue) —
this design does not allow that agent to insert a lead or contact anyone
autonomously.

## What belongs here (once implemented)

- The `Agent` interface/type definitions and shared agent-runner plumbing.
- Concrete agent implementations, each satisfying the interface above.

## What must NEVER belong here

- Business calculations (agents call `/core` engines, never compute independently).
- Direct, unreviewed write actions — every write-capable tool routes through
  `humanReview` unless a future, explicit decision loosens that for a specific,
  proven agent.

## Sprint 1 / 1.1 status

Documentation only, as above. No agent runner, no concrete agent. As of Sprint 1.1,
`tools/index.ts` defines the `Tool`/`CapabilityDefinition`/registries this
interface's `tools: Tool[]` field refers to (see `tools/README.md`) — but no
registry is populated and nothing executes.
