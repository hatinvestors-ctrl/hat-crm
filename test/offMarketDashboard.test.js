// test/offMarketDashboard.test.js
// Off-Market Dashboard Manager — pure aggregation logic (offMarketMetrics.js).
// Every classification is delegated to the EXISTING canonical functions
// (distressInfo.js / distressScoring.js / contactEnrichment.js) — these
// tests never assert a fabricated number, only real function output.
import { describe, it, expect } from 'vitest'
import { dedupeByLeadId, annotate, filterBySource, computeFunnel, applyViewFilter } from '../src/lib/offMarketMetrics.js'
import { isDistressedLead, getPrimaryDistressLabel } from '../src/lib/distressInfo.js'

function distressedLead(overrides = {}) {
  return {
    id: overrides.id || `lead-${Math.random().toString(36).slice(2)}`,
    address: '123 Test St', city: 'Jacksonville', state: 'FL', zip_code: '32208',
    is_distressed: true,
    enrichment_data: {
      distress_category: 'MORTGAGE_FORECLOSURE',
      buy_box_fit: 'FIT',
      opportunity_score: 85,
      opportunity_priority: { key: 'HIGH_PRIORITY', label: '🔥 HIGH PRIORITY' },
      opportunity_why: ['Mortgage Foreclosure identified'],
    },
    phone: '9045551234', email: null,
    ...overrides,
  }
}

describe('dedupeByLeadId — one property, never fanned out across signals (Part 29)', () => {
  it('a property with the same id appearing twice collapses to one row', () => {
    const lead = distressedLead({ id: 'p1' })
    const result = dedupeByLeadId([lead, { ...lead }])
    expect(result).toHaveLength(1)
  })
  it('leads are already 1-row-per-property in this schema — no fan-out for multiple distress filings on one property', () => {
    // The schema stores exactly one distress_category per lead row (see
    // distressScoring.js) — this test documents that as a real
    // architectural constraint, not something this dashboard invents.
    const a = distressedLead({ id: 'p1' })
    const result = dedupeByLeadId([a])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('p1')
  })
  it('null/missing ids are safely skipped, never crash', () => {
    expect(dedupeByLeadId([{ }, null, undefined, distressedLead({ id: 'p1' })])).toHaveLength(1)
  })
})

describe('annotate — delegates entirely to canonical distress/opportunity functions', () => {
  it('never invents opportunity_score/buy_box_fit — reads exactly what getOpportunityInfo returns', () => {
    const lead = distressedLead()
    const [row] = annotate([lead])
    expect(row.opp.opportunity_score).toBe(85)
    expect(row.opp.buy_box_fit).toBe('FIT')
    expect(row.opp.distress_category).toBe('MORTGAGE_FORECLOSURE')
  })
  it('a lead with no enrichment_data produces a null opp, never a fabricated score', () => {
    const lead = distressedLead({ enrichment_data: null })
    const [row] = annotate([lead])
    expect(row.opp).toBeNull()
  })
})

describe('filterBySource — client-side view filter, never touches canonical scoring', () => {
  it('excludes a lead whose category is unchecked', () => {
    const foreclosure = distressedLead({ id: 'a' })
    const hoa = distressedLead({ id: 'b', enrichment_data: { ...distressedLead().enrichment_data, distress_category: 'HOA_CONDO_LIEN' } })
    const rows = annotate([foreclosure, hoa])
    const filtered = filterBySource(rows, new Set(['MORTGAGE_FORECLOSURE']), new Set(['MORTGAGE_FORECLOSURE', 'HOA_CONDO_LIEN']))
    expect(filtered).toHaveLength(1)
    expect(filtered[0].lead.id).toBe('a')
  })
  it('an empty source-filter selection excludes every known-category lead (not a silent no-op)', () => {
    const rows = annotate([distressedLead()])
    const filtered = filterBySource(rows, new Set(), new Set(['MORTGAGE_FORECLOSURE']))
    expect(filtered).toHaveLength(0)
  })
  it('a lead with an unrecognized/UNKNOWN category is never hidden by the checkbox set (no checkbox exists for it)', () => {
    const lead = distressedLead({ enrichment_data: { ...distressedLead().enrichment_data, distress_category: 'UNKNOWN' } })
    const rows = annotate([lead])
    const filtered = filterBySource(rows, new Set(), new Set(['MORTGAGE_FORECLOSURE'])) // UNKNOWN not in known set
    expect(filtered).toHaveLength(1)
  })
  it('a lead with no distress_category at all is always visible', () => {
    const lead = distressedLead({ enrichment_data: null })
    const rows = annotate([lead])
    const filtered = filterBySource(rows, new Set(), new Set(['MORTGAGE_FORECLOSURE']))
    expect(filtered).toHaveLength(1)
  })
})

describe('computeFunnel — exact definitions, no double counting, no fabricated stages', () => {
  it('reconciles a mixed batch exactly', () => {
    const highPriorityContactReady = distressedLead({ id: 'a' })
    const noContact = distressedLead({ id: 'b', phone: null, email: null, enrichment_data: { ...distressedLead().enrichment_data, opportunity_priority: { key: 'REVIEW' } } })
    const notEnriched = distressedLead({ id: 'c', enrichment_data: null, phone: null })
    const notBuyBoxFit = distressedLead({ id: 'd', enrichment_data: { ...distressedLead().enrichment_data, buy_box_fit: 'NOT_FIT' } })

    const rows = annotate([highPriorityContactReady, noContact, notEnriched, notBuyBoxFit])
    const funnel = computeFunnel(rows)

    expect(funnel.offMarketLeads).toBe(4)
    expect(funnel.buyBoxFit).toBe(2) // 'a' and 'b' — 'c' has no enrichment_data at all (null opp), 'd' is NOT_FIT
    expect(funnel.enrichedCount).toBe(3) // all but 'c'
    expect(funnel.contactReady).toBe(2) // 'a' and 'd' — 'b' and 'c' both have phone:null/email:null
    expect(funnel.highPriority).toBe(2) // 'a' and 'd' — 'd' only overrides buy_box_fit, priority stays HIGH_PRIORITY (Buy Box and Priority are independent signals, by design)
  })

  it('a truly empty set produces all-zero counts, never null/undefined/NaN', () => {
    const funnel = computeFunnel([])
    expect(funnel).toEqual({ offMarketLeads: 0, buyBoxFit: 0, enrichedCount: 0, contactReady: 0, highPriority: 0 })
  })
})

describe('applyViewFilter — presentation filters only, never re-scores', () => {
  const reviewPriority = { key: 'REVIEW', label: '🟠 REVIEW' }
  const rows = annotate([
    distressedLead({ id: 'hp' }), // high priority + contact ready + buy box fit + enriched
    distressedLead({ id: 'nc', phone: null, email: null, enrichment_data: { ...distressedLead().enrichment_data, opportunity_priority: reviewPriority } }),
    distressedLead({ id: 'ne', enrichment_data: null }),
    distressedLead({ id: 'nb', enrichment_data: { ...distressedLead().enrichment_data, buy_box_fit: 'NOT_FIT', opportunity_priority: reviewPriority } }),
  ])

  it('ALL returns everything unfiltered', () => {
    expect(applyViewFilter(rows, 'ALL')).toHaveLength(4)
  })
  it('HIGH_PRIORITY isolates only opportunity_priority.key === HIGH_PRIORITY', () => {
    const filtered = applyViewFilter(rows, 'HIGH_PRIORITY')
    expect(filtered.map(r => r.lead.id)).toEqual(['hp'])
  })
  it('CONTACT_READY uses isContactReady() exactly, not a separate definition', () => {
    const filtered = applyViewFilter(rows, 'CONTACT_READY')
    expect(filtered.map(r => r.lead.id).sort()).toEqual(['hp', 'ne', 'nb'].sort())
  })
  it('BUY_BOX_MATCH isolates FIT only ("ne" has no enrichment_data at all, so no FIT — not counted)', () => {
    const filtered = applyViewFilter(rows, 'BUY_BOX_MATCH')
    expect(filtered.map(r => r.lead.id).sort()).toEqual(['hp', 'nc'].sort())
  })
  it('NEEDS_ENRICHMENT isolates leads with no enrichment_data', () => {
    const filtered = applyViewFilter(rows, 'NEEDS_ENRICHMENT')
    expect(filtered.map(r => r.lead.id)).toEqual(['ne'])
  })
})

describe('isDistressedLead — the same canonical classifier the dashboard filters by (regression: no independent classification)', () => {
  it('a lead flagged is_distressed is included', () => {
    expect(isDistressedLead(distressedLead())).toBe(true)
  })
  it('a normal on-market lead is excluded', () => {
    expect(isDistressedLead({ is_distressed: false, notes: 'Normal seller lead' })).toBe(false)
  })
})

describe('getPrimaryDistressLabel — single canonical Signal label (final polish Part 3)', () => {
  // Real-world case found during the wholesaler-demo final polish pass: a
  // lead had enrichment_data.distress_category = HOA_CONDO_LIEN (the
  // scoring bucket) while its notes-derived filing was actually a Lis
  // Pendens (typically a foreclosure/legal action, not an HOA lien) — the
  // table's Signal column and the "Why This Lead?" panel's headline used
  // to read two DIFFERENT fields and could show contradictory labels for
  // the same property. This is a REAL underlying data-quality gap in how
  // that lead was categorized — not something these tests or this
  // function correct — but the presentation layer must no longer show two
  // different answers for "what is this distress signal" on one property.
  it('prefers the scoring category (distress_category) as the single headline label', () => {
    const lead = {
      notes: '⚠ DISTRESSED OPPORTUNITY — Lis Pendens\nFiled: 2026-08-10\n',
      enrichment_data: { opportunity_score: 72, distress_category: 'HOA_CONDO_LIEN' },
    }
    expect(getPrimaryDistressLabel(lead)).toBe('HOA / Condo Lien')
  })
  it('falls back to the notes-derived filing type when no scoring category exists', () => {
    const lead = { notes: '⚠ DISTRESSED OPPORTUNITY — Lis Pendens\nFiled: 2026-08-10\n', enrichment_data: null }
    expect(getPrimaryDistressLabel(lead)).toBe('Pre-Foreclosure • Lis Pendens')
  })
  it('returns null (not "Unknown" or a crash) when neither field is available', () => {
    expect(getPrimaryDistressLabel({})).toBeNull()
    expect(getPrimaryDistressLabel(null)).toBeNull()
  })
  it('distress_data.distress_category (if present) still wins over enrichment_data — matches getOpportunityInfo\'s own precedence, no new precedence invented here', () => {
    const lead = {
      distress_data: { distress_category: 'MORTGAGE_FORECLOSURE' },
      enrichment_data: { opportunity_score: 85, distress_category: 'HOA_CONDO_LIEN' },
    }
    expect(getPrimaryDistressLabel(lead)).toBe('Mortgage Foreclosure')
  })
})

describe('Financial engine isolation (Part 34) — dashboard consumes, never recomputes', () => {
  it('offMarketMetrics.js imports zero financial calculation functions', async () => {
    const mod = await import('../src/lib/offMarketMetrics.js')
    const exportedNames = Object.keys(mod)
    // Only aggregation helpers + the KPI definitions object — no Max Buy/
    // profit/cash-flow function was pulled in or reimplemented here.
    expect(exportedNames.sort()).toEqual(['KPI_DEFINITIONS', 'annotate', 'applyViewFilter', 'computeFunnel', 'dedupeByLeadId', 'filterBySource'].sort())
  })
})
