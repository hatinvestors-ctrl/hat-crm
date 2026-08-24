# HAT Acquisition Coach — Continuous Coaching Intelligence

Capability #25.2. Extends Capability #24 (single-call review) and #25.1
(persistence) into a cross-call learning loop:

```
CALL → ANALYZE → COACH → REMEMBER → WATCH NEXT CALL → MEASURE ADOPTION → MEASURE IMPROVEMENT → UPDATE COACHING
```

## Architecture

```
Live Copilot (in-memory, unchanged from #24)
   full transcript in memory only
        │
        ▼
generate-call-review.mjs (ONE LLM call, same one #24 already makes)
   • scores the call against the existing 9-dimension rubric (unchanged)
   • suggests ONE primaryCoachingFocus (skill-validated against the rubric)
   • if an active focus was supplied, evaluates focusAdherence for THIS call
        │
        ▼
CallReview.jsx — deterministic validation gate (untrusted AI output in, only
verified structured facts out — same posture as #24's coaching moments)
   • validateCoachingFocusSuggestion() — rejects any skillKey not in the rubric
   • validateAdherenceEvaluation() — rejects any non-NOT_APPLICABLE claim
     without a real, transcript-verified quote
        │
        ▼
coachingMemory.js — PURE, DETERMINISTIC. The SYSTEM decides trend/adoption/
mastery from persisted history. The AI is never asked "is this rep
improving" — it only ever analyzes ONE call at a time.
        │
        ▼
call_reviews / coaching_focuses / coaching_focus_evaluations (Supabase, RLS)
```

Full transcript is used for analysis (sent to `generate-call-review.mjs` in
memory, same as #24) but **never persisted** — only structured scores,
coverage, and quote-verified evidence snippets are written to the database,
exactly continuing #25.1's privacy architecture. No raw audio anywhere in
this codebase.

## Coaching focus lifecycle

A rep has **at most one ACTIVE coaching focus at a time** (application-
level invariant, not a DB constraint). `coaching_focuses` rows are
content-immutable after insert (DB trigger blocks any change to
`title`/`recommendation`/`skill_key`/`source_call_id`) — only `status`,
`resolution`, and `resolved_at` may change, and only by the owning rep.

- **ACTIVE** — currently being coached.
- **RESOLVED** — no longer active. `resolution` says why:
  - `MASTERED` — the rep demonstrated the behavior reliably (see Mastery below).
  - `REPLACED` — reserved for a future manager-initiated override (not built in V1 — no UI creates this yet).

`IMPROVING` is deliberately **not** a stored status — it's a computed
trend label shown alongside an ACTIVE focus, always derived fresh from
real historical scores, so it can never drift out of sync with the
evidence that produced it.

## Adherence states

Evaluated once per reviewed call, against whichever focus was active
**going into** that call:

- `APPLIED` — opportunity existed, rep applied the recommendation. Requires a verified quote.
- `PARTIALLY_APPLIED` — opportunity existed, rep partially applied it. Requires a verified quote.
- `NOT_APPLIED` — opportunity existed, rep missed it. Requires a verified quote.
- `NOT_APPLICABLE` — the opportunity never occurred in this call. No quote required or expected — the rep is never penalized for a situation that didn't arise.

Every evaluation is validated by `validateAdherenceEvaluation()` before
persistence: internal consistency is checked deterministically
(`opportunityExisted` must agree with `result`), and any result other than
`NOT_APPLICABLE` is dropped entirely if it has no real, transcript-
verified quote behind it.

## Progress algorithm (all deterministic, `src/lib/coachingMemory.js`)

**Adoption rate** — `(APPLIED + 0.5 × PARTIALLY_APPLIED) / applicable`,
where `applicable` excludes every `NOT_APPLICABLE` call. A rep is never
penalized for calls where the coached opportunity never came up.

**Trend** — rolling recent-5 vs. previous-5 reviewed calls (`TREND_WINDOW_SIZE
= 5`, both windows configurable but 5 is the default and the only value
used in V1). Requires **at least one scored call in both the recent and
previous window** — otherwise `INSUFFICIENT_DATA`, never a fabricated
trend from one-sided history. This means a trend can be reported before
either window is completely full (e.g. 5 recent calls vs. 3 previous
calls still produces a real comparison) — it is never computed from a
single call on either side, but it does not require a full 5-call window
on both sides either. Live-certified against real persisted data in
#25.2's certification pass (an 8-call history — 5 recent, 3 previous —
correctly produced a real trend result). Thresholds: delta ≥ **+0.5** →
`IMPROVING`; delta ≤ **−0.5** →
`DECLINING`; otherwise `STABLE`. These thresholds are deliberately
conservative on a 0–10 scale — small noise never reads as a real signal.

**Mastery eligibility** — ALL three must hold, no exceptions:
1. `applicableCount ≥ 5` (`MASTERY_MIN_APPLICABLE_CALLS`)
2. `adoptionRate ≥ 0.8` (`MASTERY_MIN_ADOPTION_RATE`)
3. dimension trend is not `DECLINING`

One good call — or even five good calls without the adoption/trend bar
being cleared — never triggers mastery. The AI never decides mastery; it
only ever contributes the raw per-call adherence claim, which is then
filtered through this same conservative gate every time.

**Focus continuity** — a new focus is proposed **only** when the current
one is resolved (`decideFocusAction()` returns `RESOLVE_MASTERED` only
when `computeMasteryEligibility().eligible` is true; otherwise
`KEEP_ACTIVE`). The next focus's *skill* is chosen deterministically
(`pickNextFocusSkill()` — the lowest-average dimension score across the
recent window, excluding the just-mastered skill) — the AI may phrase the
new focus's title/recommendation, but never chooses which skill becomes
the new focus.

## AI vs. deterministic responsibilities

| AI (generate-call-review.mjs, one call per reviewed call) | Deterministic (coachingMemory.js) |
|---|---|
| Score one call against the fixed rubric | Compute adoption rate from all persisted evaluations |
| Suggest one coaching focus (skill + text) | Validate the suggested skill against the real rubric |
| Evaluate adherence for THIS call only | Compute recent-vs-previous trend from real score history |
| Cite quotes as evidence | Independently re-verify every quote against the real transcript |
| — | Decide mastery eligibility |
| — | Decide whether to keep or resolve the active focus |
| — | Pick the next focus's skill (never the AI) |

## Transcript / privacy behavior

- Full transcript is used for analysis (in-memory, sent once to
  `generate-call-review.mjs`), never persisted to Supabase.
- No raw audio anywhere in this codebase (unchanged from #24/#25.1).
- Only structured outputs (scores, coverage, coaching-focus text,
  adherence result + short verified quotes) are ever written.
- Every persisted quote passed the same `quoteAppearsInTranscript()` check
  #24 already established — no new evidence pathway was invented.

## Failure behavior

- If the coaching-analysis portion of the response fails validation (bad
  JSON, invalid skill key, unverifiable quote), the call REVIEW itself
  (scores/coverage/moments) is unaffected — it was already validated and
  persisted independently in the same function, before coaching-memory
  logic runs at all.
- A failure while persisting coaching-focus/adherence rows surfaces a
  visible, non-blocking message (`coachingError`) — the call session and
  review remain fully saved regardless.
- Retrying never duplicates: `coaching_focus_evaluations.call_session_id`
  is `UNIQUE`, and a duplicate-key insert is treated as "already saved"
  (same idempotency pattern as `call_reviews` in #25.1).
- No coaching focus or adherence row is ever created from a failed/
  incomplete AI response — validation happens before any insert.

## What is explicitly NOT built in #25.2

Team Dashboard, full Agent Profile, manager ranking/leaderboard,
gamification, badges, call recording storage, transcript library,
automated emails/Slack notifications, cross-team benchmarking, manager-
initiated coaching assignment UI (the `REPLACED` resolution exists in the
schema but nothing creates it yet), sales forecasting. All deferred to
later capabilities per the mission's explicit scope.
