// scripts/cap15_3_buybox_fixtures.mjs
// Capability #15.3 — deterministic Buy Box fixture tests (Section 12/13).
// Plain Node assertions (no test framework in this repo — matches the
// existing pattern of verification scripts under scripts/). Run:
//   node scripts/cap15_3_buybox_fixtures.mjs
import { qualifyBuyBoxCanonical } from '../src/lib/buyBox.js'
import { getPropertyDecisionData } from '../src/lib/propertyDecisionData.js'

let pass = 0, fail = 0
function check(name, actual, expected) {
  const ok = actual === expected
  console.log(`${ok ? '✓' : '✗ FAIL'} ${name} — expected ${expected}, got ${actual}`)
  if (ok) pass++; else fail++
}

function pdd(lead) { return getPropertyDecisionData(lead) }

// 1. Allowed ZIP + SFR → FIT
check('Allowed ZIP + SFR', qualifyBuyBoxCanonical(pdd({ zip_code: '32205', property_type: 'single_family', bedrooms: 3 })).status, 'FIT')

// 2. Blocked ZIP → NOT_FIT
check('Blocked ZIP (32209)', qualifyBuyBoxCanonical(pdd({ zip_code: '32209', property_type: 'single_family' })).status, 'NOT_FIT')

// 3. Townhouse → NOT_FIT (real value normalizePropertyType() produces — Capability #11 finding)
check('Townhouse (normalized value)', qualifyBuyBoxCanonical(pdd({ zip_code: '32205', property_type: 'townhouse' })).status, 'NOT_FIT')

// 4. Condo → NOT_FIT
check('Condo', qualifyBuyBoxCanonical(pdd({ zip_code: '32205', property_type: 'condo' })).status, 'NOT_FIT')

// 5. Missing property type (ZIP known) → POSSIBLE_FIT, never FIT or NOT_FIT
check('Missing property_type', qualifyBuyBoxCanonical(pdd({ zip_code: '32205', property_type: null })).status, 'POSSIBLE_FIT')

// 6. Missing ZIP (type known) → POSSIBLE_FIT
check('Missing ZIP', qualifyBuyBoxCanonical(pdd({ zip_code: null, property_type: 'single_family' })).status, 'POSSIBLE_FIT')

// 7. Both missing → INSUFFICIENT_DATA
check('Both ZIP and property_type missing', qualifyBuyBoxCanonical(pdd({ zip_code: null, property_type: null })).status, 'INSUFFICIENT_DATA')

// 8. Known valid off-market SFR (property data lives in enrichment_data, no top-level leads.zip_code —
// the exact #15.1 real-world shape) → FIT via the canonical resolver's fallback chain.
check(
  'Off-market SFR via enrichment_data fallback',
  qualifyBuyBoxCanonical(pdd({ zip_code: null, enrichment_data: { zip_code: '32244', property_type: 'single_family' } })).status,
  'FIT'
)

// 9. SOURCE INDEPENDENCE — Section 12/13's critical test. Same normalized
// property data, different "source" framing (on-market top-level columns
// vs off-market enrichment_data-shaped columns) MUST produce the SAME result.
const onMarketShape = { zip_code: '32216', property_type: 'single_family', bedrooms: 3 }
const offMarketShape = { zip_code: null, enrichment_data: { zip_code: '32216', property_type: 'single_family' } }
const onResult = qualifyBuyBoxCanonical(pdd(onMarketShape)).status
const offResult = qualifyBuyBoxCanonical(pdd(offMarketShape)).status
check('SOURCE INDEPENDENCE — same property, on-market vs off-market shape', onResult === offResult, true)
console.log(`   (on-market: ${onResult}, off-market: ${offResult})`)

// 10. Known real conflict case — 1106 Comanche St's actual stored data
// (single_family, 32205, 2BR) → canonical is FIT (real, reproduced result).
check('1106 Comanche St real data', qualifyBuyBoxCanonical(pdd({ zip_code: '32205', property_type: 'single_family', bedrooms: 2 })).status, 'FIT')

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
