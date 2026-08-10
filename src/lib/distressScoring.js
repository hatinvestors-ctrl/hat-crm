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
  OTHER_CIVIL: 'Other Civil',
  UNKNOWN: 'Unknown',
}

// ── 9. Opportunity Score — explainable, 0-100, centralized weights ──────
export const SCORE_WEIGHTS = {
  distressQuality: { MORTGAGE_FORECLOSURE: 25, HOA_CONDO_LIEN: 12, TAX_RELATED: 15, MUNICIPAL_LIEN: 10, OTHER_CIVIL: 8, UNKNOWN: 3 },
  propertyFitFit: 20,
  propertyFitPossible: 10,
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
