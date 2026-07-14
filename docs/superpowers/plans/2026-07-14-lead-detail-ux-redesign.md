# Lead Detail UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make MAO the first thing Kevin sees on a lead, show the deal verdict inline next to it, and eliminate the confusing duplicate "Analyze" button labels.

**Architecture:** Three isolated UI-only changes — section reorder in the page, visual redesign of the Financials card, and label renames in the AI Notes card. No backend, no data model, no hook changes.

**Tech Stack:** React, Tailwind-style CSS vars (`var(--color-*)`), existing `EditableField`, `Card`, `Button` components.

## Global Constraints

- No backend changes — all Netlify functions, Supabase queries, and hooks stay untouched.
- No data model changes — `lead.mao`, `lead.arv`, `lead.renovation_cost`, `lead.deal_analysis`, `lead.ai_notes` fields are read/written exactly as before.
- All fields must remain inline-editable via `EditableField` exactly as before.
- Use existing CSS variable tokens (`var(--color-accent)`, `var(--color-text-dim)`, etc.) — no hardcoded colors.
- Follow existing component patterns (Card, Button, EditableField) — no new UI primitives.

---

### Task 1: Reorder Left Column — FinancialSection moves to top

**Files:**
- Modify: `src/pages/LeadDetailPage.jsx` (lines 161–199)

**Interfaces:**
- Consumes: nothing new — same `lead`, `userId`, `members`, `canEdit`, `onUpdated` props already passed
- Produces: FinancialSection renders before PropertyInfoSection in DOM order

- [ ] **Step 1: Move the FinancialSection block to the top of the left column**

In `src/pages/LeadDetailPage.jsx`, inside the `lg:col-span-2` div (currently line 161), cut the `<FinancialSection ... />` block (currently lines 187–193) and paste it as the **first child**, before `<PropertyInfoSection>`.

Result — the left column order becomes:
```jsx
<div className="lg:col-span-2 space-y-4">
  <FinancialSection
    lead={lead}
    userId={user.id}
    members={members}
    canEdit={canEdit}
    onUpdated={(updated) => { setLead(updated); setActivityRefresh(v => v + 1) }}
  />
  <PropertyInfoSection
    lead={lead}
    userId={user.id}
    members={members}
    canEdit={canEdit}
    onUpdated={(updated) => { setLead(updated); setActivityRefresh(v => v + 1) }}
  />
  <NotesSection
    lead={lead}
    canEdit={canEdit}
    onUpdated={(updated) => setLead(updated)}
  />
  <AINotesSection
    lead={lead}
    canEdit={canEdit}
    onUpdated={(updated) => setLead(updated)}
  />
  <ContactInfoSection
    lead={lead}
    userId={user.id}
    members={members}
    canEdit={canEdit}
    onUpdated={(updated) => { setLead(updated); setActivityRefresh(v => v + 1) }}
  />
  <ListingAgentCard lead={lead} />
  <ScenariosFlat
    lead={lead}
    canEdit={canEdit}
    onUpdated={(updated) => setLead(updated)}
  />
  <ReportSection lead={lead} />
</div>
```

- [ ] **Step 2: Verify in browser**

Open any lead. Confirm the "Financials" card is the first card in the left column, visible without scrolling.

- [ ] **Step 3: Commit**

```bash
git add src/pages/LeadDetailPage.jsx
git commit -m "feat: move FinancialSection to top of lead detail left column"
```

---

### Task 2: MAO Hero Row + Verdict Badge + Tooltip in FinancialSection

**Files:**
- Modify: `src/components/lead-detail/FinancialSection.jsx`

**Interfaces:**
- Consumes: `lead.mao`, `lead.deal_analysis.verdict`, `lead.deal_analysis` (already available)
- Produces: Hero MAO display at top of card, colored verdict badge, tooltip on helper text

- [ ] **Step 1: Add verdict badge color helper at top of component**

After the existing imports in `FinancialSection.jsx`, add this helper before the `export default` line:

```js
function verdictStyle(verdict) {
  if (!verdict) return null
  const v = verdict.toUpperCase()
  if (v.includes('MAKE OFFER'))  return { bg: 'var(--color-success-soft)', border: 'var(--color-success)', text: 'var(--color-success-text)' }
  if (v.includes('NEGOTIATE'))   return { bg: 'var(--color-warn-soft)',    border: 'var(--color-warn)',    text: 'var(--color-warn-text)' }
  if (v.includes('LONG SHOT'))   return { bg: 'var(--color-warn-soft)',    border: 'var(--color-warn)',    text: 'var(--color-warn-text)' }
  if (v.includes('WATCH'))       return { bg: 'var(--color-bg-elev-2)',    border: 'var(--color-line)',    text: 'var(--color-text-muted)' }
  return { bg: 'var(--color-danger-soft)', border: 'var(--color-danger)', text: 'var(--color-danger-text)' }
}
```

- [ ] **Step 2: Replace the card body with the new layout**

Replace the entire `return (` block in `FinancialSection.jsx` with the following. This keeps all existing logic (EditableField, strategy toggle, analyze button, stale warning, DealAnalysisPanel) unchanged — only adds the hero row at the top and moves the helper text into a tooltip:

```jsx
  const verdict = lead.deal_analysis?.verdict || null
  const vStyle  = verdictStyle(verdict)

  return (
    <Card title="Financials" subtitle="MAO · ARV · Reno — quick deal verdict">

      {/* ── Hero MAO row ── */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-start gap-2">
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--color-text-dim)]">
                MAO · Our Offer
              </span>
              <span
                title="MAO auto-calculates as 75% × ARV − Renovation. Edit to override."
                className="text-[11px] text-[color:var(--color-text-dim)] cursor-help select-none"
              >ℹ</span>
            </div>
            <EditableField
              label=""
              type="currency"
              value={lead.mao}
              formatter={formatCurrency}
              onSave={(v) => update({ mao: v })}
              disabled={!canEdit}
              displayClassName="text-2xl font-bold text-[color:var(--color-accent)]"
            />
          </div>
        </div>
        {vStyle && verdict && (
          <span
            className="shrink-0 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide border"
            style={{ background: vStyle.bg, borderColor: vStyle.border, color: vStyle.text }}
          >
            {verdict}
          </span>
        )}
      </div>

      {/* ── ARV + Reno grid (unchanged) ── */}
      <div className="grid grid-cols-2 gap-4">
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
      </div>

      {/* ── Analyze trigger row ── */}
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
          {strategy === 'brrrr' && (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-[color:var(--color-text-dim)]">Rent $</span>
              <input
                type="number"
                value={monthlyRent}
                onChange={e => setMonthlyRent(e.target.value)}
                placeholder="2000"
                className="w-20 h-6 px-2 text-[12px] bg-[color:var(--color-bg)] border border-[color:var(--color-line)] rounded text-[color:var(--color-text)] focus:outline-none focus:border-[color:var(--color-accent)]"
              />
              <span className="text-[11px] text-[color:var(--color-text-dim)]">/mo</span>
            </div>
          )}
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
          {analyzing ? 'Analyzing…' : hasAnalysis ? '↺ Re-check' : '✦ Quick Check'}
        </Button>
      </div>

      {isStale && !analyzing && (
        <div className="mt-2 flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-[color:var(--color-warn-soft)] border border-[color:var(--color-warn)]">
          <span className="text-[11.5px] text-[color:var(--color-warn-text)]">⚠ Numbers changed since last analysis — results may be outdated.</span>
          <button
            onClick={handleAnalyze}
            disabled={!canEdit || analyzing}
            className="shrink-0 text-[11.5px] font-semibold px-2.5 py-1 rounded bg-[color:var(--color-warn)] text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            Re-check now
          </button>
        </div>
      )}

      {analyzeError && (
        <p className="mt-2 text-[11.5px] text-[color:var(--color-danger-text)]">{analyzeError}</p>
      )}

      <DealAnalysisPanel analysis={lead.deal_analysis} lead={lead} />
    </Card>
  )
```

**Note on `displayClassName` prop:** `EditableField` may not yet accept a `displayClassName` prop for styling the displayed value. If clicking MAO still shows the large styled text correctly without it, skip the prop. If the text is unstyled, check `EditableField.jsx` — if it spreads extra props onto the display span, the className will work. If not, wrap the `EditableField` in a `<div className="text-2xl font-bold text-[color:var(--color-accent)]">` and rely on CSS inheritance, or add a `displayClassName` prop to `EditableField` that it applies to its display `<span>`.

- [ ] **Step 3: Check Card component for subtitle prop**

Read `src/components/ui/Card.jsx`. If it already accepts a `subtitle` prop, leave as-is. If not, either:
- Add `subtitle` prop support: below the title render a `<p className="text-[11px] text-[color:var(--color-text-dim)] mt-0.5">{subtitle}</p>`
- Or inline the subtitle as a second line in the `title` prop using a fragment (less clean, avoid if possible)

- [ ] **Step 4: Verify in browser**

Open a lead that has `deal_analysis` set. Confirm:
- MAO shows large and blue at the top of the Financials card.
- Verdict badge (e.g. "MAKE OFFER") appears to the right of MAO.
- Hovering the ℹ shows the tooltip text.
- Clicking MAO opens the inline edit field as before.
- Button reads "Re-check" (or "Quick Check" if no analysis yet).
- Stale warning says "Re-check now" instead of "Re-analyze now".

Open a lead with no `deal_analysis`. Confirm:
- No verdict badge shown.
- Button reads "✦ Quick Check".
- MAO still editable.

- [ ] **Step 5: Commit**

```bash
git add src/components/lead-detail/FinancialSection.jsx
git commit -m "feat: MAO hero row, verdict badge, tooltip, rename Quick Check button"
```

---

### Task 3: Rename buttons in AINotesSection

**Files:**
- Modify: `src/components/lead-detail/AINotesSection.jsx` (lines 311, 407, 494)

**Interfaces:**
- Consumes: nothing new
- Produces: button labels read "Full AI Analysis" / "Re-run Full Analysis" + updated placeholder text

- [ ] **Step 1: Update the three label strings**

In `AINotesSection.jsx`, make these three targeted string replacements:

**Line ~311** — main generate button label:
```jsx
// Before:
✦ {localNotes ? 'Regenerate' : 'Generate AI Analysis'}

// After:
✦ {localNotes ? 'Re-run Full Analysis' : 'Full AI Analysis'}
```

**Line ~407** — re-run analysis button label:
```jsx
// Before:
↻ Re-run analysis

// After:
↻ Re-run Full Analysis
```

**Line ~494** — empty state placeholder text:
```jsx
// Before:
<p className="text-[12px] text-[color:var(--color-text-faint)]">Click <strong>✦ Generate AI Analysis</strong> above to run a full investor analysis.</p>

// After:
<p className="text-[12px] text-[color:var(--color-text-faint)]">Click <strong>✦ Full AI Analysis</strong> above to run a full investor analysis including comps, negotiation plan, and communications.</p>
```

- [ ] **Step 2: Verify in browser**

Open a lead with no AI notes — confirm placeholder reads "Full AI Analysis". Open a lead with existing AI notes — confirm button reads "Re-run Full Analysis". Confirm the override re-run button reads "Re-run Full Analysis".

- [ ] **Step 3: Commit**

```bash
git add src/components/lead-detail/AINotesSection.jsx
git commit -m "feat: rename AI analysis buttons to Full AI Analysis for clarity"
```

---

## Verification Checklist (End-to-End)

- [ ] Open any lead → Financials card is the **first** card visible without scrolling.
- [ ] MAO value is displayed large (2xl), bold, in accent color.
- [ ] If `deal_analysis` exists → verdict badge pill visible to the right of MAO.
- [ ] Verdict badge is green for "MAKE OFFER", amber for "NEGOTIATE"/"LONG SHOT", grey for "WATCH", red for "DEAD LEAD".
- [ ] Clicking MAO opens the inline edit field; saving updates `lead.mao` as before.
- [ ] ARV and Reno Cost remain below in their 2-column grid, fully editable.
- [ ] ℹ tooltip on MAO label shows: "MAO auto-calculates as 75% × ARV − Renovation. Edit to override."
- [ ] Financials button reads "✦ Quick Check" (no analysis) or "↺ Re-check" (has analysis).
- [ ] AI Notes section button reads "✦ Full AI Analysis" (no notes) or "↻ Re-run Full Analysis" (has notes).
- [ ] All other sections (PropertyInfo, Notes, Contact, etc.) still work normally below Financials.
- [ ] No console errors. No broken layouts on mobile-width.
