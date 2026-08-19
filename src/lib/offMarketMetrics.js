// src/lib/offMarketMetrics.js
// Off-Market Dashboard Manager — pure aggregation logic, extracted from
// OffMarketEnginePage.jsx so it's independently testable without a
// browser/DB. Never reimplements distress scoring, buy-box, or contact
// readiness — every classification below delegates to the existing
// canonical functions (distressInfo.js / distressScoring.js /
// contactEnrichment.js). This module only counts/groups their output.
import { getDistressInfo, getOpportunityInfo } from './distressInfo.js'
import { isContactReady } from './contactEnrichment.js'

// Part 28 — documented KPI definitions, kept next to the code that
// computes them.
export const KPI_DEFINITIONS = {
  offMarketLeads: 'Leads currently in the CRM that are flagged distressed/off-market (is_distressed, lead_source=off_market, or the pilot\'s notes marker) — the live pipeline state, not a single ingestion run.',
  buyBoxFit: 'Leads whose stored buy_box_fit (HAT\'s existing buy-box logic, computed at enrichment time) is FIT.',
  enriched: 'Leads with any enrichment_data recorded — a property/owner enrichment attempt has been made.',
  contactReady: 'Leads with at least one usable phone or email on file (isContactReady() — the same definition Action Center uses).',
  highPriority: 'Leads whose stored Opportunity Score priority tier is HIGH_PRIORITY (score >= 80) — HAT\'s existing scoring, not a new threshold.',
}

// Part 29 — "Unique Properties", not "Source Records". Each `leads` row
// is already one property identity in this schema (confirmed: no
// separate per-source lead records exist for the same property — a
// property with multiple distress filings still has exactly one leads
// row, with distress_category reflecting whichever filing was
// classified). This function counts unique lead IDs, never fans a
// property out across its distress signals.
export function dedupeByLeadId(leads) {
  const seen = new Set()
  const out = []
  for (const l of leads) {
    if (!l?.id || seen.has(l.id)) continue
    seen.add(l.id)
    out.push(l)
  }
  return out
}

// Enriches each lead with its distress/opportunity info once, so callers
// never re-derive it per filter/KPI.
export function annotate(leads) {
  return dedupeByLeadId(leads).map(lead => ({
    lead,
    info: getDistressInfo(lead),
    opp: getOpportunityInfo(lead),
  }))
}

// A lead whose category isn't one of the checkbox-filterable categories
// (e.g. UNKNOWN, or no category at all) always stays visible — there's no
// checkbox that could exclude it, so an empty `sourceFilter` selection
// never silently hides it.
export function filterBySource(annotated, sourceFilter, knownCategories) {
  return annotated.filter(({ opp }) => {
    const cat = opp?.distress_category
    if (!cat) return true
    if (knownCategories && !knownCategories.has(cat)) return true
    return sourceFilter.has(cat)
  })
}

export function computeFunnel(annotated) {
  const offMarketLeads = annotated.length
  const buyBoxFit = annotated.filter(({ opp }) => opp?.buy_box_fit === 'FIT').length
  const enrichedCount = annotated.filter(({ lead }) => lead.enrichment_data && Object.keys(lead.enrichment_data).length > 0).length
  const contactReady = annotated.filter(({ lead }) => isContactReady(lead)).length
  const highPriority = annotated.filter(({ opp }) => opp?.opportunity_priority?.key === 'HIGH_PRIORITY').length
  return { offMarketLeads, buyBoxFit, enrichedCount, contactReady, highPriority }
}

export function applyViewFilter(annotated, viewFilter) {
  switch (viewFilter) {
    case 'HIGH_PRIORITY': return annotated.filter(({ opp }) => opp?.opportunity_priority?.key === 'HIGH_PRIORITY')
    case 'CONTACT_READY': return annotated.filter(({ lead }) => isContactReady(lead))
    case 'BUY_BOX_MATCH': return annotated.filter(({ opp }) => opp?.buy_box_fit === 'FIT')
    case 'NEEDS_ENRICHMENT': return annotated.filter(({ lead }) => !(lead.enrichment_data && Object.keys(lead.enrichment_data).length > 0))
    default: return annotated
  }
}
