# Deal Analysis Feature — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Analyze Deal" button to the Financial section of every lead page that calls Claude API using the existing deal-analysis-agent prompt, saves results to the lead record, and renders an inline analysis panel + opens the existing deal-analyzer.html dashboard pre-populated.

**Architecture:** A new Netlify function (`analyze-deal.mjs`) calls the Anthropic Claude API with the deal-analysis-agent system prompt, parses the response into a structured JSON object, and saves it to a new `deal_analysis` JSONB column on the `leads` table. The frontend renders the saved analysis in a new `DealAnalysisPanel` component and can open the copied `deal-analyzer.html` dashboard pre-populated via URL params.

**Tech Stack:** React 18, Supabase (PostgreSQL), Netlify Functions (ESM), Anthropic Claude API (claude-opus-4-7), Tailwind CSS v4 with CSS custom properties.

---

## File Map

| File | Action |
|---|---|
| `public/deal-analyzer.html` | Copy from `../hat-ai-agents/tools/deal-analyzer.html` + add URL param bootstrap |
| `netlify/functions/analyze-deal.mjs` | Create — Claude API call + Supabase save |
| `src/components/lead-detail/DealAnalysisPanel.jsx` | Create — renders saved analysis |
| `src/components/lead-detail/FinancialSection.jsx` | Modify — add button, strategy toggle, panel |
| `src/lib/activityLogger.js` | Modify — add `logDealAnalysis()` |

---

## Task 1: Add `deal_analysis` column to Supabase

**Files:** Supabase SQL editor (no local file)

- [ ] **Step 1: Run migration in Supabase dashboard**

Go to your Supabase project → SQL Editor → New query → paste and run:

```sql
ALTER TABLE leads ADD COLUMN IF NOT EXISTS deal_analysis jsonb;
```

- [ ] **Step 2: Verify column exists**

In Supabase Table Editor, open the `leads` table and confirm `deal_analysis` column appears with type `jsonb`.

---

## Task 2: Copy deal-analyzer.html and add URL param support

**Files:**
- Create: `public/deal-analyzer.html`

- [ ] **Step 1: Copy the file**

```bash
cp "../hat-ai-agents/tools/deal-analyzer.html" "public/deal-analyzer.html"
```

- [ ] **Step 2: Add URL param bootstrap**

In `public/deal-analyzer.html`, find the `Init` block near the very end of the file (search for `loadDeal(DEAL)`). It looks like this:

```js
// Init
loadDeal(DEAL);
updateHoldLabel('flip');
updateHoldLabel('brrrr');
calc();
```

Replace it with:

```js
// Init — read URL params first (CRM integration), fall back to embedded DEAL object
const _p = new URLSearchParams(window.location.search);
const _dealData = {
  address:    _p.get('address')               || DEAL.address,
  pp:         parseFloat(_p.get('pp'))        || DEAL.pp,
  reno:       parseFloat(_p.get('reno'))      || DEAL.reno,
  arv:        parseFloat(_p.get('arv'))       || DEAL.arv,
  rent:       parseFloat(_p.get('rent'))      || DEAL.rent,
  hold_flip:  parseInt(_p.get('hold_flip'))   || DEAL.hold_flip,
  hold_brrrr: parseInt(_p.get('hold_brrrr'))  || DEAL.hold_brrrr,
};
loadDeal(_dealData);
updateHoldLabel('flip');
updateHoldLabel('brrrr');
calc();
```

- [ ] **Step 3: Verify dashboard opens standalone**

Open `http://localhost:5173/deal-analyzer.html` in the browser (with `npm run dev` running). Confirm the dashboard loads with the embedded DEAL object values.

- [ ] **Step 4: Verify URL params work**

Open `http://localhost:5173/deal-analyzer.html?pp=200000&arv=300000&reno=40000&address=123+Main+St`. Confirm the input fields pre-fill with those values and the calculations update.

- [ ] **Step 5: Commit**

```bash
git add public/deal-analyzer.html
git commit -m "feat: add deal-analyzer dashboard with URL param support"
```

---

## Task 3: Create `netlify/functions/analyze-deal.mjs`

**Files:**
- Create: `netlify/functions/analyze-deal.mjs`

**Required env vars:** `ANTHROPIC_API_KEY`, `SUPABASE_URL` (already set), `SUPABASE_PAT` (already set)

- [ ] **Step 1: Read the agent system prompt**

Read the full content of `c:\Users\tomer\Documents\PrivateNew180425\CloudeCode\hat-ai-agents\.claude\agents\deal-analysis-agent.md`. This becomes the `SYSTEM_PROMPT` constant in the function below (paste the full file content as the template literal value).

- [ ] **Step 2: Create the function file**

Create `netlify/functions/analyze-deal.mjs` with this content (replacing `<FULL CONTENT OF deal-analysis-agent.md>` with the actual file content read in Step 1):

```js
// Analyze a real estate deal using the HAT deal-analysis-agent prompt.
//
// POST /.netlify/functions/analyze-deal
// body: { lead_id, address, purchase_price, arv, renovation_cost, strategy }
//
// Required env vars: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_PAT

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
const SUPABASE_URL      = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_PAT      = process.env.SUPABASE_PAT

const HEADERS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST,OPTIONS',
}

// Full content of hat-ai-agents/.claude/agents/deal-analysis-agent.md
const SYSTEM_PROMPT = `<FULL CONTENT OF deal-analysis-agent.md>`

function buildUserPrompt({ address, purchase_price, arv, renovation_cost, strategy }) {
  const strategyLabel = strategy === 'brrrr' ? 'BRRRR' : 'flip'
  return `Analyze this ${strategyLabel} deal:
- Address: ${address || 'Not provided'}
- Purchase Price: $${Number(purchase_price).toLocaleString()}
- Renovation Cost: $${Number(renovation_cost).toLocaleString()}
- ARV: $${Number(arv).toLocaleString()}
- Strategy: ${strategyLabel}

After your full written analysis, append a JSON summary block in exactly this format (no other text after it):

\`\`\`json
{
  "verdict": "BUY",
  "score": 74,
  "profit": 54600,
  "roi": 18.3,
  "annualized_roi": 73.2,
  "total_cash_needed": 42000,
  "recommendation": "2-3 sentence summary of the deal and key reason for verdict.",
  "key_risks": ["Risk one", "Risk two", "Risk three"]
}
\`\`\``
}

function parseJsonBlock(text) {
  const match = text.match(/```json\s*([\s\S]*?)```\s*$/)
  if (!match) return null
  try { return JSON.parse(match[1].trim()) } catch { return null }
}

async function saveAnalysis(leadId, analysisObj) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}`,
    {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_PAT,
        Authorization: `Bearer ${SUPABASE_PAT}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ deal_analysis: analysisObj }),
    }
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Supabase save failed: ${res.status} ${text}`)
  }
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), { status: 405, headers: HEADERS })
  }

  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ ok: false, error: 'ANTHROPIC_API_KEY not configured.' }), { status: 500, headers: HEADERS })
  }
  if (!SUPABASE_URL || !SUPABASE_PAT) {
    return new Response(JSON.stringify({ ok: false, error: 'Supabase credentials not configured.' }), { status: 500, headers: HEADERS })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const { lead_id, address, purchase_price, arv, renovation_cost, strategy = 'flip' } = body

    if (!lead_id)        return new Response(JSON.stringify({ ok: false, error: 'lead_id is required.' }), { status: 400, headers: HEADERS })
    if (!purchase_price) return new Response(JSON.stringify({ ok: false, error: 'purchase_price is required.' }), { status: 400, headers: HEADERS })
    if (!arv)            return new Response(JSON.stringify({ ok: false, error: 'arv is required.' }), { status: 400, headers: HEADERS })

    // Call Claude API
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-7',
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserPrompt({ address, purchase_price, arv, renovation_cost, strategy }) }],
      }),
    })

    if (!claudeRes.ok) {
      const errText = await claudeRes.text()
      throw new Error(`Claude API error ${claudeRes.status}: ${errText}`)
    }

    const claudeData = await claudeRes.json()
    const markdown   = claudeData.content?.[0]?.text || ''
    const summary    = parseJsonBlock(markdown) || {}

    const analysisObj = {
      verdict:          summary.verdict          || 'UNKNOWN',
      score:            summary.score            ?? null,
      strategy,
      profit:           summary.profit           ?? null,
      roi:              summary.roi              ?? null,
      annualized_roi:   summary.annualized_roi   ?? null,
      total_cash_needed: summary.total_cash_needed ?? null,
      recommendation:   summary.recommendation   || '',
      key_risks:        summary.key_risks        || [],
      markdown,
      analyzed_at:      new Date().toISOString(),
    }

    await saveAnalysis(lead_id, analysisObj)

    return new Response(JSON.stringify({ ok: true, analysis: analysisObj }), { status: 200, headers: HEADERS })
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message || String(err) }), { status: 500, headers: HEADERS })
  }
}
```

- [ ] **Step 3: Add ANTHROPIC_API_KEY to your Netlify environment variables**

In the Netlify dashboard → Site → Environment variables → add `ANTHROPIC_API_KEY` with your Anthropic API key. Also add it to your local `.env` file (or `.env.local`) for local testing with `netlify dev`.

- [ ] **Step 4: Commit**

```bash
git add netlify/functions/analyze-deal.mjs
git commit -m "feat: add analyze-deal Netlify function (Claude API)"
```

---

## Task 4: Add `logDealAnalysis` to activityLogger.js

**Files:**
- Modify: `src/lib/activityLogger.js`

- [ ] **Step 1: Add the export**

In `src/lib/activityLogger.js`, append after `logEmailSent`:

```js
export async function logDealAnalysis(leadId, userId, { verdict, profit, roi }) {
  const profitStr = profit != null ? `$${Number(profit).toLocaleString()}` : '—'
  const roiStr    = roi    != null ? `${roi}%` : '—'
  await supabase.from('lead_activities').insert({
    lead_id:  leadId,
    user_id:  userId,
    type:     'activity',
    content:  `Deal analysis run — Verdict: ${verdict} / ${profitStr} profit / ${roiStr} ROI`,
    metadata: { event: 'deal_analysis_run', verdict, profit: profit ?? null, roi: roi ?? null },
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/activityLogger.js
git commit -m "feat: add logDealAnalysis activity logger"
```

---

## Task 5: Create `DealAnalysisPanel.jsx`

**Files:**
- Create: `src/components/lead-detail/DealAnalysisPanel.jsx`

- [ ] **Step 1: Create the component**

```jsx
import { useState } from 'react'
import Button from '../ui/Button'
import { formatCurrency } from '../../lib/calculations'

const VERDICT_STYLES = {
  BUY:         { bg: 'bg-[color:var(--color-success-soft)]', text: 'text-[color:var(--color-success-text)]', border: 'border-[color:var(--color-success)]' },
  PASS:        { bg: 'bg-[color:var(--color-danger-soft)]',  text: 'text-[color:var(--color-danger-text)]',  border: 'border-[color:var(--color-danger)]'  },
  CONDITIONAL: { bg: 'bg-[color:var(--color-warn-soft)]',   text: 'text-[color:var(--color-warn-text)]',    border: 'border-[color:var(--color-warn)]'    },
  UNKNOWN:     { bg: 'bg-[color:var(--color-bg-elev-2)]',   text: 'text-[color:var(--color-text-muted)]',   border: 'border-[color:var(--color-line)]'    },
}

function ScoreRing({ score }) {
  if (score == null) return null
  const pct   = Math.max(0, Math.min(100, score))
  const color = pct >= 70 ? '#22c55e' : pct >= 45 ? '#f59e0b' : '#ef4444'
  return (
    <div className="relative shrink-0 w-12 h-12">
      <svg viewBox="0 0 36 36" className="w-12 h-12 -rotate-90">
        <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--color-line)" strokeWidth="3" />
        <circle
          cx="18" cy="18" r="15.9" fill="none"
          stroke={color} strokeWidth="3"
          strokeDasharray={`${pct} ${100 - pct}`}
          strokeLinecap="round"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-[color:var(--color-text)]">
        {pct}
      </span>
    </div>
  )
}

export default function DealAnalysisPanel({ analysis, lead }) {
  const [expanded, setExpanded] = useState(false)
  if (!analysis) return null

  const { verdict = 'UNKNOWN', score, profit, roi, annualized_roi, total_cash_needed,
          recommendation, key_risks = [], markdown, analyzed_at, strategy = 'flip' } = analysis

  const vs = VERDICT_STYLES[verdict] || VERDICT_STYLES.UNKNOWN

  const dashboardUrl = (() => {
    const p = new URLSearchParams({
      pp:      lead.asking_price   || lead.offer_price || '',
      arv:     lead.arv            || '',
      reno:    lead.renovation_cost|| '',
      rent:    lead.rent_estimate  || '0',
      address: lead.address        || '',
    })
    return `/deal-analyzer.html?${p.toString()}`
  })()

  const ts = analyzed_at
    ? new Date(analyzed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  return (
    <div className="mt-3 pt-3 border-t border-[color:var(--color-line)] space-y-3">
      {/* Verdict + score + recommendation */}
      <div className={`flex items-start gap-3 p-3 rounded-md border ${vs.bg} ${vs.border}`}>
        <ScoreRing score={score} />
        <div className="flex-1 min-w-0">
          <div className={`text-[13px] font-bold mb-0.5 ${vs.text}`}>
            {verdict === 'BUY' ? '✓' : verdict === 'PASS' ? '✗' : '⚠'} {verdict}
            {strategy && <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider opacity-60">{strategy}</span>}
          </div>
          {recommendation && (
            <p className="text-[12px] text-[color:var(--color-text-muted)] leading-relaxed">{recommendation}</p>
          )}
        </div>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: 'Est. Profit',     value: profit           != null ? formatCurrency(profit)             : '—' },
          { label: 'ROI',             value: roi              != null ? `${roi}%`                          : '—' },
          { label: 'Annualized ROI',  value: annualized_roi   != null ? `${annualized_roi}%`               : '—' },
          { label: 'Cash Needed',     value: total_cash_needed!= null ? formatCurrency(total_cash_needed)  : '—' },
        ].map(({ label, value }) => (
          <div key={label} className="bg-[color:var(--color-bg)] border border-[color:var(--color-line)] rounded-md p-2 text-center">
            <div className="text-[9.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] mb-1">{label}</div>
            <div className="text-[13px] font-semibold text-[color:var(--color-text)]">{value}</div>
          </div>
        ))}
      </div>

      {/* Key risks */}
      {key_risks.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {key_risks.map((r, i) => (
            <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-[color:var(--color-warn-soft)] text-[color:var(--color-warn-text)]">
              ⚠ {r}
            </span>
          ))}
        </div>
      )}

      {/* Full analysis expander */}
      {markdown && (
        <div>
          <button
            onClick={() => setExpanded(v => !v)}
            className="text-[11.5px] text-[color:var(--color-accent-text)] hover:underline"
          >
            {expanded ? '▲ Hide full analysis' : '▼ View full analysis'}
          </button>
          {expanded && (
            <pre className="mt-2 p-3 bg-[color:var(--color-bg)] border border-[color:var(--color-line)] rounded-md text-[11.5px] text-[color:var(--color-text-muted)] leading-relaxed whitespace-pre-wrap overflow-auto max-h-96">
              {markdown}
            </pre>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-1">
        {ts && <span className="text-[10.5px] text-[color:var(--color-text-dim)]">Analyzed {ts}</span>}
        <a
          href={dashboardUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[12px] px-2.5 py-1 bg-[color:var(--color-bg-elev-2)] hover:bg-[color:var(--color-accent-soft)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-accent-text)] rounded transition-colors"
        >
          Open Dashboard →
        </a>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/lead-detail/DealAnalysisPanel.jsx
git commit -m "feat: add DealAnalysisPanel component"
```

---

## Task 6: Modify `FinancialSection.jsx`

**Files:**
- Modify: `src/components/lead-detail/FinancialSection.jsx`

- [ ] **Step 1: Replace the full file content**

```jsx
import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import Card from '../ui/Card'
import Button from '../ui/Button'
import EditableField from './EditableField'
import DealAnalysisPanel from './DealAnalysisPanel'
import { formatCurrency } from '../../lib/calculations'
import { useLeadUpdate } from '../../hooks/useLeadUpdate'
import { logDealAnalysis } from '../../lib/activityLogger'

export default function FinancialSection({ lead, userId, members, canEdit, onUpdated }) {
  const { workspaceId } = useOutletContext()
  const update = useLeadUpdate(lead, userId, members, onUpdated)

  const [strategy,  setStrategy]  = useState(lead.deal_analysis?.strategy || 'flip')
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState(null)

  const hasAnalysis = !!lead.deal_analysis

  async function handleAnalyze() {
    setAnalyzing(true)
    setAnalyzeError(null)
    try {
      const res = await fetch('/.netlify/functions/analyze-deal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_id:          lead.id,
          address:          [lead.address, lead.city, lead.state].filter(Boolean).join(', '),
          purchase_price:   lead.asking_price || lead.offer_price,
          arv:              lead.arv,
          renovation_cost:  lead.renovation_cost,
          strategy,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || 'Analysis failed.')
      await logDealAnalysis(lead.id, userId, data.analysis)
      onUpdated?.()
    } catch (err) {
      setAnalyzeError(err.message || 'Something went wrong.')
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <Card title="Financials">
      <div className="grid grid-cols-2 gap-4">
        <EditableField
          label="Asking Price"
          type="currency"
          value={lead.asking_price}
          formatter={formatCurrency}
          onSave={(v) => update({ asking_price: v })}
          disabled={!canEdit}
        />
        <EditableField
          label="ARV"
          type="currency"
          value={lead.arv}
          formatter={formatCurrency}
          onSave={(v) => update({ arv: v })}
          disabled={!canEdit}
        />
        <EditableField
          label="Renovation Cost"
          type="currency"
          value={lead.renovation_cost}
          formatter={formatCurrency}
          onSave={(v) => update({ renovation_cost: v })}
          disabled={!canEdit}
        />
        <EditableField
          label="MAO · Max Allowable Offer"
          type="currency"
          value={lead.mao}
          formatter={formatCurrency}
          onSave={(v) => update({ mao: v })}
          disabled={!canEdit}
        />
      </div>

      <p className="text-[11px] text-[color:var(--color-text-dim)] mt-3 leading-relaxed">
        MAO = 75% × ARV − Renovation (auto-recalculates when ARV or Renovation changes).
      </p>

      {/* Analyze trigger row */}
      <div className="mt-3 pt-3 border-t border-[color:var(--color-line)] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {/* Strategy toggle */}
          <div className="flex rounded-md border border-[color:var(--color-line)] overflow-hidden text-[11.5px] font-semibold">
            {['flip', 'brrrr'].map(s => (
              <button
                key={s}
                onClick={() => setStrategy(s)}
                disabled={analyzing}
                className={`px-2.5 py-1 transition-colors uppercase tracking-wide ${
                  strategy === s
                    ? 'bg-[color:var(--color-accent)] text-white'
                    : 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          {hasAnalysis && !analyzing && (
            <span className="text-[10.5px] text-[color:var(--color-text-dim)]">
              {new Date(lead.deal_analysis.analyzed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          )}
        </div>

        <Button
          size="sm"
          variant={hasAnalysis ? 'ghost' : 'primary'}
          onClick={handleAnalyze}
          loading={analyzing}
          disabled={!canEdit || analyzing}
        >
          {analyzing ? 'Analyzing…' : hasAnalysis ? '↺ Re-analyze' : '✦ Analyze Deal'}
        </Button>
      </div>

      {analyzeError && (
        <p className="mt-2 text-[11.5px] text-[color:var(--color-danger-text)]">{analyzeError}</p>
      )}

      <DealAnalysisPanel analysis={lead.deal_analysis} lead={lead} />
    </Card>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/lead-detail/FinancialSection.jsx
git commit -m "feat: add Analyze Deal button and panel to FinancialSection"
```

---

## Task 7: End-to-end verification

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Open a lead with financial data**

Navigate to a lead that has `arv` and `renovation_cost` filled in. Confirm the Financial section shows the strategy toggle (FLIP | BRRRR) and "✦ Analyze Deal" button.

- [ ] **Step 3: Run analysis**

Click "✦ Analyze Deal". Confirm:
- Button shows "Analyzing…" with spinner for ~15–30 seconds
- DealAnalysisPanel appears below with verdict badge, score ring, 4 metric cards, risk chips
- No console errors

- [ ] **Step 4: Verify Supabase**

In Supabase → Table Editor → leads → find the lead → confirm `deal_analysis` column is populated with the JSON object.

- [ ] **Step 5: Verify activity timeline**

On the lead page, scroll to the Activity Timeline. Confirm a new entry appears: "Deal analysis run — Verdict: BUY / $XX,XXX profit / XX% ROI".

- [ ] **Step 6: Open Dashboard**

Click "Open Dashboard →". Confirm `/deal-analyzer.html` opens in a new tab with the lead's numbers pre-filled in the input fields.

- [ ] **Step 7: Re-analyze**

Click "↺ Re-analyze". Confirm the panel updates with a fresh analysis and new timestamp.

- [ ] **Step 8: Verify readonly restriction**

Log in as a readonly user (or temporarily set `canEdit = false` in code). Confirm the button is disabled/not clickable. Confirm the saved analysis panel still shows.
