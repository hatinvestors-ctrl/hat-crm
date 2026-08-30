// src/lib/underwritingSettings.js
// Underwriting Configuration V1 — the ONE authoritative definition of
// configurable underwriting defaults, and the ONE resolver every
// consumer (Deal page, server functions) must go through.
//
// SAFETY CONTRACT (Part 1/3): every default value below is EXACTLY
// today's existing hardcoded literal from src/lib/calculations.js and
// the Netlify server functions — copied, not recalculated, not
// "improved." When workspace.settings.underwriting is absent or a given
// field is missing/malformed, the resolver falls back to these exact
// values, so a lead with no configured settings behaves byte-identically
// to before this capability existed (verified against the Woodleigh
// golden case — see test/underwritingSettings.test.js).
//
// Resolver contract: `configured ?? DEFAULT`, NEVER `configured ||
// DEFAULT` — a real, deliberately-configured 0 (e.g. 0% selling costs)
// must survive. This is the same class of bug the prior forensic QA
// found in hold_months (`lead.hold_months || 6`), fixed narrowly and
// separately in calculations.js (see resolveHoldMonths below).

// ── Canonical current defaults — DO NOT CHANGE THESE NUMBERS ────────────
// Copied verbatim from src/lib/calculations.js's existing literals.
export const DEFAULT_UNDERWRITING_SETTINGS = {
  // Shared / acquisition
  default_holding_months: 6,
  monthly_taxes: 208,
  monthly_insurance: 100,
  acquisition_closing_costs: 2450,
  hml_purchase_financing_pct: 90,   // % of purchase price financed
  hml_rehab_financing_pct: 100,     // % of rehab financed
  hml_interest_monthly_pct: 1.0,    // %/month (12%/year)
  hml_points_pct: 2.0,              // % of HML loan
  // Flip
  flip_selling_cost_pct: 7.0,       // % of ARV
  // BRRRR
  refi_ltv_pct: 70,                 // % of ARV
  refi_interest_rate_pct: 6.7,      // % annual
  refi_amort_years: 30,
  refi_costs_pct: 3.0,              // % of refi loan
}

// Field metadata — validation bounds are deliberately conservative
// mathematical/sanity constraints (e.g. a percentage-of-something field
// can't sensibly exceed 100%), NOT invented business-policy limits. Real
// policy ranges (e.g. "HAT will never accept an HML rate above X%") are
// an open product question (see delivery report) — until answered, the
// resolver only rejects values that are mathematically nonsensical, not
// merely "high."
export const UNDERWRITING_FIELDS = [
  { key: 'default_holding_months', label: 'Default Holding Period', category: 'shared', type: 'number', unit: 'months', min: 0, max: 60 },
  { key: 'monthly_taxes', label: 'Property Taxes', category: 'shared', type: 'currency', unit: '$/month', min: 0, max: null },
  { key: 'monthly_insurance', label: 'Insurance', category: 'shared', type: 'currency', unit: '$/month', min: 0, max: null },
  { key: 'acquisition_closing_costs', label: 'Acquisition Closing Costs', category: 'shared', type: 'currency', unit: '$', min: 0, max: null },
  { key: 'hml_purchase_financing_pct', label: 'Purchase Financing', category: 'shared', type: 'percentage', unit: '%', min: 0, max: 100 },
  { key: 'hml_rehab_financing_pct', label: 'Rehab Financing', category: 'shared', type: 'percentage', unit: '%', min: 0, max: 100 },
  { key: 'hml_interest_monthly_pct', label: 'HML Interest', category: 'shared', type: 'percentage', unit: '%/month', min: 0, max: 10 },
  { key: 'hml_points_pct', label: 'HML Points', category: 'shared', type: 'percentage', unit: '%', min: 0, max: 20 },
  { key: 'flip_selling_cost_pct', label: 'Selling Costs', category: 'flip', type: 'percentage', unit: '% of ARV', min: 0, max: 20 },
  { key: 'refi_ltv_pct', label: 'Refinance LTV', category: 'brrrr', type: 'percentage', unit: '% of ARV', min: 0, max: 100 },
  { key: 'refi_interest_rate_pct', label: 'Refinance Rate', category: 'brrrr', type: 'percentage', unit: '% annual', min: 0, max: 20 },
  { key: 'refi_amort_years', label: 'Refinance Term', category: 'brrrr', type: 'number', unit: 'years', min: 1, max: 40 },
  { key: 'refi_costs_pct', label: 'Refinance Costs', category: 'brrrr', type: 'percentage', unit: '% of refi loan', min: 0, max: 20 },
]

const FIELD_BY_KEY = Object.fromEntries(UNDERWRITING_FIELDS.map(f => [f.key, f]))

// Type/range validation for ONE field's raw stored value. Returns the
// clean number, or null if it's unsafe to trust (caller falls back to
// default). Rejects NaN/Infinity/wrong-type/out-of-range — never lets a
// corrupt settings blob reach the calculation engine (Part 3/18).
function validateField(key, raw) {
  if (raw === undefined) return undefined // key absent — caller falls back
  const field = FIELD_BY_KEY[key]
  if (!field) return undefined
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null // malformed — fall back, don't throw
  if (raw < field.min) return null
  if (field.max != null && raw > field.max) return null
  return raw
}

// The ONE resolver every consumer uses. `workspaceSettings` is the raw
// `workspaces.settings` JSONB (or its `.underwriting` sub-object —
// either shape is accepted defensively). Returns a complete, fully-typed
// settings object — every field guaranteed present and valid, so callers
// never need their own fallback logic.
//
// `??` throughout (never `||`) — see file header. A deliberately-set 0
// (e.g. 0% selling costs, a real underwriting policy choice) is preserved.
export function resolveUnderwritingSettings(workspaceSettings) {
  const raw = workspaceSettings?.underwriting || workspaceSettings || {}
  const out = {}
  for (const field of UNDERWRITING_FIELDS) {
    const validated = validateField(field.key, raw[field.key])
    out[field.key] = (validated === null || validated === undefined)
      ? DEFAULT_UNDERWRITING_SETTINGS[field.key]
      : validated
  }
  return out
}

// Narrow, explicitly-authorized fix (Part 4) for the previously-found
// `lead.hold_months || 6` bug — a real 0 must survive. Used everywhere
// hold_months is read for a financial calculation. Does NOT change the
// normal fallback-to-6 (or fallback-to-configured-default) behavior for
// null/undefined.
export function resolveHoldMonths(leadHoldMonths, defaultHoldingMonths = DEFAULT_UNDERWRITING_SETTINGS.default_holding_months) {
  return leadHoldMonths != null && leadHoldMonths !== '' ? Number(leadHoldMonths) : defaultHoldingMonths
}
