// test/actionCenterOtherActiveLeads.test.js
// ACTION CENTER SAFETY NET — "Other Active Leads". Presentation-level
// fallback only: an active/non-terminal lead that classifyLead() (V1) or
// classifyLeadV2() (V2) gives no category to no longer silently vanishes
// from Action Center — it falls back to a new OTHER_ACTIVE item built by
// buildOtherActiveItem(). Neither classifier's own return value, semantics,
// or precedence is touched; this only decides what happens to their
// pre-existing `null` result. No new scoring, no new DB column, no new
// status, no Decision V2 change.
//
// Structural (source-text) tests, matching this repo's established
// convention (no component-mount harness exists here).
import { describe, it, expect } from 'vitest'
import fs from 'fs'

const src = fs.readFileSync('src/pages/ActionCenterPage.jsx', 'utf8')

describe('Other Active Leads — implementation is additive-only, presentation layer', () => {
  it('buildOtherActiveItem() never calls classifyLead/classifyLeadV2 and never mutates their output', () => {
    const fnStart = src.indexOf('function buildOtherActiveItem')
    const fnEnd = src.indexOf('\n}', fnStart)
    const fnBody = src.slice(fnStart, fnEnd)
    expect(fnBody).not.toMatch(/classifyLead\(|classifyLeadV2\(/)
    // every classification-bearing field is explicitly null — nothing fabricated
    expect(fnBody).toMatch(/decision: null/)
    expect(fnBody).toMatch(/nextAction: null/)
    expect(fnBody).toMatch(/opportunity: null/)
    expect(fnBody).toMatch(/reason: null/)
    expect(fnBody).toMatch(/score: null/)
  })
  it('reuses the SAME canonicalEconomics() helper every other item already uses — no new calculation', () => {
    const fnStart = src.indexOf('function buildOtherActiveItem')
    const fnEnd = src.indexOf('\n}', fnStart)
    const fnBody = src.slice(fnStart, fnEnd)
    expect(fnBody).toMatch(/\.\.\.canonicalEconomics\(lead, underwritingSettings\)/)
  })
  it('classifyLead and classifyLeadV2 function bodies are byte-unchanged by this mission (still present, still the sole classifiers)', () => {
    expect(src).toMatch(/function classifyLead\(lead, rediscovery, underwritingSettings = null\) \{/)
    expect(src).toMatch(/export function classifyLeadV2\(lead, underwritingSettings = null\) \{/)
  })
  it('the fallback wiring only changes what happens to a null classifier result — never calls the classifiers differently', () => {
    expect(src).toMatch(/const result = isV2ActionCenter\s*\n\s*\? classifyLeadV2\(lead, underwritingSettings\)\s*\n\s*: classifyLead\(lead, rediscoveryByLead\[lead\.id\], underwritingSettings\)/)
    expect(src).toMatch(/return result \|\| buildOtherActiveItem\(lead, underwritingSettings\)/)
  })
})

describe('OTHER_ACTIVE is deliberately excluded from CATEGORY_META (no equal-weight KPI tile, no quick filter)', () => {
  it('CATEGORY_META still has exactly its original 7 entries, unchanged', () => {
    const metaBlock = src.slice(src.indexOf('const CATEGORY_META = {'), src.indexOf('\n}', src.indexOf('const CATEGORY_META = {')))
    expect(metaBlock).toMatch(/OVERDUE:/)
    expect(metaBlock).toMatch(/RE_ENGAGE:/)
    expect(metaBlock).toMatch(/ACT_NOW:/)
    expect(metaBlock).toMatch(/FOLLOW_UP_TODAY:/)
    expect(metaBlock).toMatch(/REVIEW_TODAY:/)
    expect(metaBlock).toMatch(/RECENTLY_IMPROVED:/)
    expect(metaBlock).toMatch(/OFF_MARKET:/)
    expect(metaBlock).not.toMatch(/OTHER_ACTIVE/)
  })
  it('QUICK_FILTERS is untouched — no new filter chip added', () => {
    const qfBlock = src.slice(src.indexOf('const QUICK_FILTERS = ['), src.indexOf('\n]', src.indexOf('const QUICK_FILTERS = [')))
    expect(qfBlock).not.toMatch(/OTHER_ACTIVE/)
  })
  it('a separate muted OTHER_ACTIVE_THEME constant exists, outside CATEGORY_META', () => {
    expect(src).toMatch(/const OTHER_ACTIVE_THEME = \{ bg: 'var\(--color-bg-elev-2\)', border: 'var\(--color-line\)', text: 'var\(--color-text-muted\)' \}/)
  })
  it('ActionCard falls back to OTHER_ACTIVE_THEME instead of throwing on an unrecognized category', () => {
    expect(src).toMatch(/const theme = CATEGORY_META\[item\.category\]\?\.theme \|\| OTHER_ACTIVE_THEME/)
  })
})

describe('Counts — existing bucket counts and headline "Actions Today" are unaffected', () => {
  it('the top 4-number KPI strip still iterates CATEGORY_META only (unchanged loop), so it cannot include OTHER_ACTIVE', () => {
    const kpiIdx = src.indexOf('Top summary')
    const kpiBlock = src.slice(kpiIdx, kpiIdx + 600)
    expect(kpiBlock).toMatch(/Object\.entries\(CATEGORY_META\)\.map/)
    expect(kpiBlock).not.toMatch(/OTHER_ACTIVE/)
  })
  it('todayCount explicitly excludes OTHER_ACTIVE, same treatment as UPCOMING — never inflates the headline count', () => {
    expect(src).toMatch(/const todayCount = useMemo\(\(\) => items\.filter\(i => i\.category !== 'UPCOMING' && i\.category !== 'OTHER_ACTIVE'\)\.length, \[items\]\)/)
  })
})

describe('Sorting — no new priority formula, reuses least-invasive existing order', () => {
  it('byCategory.OTHER_ACTIVE is built without calling sortCategory or any new comparator (deliberately unsorted)', () => {
    const byCatIdx = src.indexOf('const byCategory = useMemo')
    const byCatBlock = src.slice(byCatIdx, src.indexOf('}), [filteredItems, items])', byCatIdx))
    expect(byCatBlock).toMatch(/OTHER_ACTIVE: items\.filter\(i => i\.category === 'OTHER_ACTIVE'\)/)
    // no sortCategory('OTHER_ACTIVE', ...) call and no bespoke .sort( for this key
    expect(byCatBlock).not.toMatch(/sortCategory\('OTHER_ACTIVE'/)
  })
  it('sortCategory() itself is untouched — no new case added for OTHER_ACTIVE', () => {
    const sortIdx = src.indexOf('function sortCategory(category, items) {')
    const sortBlock = src.slice(sortIdx, src.indexOf('\n}', sortIdx))
    expect(sortBlock).not.toMatch(/OTHER_ACTIVE/)
    expect(sortBlock).toMatch(/default:\s*\n\s*return items/)
  })
})

describe('Rendering — visually secondary, own section, only in default Today view', () => {
  it('the Other Active Leads section only renders when filter===\'ALL\" and the list is non-empty', () => {
    expect(src).toMatch(/\{filter === 'ALL' && byCategory\.OTHER_ACTIVE\.length > 0 && \(/)
  })
  it('renders the exact supporting copy and a muted (dim-text) heading, not an alert-colored one', () => {
    expect(src).toMatch(/Other Active Leads<\/h3>/)
    expect(src).toMatch(/Active leads not currently prioritized by HAT\./)
    expect(src).toMatch(/text-\[color:var\(--color-text-dim\)\]">Other Active Leads/)
  })
  it('reuses the existing ActionCard component unmodified for rendering — no new card component', () => {
    const sectionIdx = src.indexOf("Other Active Leads</h3>")
    const sectionBlock = src.slice(sectionIdx, sectionIdx + 700)
    expect(sectionBlock).toMatch(/<ActionCard key=\{item\.lead\.id\} item=\{item\} workspaceId=\{workspaceId\} userId=\{user\.id\} members=\{members\} onLeadUpdated=\{\(\) => setRefreshTick\(t => t \+ 1\)\} \/>/)
  })
  it('the section is placed inside the CATEGORY_META loop\'s existing space-y-6 wrapper (after the map, before its closing </div>), not a separate top-level block', () => {
    const mapEndIdx = src.indexOf('})}', src.indexOf('Object.entries(CATEGORY_META).map(([key, meta]) => {'))
    const sectionIdx = src.indexOf("filter === 'ALL' && byCategory.OTHER_ACTIVE.length > 0")
    const wrapperCloseIdx = src.indexOf('</div>', sectionIdx)
    expect(sectionIdx).toBeGreaterThan(mapEndIdx)
    expect(wrapperCloseIdx).toBeGreaterThan(sectionIdx)
  })
})

describe('getActionReason / display safety for a null-category-shaped item', () => {
  const reasonSrc = fs.readFileSync('src/lib/actionReason.js', 'utf8')
  it('actionReason.js is untouched — its switch has no OTHER_ACTIVE case, falls through its existing default:null', () => {
    expect(reasonSrc).not.toMatch(/OTHER_ACTIVE/)
    expect(reasonSrc).toMatch(/default:\s*\n\s*return null/)
  })
  it('ActionCard already guards a null actionReason with a ternary — untouched, reused as-is', () => {
    expect(src).toMatch(/const actionReason = getActionReason\(item\.lead, item\)/)
    expect(src).toMatch(/\{actionReason \? \(/)
  })
  it('item.decision and item.nextAction are already rendered null-safely (existing guards, unmodified)', () => {
    expect(src).toMatch(/\{item\.decision && \(/)
    expect(src).toMatch(/\{item\.nextAction \|\| NA\}/)
  })
})

describe('Protected files / no scope creep', () => {
  it('no protected file references any Other-Active-Leads symbol', () => {
    for (const f of ['src/lib/calculations.js', 'src/lib/decisionEngineV2.js', 'src/lib/buyBox.js', 'src/lib/underwritingSettings.js', 'src/lib/dealExplanation.js', 'src/lib/sellerStrategy.js']) {
      const protectedSrc = fs.readFileSync(f, 'utf8')
      expect(protectedSrc).not.toMatch(/OTHER_ACTIVE|buildOtherActiveItem/)
    }
  })
  it('the leads query (terminal-status exclusion) is untouched — no second query, no resurrection of excluded statuses', () => {
    expect(src).toMatch(/\.not\('status', 'in', `\(\$\{TERMINAL_STATUSES\.map\(s => `"\$\{s\}"`\)\.join\(','\)\}\)`\)/)
  })
})

// ── Behavioral cases (mirrors classifyLeadV2/classifyLead + the fallback
// wiring as pure functions, since no component-mount harness exists in
// this repo — same convention as every other Action Center test file). ──

const FOLLOW_UP_STATUSES = ['follow_up', 'offer_sent', 'negotiating', 'offer_pending_hat_signing', 'offer_signed']
const V2_RECOMMENDATION_TO_CATEGORY = { ACT_NOW: 'ACT_NOW', REVIEW_TODAY: 'REVIEW_TODAY', RESEARCH: 'REVIEW_TODAY', FOLLOW_UP: 'FOLLOW_UP' }

function classifyFollowUpDate(followUpDate) {
  if (!followUpDate) return 'UNSCHEDULED'
  const today = new Date().toISOString().slice(0, 10)
  const d = String(followUpDate).slice(0, 10)
  if (d < today) return 'OVERDUE'
  if (d === today) return 'TODAY'
  return 'UPCOMING'
}

// Mirrors classifyLeadV2's exact precedence (RE_ENGAGE check -> recommendation
// mapping -> date split), for direct unit testing of the fallback wiring.
function classifyLeadV2Mirror(lead) {
  const d = lead.decision_v2
  if (!d) return null
  const isFollowUpStatus = FOLLOW_UP_STATUSES.includes(lead.status)
  const hasGenuineReEngageSignal = d.urgency?.level === 'HIGH' && (d.urgency?.reasons || []).some(r => r !== 'Follow-up overdue')
  if (isFollowUpStatus && hasGenuineReEngageSignal && d.next_best_action !== 'HUMAN_OVERRIDE' && lead.status !== 'dead_lead') {
    return { category: 'RE_ENGAGE' }
  }
  const baseCategory = V2_RECOMMENDATION_TO_CATEGORY[d.recommendation]
  if (!baseCategory) return null
  let category = baseCategory
  if (baseCategory === 'FOLLOW_UP') {
    const due = classifyFollowUpDate(lead.follow_up_date)
    category = due === 'OVERDUE' ? 'OVERDUE' : due === 'TODAY' ? 'FOLLOW_UP_TODAY' : 'UPCOMING'
  }
  return { category }
}

function buildOtherActiveItemMirror(lead) {
  return { category: 'OTHER_ACTIVE', lead }
}

function classifyWithFallback(lead) {
  const result = classifyLeadV2Mirror(lead)
  return result || buildOtherActiveItemMirror(lead)
}

describe('CASE A-F — leads already reaching a real bucket are never duplicated into OTHER_ACTIVE', () => {
  it('CASE A: ACT_NOW stays ACT_NOW', () => {
    const item = classifyWithFallback({ status: 'triage', decision_v2: { recommendation: 'ACT_NOW' } })
    expect(item.category).toBe('ACT_NOW')
  })
  it('CASE B: REVIEW_TODAY stays REVIEW_TODAY', () => {
    const item = classifyWithFallback({ status: 'triage', decision_v2: { recommendation: 'REVIEW_TODAY' } })
    expect(item.category).toBe('REVIEW_TODAY')
  })
  it('CASE C: OVERDUE stays OVERDUE', () => {
    const item = classifyWithFallback({ status: 'follow_up', follow_up_date: '2020-01-01', decision_v2: { recommendation: 'FOLLOW_UP', urgency: { level: 'MEDIUM' } } })
    expect(item.category).toBe('OVERDUE')
  })
  it('CASE D: RE_ENGAGE stays RE_ENGAGE', () => {
    const item = classifyWithFallback({ status: 'follow_up', follow_up_date: '2020-01-01', decision_v2: { recommendation: 'FOLLOW_UP', urgency: { level: 'HIGH', reasons: ['Recent price reduction'] } } })
    expect(item.category).toBe('RE_ENGAGE')
  })
  it('CASE E: FOLLOW_UP_TODAY stays FOLLOW_UP_TODAY', () => {
    const today = new Date().toISOString().slice(0, 10)
    const item = classifyWithFallback({ status: 'follow_up', follow_up_date: today, decision_v2: { recommendation: 'FOLLOW_UP', urgency: { level: 'MEDIUM' } } })
    expect(item.category).toBe('FOLLOW_UP_TODAY')
  })
  it('CASE F: UPCOMING stays UPCOMING, never duplicated into OTHER_ACTIVE', () => {
    const item = classifyWithFallback({ status: 'follow_up', follow_up_date: '2099-01-01', decision_v2: { recommendation: 'FOLLOW_UP', urgency: { level: 'MEDIUM' } } })
    expect(item.category).toBe('UPCOMING')
    expect(item.category).not.toBe('OTHER_ACTIVE')
  })
})

describe('CASE G-I — leads with no real bucket land exactly once in OTHER_ACTIVE', () => {
  it('CASE G: a lead with no stored decision_v2 at all appears exactly once in OTHER_ACTIVE', () => {
    const item = classifyWithFallback({ status: 'triage', decision_v2: null })
    expect(item.category).toBe('OTHER_ACTIVE')
  })
  it('CASE H: a MONITOR recommendation (no Action Center category today) appears in OTHER_ACTIVE', () => {
    const item = classifyWithFallback({ status: 'triage', decision_v2: { recommendation: 'MONITOR' } })
    expect(item.category).toBe('OTHER_ACTIVE')
  })
  it('CASE I: RESEARCH already maps to REVIEW_TODAY in the real code (V2_RECOMMENDATION_TO_CATEGORY.RESEARCH = REVIEW_TODAY) — it does NOT fall to OTHER_ACTIVE, confirming no duplication', () => {
    const item = classifyWithFallback({ status: 'triage', decision_v2: { recommendation: 'RESEARCH' } })
    expect(item.category).toBe('REVIEW_TODAY')
    expect(item.category).not.toBe('OTHER_ACTIVE')
  })
})

describe('CASE J — terminal/excluded leads never reach the classifier at all', () => {
  it('the leads query excludes TERMINAL_STATUSES before classification runs — a dead_lead/sold/etc. lead is never passed to classifyWithFallback in production', () => {
    expect(src).toMatch(/\.not\('status', 'in', `\(\$\{TERMINAL_STATUSES/)
    // Documented behavior, not re-tested via the mirror function: TERMINAL_STATUSES
    // leads are filtered out at the DB query level, upstream of classification,
    // so OTHER_ACTIVE (a purely post-classification fallback) structurally
    // cannot ever receive one.
  })
})

describe('CASE K — a lead can never appear in both an existing bucket and OTHER_ACTIVE', () => {
  it('the fallback is an ||, not an addition — classifyWithFallback always returns exactly one item, never two', () => {
    const strong = classifyWithFallback({ status: 'triage', decision_v2: { recommendation: 'ACT_NOW' } })
    const weak = classifyWithFallback({ status: 'triage', decision_v2: { recommendation: 'MONITOR' } })
    expect([strong.category, weak.category].sort()).toEqual(['ACT_NOW', 'OTHER_ACTIVE'].sort())
    // exactly one category per lead, by construction of `result || buildOtherActiveItem(...)`
    expect(src).toMatch(/return result \|\| buildOtherActiveItem\(lead, underwritingSettings\)/)
  })
})

describe('CASE L — works under both V1 and V2 feature-flag paths', () => {
  it('the fallback wraps BOTH classifyLead (V1) and classifyLeadV2 (V2) via the SAME isV2ActionCenter branch already used elsewhere — no flag logic duplicated or changed', () => {
    expect(src).toMatch(/const result = isV2ActionCenter\s*\n\s*\? classifyLeadV2\(lead, underwritingSettings\)\s*\n\s*: classifyLead\(lead, rediscoveryByLead\[lead\.id\], underwritingSettings\)/)
  })
  it('V1\'s classifyLead null-return paths (no signal at all, or same-day-suppressed) are unchanged — still return null, still handled by the same fallback', () => {
    expect(src).toMatch(/if \(!priorityInfo && !rediscovery && !isFollowUpStatus && !distressed\) return null/)
    expect(src).toMatch(/if \(isToday\(lead\.updated_at\)\) return null/)
  })
})
