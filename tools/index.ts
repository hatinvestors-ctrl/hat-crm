// tools — INTERFACE DEFINITIONS ONLY. No implementation. Nothing executes.
// Sprint 1.1 (HAT AI OS architecture correction) — see docs/architecture/HAT_AI_OS.md
//
// Defines the Capability vs Tool distinction requested in Sprint 1.1 review —
// see README.md for the full rationale and worked examples. No capability or
// tool defined here has a real implementation; no registry is populated.

/** Where a capability's actual logic lives — a capability is a named reference
 *  to something that already has its own home elsewhere in HAT AI OS, never
 *  code of its own. */
export type CapabilitySource =
  | { kind: 'core-engine'; engine: string }       // e.g. engine: 'financial-engine'
  | { kind: 'knowledge' }                          // future /knowledge retrieval layer
  | { kind: 'external-integration'; name: string } // e.g. name: 'rentcast'
  | { kind: 'future-engine'; name: string }        // e.g. name: 'distress-engine' (not yet built)

/**
 * A reusable business/system ability, described so it can be discovered and
 * reasoned about — not code itself. See README.md's "Capability vs Tool".
 */
export interface CapabilityDefinition {
  id: string                    // e.g. 'calculate-mao'
  description: string
  source: CapabilitySource
  readOnly: boolean
}

/** A registry of known capabilities. Interface only — no populated instance. */
export interface CapabilityRegistry {
  list(): CapabilityDefinition[]
  get(id: string): CapabilityDefinition | undefined
}

/**
 * An agent-accessible wrapper around a capability. This is what actually
 * appears in an Agent.tools array (see agents/README.md's Agent interface).
 * A Tool must reference exactly one CapabilityDefinition and must never
 * reimplement that capability's logic itself.
 */
export interface Tool {
  name: string                      // e.g. 'calculate_mao' — the agent-facing name
  capabilityId: string              // FK-style reference into CapabilityRegistry
  description: string
  /** JSON-schema-like description of expected arguments — shape intentionally
   *  loose in Sprint 1.1 since no concrete tool-calling contract exists yet. */
  argsSchema: Record<string, unknown>
  readOnly: boolean
  /** Whether invoking this tool requires the calling agent's humanReview gate
   *  to pass before any effect takes place. Must be true for every non-readOnly
   *  tool by default (see agents/README.md). */
  requiresHumanReview: boolean
}

/** A registry of known tools. Interface only — no populated instance, no
 *  execution path, no agent consumes this yet. */
export interface ToolRegistry {
  list(): Tool[]
  get(name: string): Tool | undefined
}

// No populated capabilities, tools, or registries in Sprint 1.1 — see README.md's
// worked-examples table for the capabilities/tools this is expected to eventually
// hold (calculate_mao, check_buybox, calculate_flip, calculate_brrrr,
// search_historical_deals, get_property_data, find_distress_signals).
