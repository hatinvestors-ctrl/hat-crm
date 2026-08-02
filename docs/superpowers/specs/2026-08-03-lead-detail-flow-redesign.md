# Lead Detail Page — Deal-Flow Redesign

**Date:** 2026-08-03
**Status:** Approved
**Scope:** Frontend UI + client-side orchestration only. No new Netlify functions, no new DB columns — reuses `analyze-deal`, `generate-comps`, `generate-core-analysis`, `generate-negotiation-plan`, `generate-communications` exactly as called today. Reorganizes which components call them and how results are displayed.

## Context

The Lead Detail page has grown two separate, overlapping AI systems:

1. **Quick Check** (`FinancialSection.jsx` → `DealAnalysisPanel.jsx`) — calls `analyze-deal`, produces verdict/score/ROI/profit.
2. **Full AI Analysis** (`AINotesSection.jsx`) — calls `generate-comps` → `generate-core-analysis` → `generate-negotiation-plan` → `generate-communications`, produces MAO/ARV, comps, negotiation plan, scripts.

Both compute MAO-ish numbers independently, both have their own staleness detection (`isStale` in `FinancialSection`, `negoStale` in `AINotesSection`), both have their own copy of the same renovation-tier picker popup, and both have their own "regenerate" button. Users can't tell which one to click, and updating one doesn't update the other, so results visibly disagree until both are re-run.

Additionally, ARV and Renovation Cost are each editable in three different places (Financials inline field, AI Analysis "Override Inputs" row, and the tier-picker popup), and the page has no visual sense of deal-evaluation progress — it's a flat stack of cards in a fixed order regardless of how far along the lead is.

## Goals

- One AI analysis engine, one trigger, one staleness indicator, one renovation-tier popup (reusable, always accessible).
- A visible **flow stepper** (Property → Renovation → AI Analysis → Decision) that reflects real lead state and lets the user jump to any step.
- ARV and Renovation Cost each have exactly one editable home; every other place that references them is read-only display.
- Preserve all current analysis capability (verdict/score/ROI, comps, negotiation plan, scripts, flip/BRRRR full breakdown, Ask AI) — this is a UI/orchestration reorganization, not a feature cut.
- Zero backend changes. Zero new database columns. Zero change to the shape of data already stored on `leads.deal_analysis` / `leads.ai_notes`.

## Non-goals

- No changes to the Netlify functions themselves (prompts, models, response shapes).
- No changes to `ReportSection` (lender/agent/seller report generator) — stays a separate card, unchanged.
- No changes to `ActionZone` status playbook logic, `NotesSection`, `ContactInfoSection`, `ListingAgentCard`, activity timeline, comments, or attachments.
- No changes to Screener page, Project Detail page, or any BRRRR project/draw-management work.

## Architecture

### New components

**`LeadFlowStepper.jsx`**
Horizontal 4-step indicator rendered near the top of the page, under `LeadDetailHeader`/`MlsStatusBanner` and above `ActionZone`.

Steps and their "done" conditions (pure functions of `lead`, recomputed on every render — no new state):
1. **Property** — done when `lead.address && lead.asking_price`.
2. **Renovation** — done when `lead.renovation_cost != null`.
3. **Analysis** — done when `lead.deal_analysis` exists **and** `useDealStaleness(lead)` reports not-stale. If `deal_analysis` exists but is stale, this step shows an amber "outdated" badge instead of a checkmark.
4. **Decision** — always clickable once step 3 has ever completed once (i.e. `lead.deal_analysis` exists, regardless of staleness); represents "review results and act via ActionZone".

Each step is a `<button>` that smooth-scrolls to an anchor (`#step-property`, `#step-renovation`, `#step-analysis`, `#step-decision`) placed on the relevant section. No routing changes, no forced modal/wizard — the rest of the page still renders as one scrollable document.

Visual states per step: upcoming (dim), current (accent border — "current" = first not-done step), done (green check), stale (amber warning icon, step 3 only).

**`useDealStaleness(lead)`** — shared hook, single source of truth for "does the analysis need re-running":
```js
function useDealStaleness(lead) {
  const inp = lead.deal_analysis?.inputs
  if (!inp) return { stale: false, reasons: [] }
  const reasons = []
  if (Number(lead.arv || 0) !== Number(inp.arv || 0)) reasons.push('ARV changed')
  const curReno = lead.renovation_cost != null ? Number(lead.renovation_cost) : null
  const renoMatch = curReno === inp.renovation_cost || (curReno == null && inp.renovation_cost == null)
  if (!renoMatch) reasons.push('Renovation cost changed')
  if ((lead.deal_analysis?.strategy || 'flip') !== (inp.strategy || 'flip')) reasons.push('Strategy changed')
  return { stale: reasons.length > 0, reasons }
}
```
This replaces `FinancialSection.isStale` and `AINotesSection.negoStale` — both deleted, both call sites read from this hook instead.

**`RenoTierPicker.jsx`** — extracted from the near-identical blocks currently duplicated in `FinancialSection.jsx` (lines ~329-418) and `AINotesSection.jsx` (lines ~558-627). Same behavior (Cosmetic/Medium/Heavy tiers, `$/sqft` rates, AI-suggested tier via `suggestRenoTier`, sqft input when missing, "enter exact cost" escape hatch), packaged as:
```jsx
<RenoTierPicker
  lead={lead}
  open={showPicker}
  onClose={() => setShowPicker(false)}
  onApply={(reno) => { update({ renovation_cost: reno }); onClose(); }}
/>
```
Rendered as a popover anchored to a small **🔨 icon button** placed immediately next to the Renovation Cost `EditableField`, in the Renovation step section. The icon is always present (not conditional on reno being empty) — clicking it opens the picker pre-selected to the AI-suggested tier, letting the user change tiers even after a cost is already set. Typing directly into the Renovation Cost field remains the fast path for exact numbers.

**`DealAnalysisCard.jsx`** — replaces `DealAnalysisPanel.jsx` and the analysis-running portion of `AINotesSection.jsx`. This is the merged engine:

- **Single "Run Analysis" / "Re-run Analysis" button.** Internally runs the same sequence as today's `AINotesSection.runGenerate`: `generate-comps` (skipped on re-run if comps already exist and user didn't request refresh) → `generate-core-analysis` → `generate-negotiation-plan` → `generate-communications` (fired in background, non-blocking, same as today). Also derives the same verdict/score/ROI numbers `analyze-deal` used to produce — since `generate-core-analysis` already returns `computed_arv`/`computed_mao`/`computed_starting_offer`, and the flip/BRRRR profit math is pure client-side (`computeFlipBreakdown`/`computeBrrrrBreakdown`, already in `DealAnalysisPanel.jsx`), the verdict/score can be computed client-side from those same inputs instead of via a second `analyze-deal` server round-trip. **Decision point:** keep calling `analyze-deal` too (simplest, zero risk of behavior drift) vs. compute verdict client-side (one fewer network call). Recommend keeping the `analyze-deal` call for now — it's the one place verdict/score logic already lives, and duplicating that logic client-side risks the two silently diverging again. This card just sequences it as one more step in the same run, rather than a separately-triggered "Quick Check."
- **Strategy toggle** (Flip/BRRRR, default Flip) shown above the Run button, editable before first run; changing it after a result exists triggers a labeled re-run ("Re-running for BRRRR…") rather than leaving stale flip numbers on screen.
- **Summary strip** (always visible once analysis exists): Verdict badge, Score, MAO, Starting Offer, Est. Profit/ROI — merges the current `DealAnalysisPanel` hero + `ActionZone`'s deal-snapshot numbers into one rendering (ActionZone keeps its own copy for the "what now" hint row, but both read the same `lead.deal_analysis`/`lead.mao`/`lead.starting_offer` fields, so they can never disagree).
- **Tabs below the strip**, reusing the existing `NotesRenderer` tab component (`extraTabs` prop already supports this pattern): `Comps` · `Negotiation Plan` · `Scripts` · `Ask AI` (existing `DealQA.jsx`) · `Full Breakdown` (the flip/BRRRR calculation currently shown in `DealAnalysisPanel`'s `BreakdownModal` becomes a tab instead of a modal-triggered popup — same `computeFlipBreakdown`/`computeBrrrrBreakdown` functions, just rendered inline in a tab instead of a `fixed inset-0` overlay).
- **One staleness banner**, driven by `useDealStaleness`, shown at the top of the card when stale — replaces the two separate stale-notices in `FinancialSection` (amber "Numbers changed" banner) and `AINotesSection` (amber "Negotiation plan is based on old numbers" banner).
- **One renovation-missing gate**: if `renovation_cost` is null when Run Analysis is clicked, open `RenoTierPicker` instead of running (same UX as today's two separate implementations, now one).

### Edited components

**`FinancialSection.jsx`** — shrinks significantly. Keeps: the Ask → Gap → MAO → Starting Offer price-flow strip (still useful as an at-a-glance summary), the ARV editable field, the Renovation Cost editable field (now with the 🔨 icon next to it). Removes: the Quick Check button, the reno-tier-picker block (moved to shared `RenoTierPicker`), the strategy toggle + rent input (moved into `DealAnalysisCard`), the `isStale` banner (moved to shared hook/banner in `DealAnalysisCard`), the `<DealAnalysisPanel>` and `<WhatIfPanel>` renders (WhatIfPanel stays on the page but renders inside/near the Decision step instead of inside Financials — see below).

**`AINotesSection.jsx`** — deleted. Its generation logic (`runGenerate`, `reRunWithOverrides`, `updateNegoPlan`, `generateScripts`, comps-reuse-on-rerun logic) moves into `DealAnalysisCard.jsx` largely as-is; its rendering (`NotesRenderer` + tabs) also moves into `DealAnalysisCard.jsx`.

**`DealAnalysisPanel.jsx`** — deleted. Its verdict/score/profit summary becomes the `DealAnalysisCard` summary strip; its `BreakdownModal` becomes the `Full Breakdown` tab.

**`WhatIfPanel.jsx`** — kept as-is (no logic changes), relocated to render just after the Decision step's `ActionZone`, since it's a "what if I change X" exploration tool that belongs after the user has a baseline analysis to compare against.

**`LeadDetailPage.jsx`** — reordered around the stepper:
```
Topbar
LeadDetailHeader
MlsStatusBanner
LeadFlowStepper                          ← new
ActionZone                               (unchanged, reads from same lead fields)
LeadStatusPipeline                       (unchanged)

<div id="step-property">
  PropertyInfoSection                    (unchanged — this + asking price = step 1)
</div>

<div id="step-renovation">
  FinancialSection                       (slimmed — ARV/Reno/price-flow strip)
</div>

<div id="step-analysis">
  DealAnalysisCard                       ← new, merged engine
</div>

<div id="step-decision">
  WhatIfPanel                            (relocated, unchanged)
</div>

GroupDivider "Contacts & Reports"
ContactInfoSection, ListingAgentCard, ReportSection    (unchanged)

[right column unchanged: CommentBox, ActivityTimeline, AttachmentsSection]
```
Note: `NotesSection` (manual free-text notes, distinct from `AINotesSection`) keeps existing — it was previously grouped with `AINotesSection` under "Analysis & Notes"; it now renders directly after `DealAnalysisCard`, still before the Contacts & Reports divider.

## Data flow / staleness — how this avoids the original confusion

Before: three independent staleness checks (`FinancialSection.isStale`, `AINotesSection.negoStale`, plus implicit staleness anyone had to notice manually when ARV/reno changed without re-running comps/negotiation). Three "regenerate" buttons in three different visual styles.

After: one `useDealStaleness(lead)` call, referenced by (a) the stepper's step-3 badge, (b) `DealAnalysisCard`'s single banner, (c) nowhere else — `FinancialSection` no longer shows any stale/regenerate UI at all, since editing ARV/Reno there doesn't auto-trigger anything; it just changes `lead.arv`/`lead.renovation_cost`, which `useDealStaleness` picks up next render.

## Error handling

Unchanged from today's per-call try/catch in `runGenerate`/`reRunWithOverrides` — errors surface as the existing inline `genError` text block inside `DealAnalysisCard`. No new error states introduced; this is a reorg of existing working code paths, not new logic.

## Testing

No automated test suite currently covers these components (confirmed: no `*.test.jsx` files under `src/components/lead-detail/`). Verification will be manual, via the `verify` skill: load a lead with no analysis yet, confirm stepper shows step 1/2 as the active state; enter ARV+reno via steps 1/2; run analysis via step 3 and confirm summary strip + all 5 tabs populate; edit ARV afterward and confirm stepper step 3 flips to "outdated" and `DealAnalysisCard` shows the stale banner; re-run and confirm it clears; switch Flip→BRRRR and confirm a relabeled re-run happens; open the 🔨 icon on Renovation Cost with a value already set and confirm the tier picker opens pre-selected to a tier (not just when reno is empty).
