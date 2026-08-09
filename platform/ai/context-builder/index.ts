// platform/ai/context-builder — INTERFACE DEFINITIONS ONLY. No implementation.
// Sprint 1 (HAT AI OS foundation) — see docs/architecture/HAT_AI_OS.md
//
// Sprint 1.1 correction: Context previously typed its domain fields as
// `Record<string, unknown> | null`, which architecture review flagged as
// unsuitable to stand as a permanent contract. This version introduces typed
// domain placeholders (LeadContext, PropertyContext, FinancialContext,
// MarketContext, HistoricalContext, AiHistoryContext) so the design clearly
// points toward typed domain objects. Every field below is OPTIONAL and every
// object is intentionally partial — the authoritative `leads`/`deal_financials`/
// etc. schema has not been formally migrated into TypeScript yet (the current
// production schema is only inferable from column references in
// netlify/functions/*.mjs — see the AI Architecture Report §8/§23 "Questions/
// Unknown Areas"). Fields below are limited to columns this project's own
// scaffold documents already cite by name (e.g. in core/*/README.md and
// config/*.config.ts comments); nothing here invents a field that cannot be
// traced to something already referenced elsewhere in this codebase or its
// architecture documentation.

/** Fields describing the lead/deal record itself. Partial and provisional —
 *  see file header. Field names are the ones already referenced throughout
 *  core/financial-engine, core/negotiation-engine, and the architecture docs
 *  (e.g. HatCRM_NextGen_Architecture_Design.docx Step 1). */
export interface LeadContext {
  leadId: string
  address?: string
  zipCode?: string
  city?: string
  state?: string
  status?: string
  askingPrice?: number
  arv?: number
  renovationCost?: number | null
  mao?: number
  rentEstimate?: number
  daysOnMarket?: number | null
  priceDropPct?: number | null
  competitiveMode?: boolean
  notes?: string
  teamComments?: string
}

/** Physical property attributes, kept separate from deal/financial fields so a
 *  future property-data integration (e.g. RentCast, MLS) can populate this
 *  independently of the lead's deal-specific fields. */
export interface PropertyContext {
  bedrooms?: number
  bathrooms?: number
  sqft?: number
  propertyType?: string
  yearBuilt?: number
  lotSizeSqft?: number
  hasGarage?: boolean
  mlsStatus?: string
}

/** Deal-financial-record fields, mirroring the `deal_financials` table's
 *  documented columns (see core/financial-engine/README.md and
 *  core/flip-engine/README.md). Populated only for leads that have an
 *  associated deal_financials row. */
export interface FinancialContext {
  dealFinancialsId?: string
  holdMonths?: number
  sellingCostPct?: number
  actualSalePrice?: number | null
  soldDate?: string | null
}

/** Resolved market/config data for this lead's ZIP — the typed shape Context
 *  Builder assembles by resolving /config for the lead's market, replacing
 *  Sprint 1's untyped `resolvedConfig` bag. */
export interface MarketContext {
  zipCode?: string
  market?: string
  configVersion?: string   // ties to config/config-metadata.ts's ConfigMetadata
}

/** Historical comps context — same shape/intent as Sprint 1's HistoricalComp,
 *  promoted here as the canonical per-Context historical bundle. Distinguishes
 *  outcome-verified deals from unverified prior AI narrative (see
 *  knowledge/README.md's trust-policy rationale). */
export interface HistoricalContext {
  comps: HistoricalComp[]
}

export interface HistoricalComp {
  leadId: string
  address: string
  zipCode: string
  summary: Record<string, unknown>   // deliberately loose — a comp's summary
                                       // shape varies per source and is display
                                       // data, not a typed domain object
  outcomeVerified: boolean
}

/** Prior AI runs relevant to this context — populated once history/ (ai_runs)
 *  exists; see platform/ai/memory. */
export interface AiHistoryContext {
  priorRuns: PriorAiRun[]
}

export interface PriorAiRun {
  runId: string
  taskId: string
  timestamp: string
  outputSummary: Record<string, unknown>   // deliberately loose — output shape
                                             // is task-specific; see history/README.md
}

export interface ContextRequest {
  taskId: string
  leadId?: string
  agentId?: string
  workspaceId: string
}

/** The single typed object every downstream pipeline stage consumes. Composed
 *  of the typed domain contexts above rather than generic dictionaries. */
export interface Context {
  taskId: string
  lead: LeadContext | null
  property: PropertyContext | null
  financial: FinancialContext | null
  market: MarketContext | null
  historical: HistoricalContext
  aiHistory: AiHistoryContext
}

/**
 * Assembles a Context object for a given task/lead/agent.
 * NOT IMPLEMENTED — Sprint 1 defines the contract only.
 */
export declare function buildContext(request: ContextRequest): Promise<Context>
