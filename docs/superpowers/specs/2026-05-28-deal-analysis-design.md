# Deal Analysis Feature — Design Spec
**Date:** 2026-05-28  
**Status:** Approved

---

## Context

HatInvestors already has a deal analysis system in the `hat-ai-agents` project: a Claude Code agent (`deal-analysis-agent.md`) that takes purchase price, ARV, and renovation cost, runs a full financial analysis, and outputs a rich markdown report + an interactive HTML dashboard (`tools/deal-analyzer.html`).

This spec defines how to bring that capability into HatCRM so users can trigger a deal analysis directly from any lead page, see the results inline, and open the full interactive dashboard — without duplicating the financial model logic.

---

## Approach

**Approach A (selected):** Copy `deal-analyzer.html` into the CRM's public folder. A new Netlify function calls the Anthropic Claude API using the exact deal-analysis-agent system prompt. Results are saved to the lead record. The CRM shows the verdict and key metrics inline; a button opens the dashboard pre-populated via URL params.

---

## Architecture

```
Lead Page → "Analyze Deal" button
    ↓
POST /.netlify/functions/analyze-deal
    { lead_id, address, purchase_price, arv, renovation_cost, strategy }
    ↓
Anthropic Claude API
    system: [deal-analysis-agent.md content]
    user:   "Analyze this flip: address=..., pp=..., reno=..., arv=..."
    ↓
Structured response: markdown + JSON summary block
    ↓
Save to leads.deal_analysis (JSONB)
    ↓
DealAnalysisPanel renders inline verdict + metrics
    ↓
"Open Dashboard →" opens /deal-analyzer.html?pp=...&arv=...&reno=...
```

---

## Database

Add one JSONB column to the `leads` table:

```sql
ALTER TABLE leads ADD COLUMN IF NOT EXISTS deal_analysis jsonb;
```

**Schema of the stored object:**
```json
{
  "verdict": "BUY | PASS | CONDITIONAL",
  "score": 74,
  "strategy": "flip | brrrr",
  "profit": 54600,
  "roi": 18.3,
  "annualized_roi": 73.2,
  "total_cash_needed": 42000,
  "recommendation": "2–3 sentence summary from Claude",
  "key_risks": ["risk 1", "risk 2", "risk 3"],
  "markdown": "full markdown analysis text from Claude",
  "analyzed_at": "2026-05-28T12:00:00Z"
}
```

---

## Files

| File | Action | Description |
|---|---|---|
| `public/deal-analyzer.html` | Copy + modify | Copied from `hat-ai-agents/tools/deal-analyzer.html`. Add 10-line URL param bootstrap so the page auto-loads from `?pp=&arv=&reno=&address=` |
| `netlify/functions/analyze-deal.mjs` | Create | Calls Claude API, parses response, saves to Supabase, returns JSON |
| `src/components/lead-detail/FinancialSection.jsx` | Modify | Add "✦ Analyze Deal" button + import DealAnalysisPanel |
| `src/components/lead-detail/DealAnalysisPanel.jsx` | Create | Renders saved analysis: verdict, metrics, risks, markdown expander, dashboard link |

---

## Netlify Function: `analyze-deal.mjs`

**POST body:** `{ lead_id, address, purchase_price, arv, renovation_cost, strategy }`

**Steps:**
1. Validate inputs (lead_id, purchase_price, arv required)
2. Build user prompt: `"Analyze this {strategy} deal: Address: {address}, Purchase Price: ${pp}, Renovation: ${reno}, ARV: ${arv}. After your full written analysis, append a JSON block: { verdict, score (0–100), profit, roi, annualized_roi, total_cash_needed, recommendation, key_risks[] }"`
3. Call `https://api.anthropic.com/v1/messages` with `claude-opus-4-7` model, system = deal-analysis-agent.md content
4. Parse the JSON block from the response (after the last ` ```json ` marker)
5. Save full analysis to `leads.deal_analysis` via Supabase REST API (using `SUPABASE_PAT`)
6. Return `{ ok: true, analysis: { ...parsed json, markdown } }`

**Env vars required:**
- `ANTHROPIC_API_KEY`
- `SUPABASE_URL` (already present)
- `SUPABASE_PAT` (already present)

**Error handling:** If JSON parsing fails, save raw markdown and return a best-effort response. Never fail silently — return a clear error message to the frontend.

---

## UI: FinancialSection.jsx Changes

Add inside the existing `FinancialSection` Card, as a new row after the MAO field and before the closing `</Card>` tag:

```
──────────────────────────────────────
[last analysis: 3 days ago]   [✦ Analyze Deal]   ← new row
──────────────────────────────────────
[DealAnalysisPanel]                               ← new, only when analysis exists
```

The trigger row also includes a **Flip | BRRRR** toggle (two small radio-style buttons) so the user can pick the analysis strategy before running. Defaults to **Flip**. The selected strategy is passed to the Netlify function and stored in `deal_analysis.strategy`.

Button states:
- Default: "✦ Analyze Deal" (accent color)  
- Loading: spinner + "Analyzing…" (disabled)
- Has saved analysis: "↺ Re-analyze" (ghost variant)

---

## UI: DealAnalysisPanel.jsx

Shown below the Financial section when `lead.deal_analysis` is non-null.

**Sections (top to bottom):**

1. **Verdict row** — large BUY / PASS / CONDITIONAL badge (green/red/yellow) + score ring (0–100) + 1-sentence recommendation
2. **Metrics row** — 3 cards: Est. Profit | ROI | Annualized ROI | Total Cash Needed
3. **Key risks** — 2–3 colored chips (⚠ risk text)
4. **"View Full Analysis"** — toggles an expander showing the raw markdown (rendered as preformatted text or simple markdown renderer)
5. **Footer** — "Open Dashboard →" button (opens `/deal-analyzer.html?pp=...&arv=...&reno=...&address=...` in new tab) + timestamp

---

## deal-analyzer.html: URL Param Support

Replace the existing `Init` block at the bottom of the file:

```js
// Before:
loadDeal(DEAL);
calc();

// After:
const _params = new URLSearchParams(window.location.search);
const _fromUrl = {
  address:    _params.get('address')   || DEAL.address,
  pp:         parseFloat(_params.get('pp'))   || DEAL.pp,
  reno:       parseFloat(_params.get('reno')) || DEAL.reno,
  arv:        parseFloat(_params.get('arv'))  || DEAL.arv,
  rent:       parseFloat(_params.get('rent')) || DEAL.rent,
  hold_flip:  parseInt(_params.get('hold_flip'))  || DEAL.hold_flip,
  hold_brrrr: parseInt(_params.get('hold_brrrr')) || DEAL.hold_brrrr,
};
loadDeal(_fromUrl);
calc();
```

---

## Permissions

- `readonly` users: can see saved analysis, cannot trigger or re-run
- `regular` + `admin`: can trigger and re-run analysis
- Button is disabled (`canEdit === false`) for readonly users

---

## Activity Logging

After a successful analysis, log to `lead_activities`:
```
type: 'activity'
content: 'Deal analysis run — Verdict: BUY / $54,600 profit / 18.3% ROI'
metadata: { event: 'deal_analysis_run', verdict, profit, roi }
```

---

## Verification

1. Open any lead with ARV + renovation_cost + asking_price filled in
2. Click "✦ Analyze Deal" — confirm loading spinner appears
3. After ~15s, confirm DealAnalysisPanel renders with verdict, metrics, risks
4. Confirm `deal_analysis` column is populated in Supabase
5. Confirm activity timeline shows "Deal analysis run" entry
6. Click "Open Dashboard →" — confirm deal-analyzer.html opens with correct numbers pre-filled
7. Click "↺ Re-analyze" — confirm fresh analysis replaces previous one
8. Log in as readonly user — confirm button is hidden/disabled
