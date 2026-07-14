# Lead Detail Page UX Redesign

**Date:** 2026-07-14  
**Status:** Approved  
**Scope:** UI-only — no backend, no data model, no Netlify function changes.

## Context

The Lead Detail page is used by Tomer and Kevin (power users) to evaluate leads quickly. Two problems reported:

1. **MAO is hard to find** — it sits as a visually equal field alongside ARV and Reno Cost, buried 6th in the left column scroll order. After running an AI analysis, Kevin has to scroll back up to locate and verify the MAO.
2. **Two confusingly identical "Analyze" buttons** — "Analyze Deal" (FinancialSection) and "Generate AI Analysis" (AINotesSection) look the same but do completely different things. Users don't know which to click.

## Goals

- Make MAO the first thing Kevin sees when opening a lead.
- Make the deal verdict (pass/fail/negotiate) immediately visible next to MAO.
- Eliminate button confusion between Quick Check and Full AI Analysis.
- Zero backend changes. Zero data model changes. All fields remain editable as before.

## Changes

### 1. Reorder Left Column — `LeadDetailPage.jsx`

Move `<FinancialSection>` to be the **first** component inside the `lg:col-span-2` grid div, before `PropertyInfoSection`.

New order:
1. FinancialSection ← moved up
2. PropertyInfoSection
3. NotesSection
4. AINotesSection
5. ContactInfoSection
6. ListingAgentCard
7. ScenariosFlat
8. ReportSection

This is a 4-line change (cut/paste the `<FinancialSection ... />` block).

### 2. MAO Hero Layout — `FinancialSection.jsx`

Restructure the card body so MAO reads as the primary number:

**New layout inside the card:**
```
┌─────────────────────────────────────────────┐
│ Financials   MAO · OUR OFFER  [MAKE OFFER]  │  ← card title row
│              $138,000                        │  ← hero: text-2xl, accent color, bold
├─────────────────────────────────────────────┤
│  ARV $260,000        Reno Cost $70,000      │  ← existing 2-col grid, unchanged
│  MAO auto-calculates … (tooltip on ℹ icon) │  ← helper text moved to tooltip
├─────────────────────────────────────────────┤
│  [FLIP] [BRRRR]   Rent $___/mo    [Quick Check ↺]  │
└─────────────────────────────────────────────┘
```

Specific changes:
- Add a **hero row** above the existing grid: MAO label (small, dim) + MAO value (text-2xl, font-bold, accent color) + verdict badge inline.
- **Verdict badge**: pill chip showing `deal_analysis.verdict` (e.g. "MAKE OFFER", "NEGOTIATE", "DEAD LEAD") colored green/amber/red. Only shown when `lead.deal_analysis` exists.
- Move the helper text `"MAO auto-calculates as 75% × ARV − Renovation. Edit to override."` into a tooltip (ℹ icon) on the MAO label — removes visual clutter without losing the info.
- MAO field remains a fully editable `EditableField` (click-to-edit), same `useLeadUpdate` hook, no logic change.

### 3. Rename Buttons — `FinancialSection.jsx` + `AINotesSection.jsx`

| Location | Old label | New label |
|---|---|---|
| FinancialSection | "✦ Analyze Deal" / "↺ Re-analyze" | "✦ Quick Check" / "↺ Re-check" |
| AINotesSection | "✦ Generate AI Analysis" / "↻ Re-run analysis" | "✦ Full AI Analysis" / "↻ Re-run Full Analysis" |

### 4. Card Subtitle Lines

Add a small subtitle under each card title using the existing `Card` component's `subtitle` prop (or inline if not supported):

- **Financials card**: `"MAO · ARV · Reno — quick deal verdict"`
- **AI Analysis card**: `"Comps · negotiation plan · communications"`

This makes the purpose of each section scannable at a glance without opening either.

## Files to Modify

| File | Change |
|---|---|
| `src/pages/LeadDetailPage.jsx` | Reorder: move FinancialSection block to top of left column |
| `src/components/lead-detail/FinancialSection.jsx` | Hero MAO row, verdict badge, tooltip helper text, rename button |
| `src/components/lead-detail/AINotesSection.jsx` | Rename button labels only |

## What Does NOT Change

- All `EditableField` components, `onSave` handlers, `useLeadUpdate` hook — untouched.
- `deal_analysis`, `ai_notes` data fields — untouched.
- `DealAnalysisPanel` component — untouched.
- All backend Netlify functions — untouched.
- All other sections (PropertyInfo, Notes, Contact, etc.) — untouched in content and behavior.

## Verification

1. Open any lead → FinancialSection is the first section visible without scrolling.
2. MAO displays in large accent-colored text at top of card.
3. If `deal_analysis` exists, verdict badge is visible inline next to MAO.
4. Clicking MAO opens the inline edit field as before.
5. FinancialSection button reads "Quick Check" (or "Re-check" if analysis exists).
6. AINotesSection button reads "Full AI Analysis" (or "Re-run Full Analysis" if notes exist).
7. Helper text tooltip appears on hover of ℹ icon next to MAO label.
8. All other sections remain functional and in correct order below Financials.
