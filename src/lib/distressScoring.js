// src/lib/distressScoring.js
// Capability #10.2 — distress-event classification + explainable Opportunity
// Score. Deliberately small and rule-based (no AI call, no opaque model),
// matching the mission's explicit instruction. All weights centralized in
// SCORE_WEIGHTS below so they're easy to tune without hunting through logic.

// ── 3. Distress category classification ─────────────────────────────────
// Evidence used: the Lis Pendens FILER (plaintiff/party bringing the
// action) name — the exact same real field (DirectName) already captured
// from the Duval Clerk source in Capability #10. This is real source
// evidence, not a name guess: a mortgage servicer/bank filing IS what
// makes a filing a mortgage foreclosure; an HOA filing IS what makes it an
// HOA lien. Never invents certainty — anything that doesn't match a known
// pattern stays UNKNOWN rather than being forced into a category.
const FILER_PATTERNS = [
  {
    category: 'MORTGAGE_FORECLOSURE',
    re: /\b(MORTGAGE|BANK|LOAN SERVICING|CITIMORTGAGE|FINANCIAL|N\.?A\.?|FEDERAL SAVINGS|CREDIT UNION|FUNDING|CAPITAL)\b/i,
    confidence: 'medium',
  },
  {
    category: 'HOA_CONDO_LIEN',
    re: /\b(HOMEOWNERS ASSOCIATION|OWNERS ASSOCIATION|CONDOMINIUM ASSOCIATION|HOA\b|COMMUNITY ASSOCIATION)\b/i,
    confidence: 'high',
  },
  {
    category: 'TAX_RELATED',
    re: /\b(TAX COLLECTOR|DEPARTMENT OF REVENUE|IRS|INTERNAL REVENUE)\b/i,
    confidence: 'high',
  },
  {
    category: 'MUNICIPAL_LIEN',
    re: /\b(CITY OF JACKSONVILLE|DUVAL COUNTY|CODE ENFORCEMENT|MUNICIPAL)\b/i,
    confidence: 'high',
  },
  {
    // Capability #14 — real filer evidence from the Duval Clerk's own LIEN
    // (LN) document type: contracting/trade companies filing a Claim of
    // Lien (mechanic's/construction lien) against a property owner who
    // didn't pay for work performed. Matched on the filer's real business
    // name, same evidence pattern as every other category above.
    category: 'CONTRACTOR_LIEN',
    re: /\b(CONSTRUCTION|CONTRACTING|CONTRACTOR|ROOFING|PLUMBING|ELECTRIC|HEATING|AIR COND|HVAC|BUILDERS?|REMODEL|PAVING|LANDSCAP)\b/i,
    confidence: 'medium',
  },
]

/**
 * @param {{filer?: string}} record - filer = the Lis Pendens plaintiff/DirectName
 * @returns {{distress_category: string, distress_category_confidence: 'high'|'medium'|'low', distress_category_reason: string}}
 */
export function classifyDistress(record) {
  const filer = record?.filer?.trim()
  if (!filer) {
    return { distress_category: 'UNKNOWN', distress_category_confidence: 'low', distress_category_reason: 'No filer/plaintiff name on record' }
  }
  for (const { category, re, confidence } of FILER_PATTERNS) {
    if (re.test(filer)) {
      return {
        distress_category: category,
        distress_category_confidence: confidence,
        distress_category_reason: `Filer "${filer}" matches ${category.replace(/_/g, ' ').toLowerCase()} pattern`,
      }
    }
  }
  return {
    distress_category: 'OTHER_CIVIL',
    distress_category_confidence: 'low',
    distress_category_reason: `Filer "${filer}" doesn't match a known mortgage/HOA/tax/municipal pattern`,
  }
}

export const DISTRESS_CATEGORY_LABELS = {
  MORTGAGE_FORECLOSURE: 'Mortgage Foreclosure',
  HOA_CONDO_LIEN: 'HOA / Condo Lien',
  TAX_RELATED: 'Tax Related',
  MUNICIPAL_LIEN: 'Municipal Lien',
  CONTRACTOR_LIEN: 'Contractor / Mechanic’s Lien',
  OTHER_CIVIL: 'Other Civil',
  UNKNOWN: 'Unknown',
}

// ── Capability #14 — conservative lien SIGNAL STRENGTH ──────────────────
// Deliberately separate from distress_category above: category says WHAT
// kind of lien it is (real filer evidence); strength says how much weight
// that lien deserves as an acquisition signal, given the real context we
// actually have (legal description present, is the "party" a business
// rather than a person, other corroborating signals on this property).
// Never claims a single lien alone proves a motivated seller.
export function classifyLienStrength({ distressCategory, hasLegalDescription, partyLooksLikeBusiness, otherSignalCount = 0 }) {
  if (otherSignalCount > 0) {
    return { strength: 'STRONG_FINANCIAL_DISTRESS', reason: `Corroborated by ${otherSignalCount} other distress signal(s) on this property` }
  }
  if (partyLooksLikeBusiness) {
    // The named "debtor" on the lien is itself a company, not the
    // individual property owner — e.g. a contest-of-lien between two
    // businesses. Real evidence, but not a residential-seller-distress signal.
    return { strength: 'NON_ACQUISITION_SIGNAL', reason: 'Named party is a business entity, not an individual property owner' }
  }
  if (distressCategory === 'HOA_CONDO_LIEN' || distressCategory === 'CONTRACTOR_LIEN') {
    return hasLegalDescription
      ? { strength: 'MODERATE_DISTRESS', reason: 'Lien tied to a specific legal description; unpaid HOA/contractor debt is a real but moderate signal alone' }
      : { strength: 'WEAK_DISTRESS', reason: 'Lien type suggests real distress but no legal description ties it to this specific property' }
  }
  if (distressCategory === 'TAX_RELATED') {
    return { strength: 'WEAK_DISTRESS', reason: 'Federal/state tax liens attach to the debtor broadly, not a specific property — no legal description confirms this parcel' }
  }
  if (distressCategory === 'MUNICIPAL_LIEN') {
    return { strength: 'MODERATE_DISTRESS', reason: 'Municipal lien filed against the property' }
  }
  return { strength: 'UNKNOWN', reason: 'Lien category and party context do not support a confident distress classification' }
}

// ── 9. Opportunity Score — explainable, 0-100, centralized weights ──────
export const SCORE_WEIGHTS = {
  distressQuality: { MORTGAGE_FORECLOSURE: 25, HOA_CONDO_LIEN: 12, TAX_RELATED: 15, MUNICIPAL_LIEN: 10, OTHER_CIVIL: 8, UNKNOWN: 3 },
  propertyFitFit: 20,
  propertyFitPossible: 10,
  // Capability #10.4 — real finding: once BatchData supplied actual
  // property_type for 10200 Belle Rive Blvd, the buy-box correctly
  // resolved to NOT_FIT (a condominium — hard-rejected by HAT's existing
  // rules), but the score still landed at 75/REVIEW because NOT_FIT simply
  // withheld the FIT/POSSIBLE_FIT bonus rather than penalizing it. A hard
  // buy-box rejection should meaningfully outweigh a strong distress
  // signal, not just fail to add to it — same class of fix as #10.2's
  // HOA-owner exclusion.
  propertyFitNotFit: -40,
  ownerResolvedMatch: 15,
  ownerResolvedPossible: 8,
  absenteeOwner: 10,
  identityVerified: 10,
  hasZip: 5,
  hasPropertyType: 5,
  hasCharacteristics: 5, // year_built/sqft/beds/baths — any present
  priorPropertyIntelHistory: 5, // multi-signal — property seen before (Redfin/Zillow/manual)
  govOrExcludedPenalty: -100, // effectively floors the score — still visible, never hidden
}

const PRIORITY_THRESHOLDS = [
  { min: 80, key: 'HIGH_PRIORITY', label: '🔥 HIGH PRIORITY' },
  { min: 60, key: 'REVIEW', label: '🟠 REVIEW' },
  { min: 40, key: 'RESEARCH', label: '🟡 RESEARCH' },
  { min: 0, key: 'LOW_PRIORITY', label: '⚪ LOW PRIORITY' },
]

export function priorityForScore(score) {
  return PRIORITY_THRESHOLDS.find(t => score >= t.min)
}

/**
 * @param {object} input
 * @param {string} input.distressCategory
 * @param {'FIT'|'POSSIBLE_FIT'|'NOT_FIT'|'INSUFFICIENT_DATA'} input.buyBoxFit
 * @param {string} input.ownerMatchStatus - MATCH/POSSIBLE_MATCH/DIFFERENT/UNKNOWN
 * @param {boolean|'unknown'} input.absenteeOwner
 * @param {boolean} input.identityVerified - EXACT_ADDRESS match confidence
 * @param {string|null} input.zipCode
 * @param {string|null} input.propertyType
 * @param {boolean} input.hasCharacteristics
 * @param {boolean} input.priorPropertyIntelHistory
 * @param {boolean} input.excluded - government-owned / commercial / excluded geography — hard flag
 * @returns {{score: number, priority: object, why: string[], missing: string[]}}
 */
export function computeOpportunityScore(input) {
  const w = SCORE_WEIGHTS
  const why = []
  const missing = []
  let score = 0

  if (input.excluded) {
    return { score: 0, priority: priorityForScore(0), why: [], missing: [], excluded: true }
  }

  score += w.distressQuality[input.distressCategory] ?? w.distressQuality.UNKNOWN
  if (input.distressCategory === 'MORTGAGE_FORECLOSURE') why.push('Mortgage foreclosure identified')
  else if (input.distressCategory !== 'UNKNOWN') why.push(`${DISTRESS_CATEGORY_LABELS[input.distressCategory]} identified`)
  else missing.push('Distress type unclear')

  if (input.buyBoxFit === 'FIT') { score += w.propertyFitFit; why.push('Fits HAT buy box') }
  else if (input.buyBoxFit === 'POSSIBLE_FIT') { score += w.propertyFitPossible; why.push('Possible buy-box fit') }
  else if (input.buyBoxFit === 'NOT_FIT') { score += w.propertyFitNotFit; missing.push('Does not fit HAT buy box') }
  else if (input.buyBoxFit === 'INSUFFICIENT_DATA') missing.push('Property fit unconfirmed')

  if (input.ownerMatchStatus === 'MATCH') { score += w.ownerResolvedMatch; why.push('Owner verified') }
  else if (input.ownerMatchStatus === 'POSSIBLE_MATCH') { score += w.ownerResolvedPossible; missing.push('Owner match unconfirmed') }
  else missing.push('Owner match unconfirmed')

  if (input.absenteeOwner === true) { score += w.absenteeOwner; why.push('Absentee owner') }
  else if (input.absenteeOwner !== false) missing.push('Absentee status unknown')

  if (input.identityVerified) { score += w.identityVerified; why.push('Property identity verified') }

  if (input.zipCode) score += w.hasZip
  else missing.push('ZIP')
  if (input.propertyType) score += w.hasPropertyType
  else missing.push('Property type')
  if (input.hasCharacteristics) score += w.hasCharacteristics
  else missing.push('Year built/sqft/beds/baths')

  if (input.priorPropertyIntelHistory) { score += w.priorPropertyIntelHistory; why.push('Prior Property Intelligence history') }

  // Off-market-specific missing items the mission explicitly says never to fabricate.
  missing.push('ARV', 'Renovation estimate', 'Owner contact')

  score = Math.max(0, Math.min(100, score))
  return { score, priority: priorityForScore(score), why: why.slice(0, 5), missing: [...new Set(missing)].slice(0, 6) }
}
