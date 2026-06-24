# Deal Screener — Design Spec
**Date:** 2026-06-24  
**Status:** Approved for implementation planning

---

## Context

Tomer receives batches of incoming deals daily from wholesalers, Redfin alerts, Zillow, direct mail, and other sources. Most of these deals will be dropped — they're not good enough, or the price doesn't work. The challenge is analyzing them fast enough to act on the good ones, and negotiating aggressively when a deal is worth pursuing.

The existing AI analysis (`generate-ai-notes` + `NotesRenderer`) already produces a rich deal analysis. The existing Quick Analysis modal does a lite calculation without saving to DB. This feature upgrades the Quick Analysis into a full **Deal Screener** — a temporary workspace where deals are evaluated with full AI intelligence, most dropped without ever touching the database, and the winners promoted to the CRM with a ready-to-execute negotiation plan.

**Primary targets:**
1. Process more leads per day without missing good deals
2. Make better go/no-go decisions with full AI context (comps, score, area, motivation)
3. Enter every negotiation with a psychologically crafted plan and ready-to-send communications

---

## Architecture Overview

Three components:

1. **`/screener` page** — the Deal War Room. Split-panel: deal queue on the left, full analysis on the right. Session-only for dropped deals; promoted deals save to CRM.
2. **Enhanced `generate-ai-notes`** — upgraded seller motivation scoring (10pts → 20pts), unchanged structure otherwise.
3. **`generate-negotiation-plan` Netlify function** — new, on-demand. Takes existing `ai_notes` as input, returns a Negotiation Plan + draft communications written by a master acquisition closer persona acting as HAT Investors.

---

## Section 1: Where It Lives

- `⚡ Quick Analysis` sidebar button → renamed `⚡ Deal Screener`, opens `/screener` page
- The existing `QuickAnalysisModal` is **kept unchanged** — still accessible inside lead detail for fast napkin math. No regression.
- `/screener` is a full page (not a modal) — NotesRenderer needs real estate to render properly

---

## Section 2: Page Layout — Split Panel

```
┌─────────────────────────────────────────────────────────────────┐
│ Deal Screener                          [Single Entry] [Bulk CSV] │
├──────────────────┬──────────────────────────────────────────────┤
│  DEAL QUEUE      │  ANALYSIS PANEL                              │
│                  │                                              │
│  [+ Add Deal]    │  Address: ___________________               │
│                  │  Asking:  $________                          │
│  ● 123 Main St   │  Source:  ___________________  [Analyze]    │
│    Score: 78     │                                              │
│    BUY NOW       │  ┌──────────────────────────────────────┐   │
│    Ask-MAO: -12K │  │  NotesRenderer tabs (full existing)  │   │
│                  │  │  Overview | Comps | Financials |      │   │
│  ○ 456 Oak Ave   │  │  Pros/Cons | Negotiate (new tab)     │   │
│    Score: 42     │  └──────────────────────────────────────┘   │
│    WATCH         │                                              │
│    Ask-MAO: +8K  │  ┌─────────────────────────────────────┐    │
│                  │  │ [Pass]  [Save to CRM]  [Get Nego Plan]│   │
│  ✗ 789 Pine Rd   │  └─────────────────────────────────────┘    │
│    Passed        │                                              │
└──────────────────┴──────────────────────────────────────────────┘
```

**Left panel — Deal Queue:**
- Each card shows: address, score ring, verdict badge (BUY NOW / OFFER / WATCH / DEAD), asking vs MAO gap ($ delta)
- States: Analyzing (spinner) / Scored / Passed (greyed out) / Saved (green checkmark)
- Session is not persisted — refresh clears the queue
- `[+ Add Deal]` button adds a new blank entry row to the queue

**Right panel — Analysis Panel:**
- Top strip: address, asking price, source contact (name + phone/email, optional)
- Below: full `NotesRenderer` tabs — reused exactly as in lead detail today
- Bottom: Decision Strip (see Section 4)
- When analyzing: same spinner/cancel pattern as AINotesSection today

---

## Section 3: Entry Modes

### Single Entry (default tab)
- Fields: Address (required), Asking Price (required), Source Name (optional), Source Phone/Email (optional)
- On "Analyze":
  1. **Duplicate check** via `leadDedup.js` normalization — if address exists in CRM, show banner: "⚠️ Already in CRM as [status]" with link. User can still analyze.
  2. **RentCast enrichment** via existing `enrichLead()` — auto-fills beds/baths/sqft/year_built
  3. **`generate-ai-notes`** called with `skip_save: true` — full analysis, no DB write
  4. Result rendered in right panel via `NotesRenderer`

### Bulk CSV Upload (second tab)
- Drop zone accepts CSV with columns: `address`, `asking_price`, `source_name` (optional)
- On upload: all rows appear in the left queue immediately, analysis runs sequentially (one at a time)
- As each completes, score ring fills in and verdict badge appears
- User clicks any row to see its full analysis in the right panel
- Can work the list while others are still analyzing

---

## Section 4: Decision Strip

Three buttons at the bottom of the right panel after analysis loads:

**`Pass`**
- Marks deal as "Passed" in the queue (greyed out card)
- Nothing saved to database
- Queue card shows a small "Passed" label

**`Save to CRM`**
- Creates lead via existing `LeadForm` schema
- Sets `lead_source` from the source field (defaults to `'wholesaler'` if source name provided, else `'other'`)
- Sets `screened: true` (new boolean field on leads)
- If source contact was provided: creates/upserts agent record, links via `agent_leads` with `role: 'wholesaler'`
- Saves `ai_notes` from the analysis
- Status: `'new_lead'` (skips triage — already AI-analyzed and decision made)
- Lead appears in "Screener" tab in Leads page (not in Kevin's pipeline)

**`Get Negotiation Plan`** *(available anytime after analysis loads)*
- Triggers `generate-negotiation-plan` Netlify function
- Takes `ai_notes` text + lead fields as input — no need to re-run full analysis
- Returns Negotiation Plan + Communications, rendered in a new "Negotiate" tab in NotesRenderer
- If deal was already saved to CRM: negotiation plan is also saved to `ai_notes`
- If not saved: session-only

---

## Section 5: Negotiation Plan — New AI Capability

### Netlify Function: `generate-negotiation-plan.mjs`

**Input:** `{ lead, ai_notes }` (ai_notes from already-completed analysis)  
**Model:** `claude-haiku-4-5-20251001` (fast, cost-effective — same as generate-ai-notes)  
**Output:** Structured text with NEGOTIATION PLAN section + COMMUNICATIONS section

### The Closer Persona

The system prompt encodes HAT Investors as a **master acquisition closer** — a direct investor-to-wholesaler relationship with no agent intermediary. The persona draws on:

- **Chris Voss / Never Split the Difference:** Mirroring, labeling, calibrated questions, tactical empathy, "that's right" moments
- **Psychological influence (Cialdini):** Authority (established Jacksonville buyer), Social Proof (track record), Scarcity (limited acquisition slots this quarter), Reciprocity (fast closes, repeat business)
- **Closing techniques:** Assumptive language ("when we close"), Takeaway close (when appropriate), Urgency framing (capacity constraints, end-of-month targets)
- **Anchoring:** Strategic first offer that controls the negotiation range
- **Loss aversion framing:** What the wholesaler loses by not working with HAT (certainty, speed, relationship, repeat deals)
- **HAT's unique buyer proposition:** Cash, fast close, no contingencies, experienced, reliable, repeat buyer in the Jacksonville market

### Output Sections (rendered as "Negotiate" tab)

```
NEGOTIATION PLAN
================

SELLER/WHOLESALER PROFILE
  Motivation Level: [High / Medium / Low]
  Key signals: [DOM, price drops, relisting count, urgency indicators]
  Their likely priority: [Speed / Price / Certainty / Relationship]

YOUR LEVERAGE POINTS
  • [specific leverage items from this deal's situation]

OPENING STRATEGY
  Recommended opening offer: $X
  Narrative to lead with: [specific framing for this deal]
  First message tone: [Collaborative / Firm / Urgent]

COUNTER-OFFER PLAYBOOK
  If they counter at $X → respond with $Y, use this language: "..."
  If they push back hard → [specific response]
  If they go silent → [follow-up timing and message]
  Walk-away price: $X (hard floor — do not cross)

RELATIONSHIP PLAY
  [One sentence to add to any communication that builds long-term deal flow]

---

COMMUNICATIONS
==============

EMAIL DRAFT
  Subject: [crafted subject line]
  [Full email — HAT Investors to wholesaler, master closer voice,
   assumptive language, specific to this deal's situation]

SMS / TEXT
  [Short, punchy, 2-3 sentences max]

VOICEMAIL SCRIPT
  [30-second script — confident, clear ask, callback urgency]
```

**Tone Selector:** `Soft / Balanced / Aggressive` — regenerates only the COMMUNICATIONS section (not the plan). Useful for adjusting approach based on relationship stage with this wholesaler.

---

## Section 6: Enhanced Deal Score

The existing 6-part `/100` score is updated:

| Sub-score | Before | After | Reason |
|---|---|---|---|
| Price Gap | 25pts | 20pts | Reduced to fund motivation upgrade |
| Deal Math | 25pts | 25pts | Unchanged |
| Cash Flow | 15pts | 15pts | Unchanged |
| ZIP Quality | 15pts | 15pts | Unchanged |
| **Seller Motivation** | 10pts | **20pts** | Now uses DOM, price drop count, relisting history, listing age — more data, more weight |
| ARV Confidence | 10pts | 10pts | Unchanged |

**New: Negotiation Leverage Badge** — displayed alongside the score ring (not part of the 100pt score):
- `HIGH LEVERAGE` (green) — significant gap, high motivation, distressed indicators
- `MEDIUM LEVERAGE` (yellow) — some room to negotiate
- `LOW LEVERAGE` (red) — asking price is near MAO already, tight room

This tells you: even a 55/100 deal with HIGH LEVERAGE is worth pursuing because you can likely close the gap.

---

## Section 7: Screener Tab in Leads Page

- New tab in `LeadsPage` sidebar/filter: **"Screener"**
- Filter: `leads.screened = true`
- Completely separate from Kevin's pipeline views
- Shows: address, source contact name, score, verdict, asking price, MAO gap, status, date screened
- All standard CRM actions work from here — LeadDetailPage, deal financials, AI notes, etc.
- Over time: source analytics visible here — which contacts send the best-scoring deals

---

## Schema Changes (Minimal)

**`leads` table — one new field:**
```sql
ALTER TABLE leads ADD COLUMN screened BOOLEAN DEFAULT FALSE;
CREATE INDEX leads_screened_idx ON leads(workspace_id, screened) WHERE screened = TRUE;
```

No other schema changes needed. `agent_leads` table with `role: 'wholesaler'` already handles source contact linking.

---

## What Gets Reused (No Duplication)

| Existing | Reused As |
|---|---|
| `generate-ai-notes.mjs` | Called with `skip_save: true` for screener analysis |
| `NotesRenderer.jsx` | Rendered as-is in the right panel; Negotiate tab added |
| `AINotesSection.jsx` | Spinner, cancel, error patterns reused |
| `enrichLead()` in `enrich-lead.mjs` | RentCast auto-fill on address entry |
| `leadDedup.js` | Duplicate address check before analysis |
| `agent_leads` table | Source contact linking on promote |
| `LeadForm` field structure | Same schema used when saving to CRM |
| `QuickAnalysisModal` | Unchanged — stays for fast in-lead calcs |
| ZIP cluster comps logic | Inside generate-ai-notes, unchanged |

---

## What's New

| New | Purpose |
|---|---|
| `/screener` page + split-panel layout | The Deal War Room |
| `generate-negotiation-plan.mjs` | Negotiation plan + master closer communications |
| "Negotiate" tab in `NotesRenderer` | Renders negotiation plan output |
| `screened` boolean on leads | Separates screener-promoted leads from Kevin's pipeline |
| "Screener" tab in `LeadsPage` | Dedicated view for screener-promoted leads |
| Score update: Motivation 10→20pts, Price Gap 25→20pts | Better weighting |
| Negotiation Leverage Badge | Contextualizes score with negotiating room |

---

## Verification

**End-to-end test flow:**
1. Open `/screener` — queue is empty, single entry form shown
2. Enter an address + asking price → RentCast enriches property details
3. Click Analyze → spinner runs → NotesRenderer renders full analysis with all tabs
4. Enter same address again → duplicate warning banner appears
5. Click "Pass" → deal greyed out in queue
6. Add a second deal → analyze → click "Get Negotiation Plan" → Negotiate tab appears with plan + 3 draft communications
7. Change tone to Aggressive → communications regenerate, plan unchanged
8. Click "Save to CRM" → lead created with `screened: true`, `lead_source: 'wholesaler'`, agent linked
9. Open Leads page → Screener tab shows the saved lead; Kevin's pipeline unchanged
10. Open the saved lead → full NotesRenderer with all analysis intact, including negotiation plan
11. Upload a 3-row CSV → 3 cards appear in queue → analyses run sequentially → all complete
