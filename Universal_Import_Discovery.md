# Universal Lead Import Engine — Discovery Report

**Cycle 3 — Discovery Phase.** This is investigation only. No production code was written, refactored, or created as part of this document. All findings are cited to exact files/lines in `HatCRM` and its sibling project `hat-ai-agents` (same machine, separate repo, same Supabase project).

---

## 1. Current Architecture

Two separate codebases cooperate through one shared database — there is no API boundary between them, only a shared Supabase project (`pyrgotfotmwazigewlke`):

```
┌─────────────────────────────────────────────────────────────────────┐
│  hat-ai-agents  (separate repo — ingestion & underwriting)           │
│                                                                       │
│  Gmail (Redfin/Zillow alert emails)                                  │
│        │  read via Claude MCP Gmail connector                       │
│        ▼                                                             │
│  gmail-summary-agent.md  Stage 0 — PER-SOURCE, LLM-based extraction  │
│        │  (§4a Redfin / §4b Zillow instructions, no parser code)     │
│        ▼                                                             │
│  NormalizedProperty  (lib/property-schema.md — a *documented*        │
│        │              contract, not an enforced type/schema)        │
│        ▼                                                             │
│  lib/acquisition-engine.mjs — SOURCE-INDEPENDENT, deterministic      │
│        │  scoring/underwriting/MAO math → decision enum              │
│        ▼                                                             │
│  crm-agent.md — direct REST POST to Supabase (raw HTTPS, PowerShell) │
└─────────────────────────────┬─────────────────────────────────────────┘
                               │  same Supabase project, `leads` table
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  HatCRM  (this repo — the CRM application)                           │
│                                                                       │
│  leads table (status='triage'/'monitor', auto_imported=true,         │
│  lead_source='redfin_auto', redfin_trigger_type=...)                 │
│        │                                                             │
│        ▼                                                             │
│  InboxPage.jsx  — reads status='triage' AND auto_imported=true       │
│        │  Kevin promotes/dismisses/marks hot                        │
│        ▼                                                             │
│  Rest of the CRM (Leads, Lead Detail, Screener, Action Center, ...)  │
│                                                                       │
│  Separately: 3 OTHER, unrelated lead-creation paths already exist    │
│  in HatCRM itself — LeadForm.jsx (manual), CSVImport.jsx (generic    │
│  CSV mapper), ScreenerPage.jsx (Deal Screener "Save to CRM")          │
└─────────────────────────────────────────────────────────────────────┘
```

**The critical fact this discovery surfaced:** HatCRM (this repo) contains **zero** Redfin-specific ingestion code. There is no email parser, no Redfin API client, no scheduled Redfin-scanning function anywhere in this repo. Redfin ingestion is entirely an external process (`hat-ai-agents`) that writes directly into the same `leads` table via raw Supabase REST calls. HatCRM only ever *reads* the result (`status='triage'`, `lead_source='redfin_auto'`, `redfin_trigger_type=...`, `auto_imported=true`).

---

## 2. Redfin Flow — Complete Lifecycle

1. **Email arrives** in the Gmail inbox connected via MCP (from `*@redfin.com`).
2. **A scheduled Claude agent session** ("Gmail Daily Summary" cloud routine, or a local PowerShell wrapper `hat-ai-agents/scripts/run-daily-batch.ps1` that shells out to `claude.exe --print`) runs `gmail-summary-agent.md`.
3. **Stage 0 (source-specific, LLM reasoning, not code)**: the agent reads the raw email text per the instructions in `gmail-summary-agent.md` §4a and extracts: `source='redfin'`, address, city, zip_code, asking_price, original_list_price, price_reduction_count, bedrooms, bathrooms, sqft, year_built, property_type, days_on_market, listing_status, `alert_type` (`new_listing`/`price_drop`/`back_on_market`/`relisted`/`pending_fell_through`/`stale_listing`/`generic_alert`), listing_url, description, agent_remarks, listing_agent_name/phone/email, hoa_info, occupancy, construction_type, lot_size_sqft. **There is no dedicated Redfin parser function in code** — extraction is purely an LLM following a natural-language spec. A ZIP-resolution fallback chain (Census/Nominatim geocoding) exists for when the email doesn't state a ZIP.
4. **NormalizedProperty** object is produced — a documented shape (`hat-ai-agents/lib/property-schema.md`), not a validated/enforced schema (no Zod/JSON-schema/TypeScript type anywhere).
5. **Stage 2 (deterministic, source-independent code)**: `lib/acquisition-engine.mjs` (`screen()`/`underwrite()`) computes ZIP tier, condition tier, ARV/reno estimate, motivation score, MAO/flip/BRRRR math, and returns a routing decision: `INSERT_HOT | INSERT | SECOND_CHANCE | MONITOR | REJECT`.
6. **Stage 3 (AI, survivors only)**: `second-chance-agent.md` — full underwriting narrative for borderline cases.
7. **CRM insert**: `crm-agent.md` instructs a direct HTTPS POST (PowerShell `Invoke-RestMethod`, using a Supabase Management PAT — **bypasses RLS entirely**, not the app's anon/service-role client flow) to `leads`, setting `status='triage'` (or `'monitor'` for MONITOR-routed properties), `lead_source='redfin_auto'`, `redfin_trigger_type`, `auto_imported=true`, `is_hot`, `mls_status`, plus all the standard property fields. Extended engine output (scores, reasoning) is stashed in the existing `enrichment_data` jsonb column rather than new columns.
8. **HatCRM reads it**: `InboxPage.jsx:52-60` queries `leads` filtered on `status='triage' AND auto_imported=true`, grouped into tabs by `redfin_trigger_type`. Kevin can **Promote to New Lead** (`status → 'new_lead'`), **Not in Buy Box**, or **Dismiss** (`status → 'dead_lead'`), or toggle **Hot** without changing status.
9. `monitor`-status rows are invisible in the Inbox by design (`InboxPage.jsx` only reads `'triage'`); they carry a `snooze_until` wake-up timer, intended to be re-checked and promoted to `'triage'` by the same external agent when something changes (price cut, back on market, DOM threshold) — this promotion logic was not verified to exist as a scheduled job; it is documented intent in the `20260809000000_add_monitor_lead_status.sql` migration comment.
10. From `new_lead` onward, the lead is indistinguishable from any other HatCRM lead — same detail page, same AI analysis pipeline (Capabilities #1–#5), same Action Center.

**Two downstream MLS refresh functions exist inside HatCRM** (distinct from ingestion — they only ever `UPDATE` existing rows, never `INSERT`):
- `netlify/functions/enrich-lead.mjs` — RentCast API lookup, three modes (on-demand enrich, address-lookup-no-write for the "Look up" button, scheduled sweep).
- `netlify/functions/daily-mls-sweep.mjs` — Netlify Scheduled Function (hourly, `schedule: '7 * * * *'`), a thin per-workspace wrapper that calls `enrich-lead` for stale leads.

---

## 3. Coupling Analysis — What's Tightly Coupled to Redfin (or to a single hardcoded shape)

| Location | Coupling |
|---|---|
| `hat-ai-agents/.claude/agents/gmail-summary-agent.md` §4a | The entire Redfin field-extraction spec is one prose block, hand-written per source. Adding a source = writing a new prose section, not calling a shared function. |
| `HatCRM src/pages/InboxPage.jsx:57-58` | Query hardcodes `status='triage'` **and** `auto_imported=true` together — a future source that wants "monitor now, triage later" or a different intermediate status needs to either reuse these exact two fields or the Inbox won't show it. |
| `HatCRM src/lib/constants.js` `REDFIN_TRIGGER_TYPES`/`REDFIN_TRIGGER_MAP` | The Inbox's tab UI is literally keyed on Redfin's alert vocabulary (`new_listing`, `price_drop`, `back_on_market`, etc.) via a column named `redfin_trigger_type`. Zillow (or any source) has no equivalent typed column — its `alert_type` would either have to be shoehorned into `redfin_trigger_type` (semantically wrong) or the Inbox tabs simply won't reflect it. |
| `HatCRM src/lib/constants.js` `LEAD_SOURCES` | Fixed enum list (`direct_mail, cold_call, mls, wholesaler, referral, driving_for_dollars, web, imported, redfin_auto, other`) — no `zillow_auto`, no generic `<source>_auto` pattern is pre-registered, even though `lead_source` itself is a free-text column with no DB CHECK constraint (confirmed: nothing stops writing an arbitrary string). The coupling is only in the **UI label list**, not the schema. |
| `HatCRM src/pages/ScreenerPage.jsx:443` | `lead_source: deal.sourceName ? 'wholesaler' : 'other'` — a two-way hardcoded guess, not source-aware. |
| `HatCRM src/components/leads/CSVImport.jsx` `LEAD_FIELDS` (lines 12-33) | Fixed target-field allowlist for column mapping — generic in spirit (any CSV can map into it) but the field *list itself* is hardcoded in code, not data-driven. |
| `hat-ai-agents crm-agent.md` | The actual "write a lead into HatCRM" logic is a **PowerShell prose recipe embedded in an agent prompt**, not a callable function/module/API endpoint. Every future source's ingestion agent would need its own copy of this same recipe (or to be told to reuse it), since there's no shared "insertLead()" utility even within `hat-ai-agents`. |
| Auth model | `hat-ai-agents` writes via a **Management API PAT** (bypasses Postgres RLS). HatCRM's own app writes via the anon/service-role Supabase-js client and is bound by RLS + `applyLeadVisibility`. Two different trust boundaries for the same table — a new source built the "HatCRM way" (Supabase-js + RLS) would behave differently (workspace-scoped, policy-checked) than one built the "hat-ai-agents way" (raw PAT, no RLS). |

---

## 4. Reusable Components — Already Generic, No Changes Needed

| Component | Why it's already source-agnostic |
|---|---|
| `HatCRM src/components/leads/CSVImport.jsx` | Fully generic column-mapper. Confirmed: it can already ingest a Zillow (or any) CSV export today, with zero code changes, as long as the file has an address column somewhere — mapping is 100% user-driven per import, no source detection, no source-specific branching. |
| `HatCRM src/lib/leadDedup.js` (`normalizeAddress`, `normalizeAddressForDB`, `findDuplicateLeads`) | Pure address-normalization/dedup, used identically regardless of where a lead came from. |
| `HatCRM src/lib/propertyIntelligence.js` (Capability #3/#4) | `recordPropertyEvent()`/`evaluateAndRecordRediscovery()` operate purely on `{address, city, state, zip_code}` + a lead id — genuinely source-blind already. |
| `HatCRM leads_workspace_address_unique_idx` (DB constraint) | Workspace-scoped address uniqueness applies uniformly no matter which path inserted the row. |
| `hat-ai-agents/lib/acquisition-engine.mjs` | Explicitly documented and verified as source-independent — it only ever consumes a `NormalizedProperty` object and has no Redfin/Zillow/Gmail-specific code inside it. This is the strongest piece of existing "universal" design in the whole system. |
| `hat-ai-agents/lib/property-schema.md` | The `NormalizedProperty` **contract already exists on paper** and is explicitly designed for multi-source ("Redfin today; Zillow/Realtor/MLS later... nothing in acquisition-engine.mjs needs to change"). It's a real, well-thought-out abstraction — it's just documentation, not enforced by any code (no schema validation, no shared TypeScript/JSDoc type, no runtime check that a parser's output actually matches it). |
| `HatCRM src/lib/leadVisibility.js` (`applyLeadVisibility`) | Role-based visibility applies uniformly to any lead regardless of origin. |
| `HatCRM` generic `leads` schema | `lead_source` is unconstrained free text (no CHECK constraint found) — the DB layer already permits any source string without a migration. |

---

## 5. Field Requirements Across Sources

Cross-referencing `property-schema.md` (the only existing multi-source field contract), `LEAD_FIELDS` in `CSVImport.jsx`, and the enrichment fields in `enrich-lead.mjs`:

**Required (a lead is not usable without these):**
- `address` — the only field the system hard-blocks on today (CSVImport throws without it; the DB unique index is keyed on it).
- `source` / `lead_source` — needed to know provenance, drive Inbox routing, and later measure ROI per channel (`SourcePerformance.jsx` already reports on this).

**Recommended (present for most sources; materially improves triage/underwriting quality but the system already tolerates them being null):**
- `city`, `zip_code` — `property-schema.md` explicitly allows `zip_code: null` ("never invented"); `city` defaults to `'Jacksonville'` if unstated.
- `asking_price` — the acquisition engine can still run with reduced confidence but MAO/flip math needs it eventually.
- `bedrooms`, `bathrooms`, `sqft` — used for ARV/rent estimation; explicitly nullable in the schema.
- `listing_url` — used to build a clickable reference; `zillow_url` is even auto-derived from address today if absent.
- `listing_agent_name` / `_phone` / `_email` — used for negotiation/outreach; nullable.
- `days_on_market`, `listing_status`/`mls_status` — feeds motivation scoring and the existing `daily-mls-sweep`/`enrich-lead` refresh cycle.

**Optional (nice-to-have, several sources will never provide them):**
- `photos_url`, `hoa_info`, `occupancy`, `construction_type`, `agent_remarks`, `description`, `year_built`, `lot_size_sqft`, `original_list_price`, `price_reduction_count`, `alert_type`/`redfin_trigger_type`-equivalent.

**MLS/Agent/Photos specifically**: MLS number and agent contact are Recommended, not Required — many sources (Probate, Tax Delinquent, Water Liens, Code Violations, Lis Pendens, Evictions, Driving for Dollars) will **never** have an MLS number or listing agent at all, since they're off-market/distressed-list sources rather than active listings. Any Universal Import Layer must treat "listing-style" fields (MLS #, agent, listing URL, photos) as always-optional, not just optional-for-now.

---

## 6. Assumptions That Would Block a New Source Today

1. **InboxPage's triage funnel is Redfin-shaped.** `redfin_trigger_type` and its fixed enum are the only structured "why is this here" signal the Inbox UI understands. A Zillow lead landing in `triage` would show up with a blank/mismatched trigger tab unless it reuses Redfin's vocabulary or the column is renamed/generalized.
2. **`LEAD_SOURCES` in `constants.js` is a closed label list for the UI**, even though the underlying column isn't DB-constrained. A new source's value would display as raw text in dropdowns rather than a friendly label until added.
3. **No shared "insert a lead from an external source" function exists anywhere** — not in HatCRM (which has 3 separate, independently-coded insert paths: `LeadForm.jsx`, `CSVImport.jsx`, `ScreenerPage.jsx`, none of which share an insert helper), and not in `hat-ai-agents` (the Redfin insert logic is a copy-pasteable PowerShell recipe embedded in a prompt file, not a function). Every new source today means either duplicating that recipe or hand-writing a fourth+ HatCRM insert path.
4. **No schema enforcement on `NormalizedProperty`.** Nothing validates that a new source's parser actually produces the documented shape before it reaches the acquisition engine or the CRM insert step — a subtly-wrong field name would silently produce `null`s or crash deep in the pipeline with no clear error at the boundary.
5. **Two different write paths with two different trust/permission models** (HatCRM's Supabase-js+RLS app writes vs. `hat-ai-agents`'s raw Management-API-PAT writes) — a new source has to choose one and there's no documented reason to prefer either.
6. **CSV import's `LEAD_FIELDS` allowlist** doesn't include every column a rich source might offer (e.g. `occupancy`, `construction_type`, `agent_remarks` from the NormalizedProperty schema have no matching CSV target field today) — not a hard blocker, but silently drops data on CSV-based sources.
7. **`redfin_trigger_type` and `auto_imported` are Redfin-flavored booleans/columns bolted onto the generic `leads` table** rather than a generic "import event" concept — every new automated source either needs its own bespoke column (schema sprawl) or has to awkwardly reuse Redfin's.

---

## 7. If We Wanted To Add Zillow Tomorrow — Exact Files & Effort

Zillow is actually the **best-documented case already** — `gmail-summary-agent.md` §4b and `docs/architecture/acquisition-engine.md:46-59` explicitly describe it as "added this way (2026-08) — the pattern is now proven," reusing the exact same NormalizedProperty → engine → CRM pipeline as Redfin, just with a second Stage-0 prose section.

**In `hat-ai-agents` (mostly already done):**
- `gmail-summary-agent.md` — Stage 0 §4b already exists for Zillow extraction (LLM prose, no code). *Effort already spent.*
- `lib/acquisition-engine.mjs`, `crm-agent.md` — **zero changes needed**, by design.

**In `HatCRM` (this repo) — for Zillow leads to be properly usable, not just silently mis-labeled:**
1. `src/lib/constants.js` — add `'zillow_auto'` (or similar) to `LEAD_SOURCES` for a proper UI label. *Trivial, ~1 line.*
2. `src/pages/InboxPage.jsx` + `src/lib/constants.js` `REDFIN_TRIGGER_TYPES` — decide whether Zillow's `alert_type` reuses the same tab UI (rename column/concept to something source-neutral) or gets its own tab set. *Small-to-medium — this is the one place needing real design thought, not just a data value.*
3. `src/components/leads/CSVImport.jsx` `LEAD_FIELDS` — only if Zillow leads will also arrive via manual CSV export (separate from the automated Gmail path) and need fields the current list doesn't cover.
4. Nothing in `enrich-lead.mjs`/`daily-mls-sweep.mjs` needs to change — they operate on any existing lead regardless of source.

**Estimated effort:** **0.5–1.5 developer-days** for the HatCRM side (mostly the Inbox trigger-type UI decision), assuming the `hat-ai-agents` side is genuinely already working as documented. This is a strong existing signal that the underlying design (NormalizedProperty → engine → generic `leads` table) already scales reasonably well *once a lead reaches HatCRM* — the friction is concentrated in the Inbox's Redfin-specific presentation layer, not the data pipeline.

---

## 8. Recommended Universal Import Layer — Smallest Possible Version

**Not a new architecture. Not a rewrite.** Formalize what already exists conceptually (`NormalizedProperty`) and give it exactly three things it's currently missing: (a) one canonical location inside HatCRM itself (today the contract only lives in the sibling repo's markdown), (b) one shared insert function, (c) one generalized "why is this in triage" concept.

```
   Source A          Source B          Source C
  (Redfin email)    (Zillow email)    (CSV / API / future)
        │                 │                  │
        ▼                 ▼                  ▼
   [ existing, source-specific extraction — unchanged ]
        │                 │                  │
        └────────┬────────┴──────────────────┘
                  ▼
        NormalizedLead  (same shape every time)
                  │
                  ▼
     importLead(normalizedLead)   ← the ONE new shared function
                  │
                  ▼
       leads table (unchanged schema, or +1 generic column)
                  │
                  ▼
       InboxPage.jsx (generalized to read the generic column,
       not hardcoded to `redfin_trigger_type`)
```

**Concretely, three small additive pieces — no rewrite of anything existing:**

1. **`src/lib/leadImport.js` (new, small, HatCRM side)** — a single exported function, e.g. `importLead(normalizedLead, { workspaceId, ... })`, that does exactly what `LeadForm.jsx`'s insert branch, `CSVImport.jsx`'s insert branch, and `ScreenerPage.jsx`'s insert branch each already do independently today (dedup check → insert → `recordPropertyEvent` → activity log) — just as one reusable function instead of three near-duplicate blocks. This is the same "extract shared logic, verify identical behavior" move already done once this cycle for `derivePriority()` (Capability #5). All three existing call sites *could* eventually be refactored onto it (optional, not required for new sources to benefit).
2. **A `NormalizedLead` shape, defined once in this repo** (JSDoc typedef or a plain object comment — no runtime framework needed) — essentially `hat-ai-agents/lib/property-schema.md`, copied/adapted into HatCRM as the single source of truth for what `importLead()` accepts. `source`, `address` required; everything else optional, matching §5 above.
3. **Generalize the "why is this in triage" concept**: rename/reinterpret the existing `redfin_trigger_type` column's *usage* (not necessarily its DB name, to avoid a breaking migration) to mean "import trigger reason" generically, and have `InboxPage.jsx` render whatever value is present rather than only recognizing Redfin's specific enum. Zillow/future sources populate the same column with their own trigger vocabulary (`price_drop` already means the same thing everywhere).

That's the entire abstraction. No message queue, no plugin registry, no source-adapter class hierarchy, no new tables. `importLead()` is the one seam that makes "Source A/B/C → same internal Lead object" real instead of aspirational.

---

## 9. Migration Plan — Incremental, Zero Redfin Breakage

1. **Step 0 (already true, verify only):** confirm Redfin's current path (`hat-ai-agents` → raw Management-API insert) keeps working entirely unchanged throughout. Nothing in this plan touches that path.
2. **Step 1 — Add, don't replace.** Write `src/lib/leadImport.js`'s `importLead()` in HatCRM as a **new, additive** function. Do not touch `LeadForm.jsx`/`CSVImport.jsx`/`ScreenerPage.jsx` yet.
3. **Step 2 — Prove it on the lowest-risk existing path.** Point *one* low-traffic existing insert path (candidate: CSV import, since it's already the most generic and least business-critical-path) at `importLead()` and verify identical behavior (same dedup, same fields, same events) before touching anything else. This mirrors the exact incremental-refactor pattern already used successfully for `derivePriority()` in Capability #5 (extract → verify identical output → swap callers one at a time).
4. **Step 3 — Generalize the Inbox's trigger-type rendering** (item 3 in §8) as a pure UI change — reading whatever string is present instead of a Redfin-specific enum. Existing Redfin rows keep working since their values don't change.
5. **Step 4 — Onboard Zillow through `importLead()`** as the first real second source, either continuing to use the `hat-ai-agents` raw-insert path (zero HatCRM risk, current proven approach) or switching to `importLead()` once Step 2 has proven it out. Either is safe; they write the same shape to the same table.
6. **Step 5 — Only after 2+ sources are stable**, consider migrating `LeadForm.jsx`/`ScreenerPage.jsx` onto `importLead()` too, purely for internal consistency — not required for new sources to work.
7. **At every step: the `leads` table schema, RLS policies, and Redfin's existing insert recipe are never modified.** Every change is additive (new file, new optional column at most) or purely presentational (Inbox rendering).

**Explicit non-breaking guarantee:** because `hat-ai-agents` writes directly to Postgres via REST and never calls any HatCRM code, **nothing in this migration plan can break the Redfin pipeline even in principle** — the two systems only share a table, not a call stack.

---

## 10. Risks

**Technical risks:**
- No schema validation today means a malformed `NormalizedProperty`/`NormalizedLead` fails silently (nulls) rather than loudly — worth adding a lightweight runtime check (even a simple required-fields assertion) in `importLead()`, since that's cheap and this discovery found zero validation anywhere in the current pipeline.
- Two divergent trust models (RLS-bound app writes vs. PAT-bound raw writes) could produce subtly different data (e.g. `visible_to_all`, `assigned_to` defaults) depending on which path a source uses — worth documenting explicitly so a new source's author picks correctly.
- `redfin_trigger_type` reuse-vs-rename is a judgment call with UX consequences (tab labels, filters, saved views referencing the column) — needs a short explicit design decision before Step 3, not a silent generalization.
- The `hat-ai-agents` "standalone daily batch" script referenced in `package.json`/`run-daily-batch.ps1` (`scripts/daily-batch.mjs`) **does not exist in that repo** — the real current ingestion trigger is an LLM agent session (cloud-scheduled or manually shelled out), not a deterministic script. This is a pre-existing operational fragility unrelated to the CRM but worth flagging since it's the actual thing that has to keep running for any source (Redfin included) to arrive at all.

**Business risks:**
- Every new automated source (Probate, Tax Delinquent, Water Liens, Code Violations, Lis Pendens, Evictions, Driving for Dollars, Facebook Marketplace, wholesalers) has fundamentally different data richness than Redfin/Zillow — mostly no MLS #, no listing agent, sometimes no price at all. If Kevin's triage/Inbox experience implicitly assumes listing-style data (price, agent, MLS status) is usually present, low-data sources will feel broken/low-quality in the UI even when the underlying pipeline is working correctly. The field-requirement tiers in §5 exist specifically to make this explicit up front.
- Off-market/distress sources (tax delinquent, code violations, lis pendens, evictions) often carry legal/compliance sensitivity (FDCPA-adjacent outreach rules, public-record handling) that a purely technical "just map it to NormalizedLead" plan doesn't address — worth a compliance pass before wiring these in, separate from the engineering work.
- Volume risk: several of the future sources (tax delinquent lists, code violations) can arrive as large batch files rather than one-at-a-time emails — CSVImport already handles batch reasonably well, but the Redfin-style one-lead-at-a-time Inbox/triage UX may not scale well to a 500-row tax-delinquent import without a review-in-bulk pattern (partially already true of the existing bulk CSV dedup flow, but worth a deliberate look before assuming it "just works").

---

*End of discovery document. No code was modified. Awaiting review before any implementation.*
