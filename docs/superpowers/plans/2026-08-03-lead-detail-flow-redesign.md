# Lead Detail Deal-Flow Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the two overlapping AI-analysis systems on the Lead Detail page (Quick Check + Full AI Analysis) into one engine with a single staleness check and one reusable renovation-tier picker, and add a flow stepper (Property → Renovation → Analysis → Decision) so the deal-evaluation flow is visually obvious.

**Architecture:** Pure frontend reorganization on top of existing Netlify functions (`analyze-deal`, `generate-comps`, `generate-core-analysis`, `generate-negotiation-plan`, `generate-communications`) — no backend or schema changes. Three small new shared units (`useDealStaleness` hook, `RenoTierPicker`, `LeadFlowStepper`) get built and verified first in isolation, then a new `DealAnalysisCard` absorbs the generation logic currently duplicated across `AINotesSection.jsx` and `DealAnalysisPanel.jsx`, then `FinancialSection.jsx` and `LeadDetailPage.jsx` get slimmed/reordered around it.

**Tech Stack:** React 18 (function components + hooks), Vite, Tailwind utility classes + CSS custom properties for theming (`var(--color-*)`), Supabase JS client, Netlify Functions (unchanged).

## Global Constraints

- No new Netlify functions, no new DB columns/migrations — reuse existing calls exactly as they are invoked today.
- No changes to `ReportSection.jsx`, `ActionZone.jsx` playbook logic, `NotesSection.jsx`, `ContactInfoSection.jsx`, `ListingAgentCard.jsx`, `ActivityTimeline`, `CommentBox`, `AttachmentsSection`, Screener page, or Project Detail page.
- No automated test suite exists for these components (no `*.test.jsx` under `src/components/lead-detail/`) — every task's verification is manual: run `npm run build` (must succeed) plus a described manual check via the browser against the dev server (`npm run dev`).
- Every step that touches money math must keep the exact existing formulas (75% ARV − reno − $2,450 for MAO; the flip/BRRRR breakdown formulas in `DealAnalysisPanel.jsx` lines 6-43) — this is a UI reorg, not a recalculation change.
- Follow existing style conventions in the touched files: Tailwind classes with `[color:var(--color-*)]` bracket syntax, no new CSS files, no new dependencies.

---

### Task 1: `useDealStaleness` shared hook

**Files:**
- Create: `src/hooks/useDealStaleness.js`

**Interfaces:**
- Consumes: a `lead` object with fields `arv`, `renovation_cost`, `deal_analysis` (shape: `{ strategy, inputs: { arv, renovation_cost, strategy } }`).
- Produces: `useDealStaleness(lead)` → `{ stale: boolean, reasons: string[] }`, imported by `LeadFlowStepper` (Task 3) and `DealAnalysisCard` (Task 4).

- [ ] **Step 1: Write the hook**

```js
// src/hooks/useDealStaleness.js

/**
 * Single source of truth for "does the AI analysis need re-running".
 * Compares the lead's live ARV / renovation cost / strategy against the
 * values that were actually used to produce lead.deal_analysis.
 */
export function useDealStaleness(lead) {
  const inp = lead?.deal_analysis?.inputs
  if (!inp) return { stale: false, reasons: [] }

  const reasons = []

  if (Number(lead.arv || 0) !== Number(inp.arv || 0)) {
    reasons.push('ARV changed')
  }

  const curReno = lead.renovation_cost != null ? Number(lead.renovation_cost) : null
  const renoMatch = curReno === inp.renovation_cost || (curReno == null && inp.renovation_cost == null)
  if (!renoMatch) {
    reasons.push('Renovation cost changed')
  }

  const curStrategy = lead.deal_analysis?.strategy || 'flip'
  const inpStrategy = inp.strategy || 'flip'
  if (curStrategy !== inpStrategy) {
    reasons.push('Strategy changed')
  }

  return { stale: reasons.length > 0, reasons }
}
```

- [ ] **Step 2: Verify with a scratch check**

Run: `node -e "
const { useDealStaleness } = require('./src/hooks/useDealStaleness.js')
" 2>&1 || true`

This file uses ESM `export`, so a plain `node -e` require will fail with `Cannot use import statement` — that's expected and fine; the real verification is that `npm run build` (done at the end of Task 4, once something imports this hook) compiles without errors. For now just re-read the file and confirm: (a) no stray syntax errors by eye, (b) the three comparisons match the spec's staleness definition exactly (ARV, reno, strategy).

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useDealStaleness.js
git commit -m "feat: add useDealStaleness hook, single source of truth for AI-analysis staleness"
```

---

### Task 2: `RenoTierPicker` shared popover component

**Files:**
- Create: `src/components/lead-detail/RenoTierPicker.jsx`
- Modify: `src/components/lead-detail/FinancialSection.jsx` (wire in as first consumer, remove its private copy of the picker)

**Interfaces:**
- Consumes: `suggestRenoTier(lead)` from `src/lib/renoTierSuggest.js` (already exists, returns `{ tier: 'cosmetic'|'medium'|'heavy', reason: string }`).
- Produces: `<RenoTierPicker lead={lead} open={bool} onClose={fn} onApply={(renoCost: number) => void} />`, imported by `FinancialSection.jsx` (this task) and `DealAnalysisCard.jsx` (Task 4).

- [ ] **Step 1: Create the component**

Extract the tier-picker UI currently duplicated in `FinancialSection.jsx` (lines 329-418) and `AINotesSection.jsx` (lines 558-627) into one reusable popover:

```jsx
// src/components/lead-detail/RenoTierPicker.jsx
import { useState, useEffect } from 'react'
import { suggestRenoTier } from '../../lib/renoTierSuggest'

const RENO_RATES = { cosmetic: 12, medium: 22, heavy: 38 }

const TIERS = [
  { key: 'cosmetic', label: 'Cosmetic', desc: 'Paint, floors, fixtures, kitchen/bath refresh',          rate: RENO_RATES.cosmetic },
  { key: 'medium',   label: 'Medium',   desc: 'Cosmetic + 1 major (roof, HVAC, electric, or plumbing)', rate: RENO_RATES.medium },
  { key: 'heavy',    label: 'Heavy',    desc: 'Cosmetic + 2+ majors / gut rehab',                        rate: RENO_RATES.heavy },
]

const fmt = n => `$${Math.round(n).toLocaleString()}`

export default function RenoTierPicker({ lead, open, onClose, onApply }) {
  const [selectedTier, setSelectedTier] = useState(null)
  const [sqft, setSqft] = useState(String(lead.sqft || ''))
  const [suggestion, setSuggestion] = useState(null)

  useEffect(() => {
    if (!open) return
    const s = suggestRenoTier(lead)
    setSuggestion(s)
    setSelectedTier(s.tier)
    setSqft(String(lead.sqft || ''))
  }, [open, lead])

  if (!open) return null

  const parsedSqft = parseInt(sqft, 10) || null
  const estFor = t => parsedSqft
    ? fmt(Math.round(parsedSqft * t.rate / 1000) * 1000)
    : `~${fmt(1200 * t.rate)}–${fmt(1800 * t.rate)}`
  const selectedEst = selectedTier ? estFor(TIERS.find(t => t.key === selectedTier)) : null

  const apply = () => {
    if (!selectedTier) return
    const s = parseInt(sqft, 10) || 1200
    const reno = Math.round(s * RENO_RATES[selectedTier] / 1000) * 1000
    onApply(reno)
  }

  return (
    <div className="mt-2 rounded-lg border border-[color:var(--color-warn)] bg-[color:var(--color-warn-soft)] p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold text-[color:var(--color-warn-text)]">🔨 Pick a renovation scope</span>
        <button onClick={onClose} className="text-[color:var(--color-warn-text)] opacity-60 hover:opacity-100 text-lg leading-none">×</button>
      </div>

      {suggestion && (
        <div className="flex items-start gap-1.5 bg-black/20 rounded px-2.5 py-1.5">
          <span className="text-[10px] text-[color:var(--color-warn-text)] opacity-70 mt-0.5">🤖</span>
          <span className="text-[11px] text-[color:var(--color-warn-text)] opacity-80 leading-snug">
            <strong>Suggested: {suggestion.tier.charAt(0).toUpperCase() + suggestion.tier.slice(1)}</strong>
            {' — '}{suggestion.reason}
          </span>
        </div>
      )}

      {!lead.sqft && (
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[color:var(--color-warn-text)]">Property sqft (optional):</span>
          <input
            type="number"
            value={sqft}
            onChange={e => setSqft(e.target.value)}
            placeholder="e.g. 1400"
            className="w-24 h-7 px-2 text-[12px] bg-white/60 border border-[color:var(--color-warn)] rounded text-[color:var(--color-warn-text)] focus:outline-none"
          />
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        {TIERS.map(t => (
          <button
            key={t.key}
            onClick={() => setSelectedTier(t.key)}
            className={`flex flex-col items-start gap-0.5 rounded-lg border-2 px-3 py-2 text-left transition-all ${
              selectedTier === t.key
                ? 'border-[color:var(--color-warn)] bg-[color:var(--color-warn)]/20'
                : 'border-[color:var(--color-warn)]/40 bg-white/40 hover:border-[color:var(--color-warn)]/70'
            }`}
          >
            <div className="flex items-center gap-1.5 w-full">
              <span className="text-[12px] font-bold text-[color:var(--color-warn-text)]">{t.label}</span>
              {suggestion?.tier === t.key && (
                <span className="text-[8.5px] font-bold uppercase tracking-wide px-1 py-0.5 rounded bg-[color:var(--color-warn)] text-white leading-none">AI pick</span>
              )}
            </div>
            <span className="text-[11px] font-semibold text-[color:var(--color-warn-text)]">{estFor(t)}</span>
            <span className="text-[9.5px] text-[color:var(--color-warn-text)] opacity-70 leading-tight">{t.desc}</span>
            <span className="text-[9px] text-[color:var(--color-warn-text)] opacity-50 mt-0.5">${t.rate}/sqft · Jacksonville avg</span>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 pt-1 flex-wrap">
        <button
          onClick={apply}
          disabled={!selectedTier}
          className="px-3 py-1.5 text-[12px] font-semibold rounded-md bg-[color:var(--color-warn)] text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {selectedTier ? `Use ${selectedEst}` : 'Select a scope above'}
        </button>
        <button
          onClick={onClose}
          className="text-[11.5px] text-[color:var(--color-warn-text)] underline underline-offset-2 hover:opacity-70"
        >
          Cancel — enter exact cost instead
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire it into `FinancialSection.jsx`**

In `src/components/lead-detail/FinancialSection.jsx`:

1. Add import: `import RenoTierPicker from './RenoTierPicker'`
2. Add state near the other `useState` calls: `const [showRenoPicker, setShowRenoPicker] = useState(false)`
3. In the Renovation Cost field block (around line 258-275), add a 🔨 icon button next to the `EditableField` label, always visible when `canEdit`:

```jsx
<div className={`rounded-lg border px-3 py-2.5 ${renoMissing && canEdit ? 'border-dashed border-2 border-[color:var(--color-warn)] bg-[color:var(--color-warn-soft)]' : 'border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)]'}`}>
  <div className="flex items-center justify-between gap-1">
    <EditableField
      label="Renovation Cost"
      type="currency"
      value={lead.renovation_cost}
      formatter={formatCurrency}
      onSave={(v) => {
        const newMao = lead.arv ? Math.round(Number(lead.arv) * 0.75 - Number(v || 0) - 2450) : null
        update({ renovation_cost: v, ...(newMao ? { mao: newMao } : {}) })
      }}
      disabled={!canEdit}
    />
    {canEdit && (
      <button
        onClick={() => setShowRenoPicker(true)}
        title="Pick a renovation scope (AI-suggested tier)"
        className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-[13px] hover:bg-[color:var(--color-bg)] transition-colors"
      >
        🔨
      </button>
    )}
  </div>
  {renoMissing && canEdit && (
    <p className="text-[10px] text-[color:var(--color-warn-text)] mt-1 leading-tight">
      ⚠ Enter before running analysis
    </p>
  )}
  <RenoTierPicker
    lead={lead}
    open={showRenoPicker}
    onClose={() => setShowRenoPicker(false)}
    onApply={(reno) => {
      const newMao = lead.arv ? Math.round(Number(lead.arv) * 0.75 - reno - 2450) : null
      update({ renovation_cost: reno, ...(newMao ? { mao: newMao } : {}) })
      setShowRenoPicker(false)
    }}
  />
</div>
```

Leave the rest of `FinancialSection.jsx` untouched for now — the Quick Check button, its own tier-picker block (lines 329-418), and `isStale` banner get removed in Task 5 once `DealAnalysisCard` exists to replace them. This task only proves `RenoTierPicker` works standalone.

- [ ] **Step 3: Manual verification**

Run: `npm run build` — must succeed with no errors.

Then run `npm run dev`, open any lead with a `renovation_cost` already set, click the new 🔨 icon next to Renovation Cost, and confirm: the picker opens pre-selected to an AI-suggested tier (not blank), selecting a different tier and clicking "Use $X" updates the Renovation Cost field and closes the picker. Also test on a lead with no `renovation_cost` set — confirm the picker still opens via the icon.

- [ ] **Step 4: Commit**

```bash
git add src/components/lead-detail/RenoTierPicker.jsx src/components/lead-detail/FinancialSection.jsx
git commit -m "feat: extract shared RenoTierPicker, add always-visible reno-scope icon to Financials"
```

---

### Task 3: `LeadFlowStepper` component

**Files:**
- Create: `src/components/lead-detail/LeadFlowStepper.jsx`

**Interfaces:**
- Consumes: `lead` object, `useDealStaleness(lead)` from Task 1.
- Produces: `<LeadFlowStepper lead={lead} />`, rendered by `LeadDetailPage.jsx` in Task 7. Renders 4 buttons that scroll to `#step-property`, `#step-renovation`, `#step-analysis`, `#step-decision` (anchors added to the page in Task 7 — this component only needs the ids to exist somewhere on the page, which Task 7 guarantees before this component is wired in).

- [ ] **Step 1: Write the component**

```jsx
// src/components/lead-detail/LeadFlowStepper.jsx
import { useDealStaleness } from '../../hooks/useDealStaleness'

const STEPS = [
  { id: 'step-property',   label: 'Property' },
  { id: 'step-renovation', label: 'Renovation' },
  { id: 'step-analysis',   label: 'Analysis' },
  { id: 'step-decision',   label: 'Decision' },
]

function stepStatus(lead, staleness, idx) {
  const hasProperty   = !!(lead.address && lead.asking_price)
  const hasReno       = lead.renovation_cost != null
  const hasAnalysis   = !!lead.deal_analysis

  if (idx === 0) return hasProperty ? 'done' : 'current'
  if (idx === 1) return hasReno ? 'done' : hasProperty ? 'current' : 'upcoming'
  if (idx === 2) {
    if (!hasAnalysis) return hasReno ? 'current' : 'upcoming'
    return staleness.stale ? 'stale' : 'done'
  }
  if (idx === 3) return hasAnalysis ? 'current' : 'upcoming'
  return 'upcoming'
}

const STATUS_STYLE = {
  upcoming: { circle: 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-dim)] border-[color:var(--color-line)]', label: 'text-[color:var(--color-text-dim)]' },
  current:  { circle: 'bg-[color:var(--color-accent)] text-white border-[color:var(--color-accent)]', label: 'text-[color:var(--color-text)] font-semibold' },
  done:     { circle: 'bg-[color:var(--color-success)] text-white border-[color:var(--color-success)]', label: 'text-[color:var(--color-text-muted)]' },
  stale:    { circle: 'bg-[color:var(--color-warn)] text-white border-[color:var(--color-warn)]', label: 'text-[color:var(--color-warn-text)] font-semibold' },
}

function scrollToStep(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export default function LeadFlowStepper({ lead }) {
  const staleness = useDealStaleness(lead)

  return (
    <div className="flex items-center gap-1 px-3 py-2 rounded-lg border border-[color:var(--color-line)] bg-[color:var(--color-bg-elev-2)] overflow-x-auto">
      {STEPS.map((step, idx) => {
        const status = stepStatus(lead, staleness, idx)
        const style = STATUS_STYLE[status]
        return (
          <div key={step.id} className="flex items-center gap-1 shrink-0">
            {idx > 0 && <div className="w-4 h-px bg-[color:var(--color-line)] mx-1" />}
            <button
              onClick={() => scrollToStep(step.id)}
              title={status === 'stale' ? `${step.label} — outdated: ${staleness.reasons.join(', ')}` : step.label}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-[color:var(--color-bg)] transition-colors"
            >
              <span className={`flex items-center justify-center w-5 h-5 rounded-full border text-[10px] font-bold ${style.circle}`}>
                {status === 'done' ? '✓' : status === 'stale' ? '!' : idx + 1}
              </span>
              <span className={`text-[11.5px] ${style.label}`}>{step.label}</span>
            </button>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Manual verification (standalone, before wiring into the page)**

Since `LeadFlowStepper` reads `#step-*` ids that don't exist yet (added in Task 7), verify it in isolation first: temporarily add `<LeadFlowStepper lead={lead} />` right after `<MlsStatusBanner .../>` in `LeadDetailPage.jsx`, run `npm run dev`, open a lead, and confirm:
- A lead with no `renovation_cost` and no `deal_analysis` shows step 1 done (green ✓) if it has address+asking price, step 2 as the accent "current" circle, steps 3/4 dim.
- A lead with `deal_analysis` set shows step 3 as green ✓.
- Clicking a step button doesn't throw (scrolling silently no-ops since the anchors don't exist yet — that's expected at this point).

Leave this temporary wiring in place — Task 7 will move it to its permanent position and add the anchor ids it needs.

- [ ] **Step 3: Commit**

```bash
git add src/components/lead-detail/LeadFlowStepper.jsx src/pages/LeadDetailPage.jsx
git commit -m "feat: add LeadFlowStepper component (temporarily wired for standalone verification)"
```

---

### Task 4: `DealAnalysisCard` — merged analysis engine

This is the largest task. It creates one component that absorbs: the generation pipeline from `AINotesSection.jsx`, the verdict/score summary + flip/BRRRR breakdown math from `DealAnalysisPanel.jsx`, and adds the Full Breakdown / Ask AI tabs. Split into sub-steps so each is independently checkable.

**Files:**
- Create: `src/components/lead-detail/DealAnalysisCard.jsx`
- Read (for verbatim extraction, do not modify yet): `src/components/lead-detail/AINotesSection.jsx`, `src/components/lead-detail/DealAnalysisPanel.jsx`

**Interfaces:**
- Consumes: `useDealStaleness` (Task 1), `RenoTierPicker` (Task 2), existing `NotesRenderer` (`src/components/lead-detail/NotesRenderer.jsx`, unchanged — accepts `{ notes, extraTabs, missingFields, lead, onGenerateScripts, generatingScripts, onRefreshComps, refreshingComps }`), existing `DealQA` (`src/components/lead-detail/DealQA.jsx`, unchanged), existing `suggestRenoTier` (`src/lib/renoTierSuggest.js`), existing `useLeadUpdate` hook, existing `logDealAnalysis` (`src/lib/activityLogger.js`).
- Produces: `<DealAnalysisCard lead={lead} userId={userId} canEdit={canEdit} onUpdated={(updatedLead) => void} />`, imported by `LeadDetailPage.jsx` in Task 7 (replacing `<AINotesSection>` and the `<DealAnalysisPanel>` render inside `FinancialSection`).

- [ ] **Step 1: Scaffold the file with imports and state, copying generation logic verbatim**

Create `src/components/lead-detail/DealAnalysisCard.jsx`. Copy these functions **verbatim, unchanged**, from `src/components/lead-detail/AINotesSection.jsx`:
- `parseAiMao` (lines 9-13)
- `parseAiStartingOffer` (lines 15-19)
- `fetchLeadContext` (lines 22-37)
- `callFn` (lines 40-51)
- `callFnFull` (lines 54-65)

And copy these functions **verbatim, unchanged**, from `src/components/lead-detail/DealAnalysisPanel.jsx`:
- `computeFlipBreakdown` (lines 7-21)
- `computeBrrrrBreakdown` (lines 23-43)

Then build the component shell:

```jsx
// src/components/lead-detail/DealAnalysisCard.jsx
import { useState, useEffect, useRef } from 'react'
import Card from '../ui/Card'
import NotesRenderer from './NotesRenderer'
import DealQA from './DealQA'
import RenoTierPicker from './RenoTierPicker'
import { supabase } from '../../lib/supabase'
import { suggestRenoTier } from '../../lib/renoTierSuggest'
import { formatCurrency } from '../../lib/calculations'
import { logDealAnalysis } from '../../lib/activityLogger'
import { useDealStaleness } from '../../hooks/useDealStaleness'

// [paste parseAiMao, parseAiStartingOffer, fetchLeadContext, callFn, callFnFull here — verbatim from AINotesSection.jsx]

// [paste computeFlipBreakdown, computeBrrrrBreakdown here — verbatim from DealAnalysisPanel.jsx]

const fc = formatCurrency
const pct = n => n != null ? `${n.toFixed(1)}%` : '—'

export default function DealAnalysisCard({ lead, userId, canEdit, onUpdated }) {
  const staleness = useDealStaleness(lead)

  const [strategy,    setStrategy]    = useState(lead.deal_analysis?.strategy || 'flip')
  const [monthlyRent, setMonthlyRent] = useState(lead.rent_estimate || lead.monthly_rent || '')
  const [localNotes,  setLocalNotes]  = useState(lead.ai_notes || '')
  const [generating,  setGenerating]  = useState(false)
  const [phase,       setPhase]       = useState(null)
  const [genError,    setGenError]    = useState(null)
  const [confirm,     setConfirm]     = useState(false)
  const [showRenoPicker, setShowRenoPicker] = useState(false)
  const [generatingScripts, setGeneratingScripts] = useState(false)
  const [competitiveMode, setCompetitiveMode] = useState(false)
  const [aiCompsArv, setAiCompsArv] = useState(null)
  const [lastArv,  setLastArv]  = useState(lead.arv ? Number(lead.arv) : null)
  const [lastReno, setLastReno] = useState(lead.renovation_cost ? Number(lead.renovation_cost) : null)
  const [refreshingComps, setRefreshingComps] = useState(false)
  const cancelledRef = useRef(false)

  useEffect(() => { setLocalNotes(lead.ai_notes || '') }, [lead.ai_notes])

  const hasAnalysis = !!lead.deal_analysis
  const renoMissing = lead.renovation_cost == null

  return (
    <Card title="Deal Analysis" subtitle="Comps, negotiation plan, verdict, and scripts — all from one run">
      {/* filled in by remaining steps */}
    </Card>
  )
}
```

- [ ] **Step 2: Run a build check to confirm the scaffold compiles**

Run: `npm run build`
Expected: succeeds (the file isn't imported anywhere yet, so this only checks for syntax errors — Vite still type-checks/parses every file under `src/`; if it doesn't, add a temporary `import DealAnalysisCard from '../components/lead-detail/DealAnalysisCard'` + `<DealAnalysisCard lead={lead} userId={user.id} canEdit={canEdit} onUpdated={setLead} />` at the bottom of `LeadDetailPage.jsx`'s returned JSX to force Vite to include it in the build, then remove that temporary wiring once Task 7 does it for real).

- [ ] **Step 3: Add the strategy/rent controls and the "Run Analysis" trigger**

Add inside the `Card`, before any results:

```jsx
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-[color:var(--color-line)] mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg border border-[color:var(--color-line)] overflow-hidden text-[11px] font-bold">
            {['flip', 'brrrr'].map(s => (
              <button
                key={s}
                onClick={() => {
                  if (s === strategy) return
                  setStrategy(s)
                  if (hasAnalysis) runGenerate(false, s)
                }}
                disabled={generating}
                className={`px-3 py-1.5 transition-colors uppercase tracking-wide ${
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
              <span className="text-[11px] text-[color:var(--color-text-dim)]">Rent</span>
              <input
                type="number"
                value={monthlyRent}
                onChange={e => setMonthlyRent(e.target.value)}
                placeholder="2000"
                className="w-20 h-7 px-2 text-[12px] bg-[color:var(--color-bg)] border border-[color:var(--color-line)] rounded-lg text-[color:var(--color-text)] focus:outline-none focus:border-[color:var(--color-accent)]"
              />
              <span className="text-[11px] text-[color:var(--color-text-dim)]">/mo</span>
            </div>
          )}
        </div>

        {canEdit && (
          generating ? (
            <span className="flex items-center gap-1 text-[12px] text-[color:var(--color-accent-text)]">
              <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
              </svg>
              {phase === 'analysis' ? 'Analyzing…' : phase === 'negotiation' ? 'Building negotiation plan…' : 'Working…'}
              <button onClick={cancelGenerate} className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-dim)] hover:text-[color:var(--color-text)] transition-colors">Cancel</button>
            </span>
          ) : (
            <button
              onClick={() => handleRun(false)}
              className="text-[12px] font-semibold px-3 py-1.5 rounded-lg bg-[color:var(--color-accent)] text-white hover:opacity-90 transition-opacity"
            >
              {hasAnalysis ? '↺ Re-run Analysis' : '✦ Run Analysis'}
            </button>
          )
        )}
      </div>

      {renoMissing && showRenoPicker && (
        <RenoTierPicker
          lead={lead}
          open={showRenoPicker}
          onClose={() => setShowRenoPicker(false)}
          onApply={(reno) => {
            setShowRenoPicker(false)
            onUpdated?.({ ...lead, renovation_cost: reno })
            supabase.from('leads').update({ renovation_cost: reno }).eq('id', lead.id).then(() => runGenerate(false, strategy, reno))
          }}
        />
      )}

      {staleness.stale && hasAnalysis && !generating && (
        <div className="mb-3 flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-[color:var(--color-warn)] bg-[color:var(--color-warn-soft)]">
          <span className="text-[11.5px] font-semibold text-[color:var(--color-warn-text)]">⚠ {staleness.reasons.join(', ')} — results may be outdated.</span>
          <button onClick={() => handleRun(false)} className="shrink-0 h-7 px-3 rounded text-[11.5px] font-semibold bg-[color:var(--color-warn)] text-white hover:opacity-90 transition-opacity">
            Re-run now
          </button>
        </div>
      )}

      {genError && <p className="mb-3 text-[11.5px] text-[color:var(--color-danger-text)]">⚠ {genError}</p>}
```

Add the two handler functions referenced above (`handleRun` gates on missing reno cost, matching the merged "one renovation-missing gate" from the spec):

```jsx
  function handleRun(forceRefreshComps) {
    if (renoMissing) { setShowRenoPicker(true); return }
    if (localNotes && !forceRefreshComps) { setConfirm(true); return }
    runGenerate(forceRefreshComps, strategy)
  }

  function cancelGenerate() {
    cancelledRef.current = true
    setGenerating(false)
    setPhase(null)
    setGenError(null)
  }
```

- [ ] **Step 4: Copy `runGenerate` verbatim, adapted for the merged strategy param**

Copy `AINotesSection.jsx`'s `runGenerate` (lines 130-240) into `DealAnalysisCard.jsx` as-is, with two mechanical adaptations:
1. Rename its signature from `runGenerate = async (forceRefreshComps = false) =>` to `runGenerate = async (forceRefreshComps = false, strategyOverride = null, renoOverride = null) =>` so the strategy-switch and reno-picker call sites from Step 3 work.
2. Inside the function, wherever it reads `lead.renovation_cost` for the `leadWithArv`/`renoVal` computation, use `renoOverride ?? renoVal ?? lead.renovation_cost` instead — this is the same pattern `FinancialSection.runAnalyze` used for its own reno override, now folded into the one merged function.
3. After the existing `onUpdated?.(...)` call at the end of the try block, add one more call to `analyze-deal` to populate the verdict/score/profit fields that `DealAnalysisPanel` used to fetch separately:

```jsx
      // Verdict/score/profit — same analyze-deal call FinancialSection.runAnalyze used to make
      const activeStrategy = strategyOverride ?? strategy
      const effectiveReno = renoOverride ?? lead.renovation_cost ?? 0
      const freshMao = finalArv
        ? Math.round(Number(finalArv) * 0.75 - Number(effectiveReno) - 2450)
        : finalMao
      const verdictRes = await fetch('/.netlify/functions/analyze-deal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_id: lead.id,
          address: [lead.address, lead.city, lead.state].filter(Boolean).join(', '),
          purchase_price: freshMao ?? lead.mao ?? lead.asking_price,
          arv: finalArv ?? lead.arv,
          renovation_cost: effectiveReno || null,
          monthly_rent: activeStrategy === 'brrrr' ? (parseFloat(monthlyRent) || null) : null,
          strategy: activeStrategy,
          reno_was_estimated: false,
        }),
      })
      const verdictData = await verdictRes.json()
      if (verdictRes.ok && verdictData.ok) {
        await logDealAnalysis(lead.id, userId, verdictData.analysis)
        onUpdated?.({ ...lead, ...dbUpdate, deal_analysis: verdictData.analysis, ai_notes: fullNotes })
      }
```

Place this block right after the existing `onUpdated?.({ ...lead, ...dbUpdate, deal_analysis: updatedDealAnalysis, ... })` call and before the `generateScripts(fullNotes)` line, so the final `onUpdated` call (with the real verdict) supersedes the earlier one — same "last write wins" pattern already used elsewhere in this file for `starting_offer`.

- [ ] **Step 5: Copy `reRunWithOverrides`, `updateNegoPlan`, `generateScripts`, `refreshCompsOnly` verbatim**

Copy these four functions from `AINotesSection.jsx` into `DealAnalysisCard.jsx` completely unchanged (lines 250-272, 302-378, 381-415, 417-444 respectively). They reference `lead`, `localNotes`, `lastArv`, `lastReno`, `competitiveMode`, `monthlyRent`, `strategy`, `userId`, `onUpdated`, `cancelledRef` — all already present in the Step 1 scaffold's state. No behavior changes.

Note: `reRunWithOverrides` was previously triggered by a visible "Override Inputs" row (ARV/DOM/Rent/Price Drop/Seller Notes text inputs) inside `AINotesSection`. Per the spec, ARV and Reno no longer have a duplicate edit surface inside this card — but DOM, Rent, Price Drop %, and Seller Notes overrides aren't duplicates (they don't exist elsewhere), so keep that override-inputs UI block from `AINotesSection.jsx` (lines 629-717) verbatim too, just delete the "From Financials" read-only ARV/Reno display sub-block (lines 636-647) since the summary strip (Step 6) already shows those values.

- [ ] **Step 6: Add the summary strip**

This replaces `DealAnalysisPanel`'s verdict/score hero. Add near the top of the returned JSX, right after the strategy/run-button row, shown only `{hasAnalysis && ...}`:

```jsx
      {hasAnalysis && (() => {
        const a = lead.deal_analysis
        const theme = a.score >= 70
          ? { bg: 'var(--color-success-soft)', border: 'var(--color-success)', text: 'var(--color-success-text)' }
          : a.score >= 45
          ? { bg: 'var(--color-warn-soft)', border: 'var(--color-warn)', text: 'var(--color-warn-text)' }
          : { bg: 'var(--color-danger-soft)', border: 'var(--color-danger)', text: 'var(--color-danger-text)' }
        return (
          <div className="mb-3 rounded-lg border overflow-hidden" style={{ borderColor: theme.border, background: theme.bg }}>
            <div className="grid grid-cols-2 sm:grid-cols-5 divide-x" style={{ borderColor: theme.border }}>
              <div className="px-3 py-2">
                <div className="text-[9px] uppercase tracking-widest opacity-70" style={{ color: theme.text }}>Verdict</div>
                <div className="text-[14px] font-bold" style={{ color: theme.text }}>{a.verdict || '—'}</div>
              </div>
              <div className="px-3 py-2">
                <div className="text-[9px] uppercase tracking-widest opacity-70" style={{ color: theme.text }}>Score</div>
                <div className="text-[14px] font-bold" style={{ color: theme.text }}>{a.score ?? '—'}</div>
              </div>
              <div className="px-3 py-2">
                <div className="text-[9px] uppercase tracking-widest opacity-70" style={{ color: theme.text }}>MAO</div>
                <div className="text-[14px] font-bold" style={{ color: theme.text }}>{lead.mao ? fc(lead.mao) : '—'}</div>
              </div>
              <div className="px-3 py-2">
                <div className="text-[9px] uppercase tracking-widest opacity-70" style={{ color: theme.text }}>Starting Offer</div>
                <div className="text-[14px] font-bold" style={{ color: theme.text }}>{lead.starting_offer ? fc(lead.starting_offer) : '—'}</div>
              </div>
              <div className="px-3 py-2">
                <div className="text-[9px] uppercase tracking-widest opacity-70" style={{ color: theme.text }}>Profit</div>
                <div className="text-[14px] font-bold" style={{ color: theme.text }}>{a.profit != null ? fc(a.profit) : '—'}</div>
              </div>
            </div>
          </div>
        )
      })()}
```

- [ ] **Step 7: Add the tabbed results — Comps/Strategy (via existing `NotesRenderer`) + Full Breakdown + Ask AI**

`NotesRenderer` already parses `localNotes` into Summary/Comps/Strategy tabs (see `TABS` const, `src/components/lead-detail/NotesRenderer.jsx` lines 2134-2138) — no changes needed there. Add two `extraTabs`: `Full Breakdown` (moves `DealAnalysisPanel`'s `BreakdownModal` body from a popup into an inline tab) and `Ask AI` (same as `AINotesSection` already did).

```jsx
      {localNotes ? (
        <NotesRenderer
          notes={localNotes}
          lead={lead}
          onGenerateScripts={generateScripts}
          generatingScripts={generatingScripts}
          onRefreshComps={canEdit ? refreshCompsOnly : null}
          refreshingComps={refreshingComps}
          missingFields={[
            !lead.arv             && 'ARV',
            !lead.renovation_cost && 'Reno Cost',
            !lead.rent_estimate   && 'Rent Estimate',
          ].filter(Boolean)}
          extraTabs={[
            {
              id: 'breakdown',
              label: 'Full Breakdown',
              icon: '🧮',
              content: <FullBreakdownTab lead={lead} strategy={strategy} monthlyRent={monthlyRent} />,
            },
            {
              id: 'askai',
              label: 'Ask AI',
              icon: '💬',
              content: <DealQA lead={lead} aiNotes={localNotes} />,
            },
          ]}
        />
      ) : generating ? (
        <p className="text-[12.5px] text-[color:var(--color-text-dim)] italic">Running analysis — this takes 30–50 seconds.</p>
      ) : (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <p className="text-[13px] text-[color:var(--color-text-dim)]">No AI analysis yet.</p>
          {canEdit && <p className="text-[12px] text-[color:var(--color-text-faint)]">Click <strong>✦ Run Analysis</strong> above.</p>}
        </div>
      )}
```

Add the `FullBreakdownTab` component in the same file, built from `DealAnalysisPanel.jsx`'s `BreakdownModal` (lines 49-216): copy its body verbatim, dropping the modal chrome (the `fixed inset-0` overlay div, the header close-button row, and the footer close button — lines 74-90 and 207-213), keeping everything from `const arv = ...` (line 52) through the closing of the `isFlip ? (<>...</>) : (<>...</>)` block (line 203), wrapped in a plain container instead of a modal:

```jsx
function FullBreakdownTab({ lead, strategy, monthlyRent }) {
  const arv  = Number(lead.arv || 0)
  const reno = Number(lead.renovation_cost ?? 0)
  const rent = Number(lead.rent_estimate || lead.monthly_rent || monthlyRent || 0)
  const formulaMao = arv ? Math.round(arv * 0.75 - reno - 2450) : null
  const pp = Number(lead.mao || formulaMao || lead.asking_price || 0)
  const isFlip = strategy !== 'brrrr'
  const f = isFlip ? computeFlipBreakdown(pp, arv, reno) : computeBrrrrBreakdown(pp, arv, reno, rent)

  const Row = ({ label, value, bold, positive, separator, indent }) => (
    separator
      ? <div className="border-t border-[color:var(--color-line)] my-1" />
      : <div className={`flex items-center justify-between py-1 ${indent ? 'pl-4' : ''}`}>
          <span className={`text-[12px] ${bold ? 'font-bold text-[color:var(--color-text)]' : 'text-[color:var(--color-text-muted)]'}`}>{label}</span>
          <span className={`text-[12px] font-semibold tabular-nums ${bold ? 'text-[color:var(--color-text)]' : ''} ${positive === true ? 'text-[color:var(--color-success-text)]' : positive === false ? 'text-[color:var(--color-danger-text)]' : 'text-[color:var(--color-text)]'}`}>
            {value}
          </span>
        </div>
  )

  return (
    <div className="space-y-4">
      <div className="text-[11px] text-[color:var(--color-text-dim)]">
        Purchase {fc(pp)} · ARV {fc(arv)} · Reno {fc(reno)}{!isFlip && rent ? ` · Rent ${fc(rent)}/mo` : ''}
      </div>
      {/* paste the isFlip ? (<>...</>) : (<>...</>)  block from DealAnalysisPanel.jsx lines 115-203 verbatim, using the Row/fc/pct/f/arv/reno/pp helpers already in scope above */}
    </div>
  )
}
```

- [ ] **Step 8: Run the build**

Run: `npm run build`
Expected: succeeds with no errors. Fix any leftover references to removed variables/imports (e.g. if a copied block still references a `showEstimator`/`pickerTier` state name from the source files that wasn't part of this component's Step 1 state list, rename it to match Step 1's naming or add the missing `useState`).

- [ ] **Step 9: Manual verification**

`npm run dev`, open a lead with `arv`/`renovation_cost` already set, temporarily render `<DealAnalysisCard lead={lead} userId={user.id} canEdit={canEdit} onUpdated={setLead} />` somewhere in `LeadDetailPage.jsx` (permanent wiring happens in Task 7), and confirm:
- Clicking "Run Analysis" runs the full pipeline (same ~30-50s wait as today) and afterward shows the summary strip (Verdict/Score/MAO/Starting Offer/Profit) plus tabs including Comps, Strategy, Full Breakdown, Ask AI.
- Switching Flip → BRRRR re-runs and updates the summary strip.
- Editing `renovation_cost` elsewhere (e.g. via `FinancialSection`) then reloading the page shows the stale banner with the correct reason text.
- The Full Breakdown tab shows the same numbers the old `DealAnalysisPanel` modal used to show for the same lead (spot-check one flip and one BRRRR lead).

- [ ] **Step 10: Commit**

```bash
git add src/components/lead-detail/DealAnalysisCard.jsx
git commit -m "feat: add DealAnalysisCard, merging Quick Check and Full AI Analysis into one engine"
```

---

### Task 5: Slim `FinancialSection.jsx`

**Files:**
- Modify: `src/components/lead-detail/FinancialSection.jsx`

**Interfaces:**
- Consumes: nothing new (all consumed interfaces — `RenoTierPicker`, `useLeadUpdate`, `EditableField`, `calculateMAO`, `formatCurrency` — already in use).
- Produces: same `<FinancialSection lead userId members canEdit onUpdated />` signature, now only rendering the price-flow strip + ARV/Reno editable fields (no change to the props other components pass it).

- [ ] **Step 1: Remove the Quick Check engine and its private picker**

In `src/components/lead-detail/FinancialSection.jsx`, delete:
- The `strategy`, `monthlyRent`, `analyzing`, `analyzeError`, `showEstimator`, `selectedTier`, `pickerSqft`, `suggestedTier` state (lines 19-28) — all superseded by `DealAnalysisCard`.
- `RENO_RATES` const (line 30) — now lives in `RenoTierPicker.jsx`.
- `isStale` computed value (lines 36-45) — superseded by `useDealStaleness`.
- `runAnalyze`, `handleAnalyze`, `useTierReno` functions (lines 47-116).
- The entire "Section 3: Analyze row" block (lines 278-326).
- The entire "Reno tier picker" JSX block (lines 329-418) — replaced by the `RenoTierPicker` wiring already added in Task 2.
- The `isStale` warning banner block (lines 420-431).
- The `analyzeError` paragraph (lines 433-435).
- The "Quick Check Result" divider + `<DealAnalysisPanel analysis={lead.deal_analysis} lead={lead} />` + `<WhatIfPanel lead={lead} />` block (lines 437-444) — `DealAnalysisCard` now shows this; `WhatIfPanel` moves to the Decision step in Task 7.
- Now-unused imports: `DealAnalysisPanel`, `WhatIfPanel`, `useLeadUpdate`'s `logDealAnalysis`/`fireLeadNotification`/`suggestRenoTier` imports if no longer referenced (double-check `suggestRenoTier` is still needed — it's used by `RenoTierPicker` internally now, not by this file directly, so remove the import here).

- [ ] **Step 2: Verify the remaining file still exports a working component**

After deletion, `FinancialSection.jsx` should contain: the `hasAnalysis`/`renoMissing`/`isPreAnalysisImport` consts (keep `hasAnalysis`/`isPreAnalysisImport` only if still referenced — `renoMissing` is still used by the reno field's warning text and `RenoTierPicker` gating from Task 2), the price-flow hero section (lines 122-241, unchanged), and the ARV/Reno grid (lines 244-276, unchanged from Task 2's edit).

Run: `npm run build`
Expected: succeeds. If it fails on an unused-but-still-imported symbol, remove that import; if it fails on a symbol used-but-now-missing (e.g. something still references `analyzing`), that block wasn't fully removed — delete it.

- [ ] **Step 3: Manual verification**

`npm run dev`, open a lead. Confirm `FinancialSection` (currently still rendering standalone, pre-Task-7-reorder) shows only the price-flow strip and the ARV/Reno fields with the 🔨 icon — no Quick Check button, no stale banner, no verdict panel underneath. (It will look incomplete on its own — that's expected until Task 7 places `DealAnalysisCard` right after it.)

- [ ] **Step 4: Commit**

```bash
git add src/components/lead-detail/FinancialSection.jsx
git commit -m "refactor: slim FinancialSection to ARV/Reno inputs only, engine moved to DealAnalysisCard"
```

---

### Task 6: Delete superseded components

**Files:**
- Delete: `src/components/lead-detail/AINotesSection.jsx`
- Delete: `src/components/lead-detail/DealAnalysisPanel.jsx`

- [ ] **Step 1: Confirm no remaining references**

Run: `grep -rn "AINotesSection\|DealAnalysisPanel" src/` (excluding the two files themselves)
Expected: no matches outside `LeadDetailPage.jsx`'s current import lines (which get removed in Task 7 — if Task 7 hasn't run yet, this grep will still show those two import lines; that's fine, just confirm no *other* file references them).

- [ ] **Step 2: Delete the files**

```bash
git rm src/components/lead-detail/AINotesSection.jsx src/components/lead-detail/DealAnalysisPanel.jsx
```

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor: remove AINotesSection and DealAnalysisPanel, superseded by DealAnalysisCard"
```

(This will leave `LeadDetailPage.jsx` temporarily broken — it still imports both deleted files. Task 7 fixes this immediately next; do not run `npm run build` as a gate between Task 6 and Task 7.)

---

### Task 7: Reorder `LeadDetailPage.jsx` around the stepper

**Files:**
- Modify: `src/pages/LeadDetailPage.jsx`

**Interfaces:**
- Consumes: `LeadFlowStepper` (Task 3), `DealAnalysisCard` (Task 4), existing `PropertyInfoSection`, `FinancialSection` (Task 5), `WhatIfPanel`, `ActionZone`, `NotesSection`, `ContactInfoSection`, `ListingAgentCard`, `ReportSection` — all unchanged signatures.

- [ ] **Step 1: Update imports**

Remove:
```js
import AINotesSection from '../components/lead-detail/AINotesSection'
```
(already removed if it was only referenced there; also remove any leftover `DealAnalysisPanel` import if `FinancialSection`'s Task 5 edit didn't already make this page's import list ⁠— it doesn't import `DealAnalysisPanel` today, only `FinancialSection` does, so no action needed here for that one.)

Add:
```js
import LeadFlowStepper from '../components/lead-detail/LeadFlowStepper'
import DealAnalysisCard from '../components/lead-detail/DealAnalysisCard'
```

Keep `WhatIfPanel` import if it's not already imported at the page level — check: today `WhatIfPanel` is only imported inside `FinancialSection.jsx`. Since Task 5 removed it from there, add it here instead:
```js
import WhatIfPanel from '../components/lead-detail/WhatIfPanel'
```

Remove the temporary `<LeadFlowStepper>` and `<DealAnalysisCard>` wiring added ad-hoc during Tasks 3/4's manual verification steps, if still present, before doing the real reorder below.

- [ ] **Step 2: Reorder the JSX**

Replace the body from `<MlsStatusBanner .../>` through the end of the `lg:col-span-2` div's Group 2 (`</div>` after `NotesSection`, i.e. current lines 151-205) with:

```jsx
        <MlsStatusBanner lead={lead} onUpdated={(updated) => setLead(updated)} paused={!!workspace?.settings?.mls_paused} />

        <LeadFlowStepper lead={lead} />

        <ActionZone
          lead={lead}
          userId={user.id}
          members={members}
          canEdit={canEdit}
          onUpdated={(updated) => { setLead(updated); setActivityRefresh(v => v + 1) }}
        />

        <LeadStatusPipeline
          lead={lead}
          members={members}
          userId={user.id}
          workspaceId={workspaceId}
          canEdit={canEdit}
          onUpdated={(updated) => { setLead(updated); setActivityRefresh(v => v + 1) }}
        />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-6">

            <div id="step-property" className="space-y-4">
              <PropertyInfoSection
                lead={lead}
                userId={user.id}
                members={members}
                canEdit={canEdit}
                onUpdated={(updated) => { setLead(updated); setActivityRefresh(v => v + 1) }}
              />
            </div>

            <div id="step-renovation" className="space-y-4">
              <FinancialSection
                lead={lead}
                userId={user.id}
                members={members}
                canEdit={canEdit}
                onUpdated={(updated) => { setLead(updated); setActivityRefresh(v => v + 1) }}
              />
            </div>

            <div id="step-analysis" className="space-y-4">
              <DealAnalysisCard
                lead={lead}
                userId={user.id}
                canEdit={canEdit}
                onUpdated={(updated) => setLead(updated)}
              />
              <NotesSection
                lead={lead}
                canEdit={canEdit}
                onUpdated={(updated) => setLead(updated)}
              />
            </div>

            <div id="step-decision" className="space-y-4">
              <WhatIfPanel lead={lead} />
            </div>
```

Leave the rest of the file (the `GroupDivider label="Contacts & Reports"` block through the end of the `lg:col-span-2` div, and the right-column sidebar) exactly as it is today — only the block above changes.

- [ ] **Step 3: Run the build**

Run: `npm run build`
Expected: succeeds with no errors and no unused-import warnings for the removed/added imports.

- [ ] **Step 4: Manual verification — full flow**

`npm run dev`, then walk the flow described in the spec's Testing section end-to-end on one lead:
1. Open a lead with no `renovation_cost` and no `deal_analysis` yet. Confirm the stepper shows step 1 (Property) done/current appropriately and steps 3/4 dim.
2. Scroll/click to Renovation, set a renovation cost via the 🔨 icon picker.
3. Click to Analysis, click "Run Analysis" — confirm it runs the full pipeline and the summary strip + tabs populate, and the stepper's step 3 turns green.
4. Go back to Renovation and change the ARV or reno cost. Confirm the stepper's step 3 flips to the amber "!" stale state, and `DealAnalysisCard` shows the matching stale banner with the right reason text.
5. Re-run analysis — confirm the stale state clears on both the stepper and the card.
6. Switch Flip → BRRRR in `DealAnalysisCard` — confirm a labeled re-run happens and the summary strip updates for BRRRR numbers.
7. Click the Decision stepper link — confirm it scrolls to `WhatIfPanel`.
8. Confirm `ReportSection`, `ContactInfoSection`, `ListingAgentCard`, and the right-hand sidebar (comments/activity/attachments) are all still present and unchanged below the reorganized flow.

- [ ] **Step 5: Commit**

```bash
git add src/pages/LeadDetailPage.jsx
git commit -m "refactor: reorder LeadDetailPage around flow stepper (Property/Renovation/Analysis/Decision)"
```

---

### Task 8: Final full-page verification and deploy check

**Files:** none (verification only)

- [ ] **Step 1: Full production build**

Run: `npm run build`
Expected: succeeds cleanly, no warnings about the deleted files still being referenced.

- [ ] **Step 2: Smoke-test the whole page one more time**

`npm run dev`, open at least two leads in different states (one brand-new with nothing filled in, one with a full existing `deal_analysis` from before this change) and confirm both render without console errors and without any leftover reference to the old "Quick Check" or duplicate stale banners.

- [ ] **Step 3: Confirm no stray dead files or imports remain**

Run: `grep -rn "AINotesSection\|DealAnalysisPanel" src/`
Expected: no matches anywhere.

- [ ] **Step 4: Final commit (if any cleanup was needed in Step 3)**

```bash
git add -A
git commit -m "chore: final cleanup pass after lead detail flow redesign"
```

(Skip this commit if Step 3 found nothing to clean up.)
