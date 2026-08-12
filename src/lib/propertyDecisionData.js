// src/lib/propertyDecisionData.js
// Capability #15.2 — canonical property-decision-data resolver.
//
// ROOT CAUSE FOUND (Section 12 of the mission): Capability #15.1's V2 read
// off-market property_type/bedrooms from `lead.enrichment_data.property_type`.
// That field is NEVER written by the live enrichment path
// (netlify/functions/batchdata-enrich.mjs) — confirmed by reading that
// file: its property-lookup result is null-safe merged into the TOP-LEVEL
// `leads.property_type` column (line ~315: `lead.property_type ||
// propertyFields.property_type || null`), never into
// `updatedEnrichmentData`. Only one older, one-off script
// (scripts/cap10_2_reprocess.mjs, Capability #10.2) ever wrote
// `enrichment_data.property_type` directly, for a single historical batch.
// So the "property type disappearing" bug wasn't data loss — it was V2
// reading the wrong (never-populated-by-the-real-pipeline) location. This
// resolver fixes that by making leads.* columns canonical and
// enrichment_data/distress_data explicit, documented fallbacks.
//
// This module NEVER writes to Supabase. It only resolves a read-time view.
// Write-side null-safety (Section 5/13) is enforced separately, in
// mergePropertyFields() below, reused by netlify/functions/batchdata-enrich.mjs.

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v))
const str = (v) => (v === null || v === undefined || v === '' ? null : String(v).trim())

// ── Field-level source map (Section 2) ───────────────────────────────────
// field: [ {source, path, confidence} ] in PRECEDENCE ORDER (first = wins).
// Precedence rationale (Section 4), grounded in what the real architecture
// actually supports today — not an invented hierarchy:
//   1. leads.<column>        — the one place a human can manually correct
//                               a field (LeadForm/FinancialSection editable
//                               fields) AND the one place BatchData's
//                               null-safe merge already writes to. Highest
//                               trust: it's both human-correctable and the
//                               live pipeline's real target.
//   2. enrichment_data.<key> — Duval/statewide cadastral snapshot
//                               (property identity resolution) for
//                               off-market leads; also the one-off #10.2
//                               backfill's target for older leads. Real
//                               data, but not human-editable and not the
//                               live BatchData target — a legitimate but
//                               secondary source.
//   3. distress_data.<key>   — off-market distress-specific fields only
//                               (never property characteristics beyond
//                               what off-market ingestion captured at
//                               discovery time — lowest confidence for
//                               characteristics specifically).
const FIELD_SOURCES = {
  property_type: [
    { source: 'leads', path: 'property_type', confidence: 'HIGH' },
    { source: 'enrichment_data', path: 'property_type', confidence: 'MEDIUM' },
  ],
  bedrooms: [
    { source: 'leads', path: 'bedrooms', confidence: 'HIGH' },
    { source: 'enrichment_data', path: 'bedrooms', confidence: 'MEDIUM' },
  ],
  bathrooms: [
    { source: 'leads', path: 'bathrooms', confidence: 'HIGH' },
    { source: 'enrichment_data', path: 'bathrooms', confidence: 'MEDIUM' },
  ],
  sqft: [
    { source: 'leads', path: 'sqft', confidence: 'HIGH' },
    { source: 'enrichment_data', path: 'living_area', confidence: 'MEDIUM' },
  ],
  year_built: [
    { source: 'leads', path: 'year_built', confidence: 'HIGH' },
    { source: 'enrichment_data', path: 'year_built', confidence: 'MEDIUM' },
  ],
  lot_size: [
    { source: 'leads', path: 'lot_size_sqft', confidence: 'HIGH' },
  ],
  zip: [
    { source: 'leads', path: 'zip_code', confidence: 'HIGH' },
    { source: 'enrichment_data', path: 'zip_code', confidence: 'MEDIUM' },
  ],
  parcel: [
    { source: 'enrichment_data', path: 'parcel_id', confidence: 'HIGH' }, // no leads.parcel column exists
  ],
  asking_price: [{ source: 'leads', path: 'asking_price', confidence: 'HIGH' }],
  arv: [{ source: 'leads', path: 'arv', confidence: 'HIGH' }],
  renovation: [{ source: 'leads', path: 'renovation_cost', confidence: 'HIGH' }],
  rent: [{ source: 'leads', path: 'rent_estimate', confidence: 'HIGH' }],
  owner: [
    { source: 'leads', path: 'owner_name', confidence: 'HIGH' },
    { source: 'enrichment_data', path: 'owner_name', confidence: 'MEDIUM' },
    { source: 'distress_data', path: 'current_owner', confidence: 'LOW' },
  ],
  owner_mailing_address: [
    { source: 'leads', path: 'owner_mailing_address', confidence: 'HIGH' },
    { source: 'enrichment_data', path: 'owner_mailing_address', confidence: 'MEDIUM' },
  ],
}

function readPath(lead, source, path) {
  const bag = source === 'leads' ? lead : lead?.[source]
  if (!bag) return null
  return bag[path] ?? null
}

function resolveField(lead, field) {
  const chain = FIELD_SOURCES[field]
  const seen = []
  let winner = null
  for (const { source, path, confidence } of chain) {
    const raw = readPath(lead, source, path)
    if (raw !== null && raw !== undefined && raw !== '') {
      seen.push({ source, path, value: raw, confidence })
      if (!winner) winner = { source, path, value: raw, confidence }
    }
  }
  const conflicts = []
  if (winner && seen.length > 1) {
    for (const s of seen.slice(1)) {
      if (String(s.value).trim().toLowerCase() !== String(winner.value).trim().toLowerCase()) {
        conflicts.push({ field, winning_value: winner.value, other_value: s.value, other_source: s.source })
      }
    }
  }
  return {
    value: winner?.value ?? null,
    provenance: winner ? { source: winner.source, path: winner.path, confidence: winner.confidence } : { source: null, path: null, confidence: 'NONE' },
    conflicts,
  }
}

/**
 * THE canonical read-time property-decision-data resolver (Section 3).
 * V2 (and Buy Box) should call this instead of independently poking at
 * leads columns / enrichment_data / distress_data.
 * @param {object} lead - a full leads row (as returned by Supabase select('*'))
 * @returns {object} normalized decision data with provenance/missing/conflicts
 */
export function getPropertyDecisionData(lead) {
  const fields = {}
  const provenance = {}
  const missing = []
  const conflicts = []

  for (const field of Object.keys(FIELD_SOURCES)) {
    const { value, provenance: prov, conflicts: fieldConflicts } = resolveField(lead, field)
    fields[field] = value
    provenance[field] = prov
    if (value === null) missing.push(field)
    conflicts.push(...fieldConflicts)
  }

  return {
    address: str(lead?.address),
    unit: str(lead?.enrichment_data?.identity_unit_used) || null,
    city: str(lead?.city),
    state: str(lead?.state),
    zip: fields.zip,
    property_type: fields.property_type,
    bedrooms: num(fields.bedrooms),
    bathrooms: num(fields.bathrooms),
    sqft: num(fields.sqft),
    year_built: num(fields.year_built),
    lot_size: num(fields.lot_size),
    parcel: fields.parcel,
    asking_price: num(fields.asking_price),
    arv: num(fields.arv),
    renovation: num(fields.renovation),
    rent: num(fields.rent),
    owner: fields.owner,
    owner_mailing_address: fields.owner_mailing_address,
    provenance,
    missing,
    conflicts,
  }
}

// ══════════════════════════════════════════════════════════════════════
// WRITE-SIDE null-safe merge (Section 5/13) — reusable by any enrichment
// write path. Existing non-null value always wins over an incoming null;
// an incoming non-null value only overwrites an existing non-null value
// when the caller explicitly allows overwrite (default: no), otherwise
// the disagreement is recorded as a conflict instead of silently applied.
// ══════════════════════════════════════════════════════════════════════
export function mergePropertyFields(existing, incoming, { allowOverwrite = false, source = 'unknown' } = {}) {
  const merged = { ...existing }
  const conflicts = []
  for (const [key, incomingValue] of Object.entries(incoming)) {
    const existingValue = existing?.[key]
    const hasExisting = existingValue !== null && existingValue !== undefined && existingValue !== ''
    const hasIncoming = incomingValue !== null && incomingValue !== undefined && incomingValue !== ''

    if (!hasIncoming) continue // null/blank incoming NEVER overwrites — Section 5's hard rule
    if (!hasExisting) { merged[key] = incomingValue; continue } // nothing to protect, safe to fill in

    // Both have a value.
    if (String(existingValue).trim().toLowerCase() === String(incomingValue).trim().toLowerCase()) continue // same value, no-op
    if (allowOverwrite) {
      merged[key] = incomingValue
    }
    conflicts.push({ field: key, existing_value: existingValue, incoming_value: incomingValue, incoming_source: source, applied: allowOverwrite })
  }
  return { merged, conflicts }
}
