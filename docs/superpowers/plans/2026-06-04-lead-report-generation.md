# Lead Report Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate AI-written, recipient-specific reports (Lender, Agent, Seller, Wholesaler, General) for any lead, with editable output and one-click Copy / Gmail / PDF actions.

**Architecture:** New Netlify function `generate-report.mjs` calls Claude with a recipient-specific system prompt and lead data, returning `{ subject, report }`. New `ReportSection.jsx` component renders the full UI on the lead detail page between ScenariosFlat and ActivityTimeline.

**Tech Stack:** React 18, Claude API (claude-sonnet-4-6), Netlify Functions (ESM .mjs), browser window.print() for PDF, existing Gmail URL pattern from EmailComposeModal.

---

## File Map

| File | Action |
|------|--------|
| `netlify/functions/generate-report.mjs` | Create — Claude call with 5 system prompts |
| `src/components/lead-detail/ReportSection.jsx` | Create — full report UI |
| `src/pages/LeadDetailPage.jsx` | Modify — add ReportSection after ScenariosFlat |
| `netlify.toml` | Modify — add 120s timeout for generate-report |

---

## Task 1: Netlify Function — generate-report.mjs

**Files:**
- Create: `netlify/functions/generate-report.mjs`

- [ ] **Step 1: Create the function**

```js
// netlify/functions/generate-report.mjs
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

const HEADERS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST,OPTIONS',
}

// ── System prompts per recipient type ────────────────────────────────────────

const SYSTEM_PROMPTS = {
  lender: `You are writing a professional deal review email from HAT Investors to their hard money lender Rob at 3 Shacks Capital.
Tone: professional, confident, numbers-first. Like a seasoned investor presenting a deal to their trusted lender.
Structure (use these exact sections):
1. Opening (1-2 sentences — warm, professional greeting)
2. Quick Background (how the property was found, initial offer, any negotiation history from notes)
3. Property Highlights — Pros (bullet list) and Challenges (bullet list)
4. Sold Comps (if available in notes — list as "Address – beds/baths, sqft – Sold $X". If no comps in notes, write "Comparable sales package to follow separately.")
5. Deal Numbers — a scenario table: Conservative / Realistic / Aggressive with ARV, Renovation, Purchase Price, Estimated Profit
6. Ask (request pre-approval indication and thoughts on numbers)
7. Sign-off: "Thanks, Hemi Sher & Tomer Carmelli | HAT Investors LLC"
Company: HAT Investors LLC / OHTC Investments. Market: Jacksonville, FL. Never mention principal names in body prose, only in sign-off.`,

  agent: `You are writing a cash buyer inquiry email from HAT Investors to a listing agent.
Tone: direct, decisive, professional. Agents value buyers who are easy to work with.
Structure:
1. One-line intro (who we are — local Jacksonville investor, high-volume buyer)
2. Cash offer details (amount, close timeline 14-21 days, no financing contingency, as-is)
3. Why we're a strong buyer (cash/HML, fast close, no contingency, experienced)
4. 2-3 questions about the property (seller motivation, known issues, prior offers)
5. Sign-off: "Best, [Your Name] | HAT Investors"
Keep it under 200 words. Agents receive many emails — be brief and credible.`,

  seller: `You are writing a direct outreach email from HAT Investors to a property owner (FSBO or direct seller).
Tone: warm, simple, respectful. No real estate jargon. The seller may not be experienced.
Structure:
1. Friendly introduction (who we are, local Jacksonville company, we buy homes as-is)
2. What we like about their property (reference specific features from the lead data)
3. Our offer (amount, simple process, no repairs needed, fast close)
4. The process in plain language ("Here's how it works: we sign a simple agreement, do a quick walkthrough, and close in about 3 weeks — all cash")
5. Call to action (call or reply to discuss)
6. Sign-off: "Warm regards, HAT Investors Team"
Keep it genuine and human. No pressure tactics.`,

  wholesaler: `You are writing a short investor-to-investor message from HAT Investors to a wholesaler.
Tone: brief, direct, decisive. Wholesalers talk fast.
Structure:
1. One sentence: who we are and that we're interested
2. Our MAO range (calculated from the lead data)
3. What we need (clear title, 14-21 day close, walkthrough access)
4. Sign-off: "— HAT Investors | [phone if available]"
Maximum 100 words. Do not add fluff.`,

  general: `You are writing a comprehensive internal deal summary for HAT Investors.
Tone: factual, analytical, no fluff.
Structure:
1. Property Overview (address, beds/baths, sqft, year built, condition summary)
2. Financial Summary (ARV, purchase price, renovation cost, MAO, estimated profit)
3. Scenario Analysis (table: Conservative / Realistic / Aggressive — ARV, Reno, Purchase, Profit, ROI)
4. Deal Analysis (verdict if available, key risks, recommendation)
5. Notes & History (lead notes and any recent activity)
6. Status (current pipeline status, assigned to, follow-up date)
This is for internal use only — be comprehensive and honest about risks.`,
}

const LENGTH_INSTRUCTIONS = {
  brief: 'Keep the report under 150 words. Skip detailed comps and scenario table narrative. Use the scenario table but keep each cell minimal.',
  standard: 'Target approximately 350 words. Include the full scenario table and 2-3 comps if available.',
  detailed: 'Target approximately 600+ words. Include full comps list, complete scenario narrative, all risks and notes details.',
}

function buildUserPrompt(lead, recipientType, length) {
  const fmt = (v) => v != null ? `$${Number(v).toLocaleString()}` : '—'

  // Scenario profit estimates (simplified: sale*0.93 - loan - holding - cash_needed)
  function scenarioProfit(arv, pp, reno, holdMonths = 3) {
    if (!arv || !pp) return null
    const loan = pp * 0.9 + reno
    const cashNeeded = pp * 0.1 + loan * 0.02 + 2450
    const holdCost = (loan * 0.01 + 308) * holdMonths
    return Math.round(arv * 0.93 - loan - holdCost - cashNeeded)
  }

  const conProfit = scenarioProfit(lead.conservative_arv, lead.conservative_offer_price || lead.offer_price, lead.conservative_renovation_cost || lead.renovation_cost)
  const reaProfit = scenarioProfit(lead.arv, lead.offer_price || lead.asking_price, lead.renovation_cost)
  const aggProfit = scenarioProfit(lead.aggressive_arv, lead.aggressive_offer_price || lead.offer_price, lead.aggressive_renovation_cost || lead.renovation_cost)

  const address = [lead.address, lead.city, lead.state, lead.zip_code].filter(Boolean).join(', ')

  const lines = [
    `PROPERTY: ${address}`,
    lead.bedrooms ? `Beds/Baths: ${lead.bedrooms}/${lead.bathrooms}` : '',
    lead.sqft ? `Sqft: ${lead.sqft}` : '',
    lead.year_built ? `Year Built: ${lead.year_built}` : '',
    lead.has_garage != null ? `Garage: ${lead.has_garage ? 'Yes' : 'No'}` : '',
    '',
    'FINANCIALS:',
    `ARV (Realistic): ${fmt(lead.arv)}`,
    `Asking Price: ${fmt(lead.asking_price)}`,
    `Our Offer / Purchase Price: ${fmt(lead.offer_price || lead.asking_price)}`,
    `Renovation Cost: ${fmt(lead.renovation_cost)}`,
    `MAO (75% ARV - Reno): ${fmt(lead.mao)}`,
    lead.rent_estimate ? `Monthly Rent Estimate: ${fmt(lead.rent_estimate)}` : '',
    '',
    'SCENARIOS:',
    `Conservative — ARV: ${fmt(lead.conservative_arv)}, Reno: ${fmt(lead.conservative_renovation_cost || lead.renovation_cost)}, Purchase: ${fmt(lead.conservative_offer_price || lead.offer_price)}, Est. Profit: ${conProfit != null ? fmt(conProfit) : '—'}`,
    `Realistic — ARV: ${fmt(lead.arv)}, Reno: ${fmt(lead.renovation_cost)}, Purchase: ${fmt(lead.offer_price || lead.asking_price)}, Est. Profit: ${reaProfit != null ? fmt(reaProfit) : '—'}`,
    `Aggressive — ARV: ${fmt(lead.aggressive_arv)}, Reno: ${fmt(lead.aggressive_renovation_cost || lead.renovation_cost)}, Purchase: ${fmt(lead.aggressive_offer_price || lead.offer_price)}, Est. Profit: ${aggProfit != null ? fmt(aggProfit) : '—'}`,
    '',
    lead.notes ? `NOTES:\n${lead.notes}` : '',
    lead.recent_notes?.length ? `RECENT ACTIVITY:\n${lead.recent_notes.slice(0, 5).join('\n')}` : '',
    lead.deal_analysis ? `DEAL ANALYSIS: Verdict: ${lead.deal_analysis.verdict}, Profit: ${fmt(lead.deal_analysis.profit)}, ROI: ${lead.deal_analysis.roi}%, Risks: ${(lead.deal_analysis.key_risks || []).join('; ')}` : '',
    lead.status ? `CRM STATUS: ${lead.status}` : '',
  ].filter(Boolean).join('\n')

  return `${LENGTH_INSTRUCTIONS[length] || LENGTH_INSTRUCTIONS.standard}

Write the report now. Lead data:

${lines}

After the report body, on a new line write exactly:
SUBJECT: [the email subject line you recommend]`
}

function extractSubject(text) {
  const match = text.match(/\nSUBJECT:\s*(.+)$/m)
  return match ? match[1].trim() : ''
}

function stripSubjectLine(text) {
  return text.replace(/\nSUBJECT:\s*.+$/m, '').trim()
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS })
  if (req.method !== 'POST') return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), { status: 405, headers: HEADERS })

  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ ok: false, error: 'ANTHROPIC_API_KEY not configured.' }), { status: 500, headers: HEADERS })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const { lead, recipient_type = 'lender', length = 'standard' } = body

    if (!lead) return new Response(JSON.stringify({ ok: false, error: 'lead is required.' }), { status: 400, headers: HEADERS })

    const systemPrompt = SYSTEM_PROMPTS[recipient_type] || SYSTEM_PROMPTS.lender
    const userPrompt   = buildUserPrompt(lead, recipient_type, length)

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Claude API error ${res.status}: ${err}`)
    }

    const data   = await res.json()
    const full   = data.content?.[0]?.text || ''
    const subject = extractSubject(full)
    const report  = stripSubjectLine(full)

    return new Response(JSON.stringify({ ok: true, subject, report }), { status: 200, headers: HEADERS })
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message || String(err) }), { status: 500, headers: HEADERS })
  }
}
```

- [ ] **Step 2: Add timeout to netlify.toml**

In `netlify.toml`, add after the existing `[functions."analyze-deal"]` block:
```toml
[functions."generate-report"]
  timeout = 120
```

- [ ] **Step 3: Commit**

```bash
git add netlify/functions/generate-report.mjs netlify.toml
git commit -m "feat: add generate-report netlify function with 5 recipient types"
```

---

## Task 2: ReportSection Component

**Files:**
- Create: `src/components/lead-detail/ReportSection.jsx`

- [ ] **Step 1: Create the component**

```jsx
// src/components/lead-detail/ReportSection.jsx
import { useState } from 'react'
import Card from '../ui/Card'
import Button from '../ui/Button'

const TYPES = [
  { key: 'lender',     label: '🏦 Lender',     desc: 'Funding request to Rob' },
  { key: 'agent',      label: '🏠 Agent',       desc: 'Cash offer to listing agent' },
  { key: 'seller',     label: '👤 Seller',      desc: 'Direct seller outreach' },
  { key: 'wholesaler', label: '📦 Wholesaler',  desc: 'Investor-to-investor' },
  { key: 'general',    label: '📋 General',     desc: 'Full internal summary' },
]

const LENGTHS = [
  { key: 'brief',    label: 'Brief',    desc: '~150 words' },
  { key: 'standard', label: 'Standard', desc: '~350 words' },
  { key: 'detailed', label: 'Detailed', desc: '~600 words' },
]

export default function ReportSection({ lead }) {
  const [reportType, setReportType] = useState('lender')
  const [length,     setLength]     = useState('standard')
  const [subject,    setSubject]    = useState('')
  const [reportText, setReportText] = useState('')
  const [generating, setGenerating] = useState(false)
  const [error,      setError]      = useState(null)
  const [copied,     setCopied]     = useState(false)

  const hasReport = !!reportText

  async function generate() {
    setGenerating(true)
    setError(null)
    try {
      // Gather recent activity from lead if available
      const recent_notes = []
      const res = await fetch('/.netlify/functions/generate-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead: { ...lead, recent_notes }, recipient_type: reportType, length }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || 'Generation failed.')
      setSubject(data.subject)
      setReportText(data.report)
    } catch (e) {
      setError(e.message || 'Something went wrong.')
    } finally {
      setGenerating(false)
    }
  }

  function copyToClipboard() {
    const full = subject ? `Subject: ${subject}\n\n${reportText}` : reportText
    navigator.clipboard.writeText(full)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function openInGmail() {
    const params = new URLSearchParams({ view: 'cm', fs: '1', su: subject || '', body: reportText || '' })
    window.open(`https://mail.google.com/mail/?${params.toString()}`, '_blank', 'noopener,noreferrer')
  }

  function downloadPDF() {
    const win = window.open('', '_blank')
    win.document.write(`<!DOCTYPE html><html><head>
      <title>${subject || 'HAT Investors Report'}</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6; max-width: 700px; margin: 40px auto; color: #222; }
        h2 { font-size: 18px; margin-bottom: 4px; }
        .sub { color: #555; font-size: 13px; margin-bottom: 24px; }
        pre { white-space: pre-wrap; font-family: Arial, sans-serif; }
      </style>
    </head><body>
      <h2>HAT Investors</h2>
      ${subject ? `<div class="sub">Subject: ${subject}</div>` : ''}
      <pre>${reportText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
    </body></html>`)
    win.document.close()
    win.focus()
    setTimeout(() => { win.print(); win.close() }, 500)
  }

  const selectCls = 'h-7 px-2 text-[12px] bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] rounded text-[color:var(--color-text)] focus:outline-none focus:border-[color:var(--color-accent)] cursor-pointer'

  return (
    <Card title="📄 Generate Report">
      {/* Recipient type tabs */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {TYPES.map(t => (
          <button
            key={t.key}
            onClick={() => setReportType(t.key)}
            title={t.desc}
            className={`px-3 py-1.5 rounded-md text-[12px] font-semibold transition-colors ${
              reportType === t.key
                ? 'bg-[color:var(--color-accent)] text-white'
                : 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Length + Generate row */}
      <div className="flex items-center gap-3 mb-3">
        <span className="text-[11px] text-[color:var(--color-text-dim)] uppercase tracking-wider">Length:</span>
        <div className="flex rounded-md border border-[color:var(--color-line)] overflow-hidden text-[11.5px] font-semibold">
          {LENGTHS.map(l => (
            <button
              key={l.key}
              onClick={() => setLength(l.key)}
              title={l.desc}
              className={`px-3 py-1 transition-colors ${
                length === l.key
                  ? 'bg-[color:var(--color-accent)] text-white'
                  : 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]'
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>
        <Button
          size="sm"
          variant="primary"
          onClick={generate}
          loading={generating}
          disabled={generating}
        >
          {generating ? 'Generating…' : hasReport ? '↺ Regenerate' : '⚡ Generate'}
        </Button>
      </div>

      {error && (
        <div className="mb-3 px-3 py-2 rounded bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-text)] text-[12px]">
          {error}
        </div>
      )}

      {hasReport && (
        <div className="space-y-2">
          {/* Subject line */}
          <div>
            <label className="text-[10.5px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)]">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              className="w-full mt-1 text-[13px] px-2 h-8 bg-[color:var(--color-bg)] border border-[color:var(--color-line)] rounded text-[color:var(--color-text)] focus:outline-none focus:border-[color:var(--color-accent)]"
            />
          </div>

          {/* Report body */}
          <div>
            <label className="text-[10.5px] uppercase tracking-wider font-semibold text-[color:var(--color-text-dim)]">Report</label>
            <textarea
              value={reportText}
              onChange={e => setReportText(e.target.value)}
              rows={16}
              className="w-full mt-1 text-[13px] px-3 py-2 bg-[color:var(--color-bg)] border border-[color:var(--color-line)] rounded text-[color:var(--color-text)] focus:outline-none focus:border-[color:var(--color-accent)] resize-y leading-relaxed font-mono"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={copyToClipboard}
              className="flex-1 py-2 rounded-md border border-[color:var(--color-line)] text-[12.5px] font-medium text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] hover:bg-[color:var(--color-bg-elev-2)] transition-colors"
            >
              {copied ? '✓ Copied!' : '📋 Copy'}
            </button>
            <button
              onClick={openInGmail}
              className="flex-1 py-2 rounded-md bg-[color:var(--color-accent)] text-white text-[12.5px] font-semibold hover:opacity-90 transition-opacity"
            >
              ✉ Open in Gmail
            </button>
            <button
              onClick={downloadPDF}
              className="flex-1 py-2 rounded-md border border-[color:var(--color-line)] text-[12.5px] font-medium text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] hover:bg-[color:var(--color-bg-elev-2)] transition-colors"
            >
              📄 Download PDF
            </button>
          </div>
        </div>
      )}
    </Card>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/lead-detail/ReportSection.jsx
git commit -m "feat: create ReportSection component with 5 recipient types and Copy/Gmail/PDF actions"
```

---

## Task 3: Wire ReportSection into LeadDetailPage

**Files:**
- Modify: `src/pages/LeadDetailPage.jsx`

- [ ] **Step 1: Add import**

At the top of `src/pages/LeadDetailPage.jsx`, after the `ScenariosFlat` import line, add:
```js
import ReportSection from '../components/lead-detail/ReportSection'
```

- [ ] **Step 2: Add ReportSection after ScenariosFlat**

Find (around line 150):
```jsx
            <ScenariosFlat
              lead={lead}
              canEdit={canEdit}
              onUpdated={(updated) => setLead(updated)}
            />
          </div>
```

Replace with:
```jsx
            <ScenariosFlat
              lead={lead}
              canEdit={canEdit}
              onUpdated={(updated) => setLead(updated)}
            />
            <ReportSection lead={lead} />
          </div>
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/LeadDetailPage.jsx
git commit -m "feat: add ReportSection to lead detail page"
```

---

## Task 4: Push and Verify

- [ ] **Step 1: Push all commits**

```bash
git push
```

- [ ] **Step 2: Test locally with netlify dev**

```bash
npx netlify dev
```

Open any lead in the CRM → scroll to **📄 Generate Report** section → select **🏦 Lender** → click **⚡ Generate** → verify report appears with subject line.

- [ ] **Step 3: Test all 5 report types**

For a lead with ARV, offer price, and renovation cost set:
1. Lender → should produce ~350 word professional email with scenario table
2. Agent → should produce short, direct cash buyer email under 200 words
3. Seller → should produce warm, jargon-free email
4. Wholesaler → should produce ~100 word investor message
5. General → should produce comprehensive internal summary

- [ ] **Step 4: Test actions**
- Copy → paste into a text editor to verify full text copied
- Open in Gmail → verify Gmail compose opens with subject and body pre-filled
- Download PDF → verify print dialog opens with formatted report

- [ ] **Step 5: Test Brief and Detailed lengths**

Click Brief → Generate → verify output is noticeably shorter than Standard.
Click Detailed → Generate → verify output is longer and more comprehensive.
