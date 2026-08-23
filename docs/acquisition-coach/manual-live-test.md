# HAT Acquisition Coach — Manual Live Test Script

Capability #24. This requires an actual browser + microphone — nothing in
this repo can validate it automatically. Read Kevin's lines aloud (a second
phone on speaker works well) into the mic in Chrome/Edge on the Lead
Workspace's "AI & Comps" tab → Live Copilot (off-market lead only).

For each step: **WHAT I SAY** / **WHAT SHOULD CAPTURE** / **WHAT SHOULD
CHANGE ON SCREEN** / **WHAT SHOULD NOT CHANGE**.

## 0. Before starting
- Confirm mic permission prompt appears, "I Understand — Enable Microphone" gate works.
- Confirm **Start Listening** shows a pulsing "● Listening…" state.

## 1. Opening
**SAY**: "Hi, this is Kevin. Am I speaking with John? ... I'm calling about your property. I wanted to see if you'd have any interest in selling it if the numbers made sense."
**SHOULD CAPTURE**: nothing yet (no seller answer).
**SHOULD CHANGE**: transcript segment count increments (check "Show Transcript (N)").
**SHOULD NOT CHANGE**: Next Best Question, Deal Guardrail, Call Stage.

## 2. Seller opens up
**SAY (as seller)**: "Maybe. I've actually been thinking about it."
**SHOULD CAPTURE**: Open to Sell → MAYBE/YES within ~2-5 seconds (normal debounce).
**SHOULD CHANGE**: Zone A "Open to Sell" chip; Next Best Question moves to motivation ("What's making you consider selling?").
**SHOULD NOT CHANGE**: Deal Guardrail numbers (no price yet).

## 3. Motivation + pain
**SAY**: "I'm tired of dealing with it. The tenant moved out, the house needs some repairs and I don't want to put money into it."
**SHOULD CAPTURE**: pain points (TENANT/VACANT/REPAIRS-ish), motivation notes. Capture flash should briefly appear.
**SHOULD CHANGE**: "What We Still Need" chips drop Motivation/Pain; Next Best Question moves toward condition/timeline.
**LATENCY CHECK**: note seconds between finishing the sentence and the chip updating — should feel like a couple seconds, not instant, not >5s.

## 4. Condition detail
**SAY**: "The kitchen is old, the floors need work and the roof may need replacement."
**SHOULD CAPTURE**: condition_notes populated.
**SHOULD CHANGE**: "Condition" line under Zone A shows a real label, not UNKNOWN.

## 5. Timeline
**SAY**: "Probably within 30 days."
**SHOULD CAPTURE**: Timeline → < 30 Days.
**SHOULD CHANGE**: Timeline chip; Call Stage advances.

## 6. Price — seller's number
**SAY**: "I was thinking about 180 thousand."
**SHOULD CAPTURE**: seller price $180K (FAST path — updates within ~1-2s, not the slower debounce).
**SHOULD CHANGE**: Deal Guardrail "Seller Asking" updates to $180K; Gap to Max Buy recalculates.

## 7. Kevin's range (rep-side, must NOT overwrite seller price)
**SAY**: "On our side, depending on condition, we may be somewhere around 145."
**SHOULD CAPTURE**: HAT range-mentioned note ($145K), labeled "not the seller's ask."
**SHOULD NOT CHANGE**: Deal Guardrail "Seller Asking" must stay $180K — verify it does NOT flip to $145K.

## 8. Objection + price change together
**SAY (seller)**: "145 is too low. I probably need at least 175."
**SHOULD CAPTURE**: objection TOO_LOW; seller price updates to $175K; $180K moves into price history.
**SHOULD CHANGE**: Next Best Question/Your Move switches to objection guidance ("Where were you hoping we'd be?" / "Don't raise the offer yet"); Seller Price chip shows "$180K → $175K".
**DUPLICATE CHECK**: continue to step 9 before evaluating — the objection question must NOT still be showing after step 9.

## 9. Seller explains the number (no new field — this is where "already asked" matters most)
**SAY**: "My neighbor sold for about 250, but his house was fully renovated."
**SHOULD CAPTURE**: nothing new structurally (no dedicated field for this) — that's expected, not a bug.
**MUST VERIFY**: Next Best Question/Your Move is NOT still asking "Where were you hoping we'd be?" — it should already have moved on (the objection resolved the moment $175K was captured in step 8, not because of this line). If it's still showing "Where were you hoping," that's a real regression — stop and report it.

## 10. Decision maker
**SAY**: "No. My wife is on the title too."
**SHOULD CAPTURE**: Decision Makers → mentions wife.
**SHOULD CHANGE**: Decision chip in Zone A; "What We Still Need" drops Decision Makers.

## 11. Priority + conditional price move
**SAY**: "I don't want to do repairs. I'd rather sell it as-is and be done with it." ... "Actually, if you could close quickly and buy it as-is, I might consider 170."
**SHOULD CAPTURE**: desired outcome (no repairs); seller price → $170K, status CONDITIONAL (should render "~$170K (conditional)", never as a firm accepted number).

## 12. Follow-up
**SAY**: "Call me Thursday afternoon."
**SHOULD CAPTURE**: follow_up_phrase = "Thursday afternoon" (FAST path).
**SHOULD CHANGE**: capture flash "FOLLOW-UP: Thursday afternoon."

## 13. Pause/Resume/Stop
- Click **Pause** mid-sentence — verify mic stops listening, no new segments added.
- Click **Resume** — verify listening resumes, no duplicate of the paused segment.
- Click **Stop** — verify mic fully stops; transcript preserved.

## 14. End Call → Call Review
- Click **End Call**. Verify outcome form pre-fills (spoke_follow_up, follow-up date resolved from "Thursday afternoon" if within business logic, seller price shown).
- Click **Generate Call Review**. This makes a real LLM call — expect several seconds.
  - Verify **Call Coverage** shows 8/8 (or close) BEFORE the AI call even returns (it's deterministic, always available).
  - Verify the scorecard shows 9 dimensions, each expandable to a "Why this score" with a real transcript reference.
  - Verify any "Coach This Moment" / "Strong Move" quotes are things you actually said out loud — if a quote appears that you did NOT say, that is a real defect (the quote-verification guard should have dropped it — report immediately).
  - Verify NO Max Buy number appears in the review that differs from what Zone D showed live.
- Click **Save & Schedule** — verify it saves without waiting on/requiring the Call Review to finish.

## 15. Failure simulation
- Turn off network mid-call (or block the extract-seller-facts endpoint via DevTools) and keep talking.
- Verify: mic keeps listening, no modal interrupts, an inline "Transcription analysis unavailable right now" message appears, manual pain-point capture (under "Manual capture") still works.
