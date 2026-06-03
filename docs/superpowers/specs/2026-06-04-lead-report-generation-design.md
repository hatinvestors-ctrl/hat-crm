# Lead Report Generation Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Generate AI-written, recipient-specific reports for any lead — lender, listing agent, direct seller, wholesaler, or internal summary — directly from the lead detail page with editable output and one-click Gmail/PDF export.

**Architecture:** New Netlify function `generate-report.mjs` calls Claude with a recipient-specific system prompt + lead data. New `ReportSection.jsx` component embedded on the lead detail page renders the editable report with Copy/Gmail/PDF actions. No new DB columns — reports are generated on demand.

**Tech Stack:** React 18, Claude API (claude-sonnet-4-6), Netlify Functions, browser window.print() for PDF, existing Gmail compose URL pattern.

---

## Report Types

| Type | Recipient | Subject Line | Tone | Length options |
|------|-----------|-------------|------|----------------|
| `lender` | Rob (HML) | `Funding Request — {address}` | Professional, numbers-first | Brief / Standard / Detailed |
| `agent` | Listing agent | `Cash Offer — {address}` | Direct, decisive | Brief / Standard / Detailed |
| `seller` | Direct/FSBO seller | `Your Property at {address} — Cash Offer` | Warm, simple, no jargon | Brief / Standard / Detailed |
| `wholesaler` | Wholesaler | `Interested — {address}` | Very short, investor-to-investor | Brief / Standard |
| `general` | Internal | `Deal Summary — {address}` | Factual, comprehensive | Standard / Detailed |

---

## Data Passed to Claude

```json
{
  "recipient_type": "lender",
  "length": "standard",
  "lead": {
    "address": "6552 Bartholf Ave",
    "city": "Jacksonville", "state": "FL", "zip_code": "32210",
    "bedrooms": 3, "bathrooms": 2, "sqft": 1400, "year_built": 1960, "has_garage": false,
    "arv": 250000,
    "asking_price": 140000,
    "offer_price": 132000,
    "renovation_cost": 65000,
    "mao": 122500,
    "rent_estimate": null,
    "notes": "Block construction. Large backyard with workshop. Needs full rehab.",
    "conservative_arv": 240000, "conservative_offer_price": 132000, "conservative_renovation_cost": 65000,
    "aggressive_arv": 260000, "aggressive_offer_price": 132000, "aggressive_renovation_cost": 65000,
    "deal_analysis": { "verdict": "BUY", "profit": 35500, "roi": 28.4, "key_risks": ["..."] },
    "recent_notes": ["GC inspection positive", "Seller accepted 132K after rejecting initial renegotiation"]
  }
}
```

---

## Report Structure Per Type

### Lender (`lender`)
```
Subject: Funding Request — {address}

[Greeting — "Hope you're doing well..."]
[Quick Background — how we found it, what we offered, why]
[Property Highlights — Pros bullet list, Challenges bullet list]
[Sold Comps — 3 lines: address, beds/sqft, sold price — pulled from notes or stated as "comps to be provided"]
[Scenario Table — Conservative / Realistic / Aggressive: ARV, Reno, Purchase, Profit]
[Ask — pre-approval request, thoughts on numbers, offer to send full package]
[Sign-off — Hemi Sher & Tomer Carmelli, HAT Investors LLC]
```

### Listing Agent (`agent`)
```
Subject: Cash Offer — {address}

[Who we are — HAT Investors, active Jacksonville buyers, high volume]
[Our offer — amount, terms: cash/HML, 14-21 day close, no contingency, as-is]
[Why we're strong — track record, fast close, no financing risk]
[2-3 questions — seller motivation, known issues, prior offers]
[Sign-off]
```

### Direct Seller (`seller`)
```
Subject: Your Property at {address} — Cash Offer from HAT Investors

[Introduction — friendly, who we are, local company]
[What we see in the property — positives, honest about condition]
[Our offer — amount, simple process explained, as-is, fast close]
[Process — "here's how it works: sign, inspect, close in 3 weeks"]
[Call to action — "call us or reply to discuss"]
[Sign-off]
```

### Wholesaler (`wholesaler`)
```
Subject: Interested — {address}

[2-3 sentences: who we are, our MAO range, close timeline]
[What we need: clear title, access for walkthrough]
[Sign-off — direct, no fluff]
```

### General / Internal (`general`)
```
Subject: Deal Summary — {address}

[Property Info — all fields: address, beds/baths, sqft, year, garage]
[Financial Summary — ARV, purchase, renovation, MAO, offer]
[Scenario Table — all 3 scenarios with profit/ROI]
[Deal Analysis — verdict, profit, annualized ROI, key risks]
[Notes & History — lead notes + recent activity]
[Status — current CRM status, assigned to, follow-up date]
```

---

## Length Definitions

| Length | Word count | What gets trimmed |
|--------|-----------|------------------|
| Brief | ~150 words | Comps removed, challenges condensed to 1 line, no scenario table detail |
| Standard | ~350 words | Full structure, scenario table, 2-3 comps |
| Detailed | ~600 words | Everything: full comps, full scenario narrative, GC notes, all risks |

---

## UI — ReportSection.jsx

**Location:** Lead detail page, between `ScenariosFlat` and `ActivityTimeline` (left column).

**Layout:**
```
┌─────────────────────────────────────────────────────┐
│  📄 Generate Report                                  │
│                                                     │
│  [🏦 Lender] [🏠 Agent] [👤 Seller] [📦 Wholesaler] [📋 General]  │
│                                                     │
│  Length: ○ Brief  ● Standard  ○ Detailed   [⚡ Generate] │
│                                                     │
│ ┌─────────────────────────────────────────────────┐ │
│ │  Subject: Funding Request — 6552 Bartholf Ave  │ │
│ │  ─────────────────────────────────────────────  │ │
│ │  [Editable textarea — full report text]         │ │
│ │                                                 │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│  [📋 Copy]   [✉ Open in Gmail]   [📄 Download PDF]  │
└─────────────────────────────────────────────────────┘
```

**State:**
```js
const [reportType, setReportType] = useState('lender')
const [length, setLength]         = useState('standard')
const [subject, setSubject]       = useState('')
const [reportText, setReportText] = useState('')
const [generating, setGenerating] = useState(false)
const [error, setError]           = useState(null)
```

**Behavior:**
- Clicking a recipient tab does NOT auto-generate — user must click ⚡ Generate
- Switching tabs clears the current report (with a "discard?" confirm if text was edited)
- Subject line is editable
- Report textarea is fully editable after generation
- Regenerate replaces current text (with confirm if edited)

**Actions:**
- **Copy** — `navigator.clipboard.writeText(subject + '\n\n' + reportText)`
- **Open in Gmail** — `window.open('https://mail.google.com/mail/?view=cm&su={subject}&body={text}', '_blank')`
- **Download PDF** — inject report into a hidden `<div>` with print CSS, call `window.print()`

---

## Netlify Function: `generate-report.mjs`

**Endpoint:** `POST /.netlify/functions/generate-report`

**Request body:**
```json
{
  "recipient_type": "lender",
  "length": "standard",
  "lead": { /* lead fields */ }
}
```

**Response:**
```json
{
  "ok": true,
  "subject": "Funding Request — 6552 Bartholf Ave",
  "report": "Hope you're doing well...\n\n..."
}
```

**System prompts per recipient type:** Each type has a dedicated system prompt embedded in the function that sets tone, structure, and constraints. The user prompt contains the lead data formatted as a structured brief.

**Length instruction** is appended to the user prompt:
- Brief: "Keep the report under 150 words. Skip comps and scenario table."
- Standard: "Target ~350 words. Include scenario table and 2-3 comps if available."
- Detailed: "Target ~600 words. Include full comps, scenario narrative, all risks, and notes."

**Required env vars:** `ANTHROPIC_API_KEY` (already configured)

---

## Files to Create / Modify

| File | Action |
|------|--------|
| `netlify/functions/generate-report.mjs` | Create — Claude API call with 5 system prompts |
| `src/components/lead-detail/ReportSection.jsx` | Create — full UI component |
| `src/pages/LeadDetailPage.jsx` | Modify — add ReportSection between ScenariosFlat and ActivityTimeline |

---

## Notes
- Comps are not stored in the CRM yet — the prompt tells Claude to note "comps to be provided separately" unless they exist in lead notes
- No report saving to DB in v1 — generate on demand
- PDF uses browser print — no dependencies, works for all browsers
- All 5 system prompts are embedded in the Netlify function, not in the frontend
