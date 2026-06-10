# AI Negotiation Email Assistant

**Date:** 2026-06-11  
**Status:** Approved

---

## Overview

Upgrade the Email Compose Modal from a static template into a full AI-powered negotiation assistant. Two modes: **Initial Outreach** (generate first contact email from scratch) and **Reply** (generate a counter-response based on what the seller/agent sent back or a preset situation). Every email is written as Kevin Bachman — never as Tomer or any other user.

---

## Sender Identity (baked into every email)

```
Kevin Bachman
Broker/Owner
Bachman Property Brokers LLC
(904) 748-9141
```

HAT Investors is introduced as the buyer client Kevin represents. Kevin is the agent/broker acting on their behalf. No mention of Tomer or any internal user names.

---

## UI — Modal Structure

The modal gains two tabs: **Initial Outreach** and **Reply**. The rest of the modal (To, CC, Subject, Body, Open in Gmail button) stays the same.

### Initial Outreach Tab

- Body textarea starts empty
- Prominent **"✦ Generate Email"** button below the body
- Clicking it calls `generate-email.mjs`, shows spinner on button, populates textarea on success
- User can edit before sending
- Error shown inline if generation fails

### Reply Tab

Two inputs, either or both can be filled before generating:

1. **Situation presets** — clickable chip buttons (toggle on/off):
   - "Countered higher"
   - "Asked for proof of funds"
   - "Said not interested"
   - "No response / ghosted"
   - "Wants faster close"
   - "Wants leaseback / stay longer"

2. **Paste their reply** — free-text textarea labeled "Paste their email response (optional)"

**"✦ Generate Reply"** button calls `generate-email.mjs` with `mode: 'reply'`, the selected situation chips, and the pasted reply text. Result populates the Body textarea above.

---

## Negotiation Strategy Logic

The system prompt instructs Claude to determine strategy from the gap between `offer_price` and `asking_price`:

| Gap | Strategy |
|-----|----------|
| < 5% | Confident tone — near-ask, emphasize speed/cash/no contingency, create urgency |
| 5–20% | Data-driven — reference ARV, renovation scope, justify the number, rapport-first |
| > 20% | Anchor low — as-is narrative, seller motivation focus, long-term relationship framing, scarcity of cash buyers |

When `offer_price` is not set, fall back to `mao` as the offer reference.  
When `asking_price` is not set, omit gap logic and write a neutral relationship-building email.

---

## Netlify Function: `generate-email.mjs`

**Endpoint:** `POST /.netlify/functions/generate-email`

**Request body:**
```json
{
  "mode": "initial" | "reply",
  "lead": {
    "address": "...",
    "city": "...",
    "state": "...",
    "property_type": "...",
    "bedrooms": 3,
    "bathrooms": 2,
    "sqft": 1400,
    "year_built": 1985,
    "asking_price": 220000,
    "offer_price": 155000,
    "arv": 275000,
    "renovation_cost": 55000,
    "mao": 151250,
    "rent_estimate": 1800,
    "mls_status": "active",
    "listing_agent_name": "Jane Smith",
    "listing_agent_email": "jane@brokerage.com"
  },
  "situation": ["countered_higher", "asked_proof_of_funds"],
  "their_reply": "Thanks for reaching out. The seller is firm at $220k..."
}
```

**Response:**
```json
{ "ok": true, "body": "Hi Jane,\n\n..." }
```

**System prompt persona:**
- Kevin Bachman, Broker/Owner, Bachman Property Brokers LLC, (904) 748-9141
- Represents HAT Investors — active cash buyers in Jacksonville
- Close in 14–21 days, no financing contingency, buy as-is
- Tone: professional, confident, relationship-oriented
- Never mention Tomer or any internal user
- No placeholders — use all provided data, write complete ready-to-send email

**Negotiation principles embedded in system prompt:**
- Anchor with data, not opinion
- Acknowledge the seller's position before countering
- Use social proof ("we've closed X deals in Jacksonville this year")
- Create soft urgency without pressure ("our buy box fills up quickly")
- For ghosted leads: re-engagement with new angle, not repetition
- For proof-of-funds requests: confident acknowledgment, pivot to speed advantage
- For "not interested": plant a seed for future deals, never burn the relationship

---

## Data Flow

```
User opens modal
  → Tab: Initial Outreach
  → Clicks "✦ Generate Email"
  → POST /generate-email { mode: 'initial', lead: { ...all fields } }
  → Claude writes email as Kevin with strategy based on offer/ask gap
  → Body textarea populated
  → User edits if needed → Opens in Gmail

User opens modal
  → Tab: Reply
  → Selects situation chips and/or pastes their reply
  → Clicks "✦ Generate Reply"
  → POST /generate-email { mode: 'reply', lead: {...}, situation: [...], their_reply: '...' }
  → Claude reads situation + reply + lead context → writes negotiation counter
  → Body textarea populated
  → User edits if needed → Opens in Gmail
```

---

## Files Changed

- `src/components/lead-detail/EmailComposeModal.jsx` — add tabs, Generate buttons, situation chips, paste textarea, loading states
- `netlify/functions/generate-email.mjs` — new function, Claude API call, system prompt, strategy logic
