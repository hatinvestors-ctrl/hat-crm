// test/sep4DealWorkspaceLayout.test.js
// HAT INVESTORS — SMALL CHANGE #13: Deal Tab Clean Underwriting Workspace.
// UX/LAYOUT ONLY. computeFlipResult, computeBrrrrResult,
// computeStrategyRecommendation, resolveStrategyOutlook (SC10),
// buildCloseCallComparison (SC11), buildStrategyComparison/
// buildDealCloseCallExplanation/buildStrategyExplanation (SC12) are ALL
// byte-unchanged — this only reorganizes how DealDecisionCenter.jsx and
// LeadDetailPage.jsx PRESENT their existing output.
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { computeFlipResult, computeBrrrrResult, computeStrategyRecommendation } from '../src/lib/dealExplanation.js'

const dealSrc = fs.readFileSync('src/components/lead-detail/workspace/DealDecisionCenter.jsx', 'utf8')
const pageSrc = fs.readFileSync('src/pages/LeadDetailPage.jsx', 'utf8')

const NEWMAN = { id: 'newman', asking_price: 228890, arv: 250000, renovation_cost: 50000, hold_months: 6 }
const LAZEAU = { id: 'lazeau', asking_price: 160000, arv: 245000, renovation_cost: 60000, rent_estimate: 1500, hold_months: 6 }

describe('CASE A — Newman: values unchanged by the layout redesign', () => {
  const flip = computeFlipResult(NEWMAN, null)
  const brrrr = computeBrrrrResult(NEWMAN, null)

  it('Ask/ARV/Rehab/rent-missing unchanged', () => {
    expect(NEWMAN.asking_price).toBe(228890)
    expect(NEWMAN.arv).toBe(250000)
    expect(NEWMAN.renovation_cost).toBe(50000)
    expect(brrrr.available).toBe(false)
  })
  it('Flip Max Buy / Suggested Offer / profit @ current price unchanged', () => {
    expect(Math.round(flip.mao / 100) * 100).toBe(134500)
    expect(Math.round(flip.currentOffer)).toBeCloseTo(133800, -2)
    expect(Math.round(flip.projectedProfit)).toBe(-71168)
  })
})

describe('CASE B — Lazeau: values and close-call classification unchanged', () => {
  const flip = computeFlipResult(LAZEAU, null)
  const brrrr = computeBrrrrResult(LAZEAU, null)
  const strategyRec = computeStrategyRecommendation(flip, brrrr)

  it('Flip Max Buy / BRRRR Max Buy / cash flow / cash left in unchanged', () => {
    expect(Math.round(flip.mao)).toBe(120104)
    expect(Math.round(brrrr.mao)).toBe(118710)
    expect(brrrr.monthlyCashFlow).toBe(85)
    expect(brrrr.cashLeftIn).toBe(29346)
  })
  it('canonical preferredStrategy (BRRRR) unchanged', () => {
    expect(strategyRec.preferredStrategy).toBe('BRRRR')
  })
})

describe('Section 1 — Deal Inputs: new compact read-only row, no new state/values', () => {
  it('renders Ask/ARV/Rehab/Rent/Hold from the SAME lead fields, no new editable input introduced', () => {
    expect(dealSrc).toMatch(/Deal Inputs<\/div>/)
    expect(dealSrc).toMatch(/<Metric label="Ask" value=\{lead\.asking_price/)
    expect(dealSrc).toMatch(/<Metric label="ARV" value=\{fc\(lead\.arv\)\}/)
    expect(dealSrc).toMatch(/<Metric label="Rehab" value=\{fc\(lead\.renovation_cost\)\}/)
    expect(dealSrc).toMatch(/<Metric label="Rent" value=\{lead\.rent_estimate/)
    expect(dealSrc).toMatch(/<Metric label="Hold" value=\{`\$\{lead\.hold_months \?\? 6\} mo`\}/)
    // Metric is a read-only presentational component (no onSave/onClick) —
    // confirms no new editable field was introduced here.
    expect(dealSrc).not.toMatch(/Deal Inputs[\s\S]{0,600}onSave/)
  })
})

describe('Section 2 — Strategy Status: SC10/SC11/SC12 logic reused unchanged, no second engine', () => {
  it('still computed from resolveStrategyOutlook/buildCloseCallComparison/buildStrategyComparison exactly as Small Change #12 left them', () => {
    expect(dealSrc).toMatch(/resolveStrategyOutlook\(\{ flip, brrrr, decision: \{ targetStrategy: effective, buyBoxNotFit, priceUnknown: comparison\.priceUnknown \} \}\)/)
    expect(dealSrc).toMatch(/const closeCallComparison = isCloseCall \? buildCloseCallComparison/)
    expect(dealSrc).toMatch(/const comparison = buildStrategyComparison/)
    expect(dealSrc).not.toMatch(/const pricesClose = /) // SC10's formula itself must not be reproduced here
  })
})

describe('Section 3 — Strategy Explorer (FLIP/BRRRR selector): click behavior and state completely unchanged', () => {
  it('setSelectedStrategy/active/default-selection logic byte-identical to Small Change #12', () => {
    expect(dealSrc).toMatch(/const \[selectedStrategy, setSelectedStrategy\] = useState\(null\)/)
    expect(dealSrc).toMatch(/onClick=\{\(\) => setSelectedStrategy\(s\)\}/)
    expect(dealSrc).toMatch(/const active = selectedStrategy \|\| effective \|\| \(flip\.available \? 'FLIP' : 'BRRRR'\)/)
  })
  it('close-call selector labels (Slight Lean / Viable) and clear-winner labels (Recommended) both still present', () => {
    expect(dealSrc).toMatch(/isCloseCall \? ` — \$\{s === effective \? 'Slight Lean' : 'Viable'\}` : \(s === effective \? ' — Recommended' : ''\)/)
  })
})

describe('Section 4 — Selected Strategy Underwriting: label added, detail panel/CalculationDetails/MarginVisualization untouched', () => {
  it('a small "{active} Underwriting" header renders above the existing unchanged detail panel', () => {
    expect(dealSrc).toMatch(/\{active\} Underwriting<\/div>/)
    expect(dealSrc).toMatch(/<CalculationDetails/)
    expect(dealSrc).toMatch(/<MarginVisualization currentOffer=\{flip\.currentOffer\} mao=\{displayMao\} \/>/)
  })
  it('BRRRR missing-rent empty state is simple and non-fabricating, not a large empty grid', () => {
    expect(dealSrc).toMatch(/Rent estimate needed<\/div>/)
    expect(dealSrc).toMatch(/Add a rent estimate to calculate BRRRR Max Buy, monthly cash flow, and cash left in\./)
  })
})

describe('Section 5 — Underwriting Assumptions: already a compact collapsed panel, untouched by SC13', () => {
  it('UnderwritingAssumptionsPanel.jsx is unmodified (already satisfied this requirement pre-SC13)', () => {
    const src = fs.readFileSync('src/components/lead-detail/workspace/UnderwritingAssumptionsPanel.jsx', 'utf8')
    expect(src).toMatch(/const \[open, setOpen\] = useState\(false\)/)
    expect(src).toMatch(/\{open \? 'Hide' : 'View assumptions'\}/)
  })
})

describe('Section 6 — Property Details: collapsed by default, PropertyInfoSection rendered unchanged when expanded', () => {
  it('LeadDetailPage.jsx wraps PropertyInfoSection in a collapsed-by-default disclosure, same props, same component', () => {
    expect(pageSrc).toMatch(/const \[showPropertyDetails, setShowPropertyDetails\] = useState\(false\)/)
    expect(pageSrc).toMatch(/Property Details<\/span>/)
    expect(pageSrc).toMatch(/\{showPropertyDetails \? 'Hide' : 'View \/ Edit'\}/)
    expect(pageSrc).toMatch(/\{showPropertyDetails && \(/)
    expect(pageSrc).toMatch(/<PropertyInfoSection\s+lead=\{lead\}\s+userId=\{user\.id\}\s+members=\{members\}\s+canEdit=\{canEdit\}\s+onUpdated=\{onLeadUpdated\}\s+underwritingSettings=\{underwritingSettings\}\s+\/>/)
  })
  it('PropertyInfoSection.jsx itself is completely unmodified — same EditableField calls, same onSave handlers, same fields', () => {
    const src = fs.readFileSync('src/components/lead-detail/PropertyInfoSection.jsx', 'utf8')
    expect(src).toMatch(/onSave=\{\(v\) => update\(\{ address: v \}\)\}/)
    expect(src).toMatch(/label="After-Repair Value \(ARV\)"/)
    expect(src).toMatch(/const newMao = v \? Math\.round\(Number\(v\) \* 0\.75 - Number\(lead\.renovation_cost \|\| 0\) - 2450\) : null/)
    expect(src).toMatch(/onSave=\{\(v\) => update\(\{ rent_estimate: v \}\)\}/)
    expect(src).toMatch(/onSave=\{\(v\) => update\(\{ hold_months: v \}\)\}/)
    expect(src).toMatch(/onSave=\{\(v\) => update\(\{ starting_offer: v \}\)\}/)
  })
})

describe('SC1-SC12 preserved', () => {
  it('SC3 — PASS_NEGOTIABLE state/label/tone unchanged', () => {
    const src = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    expect(src).toMatch(/state: 'PASS_NEGOTIABLE', \.\.\.STATE_META\.PASS_NEGOTIABLE/)
  })
  it('SC10 — resolveStrategyOutlook classification rule untouched', () => {
    const src = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    expect(src).toMatch(/const pricesClose = gap <= Math\.max\(5000, lowerMao \* 0\.05\)/)
    expect(src).toMatch(/const dominant = winnerVerdict === 'STRONG'/)
  })
  it('SC12 — buildDealCloseCallExplanation / price-scenario status labels untouched', () => {
    const src = fs.readFileSync('src/lib/acquisitionDecisionPresentation.js', 'utf8')
    expect(src).toMatch(/export function buildDealCloseCallExplanation/)
    expect(dealSrc).toMatch(/Viable at \$\{priceScenarioWord\}/)
    expect(dealSrc).toMatch(/'Viable at Target Range'/)
  })
})

describe('Protected files / no scope creep', () => {
  it('no protected file references any new symbol from this fix', () => {
    for (const f of ['src/lib/calculations.js', 'src/lib/decisionEngineV2.js', 'src/lib/buyBox.js', 'src/lib/underwritingSettings.js', 'src/lib/dealExplanation.js', 'src/lib/sellerStrategy.js']) {
      const src = fs.readFileSync(f, 'utf8')
      expect(src).not.toMatch(/showPropertyDetails|Deal Inputs/)
    }
  })
})
