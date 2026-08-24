// test/callSessions.test.js
// Capability #25.1 — Persistent Call Intelligence. Pure record-building
// logic only (no Supabase I/O to mock) — session identity, call_sessions/
// call_reviews row shape, idempotency-relevant fields, immutability
// guarantees, and Calls History filtering.
import { describe, it, expect } from 'vitest'
import { createCallIdentity, buildCallSessionInsert, buildCallSessionFinalizeUpdate, buildCallReviewRecord, filterCallSessions } from '../src/lib/callSessions.js'
import { createSession } from '../src/lib/conversationSession.js'
import { getSellerIntelligence, mergeSellerIntelligence } from '../src/lib/sellerStrategy.js'

function applyPatch(lead, patch) {
  return { ...lead, distress_data: mergeSellerIntelligence(lead, patch) }
}

describe('createCallIdentity / createSession — Part 8 durable identity', () => {
  it('generates a real UUID callId, never null/empty', () => {
    const id = createCallIdentity({ workspaceId: 'ws-1', repId: 'user-1' })
    expect(id.callId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    expect(id.workspaceId).toBe('ws-1')
    expect(id.repId).toBe('user-1')
  })

  it('two identities created back-to-back never collide', () => {
    const a = createCallIdentity({ workspaceId: 'ws-1', repId: 'user-1' })
    const b = createCallIdentity({ workspaceId: 'ws-1', repId: 'user-1' })
    expect(a.callId).not.toBe(b.callId)
  })

  it('createSession carries callId/workspaceId/repId onto the in-memory session — repId is whatever is explicitly passed, never derived from the lead', () => {
    const lead = { id: 'lead-1', assigned_to: 'someone-else' }
    const session = createSession(lead, { workspaceId: 'ws-1', repId: 'the-caller' })
    expect(session.callId).toBeTruthy()
    expect(session.workspaceId).toBe('ws-1')
    expect(session.repId).toBe('the-caller') // NOT lead.assigned_to
    expect(session.leadId).toBe('lead-1')
  })

  it('a session created with no workspace/rep context degrades safely (nulls, never throws)', () => {
    const session = createSession({ id: 'lead-1' })
    expect(session.workspaceId).toBeNull()
    expect(session.repId).toBeNull()
    expect(session.callId).toBeTruthy() // still gets a real id
  })
})

describe('buildCallSessionInsert — Phase 1 (Part 9), no outcome fields yet', () => {
  const identity = { callId: 'call-1', workspaceId: 'ws-1', repId: 'user-1', startedAt: '2026-08-24T10:00:00.000Z' }
  const lead = { id: 'lead-1' }

  it('outcome/follow_up_date/summary are all null — not known until Save & Schedule', () => {
    const si = getSellerIntelligence(lead)
    const record = buildCallSessionInsert({ identity, lead, si, endedAt: '2026-08-24T10:05:30.000Z' })
    expect(record.outcome).toBeNull()
    expect(record.follow_up_date).toBeNull()
    expect(record.summary).toBeNull()
  })

  it('duration is computed from real started_at/ended_at, never hardcoded', () => {
    const si = getSellerIntelligence(lead)
    const record = buildCallSessionInsert({ identity, lead, si, endedAt: '2026-08-24T10:05:30.000Z' })
    expect(record.duration_seconds).toBe(330) // 5m30s
  })

  it('id/workspace_id/lead_id/rep_id map exactly onto the given identity/lead — no re-derivation', () => {
    const si = getSellerIntelligence(lead)
    const record = buildCallSessionInsert({ identity, lead, si, endedAt: identity.startedAt })
    expect(record.id).toBe('call-1')
    expect(record.workspace_id).toBe('ws-1')
    expect(record.lead_id).toBe('lead-1')
    expect(record.rep_id).toBe('user-1')
  })

  it('coverage_snapshot is the SAME deterministic getCallCoverage() output Capability #24 already computes live — never a second definition', () => {
    const withFacts = applyPatch(lead, { open_to_sell: 'YES', pain_points: ['TENANT', 'VACANT'] })
    const si = getSellerIntelligence(withFacts)
    const record = buildCallSessionInsert({ identity, lead: withFacts, si, endedAt: identity.startedAt })
    // SELLING_INTEREST (open_to_sell set) + MOTIVATION (pain_points.length>0) + PAIN (2 pain points = CAPTURED, not PARTIAL)
    expect(record.coverage_snapshot.capturedCount).toBe(3)
    expect(record.coverage_snapshot.total).toBe(8)
  })

  it('no transcript field, no raw audio field — never persisted (Part 16/30)', () => {
    const si = getSellerIntelligence(lead)
    const record = buildCallSessionInsert({ identity, lead, si, endedAt: identity.startedAt })
    expect(record).not.toHaveProperty('transcript')
    expect(record).not.toHaveProperty('raw_audio')
    expect(record).not.toHaveProperty('segments')
  })

  it('seller price movement uses the real price-history chain, never invented', () => {
    let l = applyPatch(lead, { seller_asking_price: 180000 })
    let si = getSellerIntelligence(l)
    l = applyPatch(l, { seller_asking_price: 170000, seller_asking_price_history: [...si.seller_asking_price_history, { value: si.seller_asking_price, at: 't1' }] })
    si = getSellerIntelligence(l)
    const record = buildCallSessionInsert({ identity, lead: l, si, endedAt: identity.startedAt })
    expect(record.seller_price_initial).toBe(180000)
    expect(record.seller_price_final).toBe(170000)
    expect(record.seller_price_movement).toBe(-10000)
  })
})

describe('buildCallSessionFinalizeUpdate — Phase 2 (Part 9/10), only these 3 fields', () => {
  it('returns exactly outcome/follow_up_date/summary — nothing else, never touches identity/timing', () => {
    const update = buildCallSessionFinalizeUpdate({ outcome: 'spoke_follow_up', followUpDate: '2026-08-27', note: 'Call again Thursday' })
    expect(Object.keys(update).sort()).toEqual(['follow_up_date', 'outcome', 'summary'].sort())
    expect(update.outcome).toBe('spoke_follow_up')
    expect(update.follow_up_date).toBe('2026-08-27')
    expect(update.summary).toBe('Call again Thursday')
  })
})

describe('buildCallReviewRecord — immutable snapshot (Part 12/29)', () => {
  const validatedReview = {
    overallScore: 84,
    scores: [{ key: 'TIMELINE', score: 10, why: 'Clear timeline captured.' }],
    coverage: { capturedCount: 8, total: 8 },
    strengths: ['Asked open-ended motivation question.'],
    missedOpportunity: { summary: 'Moved to condition too fast.' },
    coachingMoments: [{ sellerQuote: 'I am tired of dealing with it', coach: 'x' }],
    strongMoves: [{ sellerQuote: 'I need 175', why: 'Asked seller to justify first.' }],
  }

  it('snapshots max_buy/seller_price exactly as given — never recomputed inside this function', () => {
    const record = buildCallReviewRecord({
      callSessionId: 'call-1', workspaceId: 'ws-1', leadId: 'lead-1', repId: 'user-1',
      validatedReview, maxBuySnapshot: 113528, sellerPriceSnapshot: 170000,
    })
    expect(record.max_buy_snapshot).toBe(113528)
    expect(record.seller_price_snapshot).toBe(170000)
    expect(record.call_session_id).toBe('call-1')
  })

  it('a null Max Buy snapshot (not ready) is stored as null, never a fabricated number', () => {
    const record = buildCallReviewRecord({
      callSessionId: 'call-1', workspaceId: 'ws-1', leadId: 'lead-1', repId: 'user-1',
      validatedReview, maxBuySnapshot: null, sellerPriceSnapshot: null,
    })
    expect(record.max_buy_snapshot).toBeNull()
  })

  it('empty arrays are stored as null, not []', () => {
    const record = buildCallReviewRecord({
      callSessionId: 'call-1', workspaceId: 'ws-1', leadId: 'lead-1', repId: 'user-1',
      validatedReview: { ...validatedReview, strengths: [], coachingMoments: [], strongMoves: [] },
      maxBuySnapshot: null, sellerPriceSnapshot: null,
    })
    expect(record.strengths).toBeNull()
    expect(record.coaching_moments).toBeNull()
    expect(record.strong_moves).toBeNull()
  })
})

describe('filterCallSessions — Calls History filtering (Part 13/14)', () => {
  const rows = [
    { id: 'a', rep_id: 'rep-1', hasReview: true, outcome: 'spoke_follow_up' },
    { id: 'b', rep_id: 'rep-2', hasReview: false, outcome: 'not_interested' },
    { id: 'c', rep_id: 'rep-1', hasReview: false, outcome: 'spoke_follow_up' },
  ]

  it('ALL rep filter returns everything', () => {
    expect(filterCallSessions(rows, { repId: 'ALL' })).toHaveLength(3)
  })
  it('a specific rep filter isolates only their calls', () => {
    expect(filterCallSessions(rows, { repId: 'rep-1' }).map(r => r.id)).toEqual(['a', 'c'])
  })
  it('reviewedOnly isolates only reviewed calls', () => {
    expect(filterCallSessions(rows, { reviewedOnly: true }).map(r => r.id)).toEqual(['a'])
  })
  it('notReviewedOnly isolates only unreviewed calls', () => {
    expect(filterCallSessions(rows, { notReviewedOnly: true }).map(r => r.id).sort()).toEqual(['b', 'c'])
  })
  it('outcome filter combines with rep filter', () => {
    expect(filterCallSessions(rows, { repId: 'rep-1', outcome: 'spoke_follow_up' }).map(r => r.id)).toEqual(['a', 'c'])
  })
})
