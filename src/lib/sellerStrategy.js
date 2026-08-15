// src/lib/sellerStrategy.js
// Capability — Off-Market Seller Strategy & Acquisition Playbook.
//
// EVERYTHING in this file is deterministic — no LLM call. Section 30's
// explicit rule ("AI MUST NOT invent seller motivation / claim unverified
// distress is true / invent psychology") is honored structurally: this
// module has no AI call to make in the first place. Next Best Question,
// motivation level, and playbook selection are all plain decision trees
// over fields Kevin has actually entered or the system has actually
// recorded — never inferred prose.
//
// Market-type detection (Section 1) reuses the ONE existing canonical
// detector (src/lib/distressInfo.js's isDistressedLead/getDistressInfo)
// — no second classification system. OFF_MARKET === isDistressedLead(lead).

import { getDistressInfo, isDistressedLead } from './distressInfo.js'

export function getMarketType(lead) {
  return isDistressedLead(lead) ? 'OFF_MARKET' : 'ON_MARKET'
}

// ── Seller Intelligence (Section 29) ────────────────────────────────────
// Reuses the existing lead.distress_data JSONB column (no migration, no
// new DB columns) — adds one nested object, seller_intelligence, that
// only off-market leads ever populate.
const EMPTY_SI = {
  open_to_sell: null,          // 'YES' | 'MAYBE' | 'NO' | null (unknown)
  motivation_notes: '',
  pain_points: [],             // e.g. ['TAXES','TENANT','VACANT']
  timeline: null,              // 'ASAP' | '<30_DAYS' | '30_60_DAYS' | '60_90_DAYS' | '90_PLUS_DAYS' | 'NO_TIMELINE'
  condition_notes: '',
  seller_asking_price: null,
  desired_outcome: [],         // e.g. ['MAX_PRICE','FAST_CLOSING','NO_REPAIRS']
  decision_makers: '',
  debt_notes: '',
  objections: [],
  last_response: '',
  next_step: '',
}

export function getSellerIntelligence(lead) {
  const raw = lead?.distress_data?.seller_intelligence
  return { ...EMPTY_SI, ...(raw && typeof raw === 'object' ? raw : {}) }
}

// Merges a partial seller_intelligence patch into lead.distress_data,
// returning the full distress_data object ready to pass to useLeadUpdate.
// Never touches any other distress_data field (distress_type/category/etc).
export function mergeSellerIntelligence(lead, patch) {
  const current = getSellerIntelligence(lead)
  return {
    ...(lead?.distress_data || {}),
    seller_intelligence: { ...current, ...patch },
  }
}

// ── Motivation level (Section 11) — deterministic, from recorded fields only ──
export function getMotivationLevel(si) {
  if (!si || si.open_to_sell == null) {
    return { level: 'UNKNOWN', reason: 'No seller conversation recorded yet.' }
  }
  if (si.open_to_sell === 'NO') {
    return { level: 'LOW', reason: 'Seller indicated they are not planning to sell.' }
  }
  const hasPain = si.pain_points.length > 0
  const hasTimeline = si.timeline && si.timeline !== 'NO_TIMELINE'
  if (hasPain && hasTimeline) {
    return { level: 'STRONG', reason: 'Clear problem identified and a timeline exists.' }
  }
  if (hasPain) {
    return { level: 'MODERATE', reason: 'Clear reason exists but no urgency/timeline yet.' }
  }
  return { level: 'POSSIBLE', reason: 'Seller is open, but no reason or timeline identified yet.' }
}

const TIMELINE_LABELS = {
  ASAP: 'ASAP', '<30_DAYS': '< 30 Days', '30_60_DAYS': '30–60 Days',
  '60_90_DAYS': '60–90 Days', '90_PLUS_DAYS': '90+ Days', NO_TIMELINE: 'No Timeline',
}

// ── Four Key Seller Dimensions (Section 12) ─────────────────────────────
export function getSellerSnapshot(lead) {
  const si = getSellerIntelligence(lead)
  const motivation = getMotivationLevel(si)
  return {
    motivation: motivation.level,
    motivationReason: motivation.reason,
    timeline: si.timeline ? (TIMELINE_LABELS[si.timeline] || si.timeline) : 'UNKNOWN',
    condition: si.condition_notes ? 'RECORDED' : 'UNKNOWN',
    price: si.seller_asking_price != null ? `$${Number(si.seller_asking_price).toLocaleString()}` : 'UNKNOWN',
    decisionMaker: si.decision_makers || 'UNKNOWN',
    debtTitle: si.debt_notes || null,
  }
}

// ── Next Best Question (Section 27) — one deterministic decision tree ──
export function getNextBestQuestion(lead, si) {
  si = si || getSellerIntelligence(lead)
  if (si.open_to_sell == null) {
    return "Would you have any interest in selling the property if the numbers and timing made sense?"
  }
  if (si.open_to_sell === 'NO') {
    return null // Section 23 — respect "no", nothing to ask
  }
  if (si.pain_points.length === 0) {
    return "Besides me calling today, what would make you consider selling?"
  }
  if (!si.timeline) {
    return "If you decided to sell, when would you ideally want everything completed?"
  }
  if (si.seller_asking_price == null && si.desired_outcome.length === 0) {
    return "Have you given any thought to what you'd want to walk away with?"
  }
  if (!si.decision_makers) {
    return "If we got to a number that worked for you, is there anyone else who'd need to be involved in the decision?"
  }
  return "You've got the pieces you need — recap priorities, then move to Offer Presentation when ready."
}

// ── Distress signal → playbook (Section 10, 28) ─────────────────────────
// Keyed by the EXISTING distress_category taxonomy (distressScoring.js) —
// no new categories invented. Every entry is phrased as a signal to
// VERIFY, never a conclusion (Section 3/28's explicit rule).
export const DISTRESS_PLAYBOOKS = {
  TAX_RELATED: {
    label: 'Tax Delinquency',
    whatWeKnow: 'A tax-related record was found for this property.',
    verify: "Are there any taxes or other balances tied to the property that we'd need to account for if you decided to sell?",
    followUps: ["How long has that been an issue?", "What are you hoping to do about it?", "If that were taken care of at closing, would that help?"],
    avoid: ["I see you're behind on taxes.", "You owe back taxes."],
  },
  MORTGAGE_FORECLOSURE: {
    label: 'Mortgage / Foreclosure',
    whatWeKnow: 'A foreclosure-related filing was found for this property.',
    verify: "If we bought the property, are there any mortgages or balances we'd need to take care of through closing?",
    followUps: ["Do you have a rough idea of the payoff amount?", "What's your timeline looking like?", "What outcome would work best for you here?"],
    avoid: ["You're in foreclosure.", "You're about to lose the house.", any_urgency_language()],
  },
  HOA_CONDO_LIEN: {
    label: 'HOA / Condo Lien',
    whatWeKnow: 'An HOA or condo association lien was found for this property.',
    verify: "Are there any HOA balances or liens we'd need to account for if you decided to sell?",
    followUps: ["Do you know roughly how much is owed?", "Has that been an ongoing issue?"],
    avoid: ["You have a lien."],
  },
  MUNICIPAL_LIEN: {
    label: 'Municipal Lien / Code Issue',
    whatWeKnow: 'A municipal lien or code-related record was found for this property.',
    verify: "Are there any repairs or city issues with the property we should know about?",
    followUps: ["Has the city reached out about repairs?", "If you didn't have to make those repairs yourself, would selling as-is be something you'd consider?"],
    avoid: ["You have code violations.", "The city is going to fine you."],
  },
  CONTRACTOR_LIEN: {
    label: 'Contractor / Mechanic’s Lien',
    whatWeKnow: 'A contractor lien was found for this property.',
    verify: "If we bought the property, are there any contractor balances or liens we'd need to take care of through closing?",
    followUps: ["Do you know roughly how much is owed?"],
    avoid: ["You have unpaid contractor bills."],
  },
  OTHER_CIVIL: {
    label: 'Other Recorded Filing',
    whatWeKnow: 'A civil filing was found for this property.',
    verify: "Are there any balances or legal matters tied to the property we'd need to know about if you decided to sell?",
    followUps: ["Is that something still active?"],
    avoid: ["I see you have a legal issue."],
  },
  UNKNOWN: {
    label: 'Distress Signal (Unclassified)',
    whatWeKnow: 'A distress-adjacent record was found for this property, but the type isn’t classified yet.',
    verify: "Are there any balances or situations tied to the property we should be aware of if you decided to sell?",
    followUps: [],
    avoid: [],
  },
}

function any_urgency_language() { return 'Any language implying urgency or threat.' }

const ABSENTEE_PLAYBOOK = {
  label: 'Absentee Owner',
  whatWeKnow: 'Public records suggest the owner’s mailing address differs from the property address.',
  verify: "How often are you able to get out to the property these days?",
  followUps: ["How's the property being managed from a distance?", "Any plans for it long-term?"],
  avoid: ["You clearly don't want this property."],
}

// Real-data check (Section 45) found distress_category is rarely
// populated on actual leads — only distress_type (lis_pendens/
// recorded_lien) reliably is. A Lis Pendens is, as a matter of public
// record fact (not an inference about THIS seller), a foreclosure-type
// filing — decisionEngineV2.js's own urgency computation already treats
// it that way ("Foreclosure filed N days ago"). Used only as a fallback
// when the more specific distress_category isn't available.
const TYPE_TO_CATEGORY_FALLBACK = { lis_pendens: 'MORTGAGE_FORECLOSURE' }

// Returns the ordered list of relevant playbooks for this lead — never
// all of them (Section 10: "Do NOT show all of them. Only surface the
// relevant one(s).").
export function getRelevantPlaybooks(lead) {
  const dd = getDistressInfo(lead)
  if (!dd) return []
  const out = []
  const cat = dd.distress_category || TYPE_TO_CATEGORY_FALLBACK[dd.distress_type]
  if (cat && DISTRESS_PLAYBOOKS[cat]) out.push(DISTRESS_PLAYBOOKS[cat])
  else if (dd.distress_type) out.push(DISTRESS_PLAYBOOKS.UNKNOWN)
  if (dd.absentee_owner === true) out.push(ABSENTEE_PLAYBOOK)
  return out
}

// ── Retail vs Cash-As-Is comparison (Section 17) — text only, no numbers
// invented; HAT MAO is passed in from the canonical calculation layer. ──
export function getRetailVsCashFraming() {
  return {
    retail: ['Potentially higher gross price', 'But: repairs, showings, buyer financing, appraisal, inspection, commissions, more time'],
    hat: ['Buy AS-IS — no repairs needed', 'Cash / dependable funding', 'Flexible closing timeline', 'Simple, fewer moving pieces'],
    ask: 'Which is more important to you — getting every possible dollar, or having a simpler as-is sale?',
  }
}

// ── Scenario Library (Section 24) — compact, deterministic ──────────────
export const SCENARIO_LIBRARY = [
  {
    key: 'JUST_GIVE_ME_OFFER', signal: '"Just give me an offer."',
    means: 'Seller wants a number fast — may be testing you, may genuinely be busy.',
    objective: 'Get enough info to make a real number, without negotiating against yourself.',
    tryS: "Fair enough — I did call you. I can work toward a number, I just don't want to throw out something random without understanding the property. Can I ask a few quick questions first?",
    next: 'Move into property condition + motivation discovery.',
    avoid: 'Do not blurt out a lowball number with zero information.',
  },
  {
    key: 'WHY_CALLING', signal: '"Why are you calling me?"',
    means: 'Seller is guarded or unfamiliar with direct-buyer outreach.',
    objective: 'Explain plainly and reduce suspicion.',
    tryS: "Totally fair question — we're a local investment company looking to buy another property in the area, and yours came up. No pressure at all if it's not something you're interested in.",
    next: 'Return to Connect stage.',
    avoid: 'Do not sound scripted or evasive.',
  },
  {
    key: 'NOT_INTERESTED', signal: '"I\'m not interested."',
    means: 'Could be a real no, or could be too early in the conversation.',
    objective: 'Respect it, leave the door open.',
    tryS: "Totally understand — I appreciate you taking the call. If anything changes down the road, feel free to keep us in mind.",
    next: 'Log as NOT MOTIVATED. Long-term nurture only if appropriate.',
    avoid: 'Do not push past a clear no.',
  },
  {
    key: 'MAYBE_SELL', signal: '"Maybe, depends on price."',
    means: 'Seller is open — move to Discovery.',
    objective: 'Understand motivation before price.',
    tryS: "That's great to hear. Besides me calling today, what would make you consider selling?",
    next: 'Discover motivation.',
    avoid: 'Do not jump straight to a number.',
  },
  {
    key: 'WHAT_WILL_YOU_PAY', signal: '"What will you pay?"',
    means: 'Same as "just give me an offer" — wants a number.',
    objective: 'Same as JUST_GIVE_ME_OFFER.',
    tryS: "I want to give you a real number, not a guess — can I ask a couple quick things about the property first?",
    next: 'Move into property condition discovery.',
    avoid: 'Do not anchor high or low without data.',
  },
  {
    key: 'OFFER_TOO_LOW', signal: '"Your offer is too low."',
    means: "There's a gap — could be expectations, could be real value seller doesn't know we don't include.",
    objective: 'Understand the gap before moving the number.',
    tryS: "I understand. Where were you hoping we'd be?",
    next: 'Ask how they arrived at that number; compare to HAT MAO and remaining room.',
    avoid: 'Do not immediately raise the offer.',
  },
  {
    key: 'WANT_RETAIL', signal: '"I want retail / Zillow says it\'s worth more."',
    means: 'Seller is anchored to a market value number, not an as-is investor number.',
    objective: 'Determine whether convenience matters enough to consider investor pricing.',
    tryS: "You may be able to get closer to that by listing it. Our option is different — we buy as-is and handle the work after closing. Is getting the highest price the main priority, or would a simpler as-is sale also matter to you?",
    next: 'If max price is everything: recommend NOT A CURRENT FIT — retail/realtor path may be better.',
    avoid: 'Do not argue that their number is wrong.',
  },
  {
    key: 'LIST_WITH_REALTOR', signal: '"I\'ll just list it with a realtor."',
    means: 'Seller values maximum price over convenience — may not be a fit right now.',
    objective: 'Respect it, leave door open.',
    tryS: "That's a completely fair option too. If the listing process ends up being more than you want to deal with, feel free to reach back out.",
    next: 'Log as RETAIL PATH PREFERRED. Long-term follow-up only.',
    avoid: 'Do not disparage realtors or listing.',
  },
  {
    key: 'TALK_TO_SPOUSE', signal: '"I need to talk to my spouse."',
    means: 'A real decision maker hasn’t weighed in yet.',
    objective: 'Confirm this and set a concrete follow-up.',
    tryS: "Makes sense — when's a good time for me to follow up once you've had a chance to talk?",
    next: 'Capture decision maker + specific follow-up date.',
    avoid: 'Do not pressure for an answer today.',
  },
  {
    key: 'NEED_TO_THINK', signal: '"I need to think about it."',
    means: 'Something specific is still unresolved — price, timing, or process.',
    objective: 'Diagnose which, without pressuring.',
    tryS: "Of course. Usually when someone wants to think about it, there's one part they're still unsure about — is it mainly the price, the timing, or something about the process?",
    next: 'Set a specific follow-up (e.g. "Would Thursday afternoon work for me to check back?").',
    avoid: 'Do not push for an immediate yes/no.',
  },
  {
    key: 'ANOTHER_OFFER', signal: '"I have another offer."',
    means: 'Possible leverage, possibly true, possibly a negotiating tactic.',
    objective: 'Understand it without getting into a bidding war blindly.',
    tryS: "Good to know — mind me asking what that offer looks like, so I can see how we compare?",
    next: 'Compare against HAT MAO before responding.',
    avoid: 'Do not automatically outbid without underwriting.',
  },
  {
    key: 'NOT_IN_RUSH', signal: '"I\'m not in a rush."',
    means: 'Low urgency — still may be a future deal.',
    objective: 'Understand timeline realistically, don’t force one.',
    tryS: "Totally fine — no rush needed on our end either. When you say not in a rush, is that weeks, months, or more just “someday”?",
    next: 'Log timeline; set appropriate nurture follow-up.',
    avoid: 'Do not manufacture urgency.',
  },
  {
    key: 'HAS_TENANTS', signal: '"Property has tenants."',
    means: 'Landlord may be dealing with tenant management burden.',
    objective: 'Understand tenant status and whether that’s a pain point.',
    tryS: "Got it — how's that been going with the tenants?",
    next: 'Discover payment status, lease, and whether landlord fatigue is present.',
    avoid: 'Do not assume the tenants are a problem — ask.',
  },
  {
    key: 'IS_VACANT', signal: '"Property is vacant."',
    means: 'Could be a maintenance/holding burden.',
    objective: 'Understand how long, and why.',
    tryS: "How long has it been sitting vacant?",
    next: 'Discover condition, utilities, security, and why it hasn’t been rented/sold.',
    avoid: 'Do not assume neglect or damage without asking.',
  },
  {
    key: 'OWE_TOO_MUCH', signal: '"I owe too much on it."',
    means: 'Possible payoff/equity concern.',
    objective: 'Understand the real numbers, gently.',
    tryS: "Understood — do you have a rough idea what's owed? That helps me see if this makes sense for both of us.",
    next: 'Capture debt notes; verify through title at closing, never assume.',
    avoid: 'Do not treat this as automatic distress.',
  },
  {
    key: 'LIENS_TAXES', signal: '"There are liens/taxes owed."',
    means: 'Confirmed balance the seller is aware of.',
    objective: 'Understand amount and whether resolving it at closing would help.',
    tryS: "If that were handled at closing as part of the sale, would that help?",
    next: 'Capture debt notes; verify through title.',
    avoid: 'Do not promise a specific payoff amount.',
  },
  {
    key: 'INHERITED', signal: '"I inherited it."',
    means: 'Probate / estate situation — use extra sensitivity.',
    objective: 'Understand logistics, not personal grief.',
    tryS: "Do you plan to keep the property, or are you considering selling it? Are there other family members involved in the decision?",
    next: 'Confirm whether estate/title process allows a sale yet. Never give legal advice.',
    avoid: 'Do not probe grief. Do not give legal/probate advice.',
  },
  {
    key: 'UNKNOWN_CONDITION', signal: '"I don’t know the condition."',
    means: 'Owner may be absentee or genuinely unsure.',
    objective: 'Get a general picture, not a full inspection.',
    tryS: "No worries — even a general picture helps. If you walked through today, what do you think you'd see?",
    next: 'Log condition_notes with whatever is known; flag as low-confidence.',
    avoid: 'Do not fabricate a condition assessment.',
  },
  {
    key: 'CALL_ME_LATER', signal: '"Call me later."',
    means: 'Timing is bad right now, not necessarily disinterest.',
    objective: 'Respect it and set a concrete time.',
    tryS: "No problem at all — what's a better time for me to reach you?",
    next: 'Set a specific follow-up date/time.',
    avoid: 'Do not keep talking past this request.',
  },
]

// ── Conversation stages (Section 4) ─────────────────────────────────────
export const CALL_STAGES = ['CONNECT', 'DISCOVER', 'UNDERSTAND', 'SOLVE', 'PRICE', 'NEXT STEP']

export const PAIN_POINT_OPTIONS = [
  { key: 'NO_MOTIVATION', label: 'No motivation' },
  { key: 'REPAIRS', label: 'Repairs' },
  { key: 'TAXES', label: 'Taxes' },
  { key: 'TENANT', label: 'Tenant / Landlord fatigue' },
  { key: 'VACANT', label: 'Vacant property' },
  { key: 'INHERITED', label: 'Inherited / Probate' },
  { key: 'FINANCIAL', label: 'Financial burden' },
  { key: 'RELOCATION', label: 'Relocation / Job change' },
  { key: 'DIVORCE', label: 'Divorce / Ownership change' },
  { key: 'OTHER', label: 'Other' },
]

export const TIMELINE_OPTIONS = [
  { key: 'ASAP', label: 'ASAP' },
  { key: '<30_DAYS', label: '< 30 Days' },
  { key: '30_60_DAYS', label: '30–60 Days' },
  { key: '60_90_DAYS', label: '60–90 Days' },
  { key: '90_PLUS_DAYS', label: '90+ Days' },
  { key: 'NO_TIMELINE', label: 'No Timeline' },
]

export const DESIRED_OUTCOME_OPTIONS = [
  'MAX_PRICE', 'FAST_CLOSING', 'NO_REPAIRS', 'CERTAINTY', 'NO_SHOWINGS',
  'TENANT_PROBLEM_SOLVED', 'DEBT_RESOLVED', 'FLEXIBLE_CLOSING', 'LEAVE_ITEMS_BEHIND', 'CONVENIENCE', 'OTHER',
]

// ── Call objective (Section 25's "CALL OBJECTIVE") ──────────────────────
export function getCallObjective(lead) {
  const si = getSellerIntelligence(lead)
  const owner = lead?.owner_name ? lead.owner_name.split(' ')[0] : 'the owner'
  if (si.open_to_sell == null) return `Find out whether ${owner} is actually open to selling and why.`
  if (si.open_to_sell === 'NO') return `${owner} said no — respect it. Only revisit if something material changes.`
  if (si.pain_points.length === 0) return `${owner} is open — understand what would make them consider selling.`
  if (!si.timeline) return `Understand ${owner}'s timeline if they decided to sell.`
  if (si.seller_asking_price == null) return `Understand what ${owner} would want to walk away with.`
  return `Move toward presenting an offer to ${owner}.`
}
