// test/callDetailUX.test.js
// Coaching Call Detail UX / Manager Scanability V1 — presentation and
// information-architecture only. Structural/source-inspection tests (no
// component-mount harness in this repo — established convention, see
// callReviewAbort.test.js etc.). Every assertion here targets PLACEMENT
// and PRESENCE, never the underlying coaching/scoring computation, which
// lives untouched in netlify/functions/generate-call-review.mjs and
// src/lib/callCoaching.js.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'

const src = fs.readFileSync('src/pages/CallDetailPage.jsx', 'utf8')

describe('Single primary overall score — no competing score heroes', () => {
  it('overall_score is rendered exactly once as a large hero number (the "/ 100" score display)', () => {
    const bigScoreMatches = src.match(/review\.overall_score\}/g) || []
    // One in the Call Result hero, one inside the Level-3 toggle label
    // ("View Full Coaching Review · Overall 41 / 100") which is
    // deliberately small/subtle text, not a second hero.
    expect(bigScoreMatches.length).toBe(2)
  })
  it('the second occurrence is inside the collapsed-by-default toggle label, not another standalone hero card', () => {
    const toggleButtonIdx = src.indexOf('<span>{showFullReview')
    // the second score reference should be inside the toggle's own label
    // span, not a second `text-[32px]` (the hero's own font size) elsewhere.
    expect(src.slice(toggleButtonIdx, toggleButtonIdx + 120)).toMatch(/Overall \{review\.overall_score\}/)
    const heroFontSizeCount = (src.match(/text-\[32px\]/g) || []).length
    expect(heroFontSizeCount).toBe(1)
  })
})

describe('Biggest Win / Biggest Miss — present, sourced from canonical review fields, unchanged', () => {
  it('Biggest Win reads review.strengths[0] — same source as before this pass', () => {
    expect(src).toMatch(/const biggestWin = review\?\.strengths\?\.\[0\] \|\| null/)
  })
  it('Biggest Miss reads review.missed_opportunity.summary — same source as before this pass', () => {
    expect(src).toMatch(/const biggestMiss = review\?\.missed_opportunity\?\.summary \|\| null/)
  })
  it('both render in Level 1 (before the Skill Breakdown section)', () => {
    const winIdx = src.indexOf('Biggest Win')
    const missIdx = src.indexOf('Biggest Miss')
    const skillIdx = src.indexOf('Skill Breakdown')
    expect(winIdx).toBeGreaterThan(-1)
    expect(missIdx).toBeGreaterThan(-1)
    expect(skillIdx).toBeGreaterThan(winIdx)
    expect(skillIdx).toBeGreaterThan(missIdx)
  })
})

describe('Next Coaching Focus — visually prominent, uses canonical currentFocus data', () => {
  it('reads the same currentFocus.title sourced from the coaching_focuses ACTIVE-status query, unchanged', () => {
    expect(src).toMatch(/\.eq\('status', 'ACTIVE'\)/)
    expect(src).toMatch(/Next Coaching Focus/)
    expect(src).toMatch(/\{currentFocus\.title\}/)
  })
  it('Next Coaching Focus card uses the strongest visual treatment on the page (2px accent border, same class used before for Executive Coaching Summary)', () => {
    // Use the JSX heading occurrence (not the earlier prose comment that
    // also happens to say "Next Coaching Focus").
    const idx = src.indexOf('>Next Coaching Focus<')
    expect(src.slice(Math.max(0, idx - 300), idx)).toMatch(/border-2 border-\[color:var\(--color-accent\)\]/)
  })
})

describe('Skill Breakdown — all 9 canonical dimensions preserved, no renamed/invented dimensions', () => {
  it('iterates COACHING_DIMENSIONS from callCoaching.js, not a locally redefined list', () => {
    expect(src).toMatch(/import \{ COACHING_DIMENSIONS \} from '\.\.\/lib\/callCoaching'/)
    expect(src).toMatch(/COACHING_DIMENSIONS\.map\(dim/)
  })
  it('does not define its own dimension key/label list (would risk drift from the canonical schema)', () => {
    expect(src).not.toMatch(/OPENING_RAPPORT.*label.*Opening/)
  })
})

describe('Continuous coaching — previous focus / adherence preserved, honest empty state, no fabricated improvement', () => {
  it('reads coachingEval.coaching_focuses / coachingEval.result exactly as before', () => {
    expect(src).toMatch(/coachingEval\?\.coaching_focuses/)
    expect(src).toMatch(/coachingEval\.result/)
  })
  it('shows an explicit, honest empty state when no prior evaluation exists — never invents progress', () => {
    expect(src).toMatch(/No previous coaching focus available for this call\./)
  })
  it('never fabricates an "improved" claim not backed by coachingEval.result', () => {
    expect(src).not.toMatch(/rep improved|Improved!|improvement detected/i)
  })
})

describe('Full Coaching Review — progressive disclosure, nothing deleted', () => {
  it('is gated behind a toggle (showFullReview state), collapsed by default', () => {
    expect(src).toMatch(/const \[showFullReview, setShowFullReview\] = useState\(false\)/)
    expect(src).toMatch(/onClick=\{\(\) => setShowFullReview\(v => !v\)\}/)
  })
  it('still renders coverage chips, strengths, missed_opportunity, coaching_moments, strong_moves, and deal-context snapshot when expanded', () => {
    const detailIdx = src.indexOf('showFullReview && (')
    const detailSlice = src.slice(detailIdx)
    expect(detailSlice).toMatch(/review\.coverage/)
    expect(detailSlice).toMatch(/review\.strengths\.map/)
    expect(detailSlice).toMatch(/review\.missed_opportunity/)
    expect(detailSlice).toMatch(/review\.coaching_moments\.map/)
    expect(detailSlice).toMatch(/review\.strong_moves\.map/)
    expect(detailSlice).toMatch(/max_buy_snapshot/)
    expect(detailSlice).toMatch(/seller_price_snapshot/)
  })
  it('strong_moves nuance annotation (GOOD_BUT_EARLY/LATE/MIXED) preserved inline — the old standalone "Deal Impact" line is folded in, not deleted', () => {
    expect(src).toMatch(/NUANCE_LABEL\[m\.nuance\]/)
  })
})

describe('Call context and Seller Movement remain present', () => {
  it('renders address, rep, date, duration, outcome — same fields as before', () => {
    expect(src).toMatch(/call\.leads\?\.address/)
    expect(src).toMatch(/repName\(call\.rep_id\)/)
    expect(src).toMatch(/formatDate\(call\.started_at\)/)
    expect(src).toMatch(/formatDuration\(call\.duration_seconds\)/)
  })
  it('renders Seller Movement using the same seller_price_initial/final/movement fields', () => {
    expect(src).toMatch(/Seller Movement/)
    expect(src).toMatch(/call\.seller_price_initial/)
    expect(src).toMatch(/call\.seller_price_final/)
    expect(src).toMatch(/call\.seller_price_movement/)
  })
})

describe('No new AI/network call introduced — structural verification', () => {
  it('the only network calls in this file are the pre-existing supabase reads (call_sessions/call_reviews/coaching_focus_evaluations/coaching_focuses)', () => {
    const fetchCalls = (src.match(/\bfetch\(/g) || []).length
    expect(fetchCalls).toBe(0)
    const supabaseFromCalls = src.match(/supabase\s*\n?\s*\.from\('(\w+)'\)/g) || []
    const tables = supabaseFromCalls.map(s => s.match(/'(\w+)'/)[1])
    expect(new Set(tables)).toEqual(new Set(['call_sessions', 'call_reviews', 'coaching_focus_evaluations', 'coaching_focuses']))
  })
  it('does not import or reference any Netlify function endpoint (no /.netlify/functions/... call)', () => {
    expect(src).not.toMatch(/\.netlify\/functions/)
  })
})

describe('Existing route unchanged, existing data sources unchanged', () => {
  it('still keyed by useParams().callId — same route contract', () => {
    expect(src).toMatch(/const \{ callId \} = useParams\(\)/)
  })
  it('still reads call_reviews by call_session_id, coaching_focus_evaluations by call_session_id — unchanged query shape', () => {
    expect(src).toMatch(/\.eq\('call_session_id', callId\)/g)
  })
})

describe('No scoring/coaching logic files touched (protected — Part 11)', () => {
  it('CallDetailPage.jsx has no import statement referencing generate-call-review, decisionEngineV2, or distressScoring (the header comment mentions generate-call-review only to explain why zero AI calls happen here)', () => {
    expect(src).not.toMatch(/^import .*(generate-call-review|decisionEngineV2|distressScoring)/m)
  })
  it('CallDetailPage.jsx imports only COACHING_DIMENSIONS from callCoaching.js — no scoring function reused/reimplemented here', () => {
    const importLine = src.match(/^import \{[^}]*\} from '\.\.\/lib\/callCoaching'/m)[0]
    expect(importLine).toMatch(/COACHING_DIMENSIONS/)
    expect(importLine).not.toMatch(/validate|score|dedupe/i)
  })
})
