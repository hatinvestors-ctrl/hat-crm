// test/fixtures/goldenLeads.js
// Release Readiness — deterministic "Golden Lead" fixtures. Plain JS
// objects shaped like real `leads` rows, used ONLY in-memory by the test
// suite — never written to any database, never touched by ingestion.
// hold_months is intentionally omitted (not a real DB column — every
// canonical function defaults it to 6 internally, confirmed via
// `leads.hold_months does not exist` errors encountered during this
// session's real-data investigations).

const base = (overrides) => ({
  id: 'golden-' + Math.random().toString(36).slice(2),
  address: 'Golden Test Lead',
  city: 'Jacksonville', state: 'FL', zip_code: '32210',
  status: 'new_lead',
  is_distressed: false,
  asking_price: null, arv: null, renovation_cost: null, rent_estimate: null,
  starting_offer: null, offer_price: null, mao: null,
  follow_up_date: null,
  decision_v2: null,
  deal_analysis: null,
  deal_brief: null,
  acquisition_override: null,
  listing_agent_name: null, owner_name: null,
  ...overrides,
})

export const GOLDEN_LEADS = {
  // G01 — STRONG FLIP: well below Max Buy, profit comfortably >= $40K
  G01_STRONG_FLIP: base({
    address: '1 Golden Strong Flip Ct', asking_price: 95000, arv: 270000, renovation_cost: 50000,
  }),

  // G02 — SOLID FLIP ("PASS" tier): profit in the $35K-$40K band. Values
  // verified via direct computeFlipResult() run: ask=$126,000 (below the
  // $133,677 canonical MAO by enough that calculateLiveOffer's ask<=mao
  // passthrough preserves real cushion) -> profit $38,230, verdict PASS.
  G02_SOLID_FLIP: base({
    address: '2 Golden Solid Flip Ct', asking_price: 126000, arv: 220000, renovation_cost: 25000,
  }),

  // G03 — WATCH FLIP: thin margin, profit just above $30K
  G03_WATCH_FLIP: base({
    address: '3 Golden Watch Flip Ct', asking_price: 118000, arv: 185000, renovation_cost: 10000,
  }),

  // G04 — reserved for a genuine "below target" price point (see
  // calculations.test.js — NO DEAL is tested directly against
  // computeFlipBreakdown at an explicit above-MAO price, NOT through
  // computeFlipResult's own currentOffer pipeline. Release Readiness
  // finding: getEffectiveOffer's MAO-clamp fix (earlier this session)
  // structurally guarantees currentOffer <= mao*0.995 whenever a stored
  // offer would otherwise exceed MAO, and calculateLiveOffer's own cap
  // does the same for the live-computed branch -- so computeFlipResult's
  // OWN verdict is virtually never NO DEAL when MAO is positive; it only
  // occurs at negative/undefined MAO. See RELEASE-READINESS.md Finding #1.)
  // offer_price = the ACTUAL/SUBMITTED offer (Product Decision, D2) — what
  // the canonical current-deal evaluation reads. starting_offer is kept
  // too (the separate RECOMMENDED/"We Offer" negotiation-anchor concept,
  // MAO-anchored) — both are real, distinct, coexisting fields.
  G04_NO_DEAL: base({
    address: '4 Golden No Deal Ct', asking_price: 204000, arv: 185000, renovation_cost: 10000,
    offer_price: 150000, starting_offer: 150000,
  }),

  // G05 — OFFER ABOVE MAX BUY explicitly (actual offer already above canonical MAO)
  G05_OFFER_ABOVE_MAX_BUY: base({
    address: '5 Golden Above Max Buy Ct', asking_price: 130000, arv: 185000, renovation_cost: 10000,
    offer_price: 130000, starting_offer: 130000,
  }),

  // G06 — LARGE ASK-TO-MAX-BUY GAP (real-world shape: 7109 Hallock St)
  G06_LARGE_GAP: base({
    address: '7109 Golden Hallock Analog', asking_price: 204000, arv: 185000, renovation_cost: 10000,
    offer_price: 115700, starting_offer: 115700,
  }),

  // G07 — MISSING ARV
  G07_MISSING_ARV: base({
    address: '7 Golden Missing ARV Ct', asking_price: 220000, arv: null, renovation_cost: 5000,
  }),

  // G08 — MISSING RENOVATION
  G08_MISSING_RENO: base({
    address: '8 Golden Missing Reno Ct', asking_price: 220000, arv: 250000, renovation_cost: null,
  }),

  // G09 — MISSING RENT ONLY (Flip computable, BRRRR blocked)
  G09_MISSING_RENT: base({
    address: '9 Golden Missing Rent Ct', asking_price: 150000, arv: 220000, renovation_cost: 15000, rent_estimate: null,
  }),

  // G10 — STRONG BRRRR: healthy cash flow, well under cash-left-in cap
  G10_STRONG_BRRRR: base({
    address: '10 Golden Strong BRRRR Ct', asking_price: 100000, arv: 270000, renovation_cost: 50000, rent_estimate: 2200,
  }),

  // G11 — BRRRR FAILS CASH FLOW: rent too low to cover the refi payment
  G11_BRRRR_FAILS_CASHFLOW: base({
    address: '11 Golden BRRRR Bad CF Ct', asking_price: 150000, arv: 150000, renovation_cost: 20000, rent_estimate: 400,
  }),

  // G12 — BRRRR FAILS CASH-LEFT-IN: cash flow fine, but too much cash stuck at any price near ask
  G12_BRRRR_FAILS_CASHLEFTIN: base({
    address: '12 Golden BRRRR Bad CLI Ct', asking_price: 300000, arv: 200000, renovation_cost: 40000, rent_estimate: 1800,
  }),

  // G13 — BOTH FLIP + BRRRR WORK (real-world shape: 7614 Club Duclay Dr)
  G13_BOTH_WORK: base({
    address: '7614 Golden Club Duclay Analog', asking_price: 100000, arv: 270000, renovation_cost: 50000, rent_estimate: 1600,
  }),

  // G14 — BOTH WORK / FLIP PREFERRED (flip's rank clearly beats BRRRR's)
  G14_BOTH_FLIP_PREFERRED: base({
    address: '14 Golden Flip Preferred Ct', asking_price: 80000, arv: 260000, renovation_cost: 40000, rent_estimate: 1500,
  }),

  // G15 — BOTH WORK / BRRRR PREFERRED (BRRRR's rank beats Flip's — thin flip margin, strong BRRRR)
  G15_BOTH_BRRRR_PREFERRED: base({
    address: '15 Golden BRRRR Preferred Ct', asking_price: 115000, arv: 185000, renovation_cost: 10000, rent_estimate: 2400,
  }),

  // G16 — PRELIMINARY DECISION (decision_v2 present, confidence flags missing core econ)
  G16_PRELIMINARY: base({
    address: '16 Golden Preliminary Ct', asking_price: 220000, renovation_cost: 5000,
    decision_v2: {
      recommendation: 'PASS', next_best_action: 'PASS',
      opportunity: { score: 15, reasons: [] },
      confidence: { score: 45, missing: ['ARV unknown'], reasons: [] },
      urgency: { level: 'MEDIUM', reasons: [] },
      fit: { status: 'FIT', missing: [], reasons: [], conflicts: [] },
      why: [], calculated_at: new Date().toISOString(), version: '2.0-shadow',
    },
  }),

  // G17 — REFINED DECISION (confidence high, nothing core missing)
  G17_REFINED: base({
    address: '17 Golden Refined Ct', asking_price: 204000, arv: 185000, renovation_cost: 10000,
    decision_v2: {
      recommendation: 'PASS', next_best_action: 'PASS',
      opportunity: { score: 21, reasons: [] },
      confidence: { score: 100, missing: [], reasons: [] },
      urgency: { level: 'MEDIUM', reasons: [] },
      fit: { status: 'FIT', missing: [], reasons: [], conflicts: [] },
      why: [], calculated_at: new Date().toISOString(), version: '2.0-shadow',
    },
  }),

  // G18 — ON-MARKET (has asking_price, not flagged distressed)
  G18_ON_MARKET: base({
    address: '18 Golden On-Market Ct', asking_price: 200000, arv: 260000, renovation_cost: 30000, is_distressed: false,
  }),

  // G19 — OFF-MARKET / DISTRESSED
  G19_OFF_MARKET: base({
    address: '19 Golden Off-Market Ct', is_distressed: true, arv: 200000, renovation_cost: 30000,
    distress_data: { seller_intelligence: { motivation_level: 'HIGH' } },
  }),

  // G20 — FOLLOW-UP TODAY
  G20_FOLLOW_UP_TODAY: base({
    address: '20 Golden Follow-Up Today Ct', status: 'follow_up', follow_up_date: 'TODAY_PLACEHOLDER',
  }),

  // G21 — OVERDUE FOLLOW-UP (7 days ago)
  G21_OVERDUE: base({
    address: '21 Golden Overdue Ct', status: 'follow_up', follow_up_date: 'MINUS_7_PLACEHOLDER',
  }),

  // G22 — UPCOMING FOLLOW-UP (+7 days)
  G22_UPCOMING: base({
    address: '22 Golden Upcoming Ct', status: 'follow_up', follow_up_date: 'PLUS_7_PLACEHOLDER',
  }),

  // G23 — RE-ENGAGE / PRICE DROP (follow-up status + genuine HIGH urgency signal, not just overdue)
  G23_RE_ENGAGE: base({
    address: '23 Golden Re-Engage Ct', status: 'follow_up', follow_up_date: 'PLUS_7_PLACEHOLDER',
    decision_v2: {
      recommendation: 'FOLLOW_UP', next_best_action: 'FOLLOW_UP',
      opportunity: { score: 55, reasons: [] },
      confidence: { score: 80, missing: [], reasons: [] },
      urgency: { level: 'HIGH', reasons: ['Price reduced $220,000 to $195,000'] },
      fit: { status: 'FIT', missing: [], reasons: [], conflicts: [] },
      why: [], calculated_at: new Date().toISOString(), version: '2.0-shadow',
    },
  }),

  // G24 — TERMINAL / DEAD LEAD
  G24_TERMINAL_DEAD: base({
    address: '24 Golden Dead Lead Ct', status: 'dead_lead',
  }),

  // G25 — HUMAN OVERRIDE (decisionEngineV2.js's applyHumanOverride path — real code path, 0 real production examples found this session, but fully implemented/testable)
  G25_HUMAN_OVERRIDE: base({
    address: '25 Golden Human Override Ct', asking_price: 100000, arv: 270000, renovation_cost: 50000,
    acquisition_override: { active: true, decision: 'DO_NOT_PURSUE', reason: 'Owner unresponsive after 3 attempts', created_by: 'test', created_at: new Date().toISOString() },
  }),

  // G26 — STALE AI ANALYSIS (deal_analysis.inputs disagree with current arv/reno — real-world shape: 7109 Hallock St)
  G26_STALE_AI: base({
    address: '26 Golden Stale AI Ct', asking_price: 204000, arv: 185000, renovation_cost: 10000, starting_offer: 115700,
    deal_analysis: { inputs: { arv: 185000, renovation_cost: 50000 }, verdict: 'PASS', profit: 21238 },
  }),

  // G27 — INVALID / MISSING CONTACT
  G27_MISSING_CONTACT: base({
    address: '27 Golden No Contact Ct', asking_price: 150000, arv: 200000, renovation_cost: 20000,
    owner_name: null, listing_agent_name: null,
  }),

  // G28 — LEGACY MAO FIELD PRESENT (lead.mao populated by the legacy 0.75xARV formula, diverges from canonical Flip MAO — real-world shape: 7614 Club Duclay Dr)
  G28_LEGACY_MAO: base({
    address: '7614 Golden Legacy MAO Analog', asking_price: 100000, arv: 270000, renovation_cost: 50000, mao: 150050,
  }),

  // G29 — EXTREME REHAB (rehab far exceeds ARV — should reliably signal NO DEAL / negative MAO, never crash)
  G29_EXTREME_REHAB: base({
    address: '29 Golden Extreme Rehab Ct', asking_price: 60000, arv: 150000, renovation_cost: 450000,
  }),

  // G30 — ZERO / EDGE NUMERIC VALUES
  G30_ZERO_EDGE: base({
    address: '30 Golden Zero Edge Ct', asking_price: 0, arv: 150000, renovation_cost: 0, rent_estimate: 0,
  }),
}

// Tests must never mutate the shared GOLDEN_LEADS singletons directly
// (module-level objects are cached across every test file that imports
// them — a mutation in one mutation-matrix test would silently leak into
// every other test). Always read fixtures through this.
export function getGoldenLead(key) {
  const lead = GOLDEN_LEADS[key]
  if (!lead) throw new Error(`Unknown golden lead: ${key}`)
  return structuredClone(lead)
}

// Follow-up-date placeholders are resolved at test-run time (not fixture-
// definition time) so date-dependent fixtures always reflect "today" in
// the test process, per Section 7's "use fixed deterministic dates" via
// explicit offsets rather than a fixture frozen at file-write time.
export function resolveFollowUpDates(todayISODate) {
  const addDays = (dateStr, n) => {
    const [y, m, d] = dateStr.split('-').map(Number)
    const dt = new Date(Date.UTC(y, m - 1, d, 12))
    dt.setUTCDate(dt.getUTCDate() + n)
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
  }
  const map = {
    TODAY_PLACEHOLDER: todayISODate,
    MINUS_7_PLACEHOLDER: addDays(todayISODate, -7),
    PLUS_7_PLACEHOLDER: addDays(todayISODate, 7),
  }
  for (const lead of Object.values(GOLDEN_LEADS)) {
    if (lead.follow_up_date && map[lead.follow_up_date]) {
      lead.follow_up_date = map[lead.follow_up_date]
    }
  }
}
