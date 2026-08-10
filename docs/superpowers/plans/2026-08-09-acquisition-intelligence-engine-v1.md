# Acquisition Intelligence Engine V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `core/acquisition-engine/` module that assembles one structured `AcquisitionDecision` object per lead (Priority, Confidence, FinancialSummary, BuyBox, RiskAssessment, MissingInformation, RecommendedActions, OfferStrategy, ReasonsToBuy, ReasonsToAvoid, FutureCapabilities), then wire it in *parallel* to the existing Screener analysis pipeline so it runs and logs its output without touching any production data, UI, or workflow.

**Architecture:** Follows the existing Sprint-1 `core/*-engine` convention (interfaces first, `../../config/*.config` relative imports, no LLM/DB calls inside `core/`). Unlike sibling engines (which are `declare`-only stubs), `acquisition-engine` also ships a minimal, clearly-labeled placeholder *implementation* — `buildAcquisitionDecision()` — because Step 4 requires something callable to produce loggable output today. The function fills every category with explicit placeholder/`null` values and a `_placeholder: true` marker; it performs zero real financial math and must never be presented as a real decision. Integration point is the frontend Screener pipeline (`DealAnalysisCard.jsx`), called fire-and-forget after the existing `generate-core-analysis` call, wrapped in `try/catch`, only `console.log`-ing its result — no state, DB writes, or rendering changes.

**Tech Stack:** TypeScript (`.ts`, no build step yet — same as sibling `core/*` folders), Vite (already transpiles `.ts` via esbuild on demand), React/JSX frontend.

## Global Constraints

- Do NOT redesign the CRM, change current user workflows, or replace the current analysis (per mission brief).
- Do NOT invent real business values — every field in the new engine's output must be a documented placeholder until a future sprint implements real logic.
- The new engine must have zero effect on existing stored data, UI rendering, or the existing `ai_notes` / `deal_analysis` pipeline.
- Follow the existing `core/*-engine` file/README pattern exactly (see `core/financial-engine/`, `core/scoring-engine/`).
- `npm run build` (`vite build`) must succeed unmodified at the end of every task.

---

### Task 1: Define `AcquisitionDecision` interfaces

**Files:**
- Create: `core/acquisition-engine/index.ts`
- Create: `core/acquisition-engine/README.md`

**Interfaces:**
- Produces: `AcquisitionDecisionInputs`, `AcquisitionDecision` (and its nested category types), consumed by Task 2's `buildAcquisitionDecision()` and Task 3's integration call.

- [ ] **Step 1: Write `core/acquisition-engine/README.md`**

```markdown
# /core/acquisition-engine — Acquisition Intelligence Engine V1

## Purpose

Assembles the outputs of the other `/core` engines (financial, flip, brrrr,
negotiation, rehab, scoring, buybox) plus lead context into **one structured
decision object** per lead — the shared, canonical shape that will eventually
power the CRM, Kevin Dashboard, Mobile, SMS/Email, and future agents.

## Status — V1 (interfaces + placeholder builder only)

This is a **new engine running in parallel to production**, per the Acquisition
Intelligence Engine V1 mission brief. It does NOT change, replace, or read from
the existing Screener AI pipeline (`netlify/functions/generate-core-analysis.mjs`,
`src/lib/dealCalculations.js`). Its output is logged only (see integration point
in `src/components/lead-detail/DealAnalysisCard.jsx`) and is not stored, rendered,
or used to make any decision yet.

`buildAcquisitionDecision()` is intentionally a **placeholder implementation** —
every field is a documented stand-in value (`null`, `0`, `'unknown'`, or an empty
array) plus a `_placeholder: true` flag on the returned object. No real financial
math, AI calls, or DB reads happen here. Real logic lands in a future sprint once
the sibling `/core` engines (financial-engine, scoring-engine, etc.) are themselves
implemented — this engine will then compose their real outputs instead of
placeholders.

## What belongs here

- The `AcquisitionDecision` type — the single structured object shape consumed
  by every future surface (CRM, Dashboard, Mobile, SMS, Email, Agents).
- Composition logic that maps sibling `/core` engine outputs into that shape.

## What must NEVER belong here

- Anthropic/Claude API calls or prompt construction (see `core/README.md`).
- Database reads/writes.
- Hard-coded business constants — those live in `/config`.
- Real business math — that's the sibling engines' job; this engine only composes.

## See also

`core/README.md` for the full `/core` engine inventory and boundary rules.
`docs/architecture/HAT_AI_OS.md` for the overall HAT AI OS folder map.
```

- [ ] **Step 2: Write `core/acquisition-engine/index.ts`**

```typescript
// core/acquisition-engine — Acquisition Intelligence Engine V1
// Sprint: Acquisition Intelligence Engine V1 — see core/acquisition-engine/README.md
//
// Assembles ONE structured decision object per lead, composed from the other
// /core engines' outputs. Today this ships a placeholder builder only (see
// README "Status" section) — no real business math lives here yet. It runs in
// PARALLEL to the existing Screener AI pipeline and must never be wired into
// any production read/write path.

import type { MaoResult, HmlLoanResult, HoldingCostResult } from '../financial-engine'
import type { FlipResult } from '../flip-engine'
import type { RefiResult, CashFlowResult } from '../brrrr-engine'
import type { AnchorResult, MotivationResult } from '../negotiation-engine'
import type { RehabCostBracket, MaxRehabBudgetResult } from '../rehab-engine'
import type { DealScoreResult } from '../scoring-engine'
import type { BuyBoxResult } from '../buybox-engine'

/** Minimal lead-identifying context the engine composes a decision for. */
export interface AcquisitionDecisionInputs {
  leadId: string | number
  address: string | null
  /** Whichever sibling /core engine outputs are already available for this lead.
   *  All optional — V1 callers may have none of these computed yet. */
  mao?: MaoResult
  hmlLoan?: HmlLoanResult
  holdingCosts?: HoldingCostResult
  flip?: FlipResult
  refi?: RefiResult
  cashFlow?: CashFlowResult
  rehabBracket?: RehabCostBracket
  maxRehabBudget?: MaxRehabBudgetResult
  motivation?: MotivationResult
  anchor?: AnchorResult
  dealScore?: DealScoreResult
  buyBox?: BuyBoxResult
}

export type Priority = 'high' | 'medium' | 'low' | 'unknown'
export type Confidence = 'high' | 'medium' | 'low' | 'unknown'

export interface FinancialSummary {
  arv: number | null
  mao: number | null
  estimatedRenovationCost: number | null
  projectedProfit: number | null
  projectedRoi: number | null
}

export interface BuyBoxSummary {
  inBuyBox: boolean | null
  zipEligible: boolean | null
  propertyTypeEligible: boolean | null
  reasons: string[]
}

export interface RiskAssessment {
  overallRisk: 'high' | 'medium' | 'low' | 'unknown'
  flags: string[]
}

export interface MissingInformation {
  fields: string[]
}

export interface RecommendedAction {
  action: string
  rationale: string
}

export interface OfferStrategy {
  startingOffer: number | null
  targetPrice: number | null
  walkAwayPrice: number | null
  approach: string | null
}

/**
 * ONE structured decision object per lead — the shared shape every future
 * surface (CRM, Kevin Dashboard, Mobile, SMS, Email, Agents) will consume.
 */
export interface AcquisitionDecision {
  leadId: string | number
  priority: Priority
  confidence: Confidence
  financialSummary: FinancialSummary
  buyBox: BuyBoxSummary
  riskAssessment: RiskAssessment
  missingInformation: MissingInformation
  recommendedActions: RecommendedAction[]
  offerStrategy: OfferStrategy
  reasonsToBuy: string[]
  reasonsToAvoid: string[]
  futureCapabilities: string[]
  /** V1 placeholder marker — true until real composition logic lands. Every
   *  consumer of this object MUST check this flag before trusting any value. */
  _placeholder: true
  generatedAt: string
}

/**
 * Assembles the placeholder AcquisitionDecision object for a lead.
 *
 * V1 PLACEHOLDER IMPLEMENTATION — does not read any sibling engine output
 * even when provided in `inputs`; every field is a documented stand-in. This
 * exists so Step 4 (parallel integration + logging) has something concrete to
 * call. Do NOT use this output to drive any real decision.
 */
export function buildAcquisitionDecision(
  inputs: AcquisitionDecisionInputs
): AcquisitionDecision {
  return {
    leadId: inputs.leadId,
    priority: 'unknown',
    confidence: 'unknown',
    financialSummary: {
      arv: null,
      mao: null,
      estimatedRenovationCost: null,
      projectedProfit: null,
      projectedRoi: null,
    },
    buyBox: {
      inBuyBox: null,
      zipEligible: null,
      propertyTypeEligible: null,
      reasons: [],
    },
    riskAssessment: {
      overallRisk: 'unknown',
      flags: [],
    },
    missingInformation: {
      fields: [],
    },
    recommendedActions: [],
    offerStrategy: {
      startingOffer: null,
      targetPrice: null,
      walkAwayPrice: null,
      approach: null,
    },
    reasonsToBuy: [],
    reasonsToAvoid: [],
    futureCapabilities: [
      'CRM decision panel',
      'Kevin Dashboard feed',
      'Mobile push summary',
      'SMS/Email auto-draft trigger',
      'Future autonomous agents',
    ],
    _placeholder: true,
    generatedAt: new Date().toISOString(),
  }
}
```

- [ ] **Step 3: Verify it's syntactically valid TypeScript**

Run: `npx tsc --noEmit --strict --target es2020 --module esnext --moduleResolution bundler core/acquisition-engine/index.ts`
Expected: no errors (may warn about missing `core/*-engine` sibling type files only if those files were themselves changed — they weren't, so it should resolve cleanly against existing sibling `index.ts` files).

- [ ] **Step 4: Commit**

```bash
git add core/acquisition-engine/index.ts core/acquisition-engine/README.md
git commit -m "feat(core): add acquisition-engine interfaces + V1 placeholder builder"
```

---

### Task 2: Register the new engine in the `/core` docs

**Files:**
- Modify: `core/README.md` (subfolder table, lines ~50-61)
- Modify: `docs/architecture/HAT_AI_OS.md` (folder map, lines ~70-79 per investigation notes — locate the exact `core/` folder listing before editing)

**Interfaces:** none (docs only).

- [ ] **Step 1: Add a row to `core/README.md`'s subfolder table**

Find the table block:
```markdown
| `buybox-engine/` | ZIP eligibility, property-type filter, financial sense-check |
```
Add immediately after it:
```markdown
| `acquisition-engine/` | Composes all sibling engine outputs into one `AcquisitionDecision` object per lead — the shared shape for CRM/Dashboard/Mobile/SMS/Email/Agents |
```

- [ ] **Step 2: Update `docs/architecture/HAT_AI_OS.md`'s folder map**

Open `docs/architecture/HAT_AI_OS.md` and find the `core/` folder listing (around the section enumerating `core/{financial,flip,brrrr,...}-engine/`). Add `acquisition-engine/` to that enumerated list with a one-line description consistent with the existing entries' style, e.g.:
```
├── core/acquisition-engine/    Composes all engine outputs into one AcquisitionDecision object (V1: placeholder builder)
```
Match the existing formatting/indentation exactly — read the surrounding lines first since the exact tree characters must line up.

- [ ] **Step 3: Commit**

```bash
git add core/README.md docs/architecture/HAT_AI_OS.md
git commit -m "docs: register core/acquisition-engine in core and architecture docs"
```

---

### Task 3: Wire parallel, log-only invocation into the Screener pipeline

**Files:**
- Modify: `src/components/lead-detail/DealAnalysisCard.jsx` (near line 622, right after the existing `generate-core-analysis` call in the `runFullAnalysis`-style handler)

**Interfaces:**
- Consumes: `buildAcquisitionDecision(inputs: AcquisitionDecisionInputs): AcquisitionDecision` from `core/acquisition-engine/index.ts` (Task 1).

- [ ] **Step 1: Add the import at the top of `DealAnalysisCard.jsx`**

Add alongside the existing imports (top of file, near other relative imports):
```javascript
import { buildAcquisitionDecision } from '../../../core/acquisition-engine/index.ts'
```
(Verify the exact relative path from `src/components/lead-detail/` to `core/acquisition-engine/` — it is `../../../core/acquisition-engine/index.ts`; adjust only if the actual file tree differs.)

- [ ] **Step 2: Call it in parallel, right after the existing core-analysis call, log-only**

Immediately after this existing line (around line 622):
```javascript
      const coreResult = await callFnFull('generate-core-analysis', { lead: leadWithArv })
```
insert:
```javascript
      // Acquisition Intelligence Engine V1 — runs in PARALLEL, log-only, zero
      // production impact. Does not read coreResult, does not affect state,
      // does not write to the DB. Safe to fail silently.
      try {
        const acquisitionDecision = buildAcquisitionDecision({
          leadId: lead.id,
          address: lead.address ?? null,
        })
        console.log('[acquisition-engine v1]', acquisitionDecision)
      } catch (engineErr) {
        console.warn('[acquisition-engine v1] non-fatal error (parallel engine, ignored):', engineErr)
      }
```

- [ ] **Step 3: Confirm no existing behavior changed**

Run: `npm run build`
Expected: build succeeds with no new errors/warnings beyond what existed before this change (Vite transpiles the `.ts` import via esbuild automatically — no `tsconfig.json` or bundler config change needed, confirmed by investigation: sibling `.jsx` files in this repo import plain JS/TS relative modules the same way already).

- [ ] **Step 4: Manually verify in dev**

Run: `npm run dev:vite` (or `npm run dev` if Netlify functions are needed for the rest of the page to load), open a lead in the Screener/lead-detail view, trigger the existing "Run AI Analysis" action, and confirm in the browser console that a `[acquisition-engine v1] {...}` log line appears with `_placeholder: true`, while the existing `ai_notes` / DEAL SNAPSHOT / MAO / negotiation-plan UI behaves exactly as before (no visual or data differences).

- [ ] **Step 5: Commit**

```bash
git add src/components/lead-detail/DealAnalysisCard.jsx
git commit -m "feat: run acquisition-engine V1 in parallel (log-only) during Screener analysis"
```

---

### Task 4: Final verification and mission report

**Files:** none (verification only).

- [ ] **Step 1: Full build check**

Run: `npm run build`
Expected: PASS, identical output to pre-change baseline aside from bundle size (negligible — one new tiny module).

- [ ] **Step 2: Diff review**

Run: `git diff main --stat` (or `git log --oneline` for the commits made in Tasks 1-3)
Expected: only these files touched: `core/acquisition-engine/index.ts` (new), `core/acquisition-engine/README.md` (new), `core/README.md` (modified), `docs/architecture/HAT_AI_OS.md` (modified), `src/components/lead-detail/DealAnalysisCard.jsx` (modified, additive-only diff — no deletions of existing logic).

- [ ] **Step 3: Compose the mission report**

Produce the Step 5 report the mission brief asked for, covering:
- **Files created**: `core/acquisition-engine/index.ts`, `core/acquisition-engine/README.md`
- **Files modified**: `core/README.md`, `docs/architecture/HAT_AI_OS.md`, `src/components/lead-detail/DealAnalysisCard.jsx`
- **Production impact**: none — the new call is additive, wrapped in try/catch, log-only, does not touch `leads`/`deal_financials` tables, does not alter `ai_notes`/`deal_analysis`, does not change any rendered UI.
- **Build status**: PASS (`npm run build`), confirmed manually in dev (`npm run dev:vite`).
- **Migration risks**: low — the module has no consumers besides the new log-only call site; sibling `core/*-engine` modules remain untouched (`declare`-only, unimplemented) so `AcquisitionDecision`'s optional sibling-engine-typed fields on `AcquisitionDecisionInputs` are currently unused by the placeholder builder — a future sprint implementing the sibling engines and wiring their real outputs into `buildAcquisitionDecision()` is a **breaking-free additive change** (the `_placeholder: true` flag and placeholder values simply get replaced with real ones; the object shape itself does not need to change for known category fields).

No commit needed for this task (verification + reporting only).

---

## Self-Review Notes

- **Spec coverage**: Step 1 (inspect existing flow) done in investigation preamble, not a plan task. Step 2 (interfaces with example categories) → Task 1. Step 3 (interfaces only, no logic changes) → Task 1 (placeholder builder is explicitly documented as non-logic, needed only to satisfy Step 4's "runs in parallel" requirement — flagged clearly in README and code comments). Step 4 (integrate without changing production behavior, log only) → Task 3. Step 5 (report) → Task 4.
- **Placeholder scan**: All object fields in `buildAcquisitionDecision` are real code returning explicit stand-in values, not `// TODO` comments — this satisfies "use placeholders where needed" from the mission brief while keeping "No Placeholders" plan-writing rule about vague steps.
- **Type consistency**: `AcquisitionDecisionInputs` field names (`mao`, `flip`, `refi`, `cashFlow`, `rehabBracket`, `maxRehabBudget`, `motivation`, `anchor`, `dealScore`, `buyBox`) match `platform/analysis/index.ts`'s existing `AnalysisResult` field names exactly, so a future sprint can pass an `AnalysisResult` straight through without renaming.
