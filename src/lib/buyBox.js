// src/lib/buyBox.js
// Capability #10.2 — the geography/type rules mirrored VERBATIM from
// hat-ai-agents/lib/acquisition-engine.mjs (BLOCKED_ZIPS, LOW_PRIORITY_ZIPS,
// PREFERRED_ZIPS, ACCEPTABLE_ZIPS, classifyZip(), hardTypeReject()) — the
// ALREADY-EXISTING single source of truth for HAT's buy box, used today by
// the Gmail acquisition agent. That module lives in a separate repository
// (hat-ai-agents) that HatCRM's Vite build cannot import across a repo
// boundary, so the exact same rules are copied here rather than a second,
// different buy box being invented. Keep these two files in sync manually
// if hat-ai-agents/lib/acquisition-engine.mjs ever changes — same pattern
// already used for cross-cutting constants in this codebase.

export const BLOCKED_ZIPS = new Set(['32206', '32209', '32254'])
export const LOW_PRIORITY_ZIPS = new Set(['32220'])
export const PREFERRED_ZIPS = new Set([
  '32210', '32244', '32221', '32222', '32218', '32208', '32205', '32216', '32207', '32219',
  '32073', '32065', '32068', '32043', // Clay County
])
export const ACCEPTABLE_ZIPS = new Set([
  '32086', '32095', '32092', '32259', // St. Augustine / St. Johns County
])

export function classifyZip(zip) {
  if (!zip) return 'unknown'
  const z = String(zip).slice(0, 5)
  if (BLOCKED_ZIPS.has(z)) return 'blocked'
  if (LOW_PRIORITY_ZIPS.has(z)) return 'low_priority'
  if (PREFERRED_ZIPS.has(z)) return 'preferred'
  if (ACCEPTABLE_ZIPS.has(z)) return 'acceptable'
  return 'other'
}

const HARD_REJECT_TYPE_PATTERNS = [
  { re: /\bcondo(minium)?\b/i, reason: 'Condominium' },
  // Capability #11 real finding: the mirrored source (hat-ai-agents/lib/
  // acquisition-engine.mjs) only matches "town ?home", which NEVER matches
  // "townhouse" — the exact value normalizePropertyType() actually
  // produces everywhere in this codebase (RentCast and BatchData both
  // normalize to 'townhouse', never 'townhome'). Caught live: a real
  // townhouse (2839 Black Buck Cir) incorrectly passed as FIT. Widened to
  // catch both spellings.
  { re: /\btown ?home\b|\btownhouse\b/i, reason: 'Townhouse' },
  { re: /\bapartment\b/i, reason: 'Apartment' },
  { re: /\bcommercial\b/i, reason: 'Commercial property' },
  // Capability #15.5 real finding — same bug class as the #11 townhouse
  // fix: normalizePropertyType() (batchdata-enrich.mjs/enrich-lead.mjs)
  // produces the bare short value 'land' for any land/lot listing, which
  // never matched "land only"/"land-only". Confirmed live: 8849 S Old
  // Kings Rd (property_type='land') was returning FIT. Widened to match
  // the bare normalized value too.
  { re: /\bland[- ]?only\b|\bvacant lot\b|\bunimproved land\b|^land$/i, reason: 'Land only' },
  { re: /\bmanufactured home\b|\bmobile home\b/i, reason: 'Manufactured/mobile home' },
]

export function hardTypeReject(propertyType) {
  const haystack = (propertyType || '').toLowerCase()
  for (const { re, reason } of HARD_REJECT_TYPE_PATTERNS) {
    if (re.test(haystack)) return { reject: true, reason }
  }
  return { reject: false, reason: null }
}

/**
 * Capability #10.2 — off-market buy-box qualification. Deliberately
 * DIFFERENT shape from the on-market acquisitionScreen() in
 * acquisition-engine.mjs (which requires asking_price/financials) — an
 * off-market lead frequently has neither. This only ever asks "does this
 * property fit HAT's geography/type profile", never "is this a good
 * price", and returns INSUFFICIENT_DATA rather than guessing when the
 * inputs needed to answer aren't there yet.
 *
 * @param {{zip_code?: string, property_type?: string, bedrooms?: number, bathrooms?: number, arv?: number}} p
 * @returns {{fit: 'FIT'|'POSSIBLE_FIT'|'NOT_FIT'|'INSUFFICIENT_DATA', reasons: string[]}}
 */
export function qualifyBuyBox(p) {
  const reasons = []

  if (p.zip_code) {
    const zipClass = classifyZip(p.zip_code)
    if (zipClass === 'blocked') {
      return { fit: 'NOT_FIT', reasons: [`Blocked ZIP ${p.zip_code}`] }
    }
  }

  if (p.property_type) {
    const typeCheck = hardTypeReject(p.property_type)
    if (typeCheck.reject) {
      return { fit: 'NOT_FIT', reasons: [typeCheck.reason] }
    }
  }

  const haveZip = !!p.zip_code
  const haveType = !!p.property_type
  if (!haveZip && !haveType) {
    return { fit: 'INSUFFICIENT_DATA', reasons: ['No ZIP or property type known yet'] }
  }

  if (haveZip) {
    const zipClass = classifyZip(p.zip_code)
    if (zipClass === 'preferred') reasons.push('Preferred HAT geography')
    else if (zipClass === 'acceptable') reasons.push('Acceptable HAT geography')
    else if (zipClass === 'low_priority') reasons.push('Low-priority geography')
    else if (zipClass === 'other') reasons.push('Outside preferred geography (not blocked)')
  }
  if (haveType) reasons.push('Residential property type confirmed')
  if (typeof p.bedrooms === 'number' && p.bedrooms >= 2) reasons.push(`${p.bedrooms}BR — has a rental angle`)

  // FIT requires both dimensions known and neither disqualifying;
  // POSSIBLE_FIT when only one dimension is known (real signal, not proof).
  if (haveZip && haveType) {
    const zipClass = classifyZip(p.zip_code)
    return { fit: zipClass === 'low_priority' ? 'POSSIBLE_FIT' : 'FIT', reasons }
  }
  return { fit: 'POSSIBLE_FIT', reasons }
}

// ══════════════════════════════════════════════════════════════════════
// Capability #15.2 — CANONICAL Buy Box entry point (Section 7). This is
// the ONE function Decision Engine V2 calls for both on-market and
// off-market leads. It does not replace qualifyBuyBox() above (every
// existing caller — netlify/functions/batchdata-enrich.mjs — keeps
// calling that exact function, unchanged, so nothing already in
// production is touched) — it wraps it with the canonical
// property-decision-data resolver's missing/conflicts, and normalizes
// the output shape to {status, reasons, missing, conflicts} per the
// mission's Section 10 contract. No numeric fit score is introduced.
//
// acquisitionProfile is accepted but unused today — HAT is the only
// profile that exists; the parameter exists so this signature doesn't
// need to change again when a second profile becomes real (Section 7:
// "do not build multi-tenant SaaS yet, but avoid embedding source-
// specific logic").
// ══════════════════════════════════════════════════════════════════════
export function qualifyBuyBoxCanonical(propertyDecisionData, acquisitionProfile = 'HAT') {
  const result = qualifyBuyBox({
    zip_code: propertyDecisionData.zip,
    property_type: propertyDecisionData.property_type,
    bedrooms: propertyDecisionData.bedrooms,
  })
  const relevantMissing = ['zip', 'property_type'].filter(f => propertyDecisionData.missing?.includes(f))
  const relevantConflicts = (propertyDecisionData.conflicts || []).filter(c => c.field === 'zip' || c.field === 'property_type')
  return {
    status: result.fit,
    reasons: result.reasons,
    missing: relevantMissing,
    conflicts: relevantConflicts,
  }
}
