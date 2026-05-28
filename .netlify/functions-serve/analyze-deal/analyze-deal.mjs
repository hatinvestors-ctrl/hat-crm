
import {createRequire as ___nfyCreateRequire} from "module";
import {fileURLToPath as ___nfyFileURLToPath} from "url";
import {dirname as ___nfyPathDirname} from "path";
let __filename=___nfyFileURLToPath(import.meta.url);
let __dirname=___nfyPathDirname(___nfyFileURLToPath(import.meta.url));
let require=___nfyCreateRequire(import.meta.url);


// netlify/functions/analyze-deal.mjs
var ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
var SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
var SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
var HEADERS = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "POST,OPTIONS"
};
var SYSTEM_PROMPT = `# Deal Analysis Agent

You are a real estate deal analysis agent using Tomer Carmelli's exact financial model. Your job is numbers only \u2014 you do not draft emails, contact lenders, or make decisions. You output analysis and a verdict.

## Required Inputs

Provide: property address + purchase price + renovation estimate + strategy (BRRRR or flip) + either expected monthly rent (BRRRR) or ARV (flip). If ARV is unknown, run 3 scenarios.

Optional but include if known: beds/baths, sq ft, year built, lot size, MLS#.

## HML Defaults (Rob @ 3 Shacks)

- Covers: 90% purchase + 100% renovation
- Rate: 12% annual | Points: 2% of total loan (purchase + reno)
- Loan type: Interest-only during hold
- Monthly loan payment = Total Loan \xD7 1% (12% / 12)

## Purchase Costs (itemized)

**Title / closing costs (fixed):**
| Item | Default |
|------|---------|
| Title closing costs | $1,600 |

**HML lender costs:**
| Item | Default |
|------|---------|
| Loan points | 2% \xD7 total loan |
| Title lender insurance | $500 |
| Document stamps / mortgage | $200 |
| Intangible tax | $150 |

**Total Purchase Costs** = $1,600 + Points + $500 + $200 + $150

Down Payment = Purchase Price \xD7 10%
**Total Cash Needed** = Down Payment + Total Purchase Costs

## Total All-In Cost

Purchase Price + Renovation + Total Purchase Costs + Total Holding Costs

## Holding Costs (per month)

| Item | Default |
|------|---------|
| Loan payment | Total Loan \xD7 1%/mo |
| Property taxes | $208/mo ($2,500/yr) |
| Insurance | $100/mo ($1,200/yr) |
| HOA | $0 unless specified |
| Utilities | $0 unless specified |
| **Total per month** | sum |

Always calculate holding costs for the assumed holding period.
- Default holding period for **flips**: 3 months
- Default holding period for **BRRRR**: 6 months

## BRRRR Refinance

- Refi loan: 70% of ARV
- Rate: 6.9% | 30-year amortization
- Monthly mortgage factor at 6.9%/30yr: \u2248 0.006607 per dollar
- Refi closing costs: 3% of new loan

**Refi Cash Out** = New Loan Amount \u2212 Refi Closing Costs \u2212 HML Loan Repayment \u2212 Total Holding Costs

If Refi Cash Out is **negative**, that amount is additional cash out of pocket at refi.

**Total Cash Invested** = Total Cash Needed (at purchase) + any negative Refi Cash Out
If Refi Cash Out is positive (cash back), **Total Cash Invested** = Total Cash Needed \u2212 Cash Back (but never below $0)

## Post-Refi Annual Operating Costs

| Item | Default |
|------|---------|
| Property taxes | $2,500/yr ($208/mo) |
| Insurance | $1,200/yr ($100/mo) |

Use actual values if provided.

**NOI** = Annual Rent \u2212 Property Taxes \u2212 Insurance
**Cash Flow** = Monthly Rent \u2212 Refi Mortgage Payment \u2212 Property Taxes/mo \u2212 Insurance/mo

## Key Metrics

- **Total Cash Needed** = Down payment + Purchase costs
- **Total Cash Invested** = Cash left in deal after refi (see above)
- **Cap Rate (Purchase)** = NOI / Total All-In Cost
- **Cap Rate (Market)** = NOI / ARV
- **Cash-on-Cash (COC)** = Annual Cash Flow / Total Cash Invested
- **Gross Rent Multiplier** = ARV / Annual Rent
- **Debt Coverage Ratio** = NOI / Annual Mortgage Payment
- **Break Even Ratio** = (Operating Expenses + Mortgage) / Gross Rent
- **Rent to Value** = Monthly Rent / ARV
- **Return on Investment (ROI)** = (Total Profit at Year 1 sale) / Total Cash Invested
- **Equity Multiple** = Total Value Returned / Total Cash Invested

## Flip Metrics

- **Total Profit** = Sale Proceeds \u2212 Loan Repayment \u2212 Total Holding Costs \u2212 Total Cash Needed
- **ROI** = Total Profit / Total Cash Needed \xD7 100
- **Annualized ROI** = ROI / Holding Period (months) \xD7 12
- Minimum acceptable profit: $30,000, or $10,000 per rehab month

## Flip Analysis

- Net Sale (Sale Proceeds) = ARV \xD7 93% (7% selling costs)

## MAO (Maximum Allowable Offer)

- MAO = 75% \xD7 ARV \u2013 Repairs \u2013 Closing costs \u2013 Minimum profit

---

## Output Format \u2014 Flip

### 1. Property Summary
Address, beds/baths, sq ft, year built, lot size, MLS# (if known)

### 2. Purchase & Rehab Summary
| Item | Amount |
|------|--------|
| Purchase Price | |
| Rehab Costs | |
| Amount Financed (HML) | |
| Down Payment (10%) | |
| Purchase Costs | |
| **Total Cash Needed** | |
| ARV | |
| ARV per Sq Ft | |
| Price per Sq Ft | |

### 3. Financing
Loan amount, rate, type, monthly payment, LTC/LTV

### 4. Purchase Costs (itemized)
| Item | Amount |
|------|--------|
| Title closing costs | |
| Title lender insurance | |
| Loan points | |
| Doc stamps / mortgage | |
| Intangible tax | |
| **Total** | |

### 5. Holding Costs (at assumed holding period)
| Item | Total |
|------|-------|
| Loan payments | |
| Property taxes | |
| Insurance | |
| **Total** | |
| Per month | |

### 6. Sale & Profit
| Item | Amount |
|------|--------|
| After Repair Value | |
| Selling Costs (7%) | |
| Sale Proceeds | |
| Loan Repayment | |
| Holding Costs | |
| Cash Invested | |
| **Total Profit** | |

### 7. Investment Returns
| Metric | Value |
|--------|-------|
| ROI | |
| Annualized ROI | |

### 8. Profit Projections (sensitivity table)

| Holding Period | Loan Pmts | Taxes | Insurance | Total Holding | Total Profit | ROI | Ann. ROI |
|----------------|-----------|-------|-----------|---------------|--------------|-----|----------|
| 1 month | | | | | | | |
| 2 months | | | | | | | |
| 3 months | | | | | | | |
| 4 months | | | | | | | |
| 6 months | | | | | | | |

### 9. Scenarios (if ARV unknown)
| Metric | Conservative | Base | Optimistic |
|--------|-------------|------|------------|
| ARV | | | |
| All-In Cost | | | |
| Total Profit | | | |
| MAO | | | |
| ROI | | | |
| Ann. ROI | | | |

### 10. Verdict
**BUY** / **PASS** / **CONDITIONAL** \u2014 2\u20133 sentences on what needs to be true.

### 11. Key Risks
2\u20133 bullets on what could kill this deal.

---

## Output Format \u2014 BRRRR

### 1. Property Summary
Address, beds/baths, sq ft, year built, lot size, MLS# (if known)

### 2. Purchase & Rehab Summary
| Item | Amount |
|------|--------|
| Purchase Price | |
| Rehab Costs | |
| Amount Financed (HML) | |
| Down Payment (10%) | |
| Purchase Costs | |
| **Total Cash Needed** | |
| ARV | |
| ARV per Sq Ft | |
| Price per Sq Ft | |

### 3. Financing (Purchase \u2014 HML)
Loan amount, rate, type, monthly payment, LTC/LTV

### 4. Purchase Costs (itemized)
| Item | Amount |
|------|--------|
| Title closing costs | |
| Title lender insurance | |
| Loan points | |
| Doc stamps / mortgage | |
| Intangible tax | |
| **Total** | |

### 5. Holding Costs (6-month default)
| Item | Total |
|------|-------|
| Loan payments | |
| Property taxes | |
| Insurance | |
| **Total** | |
| Per month | |

### 6. Refinance Analysis
| Item | Amount |
|------|--------|
| New Loan Amount (70% ARV) | |
| Refinance Costs (3%) | |
| Loan Repayment (HML) | |
| Holding Costs | |
| **Refi Cash Out** | |
| \u2014 | \u2014 |
| Initial Cash Invested | |
| Refi Cash Out (+ or \u2212) | |
| **Total Cash Invested** | |

### 7. Financing (Refinance)
Loan type, rate, loan amount, LTV, monthly payment, annual payment

### 8. Cash Flow (Year 1, After Refinance)
| Item | Monthly | Yearly |
|------|---------|--------|
| Gross Rent | | |
| Vacancy | | |
| Operating Income | | |
| Operating Expenses | | |
| \u2014 Property Taxes | | |
| \u2014 Insurance | | |
| **Net Operating Income** | | |
| Loan Payments | | |
| **Cash Flow** | | |

### 9. Returns & Ratios (Year 1)
| Metric | Value |
|--------|-------|
| Cap Rate (Purchase Price) | |
| Cap Rate (Market / ARV) | |
| Cash on Cash Return | |
| Gross Rent Multiplier | |
| Rent to Value | |
| Debt Coverage Ratio | |
| Break Even Ratio | |

### 10. Buy & Hold Projections
Assume: 3% appreciation/yr, 2% income increase/yr, 2% expense increase/yr, 6% selling costs

| | Year 1 | Year 2 | Year 3 | Year 5 | Year 10 |
|---|---|---|---|---|---|
| Gross Rent | | | | | |
| Operating Expenses | | | | | |
| NOI | | | | | |
| Loan Payments | | | | | |
| **Cash Flow** | | | | | |
| Property Value | | | | | |
| Loan Balance | | | | | |
| **Total Equity** | | | | | |
| Total Profit (if sold) | | | | | |
| Cash on Cash | | | | | |

### 11. Verdict
**BUY** / **PASS** / **CONDITIONAL** \u2014 2\u20133 sentences on what needs to be true.

### 12. Key Risks
2\u20133 bullets on what could kill this deal.

---

## Style

Numbers-first, no fluff. Short and actionable. Flag clearly if inputs are estimates vs. confirmed. Always state assumed holding period explicitly.

## Comps

**Sale comps:**
- Sold \u2264 12 months, same neighborhood (expand radius if needed \u2014 note explicitly)
- Include: distance, similarity %, beds/baths, sq ft, sale price, price/sq ft, sale date, days on market
- Include active + pending separately
- Adjustments: $50/sqft, $10K garage, $15\u201320K pool, $5\u201310K lot size

**Rental comps (BRRRR):**
- Active listings, same neighborhood
- Include: distance, similarity %, beds/baths, sq ft, listed rent, rent/sqft, last seen
- State estimated rent range and midpoint used in analysis`;
function buildUserPrompt({ address, purchase_price, arv, renovation_cost, strategy }) {
  const strategyLabel = strategy === "brrrr" ? "BRRRR" : "flip";
  return `Analyze this ${strategyLabel} deal (be concise \u2014 skip sensitivity tables and scenario tables):
- Address: ${address || "Not provided"}
- Purchase Price: $${Number(purchase_price).toLocaleString()}
- Renovation Cost: $${Number(renovation_cost).toLocaleString()}
- ARV: $${Number(arv).toLocaleString()}
- Strategy: ${strategyLabel}

Give a brief analysis (3-4 paragraphs max), then append a JSON summary block in exactly this format (no other text after it):

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
\`\`\``;
}
function parseJsonBlock(text) {
  const match = text.match(/```json\s*([\s\S]*?)```\s*$/);
  if (!match) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch {
    return null;
  }
}
async function saveAnalysis(leadId, analysisObj) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}`,
    {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify({ deal_analysis: analysisObj })
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase save failed: ${res.status} ${text}`);
  }
}
var analyze_deal_default = async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: HEADERS });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), { status: 405, headers: HEADERS });
  }
  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ ok: false, error: "ANTHROPIC_API_KEY not configured." }), { status: 500, headers: HEADERS });
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return new Response(JSON.stringify({ ok: false, error: "Supabase credentials not configured." }), { status: 500, headers: HEADERS });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const { lead_id, address, purchase_price, arv, renovation_cost, strategy = "flip" } = body;
    if (!lead_id) return new Response(JSON.stringify({ ok: false, error: "lead_id is required." }), { status: 400, headers: HEADERS });
    if (!purchase_price) return new Response(JSON.stringify({ ok: false, error: "purchase_price is required." }), { status: 400, headers: HEADERS });
    if (!arv) return new Response(JSON.stringify({ ok: false, error: "arv is required." }), { status: 400, headers: HEADERS });
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserPrompt({ address, purchase_price, arv, renovation_cost, strategy }) }]
      })
    });
    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      throw new Error(`Claude API error ${claudeRes.status}: ${errText}`);
    }
    const claudeData = await claudeRes.json();
    const markdown = claudeData.content?.[0]?.text || "";
    const summary = parseJsonBlock(markdown) || {};
    const analysisObj = {
      verdict: summary.verdict || "UNKNOWN",
      score: summary.score ?? null,
      strategy,
      profit: summary.profit ?? null,
      roi: summary.roi ?? null,
      annualized_roi: summary.annualized_roi ?? null,
      total_cash_needed: summary.total_cash_needed ?? null,
      recommendation: summary.recommendation || "",
      key_risks: summary.key_risks || [],
      markdown,
      analyzed_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    await saveAnalysis(lead_id, analysisObj);
    return new Response(JSON.stringify({ ok: true, analysis: analysisObj }), { status: 200, headers: HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message || String(err) }), { status: 500, headers: HEADERS });
  }
};
export {
  analyze_deal_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsibmV0bGlmeS9mdW5jdGlvbnMvYW5hbHl6ZS1kZWFsLm1qcyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLy8gQW5hbHl6ZSBhIHJlYWwgZXN0YXRlIGRlYWwgdXNpbmcgdGhlIEhBVCBkZWFsLWFuYWx5c2lzLWFnZW50IHByb21wdC5cbi8vXG4vLyBQT1NUIC8ubmV0bGlmeS9mdW5jdGlvbnMvYW5hbHl6ZS1kZWFsXG4vLyBib2R5OiB7IGxlYWRfaWQsIGFkZHJlc3MsIHB1cmNoYXNlX3ByaWNlLCBhcnYsIHJlbm92YXRpb25fY29zdCwgc3RyYXRlZ3kgfVxuLy9cbi8vIFJlcXVpcmVkIGVudiB2YXJzOiBBTlRIUk9QSUNfQVBJX0tFWSwgU1VQQUJBU0VfVVJMLCBTVVBBQkFTRV9QQVRcblxuY29uc3QgQU5USFJPUElDX0FQSV9LRVkgPSBwcm9jZXNzLmVudi5BTlRIUk9QSUNfQVBJX0tFWVxuY29uc3QgU1VQQUJBU0VfVVJMICAgICAgPSBwcm9jZXNzLmVudi5TVVBBQkFTRV9VUkwgfHwgcHJvY2Vzcy5lbnYuVklURV9TVVBBQkFTRV9VUkxcbmNvbnN0IFNVUEFCQVNFX0tFWSAgICAgID0gcHJvY2Vzcy5lbnYuU1VQQUJBU0VfU0VSVklDRV9ST0xFX0tFWSB8fCBwcm9jZXNzLmVudi5TVVBBQkFTRV9BTk9OX0tFWSB8fCBwcm9jZXNzLmVudi5WSVRFX1NVUEFCQVNFX0FOT05fS0VZXG5cbmNvbnN0IEhFQURFUlMgPSB7XG4gICdjb250ZW50LXR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICdhY2Nlc3MtY29udHJvbC1hbGxvdy1vcmlnaW4nOiAnKicsXG4gICdhY2Nlc3MtY29udHJvbC1hbGxvdy1oZWFkZXJzJzogJ2NvbnRlbnQtdHlwZScsXG4gICdhY2Nlc3MtY29udHJvbC1hbGxvdy1tZXRob2RzJzogJ1BPU1QsT1BUSU9OUycsXG59XG5cbi8vIEZ1bGwgY29udGVudCBvZiBoYXQtYWktYWdlbnRzLy5jbGF1ZGUvYWdlbnRzL2RlYWwtYW5hbHlzaXMtYWdlbnQubWRcbmNvbnN0IFNZU1RFTV9QUk9NUFQgPSBgIyBEZWFsIEFuYWx5c2lzIEFnZW50XG5cbllvdSBhcmUgYSByZWFsIGVzdGF0ZSBkZWFsIGFuYWx5c2lzIGFnZW50IHVzaW5nIFRvbWVyIENhcm1lbGxpJ3MgZXhhY3QgZmluYW5jaWFsIG1vZGVsLiBZb3VyIGpvYiBpcyBudW1iZXJzIG9ubHkgXHUyMDE0IHlvdSBkbyBub3QgZHJhZnQgZW1haWxzLCBjb250YWN0IGxlbmRlcnMsIG9yIG1ha2UgZGVjaXNpb25zLiBZb3Ugb3V0cHV0IGFuYWx5c2lzIGFuZCBhIHZlcmRpY3QuXG5cbiMjIFJlcXVpcmVkIElucHV0c1xuXG5Qcm92aWRlOiBwcm9wZXJ0eSBhZGRyZXNzICsgcHVyY2hhc2UgcHJpY2UgKyByZW5vdmF0aW9uIGVzdGltYXRlICsgc3RyYXRlZ3kgKEJSUlJSIG9yIGZsaXApICsgZWl0aGVyIGV4cGVjdGVkIG1vbnRobHkgcmVudCAoQlJSUlIpIG9yIEFSViAoZmxpcCkuIElmIEFSViBpcyB1bmtub3duLCBydW4gMyBzY2VuYXJpb3MuXG5cbk9wdGlvbmFsIGJ1dCBpbmNsdWRlIGlmIGtub3duOiBiZWRzL2JhdGhzLCBzcSBmdCwgeWVhciBidWlsdCwgbG90IHNpemUsIE1MUyMuXG5cbiMjIEhNTCBEZWZhdWx0cyAoUm9iIEAgMyBTaGFja3MpXG5cbi0gQ292ZXJzOiA5MCUgcHVyY2hhc2UgKyAxMDAlIHJlbm92YXRpb25cbi0gUmF0ZTogMTIlIGFubnVhbCB8IFBvaW50czogMiUgb2YgdG90YWwgbG9hbiAocHVyY2hhc2UgKyByZW5vKVxuLSBMb2FuIHR5cGU6IEludGVyZXN0LW9ubHkgZHVyaW5nIGhvbGRcbi0gTW9udGhseSBsb2FuIHBheW1lbnQgPSBUb3RhbCBMb2FuIFx1MDBENyAxJSAoMTIlIC8gMTIpXG5cbiMjIFB1cmNoYXNlIENvc3RzIChpdGVtaXplZClcblxuKipUaXRsZSAvIGNsb3NpbmcgY29zdHMgKGZpeGVkKToqKlxufCBJdGVtIHwgRGVmYXVsdCB8XG58LS0tLS0tfC0tLS0tLS0tLXxcbnwgVGl0bGUgY2xvc2luZyBjb3N0cyB8ICQxLDYwMCB8XG5cbioqSE1MIGxlbmRlciBjb3N0czoqKlxufCBJdGVtIHwgRGVmYXVsdCB8XG58LS0tLS0tfC0tLS0tLS0tLXxcbnwgTG9hbiBwb2ludHMgfCAyJSBcdTAwRDcgdG90YWwgbG9hbiB8XG58IFRpdGxlIGxlbmRlciBpbnN1cmFuY2UgfCAkNTAwIHxcbnwgRG9jdW1lbnQgc3RhbXBzIC8gbW9ydGdhZ2UgfCAkMjAwIHxcbnwgSW50YW5naWJsZSB0YXggfCAkMTUwIHxcblxuKipUb3RhbCBQdXJjaGFzZSBDb3N0cyoqID0gJDEsNjAwICsgUG9pbnRzICsgJDUwMCArICQyMDAgKyAkMTUwXG5cbkRvd24gUGF5bWVudCA9IFB1cmNoYXNlIFByaWNlIFx1MDBENyAxMCVcbioqVG90YWwgQ2FzaCBOZWVkZWQqKiA9IERvd24gUGF5bWVudCArIFRvdGFsIFB1cmNoYXNlIENvc3RzXG5cbiMjIFRvdGFsIEFsbC1JbiBDb3N0XG5cblB1cmNoYXNlIFByaWNlICsgUmVub3ZhdGlvbiArIFRvdGFsIFB1cmNoYXNlIENvc3RzICsgVG90YWwgSG9sZGluZyBDb3N0c1xuXG4jIyBIb2xkaW5nIENvc3RzIChwZXIgbW9udGgpXG5cbnwgSXRlbSB8IERlZmF1bHQgfFxufC0tLS0tLXwtLS0tLS0tLS18XG58IExvYW4gcGF5bWVudCB8IFRvdGFsIExvYW4gXHUwMEQ3IDElL21vIHxcbnwgUHJvcGVydHkgdGF4ZXMgfCAkMjA4L21vICgkMiw1MDAveXIpIHxcbnwgSW5zdXJhbmNlIHwgJDEwMC9tbyAoJDEsMjAwL3lyKSB8XG58IEhPQSB8ICQwIHVubGVzcyBzcGVjaWZpZWQgfFxufCBVdGlsaXRpZXMgfCAkMCB1bmxlc3Mgc3BlY2lmaWVkIHxcbnwgKipUb3RhbCBwZXIgbW9udGgqKiB8IHN1bSB8XG5cbkFsd2F5cyBjYWxjdWxhdGUgaG9sZGluZyBjb3N0cyBmb3IgdGhlIGFzc3VtZWQgaG9sZGluZyBwZXJpb2QuXG4tIERlZmF1bHQgaG9sZGluZyBwZXJpb2QgZm9yICoqZmxpcHMqKjogMyBtb250aHNcbi0gRGVmYXVsdCBob2xkaW5nIHBlcmlvZCBmb3IgKipCUlJSUioqOiA2IG1vbnRoc1xuXG4jIyBCUlJSUiBSZWZpbmFuY2VcblxuLSBSZWZpIGxvYW46IDcwJSBvZiBBUlZcbi0gUmF0ZTogNi45JSB8IDMwLXllYXIgYW1vcnRpemF0aW9uXG4tIE1vbnRobHkgbW9ydGdhZ2UgZmFjdG9yIGF0IDYuOSUvMzB5cjogXHUyMjQ4IDAuMDA2NjA3IHBlciBkb2xsYXJcbi0gUmVmaSBjbG9zaW5nIGNvc3RzOiAzJSBvZiBuZXcgbG9hblxuXG4qKlJlZmkgQ2FzaCBPdXQqKiA9IE5ldyBMb2FuIEFtb3VudCBcdTIyMTIgUmVmaSBDbG9zaW5nIENvc3RzIFx1MjIxMiBITUwgTG9hbiBSZXBheW1lbnQgXHUyMjEyIFRvdGFsIEhvbGRpbmcgQ29zdHNcblxuSWYgUmVmaSBDYXNoIE91dCBpcyAqKm5lZ2F0aXZlKiosIHRoYXQgYW1vdW50IGlzIGFkZGl0aW9uYWwgY2FzaCBvdXQgb2YgcG9ja2V0IGF0IHJlZmkuXG5cbioqVG90YWwgQ2FzaCBJbnZlc3RlZCoqID0gVG90YWwgQ2FzaCBOZWVkZWQgKGF0IHB1cmNoYXNlKSArIGFueSBuZWdhdGl2ZSBSZWZpIENhc2ggT3V0XG5JZiBSZWZpIENhc2ggT3V0IGlzIHBvc2l0aXZlIChjYXNoIGJhY2spLCAqKlRvdGFsIENhc2ggSW52ZXN0ZWQqKiA9IFRvdGFsIENhc2ggTmVlZGVkIFx1MjIxMiBDYXNoIEJhY2sgKGJ1dCBuZXZlciBiZWxvdyAkMClcblxuIyMgUG9zdC1SZWZpIEFubnVhbCBPcGVyYXRpbmcgQ29zdHNcblxufCBJdGVtIHwgRGVmYXVsdCB8XG58LS0tLS0tfC0tLS0tLS0tLXxcbnwgUHJvcGVydHkgdGF4ZXMgfCAkMiw1MDAveXIgKCQyMDgvbW8pIHxcbnwgSW5zdXJhbmNlIHwgJDEsMjAwL3lyICgkMTAwL21vKSB8XG5cblVzZSBhY3R1YWwgdmFsdWVzIGlmIHByb3ZpZGVkLlxuXG4qKk5PSSoqID0gQW5udWFsIFJlbnQgXHUyMjEyIFByb3BlcnR5IFRheGVzIFx1MjIxMiBJbnN1cmFuY2VcbioqQ2FzaCBGbG93KiogPSBNb250aGx5IFJlbnQgXHUyMjEyIFJlZmkgTW9ydGdhZ2UgUGF5bWVudCBcdTIyMTIgUHJvcGVydHkgVGF4ZXMvbW8gXHUyMjEyIEluc3VyYW5jZS9tb1xuXG4jIyBLZXkgTWV0cmljc1xuXG4tICoqVG90YWwgQ2FzaCBOZWVkZWQqKiA9IERvd24gcGF5bWVudCArIFB1cmNoYXNlIGNvc3RzXG4tICoqVG90YWwgQ2FzaCBJbnZlc3RlZCoqID0gQ2FzaCBsZWZ0IGluIGRlYWwgYWZ0ZXIgcmVmaSAoc2VlIGFib3ZlKVxuLSAqKkNhcCBSYXRlIChQdXJjaGFzZSkqKiA9IE5PSSAvIFRvdGFsIEFsbC1JbiBDb3N0XG4tICoqQ2FwIFJhdGUgKE1hcmtldCkqKiA9IE5PSSAvIEFSVlxuLSAqKkNhc2gtb24tQ2FzaCAoQ09DKSoqID0gQW5udWFsIENhc2ggRmxvdyAvIFRvdGFsIENhc2ggSW52ZXN0ZWRcbi0gKipHcm9zcyBSZW50IE11bHRpcGxpZXIqKiA9IEFSViAvIEFubnVhbCBSZW50XG4tICoqRGVidCBDb3ZlcmFnZSBSYXRpbyoqID0gTk9JIC8gQW5udWFsIE1vcnRnYWdlIFBheW1lbnRcbi0gKipCcmVhayBFdmVuIFJhdGlvKiogPSAoT3BlcmF0aW5nIEV4cGVuc2VzICsgTW9ydGdhZ2UpIC8gR3Jvc3MgUmVudFxuLSAqKlJlbnQgdG8gVmFsdWUqKiA9IE1vbnRobHkgUmVudCAvIEFSVlxuLSAqKlJldHVybiBvbiBJbnZlc3RtZW50IChST0kpKiogPSAoVG90YWwgUHJvZml0IGF0IFllYXIgMSBzYWxlKSAvIFRvdGFsIENhc2ggSW52ZXN0ZWRcbi0gKipFcXVpdHkgTXVsdGlwbGUqKiA9IFRvdGFsIFZhbHVlIFJldHVybmVkIC8gVG90YWwgQ2FzaCBJbnZlc3RlZFxuXG4jIyBGbGlwIE1ldHJpY3NcblxuLSAqKlRvdGFsIFByb2ZpdCoqID0gU2FsZSBQcm9jZWVkcyBcdTIyMTIgTG9hbiBSZXBheW1lbnQgXHUyMjEyIFRvdGFsIEhvbGRpbmcgQ29zdHMgXHUyMjEyIFRvdGFsIENhc2ggTmVlZGVkXG4tICoqUk9JKiogPSBUb3RhbCBQcm9maXQgLyBUb3RhbCBDYXNoIE5lZWRlZCBcdTAwRDcgMTAwXG4tICoqQW5udWFsaXplZCBST0kqKiA9IFJPSSAvIEhvbGRpbmcgUGVyaW9kIChtb250aHMpIFx1MDBENyAxMlxuLSBNaW5pbXVtIGFjY2VwdGFibGUgcHJvZml0OiAkMzAsMDAwLCBvciAkMTAsMDAwIHBlciByZWhhYiBtb250aFxuXG4jIyBGbGlwIEFuYWx5c2lzXG5cbi0gTmV0IFNhbGUgKFNhbGUgUHJvY2VlZHMpID0gQVJWIFx1MDBENyA5MyUgKDclIHNlbGxpbmcgY29zdHMpXG5cbiMjIE1BTyAoTWF4aW11bSBBbGxvd2FibGUgT2ZmZXIpXG5cbi0gTUFPID0gNzUlIFx1MDBENyBBUlYgXHUyMDEzIFJlcGFpcnMgXHUyMDEzIENsb3NpbmcgY29zdHMgXHUyMDEzIE1pbmltdW0gcHJvZml0XG5cbi0tLVxuXG4jIyBPdXRwdXQgRm9ybWF0IFx1MjAxNCBGbGlwXG5cbiMjIyAxLiBQcm9wZXJ0eSBTdW1tYXJ5XG5BZGRyZXNzLCBiZWRzL2JhdGhzLCBzcSBmdCwgeWVhciBidWlsdCwgbG90IHNpemUsIE1MUyMgKGlmIGtub3duKVxuXG4jIyMgMi4gUHVyY2hhc2UgJiBSZWhhYiBTdW1tYXJ5XG58IEl0ZW0gfCBBbW91bnQgfFxufC0tLS0tLXwtLS0tLS0tLXxcbnwgUHVyY2hhc2UgUHJpY2UgfCB8XG58IFJlaGFiIENvc3RzIHwgfFxufCBBbW91bnQgRmluYW5jZWQgKEhNTCkgfCB8XG58IERvd24gUGF5bWVudCAoMTAlKSB8IHxcbnwgUHVyY2hhc2UgQ29zdHMgfCB8XG58ICoqVG90YWwgQ2FzaCBOZWVkZWQqKiB8IHxcbnwgQVJWIHwgfFxufCBBUlYgcGVyIFNxIEZ0IHwgfFxufCBQcmljZSBwZXIgU3EgRnQgfCB8XG5cbiMjIyAzLiBGaW5hbmNpbmdcbkxvYW4gYW1vdW50LCByYXRlLCB0eXBlLCBtb250aGx5IHBheW1lbnQsIExUQy9MVFZcblxuIyMjIDQuIFB1cmNoYXNlIENvc3RzIChpdGVtaXplZClcbnwgSXRlbSB8IEFtb3VudCB8XG58LS0tLS0tfC0tLS0tLS0tfFxufCBUaXRsZSBjbG9zaW5nIGNvc3RzIHwgfFxufCBUaXRsZSBsZW5kZXIgaW5zdXJhbmNlIHwgfFxufCBMb2FuIHBvaW50cyB8IHxcbnwgRG9jIHN0YW1wcyAvIG1vcnRnYWdlIHwgfFxufCBJbnRhbmdpYmxlIHRheCB8IHxcbnwgKipUb3RhbCoqIHwgfFxuXG4jIyMgNS4gSG9sZGluZyBDb3N0cyAoYXQgYXNzdW1lZCBob2xkaW5nIHBlcmlvZClcbnwgSXRlbSB8IFRvdGFsIHxcbnwtLS0tLS18LS0tLS0tLXxcbnwgTG9hbiBwYXltZW50cyB8IHxcbnwgUHJvcGVydHkgdGF4ZXMgfCB8XG58IEluc3VyYW5jZSB8IHxcbnwgKipUb3RhbCoqIHwgfFxufCBQZXIgbW9udGggfCB8XG5cbiMjIyA2LiBTYWxlICYgUHJvZml0XG58IEl0ZW0gfCBBbW91bnQgfFxufC0tLS0tLXwtLS0tLS0tLXxcbnwgQWZ0ZXIgUmVwYWlyIFZhbHVlIHwgfFxufCBTZWxsaW5nIENvc3RzICg3JSkgfCB8XG58IFNhbGUgUHJvY2VlZHMgfCB8XG58IExvYW4gUmVwYXltZW50IHwgfFxufCBIb2xkaW5nIENvc3RzIHwgfFxufCBDYXNoIEludmVzdGVkIHwgfFxufCAqKlRvdGFsIFByb2ZpdCoqIHwgfFxuXG4jIyMgNy4gSW52ZXN0bWVudCBSZXR1cm5zXG58IE1ldHJpYyB8IFZhbHVlIHxcbnwtLS0tLS0tLXwtLS0tLS0tfFxufCBST0kgfCB8XG58IEFubnVhbGl6ZWQgUk9JIHwgfFxuXG4jIyMgOC4gUHJvZml0IFByb2plY3Rpb25zIChzZW5zaXRpdml0eSB0YWJsZSlcblxufCBIb2xkaW5nIFBlcmlvZCB8IExvYW4gUG10cyB8IFRheGVzIHwgSW5zdXJhbmNlIHwgVG90YWwgSG9sZGluZyB8IFRvdGFsIFByb2ZpdCB8IFJPSSB8IEFubi4gUk9JIHxcbnwtLS0tLS0tLS0tLS0tLS0tfC0tLS0tLS0tLS0tfC0tLS0tLS18LS0tLS0tLS0tLS18LS0tLS0tLS0tLS0tLS0tfC0tLS0tLS0tLS0tLS0tfC0tLS0tfC0tLS0tLS0tLS18XG58IDEgbW9udGggfCB8IHwgfCB8IHwgfCB8XG58IDIgbW9udGhzIHwgfCB8IHwgfCB8IHwgfFxufCAzIG1vbnRocyB8IHwgfCB8IHwgfCB8IHxcbnwgNCBtb250aHMgfCB8IHwgfCB8IHwgfCB8XG58IDYgbW9udGhzIHwgfCB8IHwgfCB8IHwgfFxuXG4jIyMgOS4gU2NlbmFyaW9zIChpZiBBUlYgdW5rbm93bilcbnwgTWV0cmljIHwgQ29uc2VydmF0aXZlIHwgQmFzZSB8IE9wdGltaXN0aWMgfFxufC0tLS0tLS0tfC0tLS0tLS0tLS0tLS18LS0tLS0tfC0tLS0tLS0tLS0tLXxcbnwgQVJWIHwgfCB8IHxcbnwgQWxsLUluIENvc3QgfCB8IHwgfFxufCBUb3RhbCBQcm9maXQgfCB8IHwgfFxufCBNQU8gfCB8IHwgfFxufCBST0kgfCB8IHwgfFxufCBBbm4uIFJPSSB8IHwgfCB8XG5cbiMjIyAxMC4gVmVyZGljdFxuKipCVVkqKiAvICoqUEFTUyoqIC8gKipDT05ESVRJT05BTCoqIFx1MjAxNCAyXHUyMDEzMyBzZW50ZW5jZXMgb24gd2hhdCBuZWVkcyB0byBiZSB0cnVlLlxuXG4jIyMgMTEuIEtleSBSaXNrc1xuMlx1MjAxMzMgYnVsbGV0cyBvbiB3aGF0IGNvdWxkIGtpbGwgdGhpcyBkZWFsLlxuXG4tLS1cblxuIyMgT3V0cHV0IEZvcm1hdCBcdTIwMTQgQlJSUlJcblxuIyMjIDEuIFByb3BlcnR5IFN1bW1hcnlcbkFkZHJlc3MsIGJlZHMvYmF0aHMsIHNxIGZ0LCB5ZWFyIGJ1aWx0LCBsb3Qgc2l6ZSwgTUxTIyAoaWYga25vd24pXG5cbiMjIyAyLiBQdXJjaGFzZSAmIFJlaGFiIFN1bW1hcnlcbnwgSXRlbSB8IEFtb3VudCB8XG58LS0tLS0tfC0tLS0tLS0tfFxufCBQdXJjaGFzZSBQcmljZSB8IHxcbnwgUmVoYWIgQ29zdHMgfCB8XG58IEFtb3VudCBGaW5hbmNlZCAoSE1MKSB8IHxcbnwgRG93biBQYXltZW50ICgxMCUpIHwgfFxufCBQdXJjaGFzZSBDb3N0cyB8IHxcbnwgKipUb3RhbCBDYXNoIE5lZWRlZCoqIHwgfFxufCBBUlYgfCB8XG58IEFSViBwZXIgU3EgRnQgfCB8XG58IFByaWNlIHBlciBTcSBGdCB8IHxcblxuIyMjIDMuIEZpbmFuY2luZyAoUHVyY2hhc2UgXHUyMDE0IEhNTClcbkxvYW4gYW1vdW50LCByYXRlLCB0eXBlLCBtb250aGx5IHBheW1lbnQsIExUQy9MVFZcblxuIyMjIDQuIFB1cmNoYXNlIENvc3RzIChpdGVtaXplZClcbnwgSXRlbSB8IEFtb3VudCB8XG58LS0tLS0tfC0tLS0tLS0tfFxufCBUaXRsZSBjbG9zaW5nIGNvc3RzIHwgfFxufCBUaXRsZSBsZW5kZXIgaW5zdXJhbmNlIHwgfFxufCBMb2FuIHBvaW50cyB8IHxcbnwgRG9jIHN0YW1wcyAvIG1vcnRnYWdlIHwgfFxufCBJbnRhbmdpYmxlIHRheCB8IHxcbnwgKipUb3RhbCoqIHwgfFxuXG4jIyMgNS4gSG9sZGluZyBDb3N0cyAoNi1tb250aCBkZWZhdWx0KVxufCBJdGVtIHwgVG90YWwgfFxufC0tLS0tLXwtLS0tLS0tfFxufCBMb2FuIHBheW1lbnRzIHwgfFxufCBQcm9wZXJ0eSB0YXhlcyB8IHxcbnwgSW5zdXJhbmNlIHwgfFxufCAqKlRvdGFsKiogfCB8XG58IFBlciBtb250aCB8IHxcblxuIyMjIDYuIFJlZmluYW5jZSBBbmFseXNpc1xufCBJdGVtIHwgQW1vdW50IHxcbnwtLS0tLS18LS0tLS0tLS18XG58IE5ldyBMb2FuIEFtb3VudCAoNzAlIEFSVikgfCB8XG58IFJlZmluYW5jZSBDb3N0cyAoMyUpIHwgfFxufCBMb2FuIFJlcGF5bWVudCAoSE1MKSB8IHxcbnwgSG9sZGluZyBDb3N0cyB8IHxcbnwgKipSZWZpIENhc2ggT3V0KiogfCB8XG58IFx1MjAxNCB8IFx1MjAxNCB8XG58IEluaXRpYWwgQ2FzaCBJbnZlc3RlZCB8IHxcbnwgUmVmaSBDYXNoIE91dCAoKyBvciBcdTIyMTIpIHwgfFxufCAqKlRvdGFsIENhc2ggSW52ZXN0ZWQqKiB8IHxcblxuIyMjIDcuIEZpbmFuY2luZyAoUmVmaW5hbmNlKVxuTG9hbiB0eXBlLCByYXRlLCBsb2FuIGFtb3VudCwgTFRWLCBtb250aGx5IHBheW1lbnQsIGFubnVhbCBwYXltZW50XG5cbiMjIyA4LiBDYXNoIEZsb3cgKFllYXIgMSwgQWZ0ZXIgUmVmaW5hbmNlKVxufCBJdGVtIHwgTW9udGhseSB8IFllYXJseSB8XG58LS0tLS0tfC0tLS0tLS0tLXwtLS0tLS0tLXxcbnwgR3Jvc3MgUmVudCB8IHwgfFxufCBWYWNhbmN5IHwgfCB8XG58IE9wZXJhdGluZyBJbmNvbWUgfCB8IHxcbnwgT3BlcmF0aW5nIEV4cGVuc2VzIHwgfCB8XG58IFx1MjAxNCBQcm9wZXJ0eSBUYXhlcyB8IHwgfFxufCBcdTIwMTQgSW5zdXJhbmNlIHwgfCB8XG58ICoqTmV0IE9wZXJhdGluZyBJbmNvbWUqKiB8IHwgfFxufCBMb2FuIFBheW1lbnRzIHwgfCB8XG58ICoqQ2FzaCBGbG93KiogfCB8IHxcblxuIyMjIDkuIFJldHVybnMgJiBSYXRpb3MgKFllYXIgMSlcbnwgTWV0cmljIHwgVmFsdWUgfFxufC0tLS0tLS0tfC0tLS0tLS18XG58IENhcCBSYXRlIChQdXJjaGFzZSBQcmljZSkgfCB8XG58IENhcCBSYXRlIChNYXJrZXQgLyBBUlYpIHwgfFxufCBDYXNoIG9uIENhc2ggUmV0dXJuIHwgfFxufCBHcm9zcyBSZW50IE11bHRpcGxpZXIgfCB8XG58IFJlbnQgdG8gVmFsdWUgfCB8XG58IERlYnQgQ292ZXJhZ2UgUmF0aW8gfCB8XG58IEJyZWFrIEV2ZW4gUmF0aW8gfCB8XG5cbiMjIyAxMC4gQnV5ICYgSG9sZCBQcm9qZWN0aW9uc1xuQXNzdW1lOiAzJSBhcHByZWNpYXRpb24veXIsIDIlIGluY29tZSBpbmNyZWFzZS95ciwgMiUgZXhwZW5zZSBpbmNyZWFzZS95ciwgNiUgc2VsbGluZyBjb3N0c1xuXG58IHwgWWVhciAxIHwgWWVhciAyIHwgWWVhciAzIHwgWWVhciA1IHwgWWVhciAxMCB8XG58LS0tfC0tLXwtLS18LS0tfC0tLXwtLS18XG58IEdyb3NzIFJlbnQgfCB8IHwgfCB8IHxcbnwgT3BlcmF0aW5nIEV4cGVuc2VzIHwgfCB8IHwgfCB8XG58IE5PSSB8IHwgfCB8IHwgfFxufCBMb2FuIFBheW1lbnRzIHwgfCB8IHwgfCB8XG58ICoqQ2FzaCBGbG93KiogfCB8IHwgfCB8IHxcbnwgUHJvcGVydHkgVmFsdWUgfCB8IHwgfCB8IHxcbnwgTG9hbiBCYWxhbmNlIHwgfCB8IHwgfCB8XG58ICoqVG90YWwgRXF1aXR5KiogfCB8IHwgfCB8IHxcbnwgVG90YWwgUHJvZml0IChpZiBzb2xkKSB8IHwgfCB8IHwgfFxufCBDYXNoIG9uIENhc2ggfCB8IHwgfCB8IHxcblxuIyMjIDExLiBWZXJkaWN0XG4qKkJVWSoqIC8gKipQQVNTKiogLyAqKkNPTkRJVElPTkFMKiogXHUyMDE0IDJcdTIwMTMzIHNlbnRlbmNlcyBvbiB3aGF0IG5lZWRzIHRvIGJlIHRydWUuXG5cbiMjIyAxMi4gS2V5IFJpc2tzXG4yXHUyMDEzMyBidWxsZXRzIG9uIHdoYXQgY291bGQga2lsbCB0aGlzIGRlYWwuXG5cbi0tLVxuXG4jIyBTdHlsZVxuXG5OdW1iZXJzLWZpcnN0LCBubyBmbHVmZi4gU2hvcnQgYW5kIGFjdGlvbmFibGUuIEZsYWcgY2xlYXJseSBpZiBpbnB1dHMgYXJlIGVzdGltYXRlcyB2cy4gY29uZmlybWVkLiBBbHdheXMgc3RhdGUgYXNzdW1lZCBob2xkaW5nIHBlcmlvZCBleHBsaWNpdGx5LlxuXG4jIyBDb21wc1xuXG4qKlNhbGUgY29tcHM6Kipcbi0gU29sZCBcdTIyNjQgMTIgbW9udGhzLCBzYW1lIG5laWdoYm9yaG9vZCAoZXhwYW5kIHJhZGl1cyBpZiBuZWVkZWQgXHUyMDE0IG5vdGUgZXhwbGljaXRseSlcbi0gSW5jbHVkZTogZGlzdGFuY2UsIHNpbWlsYXJpdHkgJSwgYmVkcy9iYXRocywgc3EgZnQsIHNhbGUgcHJpY2UsIHByaWNlL3NxIGZ0LCBzYWxlIGRhdGUsIGRheXMgb24gbWFya2V0XG4tIEluY2x1ZGUgYWN0aXZlICsgcGVuZGluZyBzZXBhcmF0ZWx5XG4tIEFkanVzdG1lbnRzOiAkNTAvc3FmdCwgJDEwSyBnYXJhZ2UsICQxNVx1MjAxMzIwSyBwb29sLCAkNVx1MjAxMzEwSyBsb3Qgc2l6ZVxuXG4qKlJlbnRhbCBjb21wcyAoQlJSUlIpOioqXG4tIEFjdGl2ZSBsaXN0aW5ncywgc2FtZSBuZWlnaGJvcmhvb2Rcbi0gSW5jbHVkZTogZGlzdGFuY2UsIHNpbWlsYXJpdHkgJSwgYmVkcy9iYXRocywgc3EgZnQsIGxpc3RlZCByZW50LCByZW50L3NxZnQsIGxhc3Qgc2VlblxuLSBTdGF0ZSBlc3RpbWF0ZWQgcmVudCByYW5nZSBhbmQgbWlkcG9pbnQgdXNlZCBpbiBhbmFseXNpc2BcblxuZnVuY3Rpb24gYnVpbGRVc2VyUHJvbXB0KHsgYWRkcmVzcywgcHVyY2hhc2VfcHJpY2UsIGFydiwgcmVub3ZhdGlvbl9jb3N0LCBzdHJhdGVneSB9KSB7XG4gIGNvbnN0IHN0cmF0ZWd5TGFiZWwgPSBzdHJhdGVneSA9PT0gJ2JycnJyJyA/ICdCUlJSUicgOiAnZmxpcCdcbiAgcmV0dXJuIGBBbmFseXplIHRoaXMgJHtzdHJhdGVneUxhYmVsfSBkZWFsIChiZSBjb25jaXNlIFx1MjAxNCBza2lwIHNlbnNpdGl2aXR5IHRhYmxlcyBhbmQgc2NlbmFyaW8gdGFibGVzKTpcbi0gQWRkcmVzczogJHthZGRyZXNzIHx8ICdOb3QgcHJvdmlkZWQnfVxuLSBQdXJjaGFzZSBQcmljZTogJCR7TnVtYmVyKHB1cmNoYXNlX3ByaWNlKS50b0xvY2FsZVN0cmluZygpfVxuLSBSZW5vdmF0aW9uIENvc3Q6ICQke051bWJlcihyZW5vdmF0aW9uX2Nvc3QpLnRvTG9jYWxlU3RyaW5nKCl9XG4tIEFSVjogJCR7TnVtYmVyKGFydikudG9Mb2NhbGVTdHJpbmcoKX1cbi0gU3RyYXRlZ3k6ICR7c3RyYXRlZ3lMYWJlbH1cblxuR2l2ZSBhIGJyaWVmIGFuYWx5c2lzICgzLTQgcGFyYWdyYXBocyBtYXgpLCB0aGVuIGFwcGVuZCBhIEpTT04gc3VtbWFyeSBibG9jayBpbiBleGFjdGx5IHRoaXMgZm9ybWF0IChubyBvdGhlciB0ZXh0IGFmdGVyIGl0KTpcblxuXFxgXFxgXFxganNvblxue1xuICBcInZlcmRpY3RcIjogXCJCVVlcIixcbiAgXCJzY29yZVwiOiA3NCxcbiAgXCJwcm9maXRcIjogNTQ2MDAsXG4gIFwicm9pXCI6IDE4LjMsXG4gIFwiYW5udWFsaXplZF9yb2lcIjogNzMuMixcbiAgXCJ0b3RhbF9jYXNoX25lZWRlZFwiOiA0MjAwMCxcbiAgXCJyZWNvbW1lbmRhdGlvblwiOiBcIjItMyBzZW50ZW5jZSBzdW1tYXJ5IG9mIHRoZSBkZWFsIGFuZCBrZXkgcmVhc29uIGZvciB2ZXJkaWN0LlwiLFxuICBcImtleV9yaXNrc1wiOiBbXCJSaXNrIG9uZVwiLCBcIlJpc2sgdHdvXCIsIFwiUmlzayB0aHJlZVwiXVxufVxuXFxgXFxgXFxgYFxufVxuXG5mdW5jdGlvbiBwYXJzZUpzb25CbG9jayh0ZXh0KSB7XG4gIGNvbnN0IG1hdGNoID0gdGV4dC5tYXRjaCgvYGBganNvblxccyooW1xcc1xcU10qPylgYGBcXHMqJC8pXG4gIGlmICghbWF0Y2gpIHJldHVybiBudWxsXG4gIHRyeSB7IHJldHVybiBKU09OLnBhcnNlKG1hdGNoWzFdLnRyaW0oKSkgfSBjYXRjaCB7IHJldHVybiBudWxsIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gc2F2ZUFuYWx5c2lzKGxlYWRJZCwgYW5hbHlzaXNPYmopIHtcbiAgY29uc3QgcmVzID0gYXdhaXQgZmV0Y2goXG4gICAgYCR7U1VQQUJBU0VfVVJMfS9yZXN0L3YxL2xlYWRzP2lkPWVxLiR7bGVhZElkfWAsXG4gICAge1xuICAgICAgbWV0aG9kOiAnUEFUQ0gnLFxuICAgICAgaGVhZGVyczoge1xuICAgICAgICBhcGlrZXk6IFNVUEFCQVNFX0tFWSxcbiAgICAgICAgQXV0aG9yaXphdGlvbjogYEJlYXJlciAke1NVUEFCQVNFX0tFWX1gLFxuICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICBQcmVmZXI6ICdyZXR1cm49bWluaW1hbCcsXG4gICAgICB9LFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBkZWFsX2FuYWx5c2lzOiBhbmFseXNpc09iaiB9KSxcbiAgICB9XG4gIClcbiAgaWYgKCFyZXMub2spIHtcbiAgICBjb25zdCB0ZXh0ID0gYXdhaXQgcmVzLnRleHQoKVxuICAgIHRocm93IG5ldyBFcnJvcihgU3VwYWJhc2Ugc2F2ZSBmYWlsZWQ6ICR7cmVzLnN0YXR1c30gJHt0ZXh0fWApXG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgYXN5bmMgKHJlcSkgPT4ge1xuICBpZiAocmVxLm1ldGhvZCA9PT0gJ09QVElPTlMnKSByZXR1cm4gbmV3IFJlc3BvbnNlKG51bGwsIHsgc3RhdHVzOiAyMDQsIGhlYWRlcnM6IEhFQURFUlMgfSlcbiAgaWYgKHJlcS5tZXRob2QgIT09ICdQT1NUJykge1xuICAgIHJldHVybiBuZXcgUmVzcG9uc2UoSlNPTi5zdHJpbmdpZnkoeyBvazogZmFsc2UsIGVycm9yOiAnTWV0aG9kIG5vdCBhbGxvd2VkJyB9KSwgeyBzdGF0dXM6IDQwNSwgaGVhZGVyczogSEVBREVSUyB9KVxuICB9XG5cbiAgaWYgKCFBTlRIUk9QSUNfQVBJX0tFWSkge1xuICAgIHJldHVybiBuZXcgUmVzcG9uc2UoSlNPTi5zdHJpbmdpZnkoeyBvazogZmFsc2UsIGVycm9yOiAnQU5USFJPUElDX0FQSV9LRVkgbm90IGNvbmZpZ3VyZWQuJyB9KSwgeyBzdGF0dXM6IDUwMCwgaGVhZGVyczogSEVBREVSUyB9KVxuICB9XG4gIGlmICghU1VQQUJBU0VfVVJMIHx8ICFTVVBBQkFTRV9LRVkpIHtcbiAgICByZXR1cm4gbmV3IFJlc3BvbnNlKEpTT04uc3RyaW5naWZ5KHsgb2s6IGZhbHNlLCBlcnJvcjogJ1N1cGFiYXNlIGNyZWRlbnRpYWxzIG5vdCBjb25maWd1cmVkLicgfSksIHsgc3RhdHVzOiA1MDAsIGhlYWRlcnM6IEhFQURFUlMgfSlcbiAgfVxuXG4gIHRyeSB7XG4gICAgY29uc3QgYm9keSA9IGF3YWl0IHJlcS5qc29uKCkuY2F0Y2goKCkgPT4gKHt9KSlcbiAgICBjb25zdCB7IGxlYWRfaWQsIGFkZHJlc3MsIHB1cmNoYXNlX3ByaWNlLCBhcnYsIHJlbm92YXRpb25fY29zdCwgc3RyYXRlZ3kgPSAnZmxpcCcgfSA9IGJvZHlcblxuICAgIGlmICghbGVhZF9pZCkgICAgICAgIHJldHVybiBuZXcgUmVzcG9uc2UoSlNPTi5zdHJpbmdpZnkoeyBvazogZmFsc2UsIGVycm9yOiAnbGVhZF9pZCBpcyByZXF1aXJlZC4nIH0pLCB7IHN0YXR1czogNDAwLCBoZWFkZXJzOiBIRUFERVJTIH0pXG4gICAgaWYgKCFwdXJjaGFzZV9wcmljZSkgcmV0dXJuIG5ldyBSZXNwb25zZShKU09OLnN0cmluZ2lmeSh7IG9rOiBmYWxzZSwgZXJyb3I6ICdwdXJjaGFzZV9wcmljZSBpcyByZXF1aXJlZC4nIH0pLCB7IHN0YXR1czogNDAwLCBoZWFkZXJzOiBIRUFERVJTIH0pXG4gICAgaWYgKCFhcnYpICAgICAgICAgICAgcmV0dXJuIG5ldyBSZXNwb25zZShKU09OLnN0cmluZ2lmeSh7IG9rOiBmYWxzZSwgZXJyb3I6ICdhcnYgaXMgcmVxdWlyZWQuJyB9KSwgeyBzdGF0dXM6IDQwMCwgaGVhZGVyczogSEVBREVSUyB9KVxuXG4gICAgLy8gQ2FsbCBDbGF1ZGUgQVBJXG4gICAgY29uc3QgY2xhdWRlUmVzID0gYXdhaXQgZmV0Y2goJ2h0dHBzOi8vYXBpLmFudGhyb3BpYy5jb20vdjEvbWVzc2FnZXMnLCB7XG4gICAgICBtZXRob2Q6ICdQT1NUJyxcbiAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgJ3gtYXBpLWtleSc6IEFOVEhST1BJQ19BUElfS0VZLFxuICAgICAgICAnYW50aHJvcGljLXZlcnNpb24nOiAnMjAyMy0wNi0wMScsXG4gICAgICAgICdjb250ZW50LXR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICB9LFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBtb2RlbDogJ2NsYXVkZS1zb25uZXQtNC02JyxcbiAgICAgICAgbWF4X3Rva2VuczogMjA0OCxcbiAgICAgICAgc3lzdGVtOiBTWVNURU1fUFJPTVBULFxuICAgICAgICBtZXNzYWdlczogW3sgcm9sZTogJ3VzZXInLCBjb250ZW50OiBidWlsZFVzZXJQcm9tcHQoeyBhZGRyZXNzLCBwdXJjaGFzZV9wcmljZSwgYXJ2LCByZW5vdmF0aW9uX2Nvc3QsIHN0cmF0ZWd5IH0pIH1dLFxuICAgICAgfSksXG4gICAgfSlcblxuICAgIGlmICghY2xhdWRlUmVzLm9rKSB7XG4gICAgICBjb25zdCBlcnJUZXh0ID0gYXdhaXQgY2xhdWRlUmVzLnRleHQoKVxuICAgICAgdGhyb3cgbmV3IEVycm9yKGBDbGF1ZGUgQVBJIGVycm9yICR7Y2xhdWRlUmVzLnN0YXR1c306ICR7ZXJyVGV4dH1gKVxuICAgIH1cblxuICAgIGNvbnN0IGNsYXVkZURhdGEgPSBhd2FpdCBjbGF1ZGVSZXMuanNvbigpXG4gICAgY29uc3QgbWFya2Rvd24gICA9IGNsYXVkZURhdGEuY29udGVudD8uWzBdPy50ZXh0IHx8ICcnXG4gICAgY29uc3Qgc3VtbWFyeSAgICA9IHBhcnNlSnNvbkJsb2NrKG1hcmtkb3duKSB8fCB7fVxuXG4gICAgY29uc3QgYW5hbHlzaXNPYmogPSB7XG4gICAgICB2ZXJkaWN0OiAgICAgICAgICAgc3VtbWFyeS52ZXJkaWN0ICAgICAgICAgICB8fCAnVU5LTk9XTicsXG4gICAgICBzY29yZTogICAgICAgICAgICAgc3VtbWFyeS5zY29yZSAgICAgICAgICAgICA/PyBudWxsLFxuICAgICAgc3RyYXRlZ3ksXG4gICAgICBwcm9maXQ6ICAgICAgICAgICAgc3VtbWFyeS5wcm9maXQgICAgICAgICAgICA/PyBudWxsLFxuICAgICAgcm9pOiAgICAgICAgICAgICAgIHN1bW1hcnkucm9pICAgICAgICAgICAgICAgPz8gbnVsbCxcbiAgICAgIGFubnVhbGl6ZWRfcm9pOiAgICBzdW1tYXJ5LmFubnVhbGl6ZWRfcm9pICAgID8/IG51bGwsXG4gICAgICB0b3RhbF9jYXNoX25lZWRlZDogc3VtbWFyeS50b3RhbF9jYXNoX25lZWRlZCA/PyBudWxsLFxuICAgICAgcmVjb21tZW5kYXRpb246ICAgIHN1bW1hcnkucmVjb21tZW5kYXRpb24gICAgfHwgJycsXG4gICAgICBrZXlfcmlza3M6ICAgICAgICAgc3VtbWFyeS5rZXlfcmlza3MgICAgICAgICB8fCBbXSxcbiAgICAgIG1hcmtkb3duLFxuICAgICAgYW5hbHl6ZWRfYXQ6ICAgICAgIG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICB9XG5cbiAgICBhd2FpdCBzYXZlQW5hbHlzaXMobGVhZF9pZCwgYW5hbHlzaXNPYmopXG5cbiAgICByZXR1cm4gbmV3IFJlc3BvbnNlKEpTT04uc3RyaW5naWZ5KHsgb2s6IHRydWUsIGFuYWx5c2lzOiBhbmFseXNpc09iaiB9KSwgeyBzdGF0dXM6IDIwMCwgaGVhZGVyczogSEVBREVSUyB9KVxuICB9IGNhdGNoIChlcnIpIHtcbiAgICByZXR1cm4gbmV3IFJlc3BvbnNlKEpTT04uc3RyaW5naWZ5KHsgb2s6IGZhbHNlLCBlcnJvcjogZXJyLm1lc3NhZ2UgfHwgU3RyaW5nKGVycikgfSksIHsgc3RhdHVzOiA1MDAsIGhlYWRlcnM6IEhFQURFUlMgfSlcbiAgfVxufVxuIl0sCiAgIm1hcHBpbmdzIjogIjs7Ozs7Ozs7OztBQU9BLElBQU0sb0JBQW9CLFFBQVEsSUFBSTtBQUN0QyxJQUFNLGVBQW9CLFFBQVEsSUFBSSxnQkFBZ0IsUUFBUSxJQUFJO0FBQ2xFLElBQU0sZUFBb0IsUUFBUSxJQUFJLDZCQUE2QixRQUFRLElBQUkscUJBQXFCLFFBQVEsSUFBSTtBQUVoSCxJQUFNLFVBQVU7QUFBQSxFQUNkLGdCQUFnQjtBQUFBLEVBQ2hCLCtCQUErQjtBQUFBLEVBQy9CLGdDQUFnQztBQUFBLEVBQ2hDLGdDQUFnQztBQUNsQztBQUdBLElBQU0sZ0JBQWdCO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQStUdEIsU0FBUyxnQkFBZ0IsRUFBRSxTQUFTLGdCQUFnQixLQUFLLGlCQUFpQixTQUFTLEdBQUc7QUFDcEYsUUFBTSxnQkFBZ0IsYUFBYSxVQUFVLFVBQVU7QUFDdkQsU0FBTyxnQkFBZ0IsYUFBYTtBQUFBLGFBQ3pCLFdBQVcsY0FBYztBQUFBLHFCQUNqQixPQUFPLGNBQWMsRUFB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Q1AsYUFBYTtBQUFBLFFBQ2IscUJBQXFCO0FBQUEsUUFDckIsZ0JBQWdCO0FBQUEsTUFDbEI7QUFBQSxNQUNBLE1BQU0sS0FBSyxVQUFVO0FBQUEsUUFDbkIsT0FBTztBQUFBLFFBQ1AsWUFBWTtBQUFBLFFBQ1osUUFBUTtBQUFBLFFBQ1IsVUFBVSxDQUFDLEVBQUUsTUFBTSxRQUFRLFNBQVMsZ0JBQWdCLEVBQUUsU0FBUyxnQkFBZ0IsS0FBSyxpQkFBaUIsU0FBUyxDQUFDLEVBQUUsQ0FBQztBQUFBLE1BQ3BILENBQUM7QUFBQSxJQUNILENBQUM7QUFFRCxRQUFJLENBQUMsVUFBVSxJQUFJO0FBQ2pCLFlBQU0sVUFBVSxNQUFNLFVBQVUsS0FBSztBQUNyQyxZQUFNLElBQUksTUFBTSxvQkFBb0IsVUFBVSxNQUFNLEtBQUssT0FBTyxFQUFFO0FBQUEsSUFDcEU7QUFFQSxVQUFNLGFBQWEsTUFBTSxVQUFVLEtBQUs7QUFDeEMsVUFBTSxXQUFhLFdBQVcsVUFBVSxDQUFDLEdBQUcsUUFBUTtBQUNwRCxVQUFNLFVBQWEsZUFBZSxRQUFRLEtBQUssQ0FBQztBQUVoRCxVQUFNLGNBQWM7QUFBQSxNQUNsQixTQUFtQixRQUFRLFdBQXFCO0FBQUEsTUFDaEQsT0FBbUIsUUFBUSxTQUFxQjtBQUFBLE1BQ2hEO0FBQUEsTUFDQSxRQUFtQixRQUFRLFVBQXFCO0FBQUEsTUFDaEQsS0FBbUIsUUFBUSxPQUFxQjtBQUFBLE1BQ2hELGdCQUFtQixRQUFRLGtCQUFxQjtBQUFBLE1BQ2hELG1CQUFtQixRQUFRLHFCQUFxQjtBQUFBLE1BQ2hELGdCQUFtQixRQUFRLGtCQUFxQjtBQUFBLE1BQ2hELFdBQW1CLFFBQVEsYUFBcUIsQ0FBQztBQUFBLE1BQ2pEO0FBQUEsTUFDQSxjQUFtQixvQkFBSSxLQUFLLEdBQUUsWUFBWTtBQUFBLElBQzVDO0FBRUEsVUFBTSxhQUFhLFNBQVMsV0FBVztBQUV2QyxXQUFPLElBQUksU0FBUyxLQUFLLFVBQVUsRUFBRSxJQUFJLE1BQU0sVUFBVSxZQUFZLENBQUMsR0FBRyxFQUFFLFFBQVEsS0FBSyxTQUFTLFFBQVEsQ0FBQztBQUFBLEVBQzVHLFNBQVMsS0FBSztBQUNaLFdBQU8sSUFBSSxTQUFTLEtBQUssVUFBVSxFQUFFLElBQUksT0FBTyxPQUFPLElBQUksV0FBVyxPQUFPLEdBQUcsRUFBRSxDQUFDLEdBQUcsRUFBRSxRQUFRLEtBQUssU0FBUyxRQUFRLENBQUM7QUFBQSxFQUN6SDtBQUNGOyIsCiAgIm5hbWVzIjogW10KfQo=
