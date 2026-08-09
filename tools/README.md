# /tools — Future Agent Tool Registry (Documentation Only, Sprint 1)

## Status

**Documentation only in Sprint 1. Sprint 1.1 adds interface-only type definitions
(`index.ts`) for the Capability/Tool concept below — nothing executes.**

## Purpose (future)

The Agent Platform interface (`agents/README.md`) defines every `Agent` as having
an explicit, typed, allow-listed `tools` array — deliberately **not** arbitrary
code execution. `/tools` is the anticipated future home for those tool
definitions: the actual typed wrappers an agent's `decision()` step is allowed to
call.

## Capability vs Tool (added Sprint 1.1)

Architecture review asked for these two concepts to be explicitly distinguished,
since conflating them was a latent risk in the Sprint 1 design (it would have been
easy to let "tool" mean both "a reusable ability" and "an agent-callable wrapper,"
blurring where reuse should happen).

- **Capability** = a reusable business/system ability that exists independent of
  any agent — almost always a thin, named reference to something that already has
  its own home elsewhere in HAT AI OS (a `/core` engine function, a `/knowledge`
  retrieval function, an external data integration). A capability is not itself
  code; it's the *concept* of "the system can do X," described so it can be
  discovered and reasoned about.

- **Tool** = an agent-accessible wrapper *around* a capability — the thing that
  actually appears in an `Agent.tools` array (see `agents/README.md`'s `Agent`
  interface). A tool adds whatever an agent-calling context needs on top of the
  capability (typed args/schema for tool-use, read-only vs write-capable
  classification, which triggers the `humanReview` gate) without reimplementing
  the capability itself.

**The rule this separation exists to enforce:** a tool must never reimplement a
capability inline. If a tool "calculates MAO," it must call
`core/financial-engine`'s `computeMao()` — the tool is a wrapper, not a second
implementation.

### Worked examples

| Tool name | Wraps capability in | Read or write |
|---|---|---|
| `calculate_mao` | `core/financial-engine` | read |
| `check_buybox` | `core/buybox-engine` | read |
| `calculate_flip` | `core/flip-engine` | read |
| `calculate_brrrr` | `core/brrrr-engine` | read |
| `search_historical_deals` | `/knowledge` (future retrieval layer) | read |
| `get_property_data` | external data integration (e.g. RentCast) | read |
| `find_distress_signals` | future distress engine (Step 7 of the architecture doc) | read |

No write-capable tool is defined in this initial set — every example above is
read-only, consistent with `agents/README.md`'s default posture that any
write-capable tool must be paired with the calling agent's `humanReview` gate.

## Responsibilities (future)

- Define one `CapabilityDefinition` per reusable ability, referencing where it
  actually lives (a `/core` engine, `/knowledge`, an external integration) rather
  than containing logic itself.
- Define one `Tool` per agent-accessible wrapper around a capability, with its
  typed argument schema and read/write classification.
- Provide the `CapabilityRegistry`/tool registry that `platform/ai/model-router`
  will consume when making a tool-enabled model call for an agent.

## What belongs here (once implemented)

- `CapabilityDefinition`/`Tool` type definitions and their registries (Sprint 1.1:
  now interface-only in `index.ts`, see below).
- Typed tool wrapper functions and their schemas (future — not yet implemented).

## What must NEVER belong here

- Business calculations inline inside a tool wrapper — a tool that "computes MAO"
  must call `core/financial-engine`, not reimplement the formula. This is the
  Capability/Tool distinction's entire purpose.
- Unrestricted/arbitrary execution capability of any kind.
- Any tool that performs an irreversible action (send email, change lead status,
  insert a record) without that action being gated by the calling agent's
  `humanReview.required` check.

## Sprint 1.1 status

`index.ts` contains `CapabilityDefinition`/`CapabilityRegistry`/`Tool` interface
definitions only. **No capability or tool actually executes** — there is no
implementation, no registry populated with real entries, and no agent to consume
any of this yet (see `agents/README.md`, also documentation-only).
