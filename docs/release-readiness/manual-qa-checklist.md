# Manual QA Checklist — HAT Investors Acquisition Intelligence

For everything the automated suite cannot cover without a browser, a live LLM call, or real ingestion (see `RELEASE-READINESS.md` → "Not Covered"). Run against `localhost:8888`, never production. One pass = one named QA person, one date, one lead used per section noted.

| # | Step | Expected result | Pass/Fail | Notes |
|---|---|---|---|---|
| 1 | Open an existing on-market lead's workspace | Overview/Deal/Acquisition/AI & Comps/Activity tabs render, sticky header shows address + one dominant decision | | |
| 2 | Edit ARV up by $50K, save | Deal tab's Max Buy, profit, Margin of Safety all update immediately; no stale numbers left on Overview | | |
| 3 | Edit renovation cost up by $20K, save | Max Buy decreases; if a stored AI offer existed, a "stale" indicator appears | | |
| 4 | Add a rent estimate to a lead that had none | BRRRR becomes available on the Deal tab without altering the Flip numbers | | |
| 5 | Schedule a follow-up for today's date | Lead appears under "Today" in Action Center, not Overdue/Upcoming | | |
| 6 | Schedule a follow-up 7 days in the past (via DB or an existing overdue lead) | Lead appears under "Overdue" with a day count of 7 | | |
| 7 | Log a follow-up outcome (call result) | New entry appears in Activity tab immediately, in correct chronological order | | |
| 8 | Change lead status to a terminal status (e.g. Dead Lead) | Lead disappears from Action Center on next load | | |
| 9 | Run AI analysis ("Run AI Analysis" / Deal Brief) on a lead | AI & Comps tab populates; verdict language is clearly distinguished from the deterministic Flip/BRRRR tier (different vocabulary, not conflated) | | |
| 10 | After running AI analysis, edit ARV or reno again | A visible "AI analysis is stale" warning appears near the AI numbers | | |
| 11 | Open an on-market lead's Acquisition tab | Negotiation-gap / Max Buy language matches Deal tab exactly (no contradicting numbers) | | |
| 12 | Open an off-market/distressed lead | Seller-strategy content renders from `distress_data` (no LLM spinner, populates instantly) | | |
| 13 | Start a Live Copilot session, speak/type a few lines, switch tabs mid-session | Copilot keeps running uninterrupted across tab switches; timer doesn't reset | | |
| 14 | End the Live Copilot session | Extracted facts get written to the correct lead fields; session cleanly stops (no zombie timer) | | |
| 15 | Upload an attachment to a lead | File appears in Activity/attachments list, is downloadable | | |
| 16 | Add a free-text comment | Appears in Activity feed and is included as AI context on next AI run (spot-check the AI response references it) | | |
| 17 | Add/edit notes on a lead | `NotesRenderer` displays formatting correctly, no raw markdown/HTML leaking | | |
| 18 | From a won/under-contract lead, create a flip/BRRRR project | Project created with `deal_financials` populated per [[project_flip_creation]] structure; Florida fees present | | |
| 19 | Open the Zillow/Redfin link action on a lead | Correct external URL opens for that property's address | | |
| 20 | Resize the browser to mobile width (~375px) and tablet width (~768px) on the Lead workspace | Tabs, header, and DecisionHero remain usable — no horizontal scroll on the page body, no overlapping text | | |
| 21 | Trigger a fresh Redfin/Zillow import for one new address | New lead created with correct source tag, no duplicate created for an existing address | | |
| 22 | Force an AI call to fail (e.g. disconnect network briefly during "Run AI Analysis") | UI shows a clear error state, not an infinite spinner or silent failure | | |
| 23 | Apply a Human Override (Do Not Pursue) on a lead with strong underlying economics | Action Center recommendation flips to PASS/Human Override immediately, override reason is visible on the lead | | |

**Sign-off:** all 23 rows PASS, by a named human, before this checklist can support a "BETA READY" determination — automated tests alone cannot certify these paths.
