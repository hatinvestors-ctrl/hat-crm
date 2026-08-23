# HAT Acquisition Coach — Post-Call Scoring Rubric

Capability #24. This is the documented rubric `generate-call-review.mjs`
scores against (Part 20 of the mission brief). Every dimension is 0-10.
Scores must be explainable with real transcript evidence (Part 21) —
`src/lib/callCoaching.js`'s `validateScorecard()` rejects any dimension
returned without a `why` string, and `verifyCoachingMoments()` independently
re-checks every quoted coaching moment against the real transcript before
it's ever shown, regardless of what the model claims.

**Coverage vs. Score** — these are different questions (Part 18/19):
*Coverage* ("did we capture the info?") is 100% deterministic, computed by
`getCallCoverage()` in `sellerStrategy.js`. *Score* ("how well did the rep
handle it?") is the qualitative judgment below — a rep can conduct a
strong call that doesn't produce every fact, and can capture every fact
while handling the conversation poorly. Never conflate the two.

## OPENING & RAPPORT
- **9-10**: Clear, confident opening; stated purpose plainly; established rapport without sounding scripted.
- **6-8**: Opening was clear but generic, or rapport was thin.
- **3-5**: Opening was confusing, overly scripted, or created early friction.
- **0-2**: No real opening, or immediately put the seller on the defensive.

## MOTIVATION DISCOVERY
- **9-10**: Rep asked an open question and let the seller state motivation in their own words.
- **7-8**: Motivation was captured, but the rep led with a leading/closed question.
- **4-6**: Motivation was only surface-level or came from the rep, not the seller.
- **0**: Motivation never discussed.

## PAIN DEPTH
- **9-10**: Rep followed a stated problem with a genuine deepening question ("what's been the hardest part about that?") before moving on.
- **6-8**: A follow-up existed but was shallow or moved on quickly.
- **3-5**: Rep acknowledged the pain but moved directly to property/price without exploring it.
- **0-2**: Pain point stated and ignored entirely.

## PROPERTY DISCOVERY
- **9-10**: Specific, useful condition detail captured (systems, age, scope).
- **6-8**: General condition captured ("needs some work") without specifics.
- **3-5**: Condition briefly mentioned, not explored.
- **0**: Never discussed.

## TIMELINE
- **10**: Clear seller-defined timing captured.
- **7**: General timing captured but not specific.
- **4**: Timing discussed but ambiguous.
- **0**: Never discussed.

## PRICE DISCOVERY
- **9-10**: Rep asked for the seller's number before anchoring their own, and asked the seller to explain their reasoning rather than immediately countering.
- **6-8**: Price captured, but rep anchored first or didn't probe the seller's reasoning.
- **3-5**: Price discussed vaguely, or rep negotiated against themselves (raised their own number without new information).
- **0**: Price never discussed.

## DECISION MAKERS
- **10**: All decision makers identified and their involvement/alignment explored.
- **7**: Additional decision maker identified but alignment not explored.
- **4**: Possible other decision maker mentioned but unclear.
- **0**: Not addressed.

## NEGOTIATION
Scored on observable behavior, never on whether the seller simply accepted
(a rep can run a strong call that doesn't close):
- explored the seller's expectation before responding
- avoided negotiating against themselves (didn't raise their own number without new information)
- acknowledged objections directly
- investigated the reasoning behind a stated number/objection
- used the seller's own stated priorities (e.g. as-is, speed) in the pitch
- maintained the Max Buy guardrail (never implied willingness to exceed it)
- made no unsupported promises (timelines, repairs, price) the transcript doesn't support
- **9-10**: Demonstrates most of the above.
- **6-8**: Demonstrates some; at least one clear miss (e.g., raised own number early).
- **3-5**: Negotiated reactively, little structure.
- **0-2**: Negotiated against self, or made an unsupported promise.

## COMMITMENT / FOLLOW-UP
- **10**: Secured a specific, real next step (day/time, or a concrete condition to be met).
- **7**: Secured a soft, non-specific next step ("I'll call again soon").
- **4**: Ended without ever asking for a next step, though the seller stayed engaged.
- **0**: No next step and the seller clearly disengaged.

## What the AI may and may not do (see also the AI authority contract in
`generate-call-review.mjs`)

**MAY**: read the real transcript, apply the rubric above, cite the exact
transcript lines that justify each score, identify up to 3 coaching
moments and up to 3 strengths (each anchored to a real quote), identify
ONE biggest missed opportunity, summarize the seller outcome.

**MAY NOT**: invent a quote, invent a fact, calculate or alter Max Buy /
MAO / Flip / BRRRR economics, score based on whether the seller ultimately
said yes, or produce more than 3 coaching moments / 3 strengths.
