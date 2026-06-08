# Projects Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all deal financial tracking out of the lead detail page into a dedicated Project detail page; add a "Create Project" button on leads that promotes a lead to a project and navigates to the new project view.

**Architecture:** The lead detail page loses `DealFinancialsSection` and gains a "Create Project / View Project" button in its header. A new `ProjectDetailPage` at `/w/:id/projects/:leadId` hosts all financial inputs (HML, closing costs, holding costs, renovation items) and a live deal summary. `ProjectsPage` filters to only explicitly-promoted leads (`working_project` + `sold`) and links rows to the project detail page instead of the lead detail page.

**Tech Stack:** React 18, React Router 6, Supabase JS SDK, Tailwind CSS 4, existing components (`Card`, `Button`, `Topbar`, `DealFinancialsSection` internals reused directly in the new page).

---

## File Map

| Action | File | What it does |
|---|---|---|
| Modify | `src/pages/LeadDetailPage.jsx` | Remove DealFinancialsSection; add Create Project / View Project button logic |
| Modify | `src/components/lead-detail/LeadDetailHeader.jsx` | Add project button prop + render |
| Modify | `src/pages/ProjectsPage.jsx` | Filter to `working_project`+`sold`; rows link to `/projects/:leadId` |
| Modify | `src/App.jsx` | Add `projects/:leadId` route |
| Create | `src/pages/ProjectDetailPage.jsx` | New project detail page |

`DealFinancialsSection.jsx`, `DealRenovationItems.jsx`, `DealImportModal.jsx`, `dealCalculations.js` — unchanged, reused by `ProjectDetailPage`.

---

## Task 1: Update LeadDetailPage — Remove DealFinancialsSection, Add Project Button Logic

**Files:**
- Modify: `src/pages/LeadDetailPage.jsx`
- Modify: `src/components/lead-detail/LeadDetailHeader.jsx`

- [ ] **Step 1: Remove DealFinancialsSection from LeadDetailPage**

In `src/pages/LeadDetailPage.jsx`, remove the import line:
```js
// DELETE this line:
import DealFinancialsSection from '../components/lead-detail/DealFinancialsSection'
```
And remove the component render (the `<DealFinancialsSection ... />` block that was added after `<ScenariosFlat />`).

- [ ] **Step 2: Add project button state and handler to LeadDetailPage**

In `src/pages/LeadDetailPage.jsx`, add `useNavigate` is already imported. Add a new state variable and handler after the existing state declarations (~line 36):

```js
const [creatingProject, setCreatingProject] = useState(false)

const handleCreateProject = async () => {
  setCreatingProject(true)
  // Set status to working_project
  const { data: updatedLead } = await supabase
    .from('leads')
    .update({ status: 'working_project' })
    .eq('id', leadId)
    .select()
    .single()

  // Create deal_financials record seeded from lead data
  await supabase.from('deal_financials').upsert({
    lead_id:               lead.id,
    workspace_id:          lead.workspace_id,
    purchase_price_actual: lead.offer_price || lead.asking_price || null,
    expected_sell_price:   lead.arv || null,
  }, { onConflict: 'lead_id' })

  setCreatingProject(false)
  if (updatedLead) setLead(updatedLead)
  navigate(`/w/${workspaceId}/projects/${leadId}`)
}
```

- [ ] **Step 3: Pass project props to LeadDetailHeader**

In `src/pages/LeadDetailPage.jsx`, find the `<LeadDetailHeader .../>` render (around line 95) and add two new props:

```jsx
<LeadDetailHeader
  lead={lead}
  members={members}
  canEdit={canEdit}
  canAssign={canAssign}
  onEdit={() => setEditOpen(true)}
  onUpdated={(updated) => setLead(updated)}
  onCreateProject={handleCreateProject}
  creatingProject={creatingProject}
  workspaceId={workspaceId}
/>
```

- [ ] **Step 4: Add project button to LeadDetailHeader**

In `src/components/lead-detail/LeadDetailHeader.jsx`, add the new props to the function signature:

```js
export default function LeadDetailHeader({ lead, members, canEdit, canAssign, onEdit, onUpdated, onCreateProject, creatingProject, workspaceId }) {
```

Add this import at the top of the file (after existing imports):
```js
import { useNavigate } from 'react-router-dom'
```

Inside the component body, add:
```js
const navigate = useNavigate()
const isProject = ['working_project', 'sold'].includes(lead.status)
```

In the button row (the `<div className="flex items-center gap-2 shrink-0">` at the bottom), add the project button **before** the "Edit lead" button:

```jsx
{canEdit && (
  isProject ? (
    <button
      onClick={() => navigate(`/w/${workspaceId}/projects/${lead.id}`)}
      className="inline-flex items-center gap-1.5 h-8 px-3 text-[12.5px] font-medium rounded-md bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)] hover:brightness-110 transition"
    >
      View Project →
    </button>
  ) : (
    <button
      onClick={onCreateProject}
      disabled={creatingProject}
      className="inline-flex items-center gap-1.5 h-8 px-3 text-[12.5px] font-medium rounded-md bg-[color:var(--color-accent)] text-white hover:brightness-110 transition disabled:opacity-60"
    >
      {creatingProject ? 'Creating…' : '+ Create Project'}
    </button>
  )
)}
```

- [ ] **Step 5: Verify build passes**

```bash
npm run build
```
Expected: `✓ built in ~16s` with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/LeadDetailPage.jsx src/components/lead-detail/LeadDetailHeader.jsx
git commit -m "feat: remove deal financials from lead detail, add create project button"
```

---

## Task 2: Update ProjectsPage — Filter and Navigation

**Files:**
- Modify: `src/pages/ProjectsPage.jsx`

- [ ] **Step 1: Change the Supabase query to filter by project statuses**

In `src/pages/ProjectsPage.jsx`, the `useEffect` currently fetches from `deal_financials` and joins leads. Change the query so it also filters the joined leads to only `working_project` and `sold`:

Replace the fetch block (lines ~36-43) with:

```js
const { data: fins } = await supabase
  .from('deal_financials')
  .select('*, leads!inner(id, address, city, state, status, workspace_id)')
  .eq('workspace_id', workspaceId)
  .in('leads.status', ['working_project', 'sold'])
  .order('created_at', { ascending: false })

if (!fins?.length) { setRows([]); setLoading(false); return }

// Filter client-side as well since Supabase inner join filter may return all
const projectFins = fins.filter(f => ['working_project', 'sold'].includes(f.leads?.status))
if (!projectFins.length) { setRows([]); setLoading(false); return }

const leadIds = projectFins.map(f => f.lead_id)
```

Then update the `setRows` call to use `projectFins` instead of `fins`:

```js
setRows(projectFins.map(f => ({
  financials: f,
  lead: f.leads,
  items: itemsByLead[f.lead_id] || [],
  calc: calcDeal(f, itemsByLead[f.lead_id] || []),
})))
```

- [ ] **Step 2: Update row click to navigate to project detail page**

In the table `<tr>` onClick (line ~171), change the navigate target:

```jsx
// BEFORE:
onClick={() => navigate(`/w/${workspaceId}/leads/${lead.id}`)}

// AFTER:
onClick={() => navigate(`/w/${workspaceId}/projects/${lead.id}`)}
```

- [ ] **Step 3: Update empty state message**

Change the empty state text (line ~150):
```jsx
// BEFORE:
No projects yet. Start deal tracking on a lead to see it here.

// AFTER:
No projects yet. Open any lead and click "Create Project" to start tracking a deal here.
```

- [ ] **Step 4: Verify build passes**

```bash
npm run build
```
Expected: `✓ built in ~16s` with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/pages/ProjectsPage.jsx
git commit -m "feat: filter projects to working_project+sold, link rows to project detail"
```

---

## Task 3: Create ProjectDetailPage

**Files:**
- Create: `src/pages/ProjectDetailPage.jsx`

This page reuses the internals of `DealFinancialsSection` — the same Supabase load/save pattern, the same `calcDeal` call, and `DealRenovationItems`. It does NOT reuse the DealFinancialsSection component itself (that component has a "Start Deal Tracking" flow and scenario cards we don't want here). Instead, the page is a purpose-built layout.

- [ ] **Step 1: Create the file with imports and helpers**

Create `src/pages/ProjectDetailPage.jsx`:

```jsx
import { useState, useEffect, useCallback } from 'react'
import { useParams, useOutletContext, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { calcDeal, fmtUSD, fmtPct, dealRatingColor } from '../lib/dealCalculations'
import Topbar from '../components/Topbar'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import DealRenovationItems from '../components/lead-detail/DealRenovationItems'
import DealImportModal from '../components/lead-detail/DealImportModal'

const labelCls = 'text-[10px] uppercase tracking-wider font-medium text-[color:var(--color-text-dim)] block mb-0.5'
const inputCls = 'w-full h-8 px-2 text-[12px] rounded bg-[color:var(--color-bg-input)] text-[color:var(--color-text)] border border-[color:var(--color-line)] focus:outline-none focus:border-[color:var(--color-accent)] disabled:opacity-50'

function Field({ label, children }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {children}
    </div>
  )
}

function NumInput({ value, onChange, onBlur, disabled, placeholder }) {
  const [local, setLocal] = useState(value ?? '')
  useEffect(() => { setLocal(value ?? '') }, [value])
  return (
    <input
      type="number"
      value={local}
      onChange={e => { setLocal(e.target.value); onChange?.(e.target.value) }}
      onBlur={e => onBlur?.(e.target.value)}
      disabled={disabled}
      placeholder={placeholder || '0'}
      className={inputCls}
    />
  )
}

function MetricRow({ label, value, highlight }) {
  return (
    <div className={`flex justify-between items-center py-1.5 border-b border-[color:var(--color-line)] text-[12px] last:border-0 ${highlight ? 'font-semibold' : ''}`}>
      <span className="text-[color:var(--color-text-dim)]">{label}</span>
      <span className={highlight ? 'text-[color:var(--color-text)]' : 'text-[color:var(--color-text-muted)]'}>{value}</span>
    </div>
  )
}
```

- [ ] **Step 2: Add the main component — data loading**

Append to `src/pages/ProjectDetailPage.jsx`:

```jsx
export default function ProjectDetailPage() {
  const { leadId } = useParams()
  const { workspace, workspaceId, userRole } = useOutletContext()
  const navigate = useNavigate()
  const canEdit = userRole !== 'readonly'

  const [lead, setLead]           = useState(null)
  const [financials, setFinancials] = useState(null)
  const [items, setItems]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [importOpen, setImportOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: l }, { data: fin }, { data: reno }] = await Promise.all([
      supabase.from('leads').select('*').eq('id', leadId).single(),
      supabase.from('deal_financials').select('*').eq('lead_id', leadId).maybeSingle(),
      supabase.from('deal_renovation_items').select('*').eq('lead_id', leadId).order('sort_order'),
    ])
    setLead(l || null)
    setFinancials(fin || null)
    setItems(reno || [])
    setLoading(false)
  }, [leadId])

  useEffect(() => { load() }, [load])

  const save = async (changes) => {
    if (!financials) return
    const next = { ...financials, ...changes, updated_at: new Date().toISOString() }
    setFinancials(next)
    await supabase.from('deal_financials').update({ ...changes, updated_at: new Date().toISOString() }).eq('id', financials.id)
  }

  const handleBlur = (field) => (value) => {
    const num = value === '' ? null : Number(value)
    save({ [field]: num })
  }

  const handleSelect = (field) => (e) => save({ [field]: e.target.value })

  const handleImport = async (values) => {
    const next = { ...financials, ...values, updated_at: new Date().toISOString() }
    setFinancials(next)
    await supabase.from('deal_financials').update({ ...values, updated_at: new Date().toISOString() }).eq('id', financials.id)
    setImportOpen(false)
  }

  if (loading) return <LoadingSpinner fullPage label="Loading project…" />
  if (!lead) return <div className="p-6 text-slate-500">Project not found.</div>

  const calc = financials ? calcDeal(financials, items) : null
  const isProject = ['working_project', 'sold'].includes(lead.status)
```

- [ ] **Step 3: Add the JSX render — header and property summary**

Append to `src/pages/ProjectDetailPage.jsx` (inside the component, after the `const calc` line):

```jsx
  return (
    <>
      <Topbar
        title={lead.address || 'Project'}
        breadcrumbs={[
          { label: workspace?.name, to: `/w/${workspaceId}` },
          { label: 'Projects', to: `/w/${workspaceId}/projects` },
          { label: lead.address || 'Project' },
        ]}
        actions={
          <Link
            to={`/w/${workspaceId}/leads/${leadId}`}
            className="inline-flex items-center gap-1.5 h-8 px-3 text-[12.5px] font-medium rounded-md bg-[color:var(--color-bg-elev)] border border-[color:var(--color-line)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)] transition"
          >
            View Lead ↗
          </Link>
        }
      />

      <div className="px-6 py-4 space-y-4 max-w-[1200px] w-full">

        {/* Status badge */}
        <div className="flex items-center gap-3">
          <span className={`inline-flex px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wide ${
            lead.status === 'sold'
              ? 'bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)]'
              : 'bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent-text)]'
          }`}>
            {lead.status === 'sold' ? 'Sold' : 'Active Project'}
          </span>
          {financials && canEdit && (
            <button
              onClick={() => setImportOpen(true)}
              className="text-[11px] text-[color:var(--color-text-dim)] hover:text-[color:var(--color-text)] underline"
            >
              Import from CSV
            </button>
          )}
        </div>

        {/* Property Summary */}
        <Card title="Property Summary">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[12px]">
            {[
              { label: 'Address',     value: [lead.address, lead.city, lead.state].filter(Boolean).join(', ') || '—' },
              { label: 'Beds / Baths', value: [lead.bedrooms && `${lead.bedrooms} bd`, lead.bathrooms && `${lead.bathrooms} ba`].filter(Boolean).join(' / ') || '—' },
              { label: 'Sqft',        value: lead.square_feet ? lead.square_feet.toLocaleString() : '—' },
              { label: 'Year Built',  value: lead.year_built || '—' },
              { label: 'Purchase Price', value: fmtUSD(lead.offer_price || lead.asking_price) },
              { label: 'ARV',         value: fmtUSD(lead.arv) },
              { label: 'Listing Agent', value: lead.listing_agent_name || '—' },
              { label: 'Agent Phone', value: lead.listing_agent_phone || '—' },
            ].map(({ label, value }) => (
              <div key={label}>
                <div className={labelCls}>{label}</div>
                <div className="text-[color:var(--color-text)]">{value}</div>
              </div>
            ))}
          </div>
        </Card>
```

- [ ] **Step 4: Add financial inputs — Assumptions + Property inputs**

Append to the JSX (inside the outer `<div className="px-6...">`, after the Property Summary card):

```jsx
        {!financials ? (
          <Card>
            <div className="py-6 text-center space-y-3">
              <div className="text-[13px] text-[color:var(--color-text-muted)]">No financial data yet for this project.</div>
              <p className="text-[11px] text-[color:var(--color-text-dim)]">Financial data is created automatically when you create a project from a lead.</p>
            </div>
          </Card>
        ) : (
          <>
            {/* Assumptions */}
            <Card title="Assumptions">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Field label="Selling Cost %">
                  <NumInput value={financials.selling_cost_pct != null ? financials.selling_cost_pct * 100 : ''} onBlur={v => save({ selling_cost_pct: v === '' ? null : Number(v) / 100 })} disabled={!canEdit} placeholder="7" />
                </Field>
                <Field label="Loan-to-Purchase %">
                  <NumInput value={financials.loan_to_purchase_pct != null ? financials.loan_to_purchase_pct * 100 : ''} onBlur={v => save({ loan_to_purchase_pct: v === '' ? null : Number(v) / 100 })} disabled={!canEdit} placeholder="90" />
                </Field>
                <Field label="Renovation Financing">
                  <select value={financials.renovation_financing || 'Financed'} onChange={handleSelect('renovation_financing')} disabled={!canEdit} className={inputCls}>
                    <option value="Financed">Financed</option>
                    <option value="Cash">Cash</option>
                  </select>
                </Field>
                <Field label="Points Charged On">
                  <select value={financials.points_charged_on || 'Full Loan'} onChange={handleSelect('points_charged_on')} disabled={!canEdit} className={inputCls}>
                    <option value="Full Loan">Full Loan</option>
                    <option value="Purchase Only">Purchase Only</option>
                  </select>
                </Field>
              </div>
            </Card>

            {/* Deal Inputs */}
            <Card title="Deal Inputs">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <Field label="Purchase Price (Actual)">
                  <NumInput value={financials.purchase_price_actual} onBlur={handleBlur('purchase_price_actual')} disabled={!canEdit} />
                </Field>
                <Field label="Hold Months">
                  <NumInput value={financials.hold_months} onBlur={handleBlur('hold_months')} disabled={!canEdit} placeholder="5" />
                </Field>
                <Field label="Expected Sale Price">
                  <NumInput value={financials.expected_sell_price} onBlur={handleBlur('expected_sell_price')} disabled={!canEdit} />
                </Field>
                <Field label="Actual Sale Price">
                  <NumInput value={financials.actual_sale_price} onBlur={handleBlur('actual_sale_price')} disabled={!canEdit} />
                </Field>
                <Field label="Sold Date">
                  <input
                    type="date"
                    defaultValue={financials.sold_date || ''}
                    onBlur={e => save({ sold_date: e.target.value || null })}
                    disabled={!canEdit}
                    className={inputCls}
                  />
                </Field>
              </div>
            </Card>
```

- [ ] **Step 5: Add HML, Closing Costs, Holding Costs inputs**

Append to the JSX (inside the `<>` fragment, after the Deal Inputs card):

```jsx
            {/* Hard Money Loan */}
            <Card title="Hard Money Loan">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Field label="Renovation Lender Amount">
                  <NumInput value={financials.renovation_lender_amount} onBlur={handleBlur('renovation_lender_amount')} disabled={!canEdit} />
                </Field>
                <Field label="Interest Rate (Annual %)">
                  <NumInput value={financials.interest_rate_annual != null ? financials.interest_rate_annual * 100 : ''} onBlur={v => save({ interest_rate_annual: v === '' ? null : Number(v) / 100 })} disabled={!canEdit} placeholder="12" />
                </Field>
                <Field label="Points %">
                  <NumInput value={financials.points_pct != null ? financials.points_pct * 100 : ''} onBlur={v => save({ points_pct: v === '' ? null : Number(v) / 100 })} disabled={!canEdit} placeholder="2" />
                </Field>
                <Field label="Title Lender Insurance">
                  <NumInput value={financials.title_lender_insurance} onBlur={handleBlur('title_lender_insurance')} disabled={!canEdit} />
                </Field>
                <Field label="Interest Portion">
                  <NumInput value={financials.interest_portion} onBlur={handleBlur('interest_portion')} disabled={!canEdit} />
                </Field>
                <Field label="Doc Stamps (Mortgage)">
                  <NumInput value={financials.doc_stamps_mortgage} onBlur={handleBlur('doc_stamps_mortgage')} disabled={!canEdit} />
                </Field>
                <Field label="Intangible Tax">
                  <NumInput value={financials.intangible_tax} onBlur={handleBlur('intangible_tax')} disabled={!canEdit} />
                </Field>
                <Field label="Extension Fee">
                  <NumInput value={financials.extension_fee} onBlur={handleBlur('extension_fee')} disabled={!canEdit} />
                </Field>
              </div>
            </Card>

            {/* Purchase Closing Costs */}
            <Card title="Purchase Closing Costs">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Title & Closing Costs">
                  <NumInput value={financials.title_closing_costs} onBlur={handleBlur('title_closing_costs')} disabled={!canEdit} />
                </Field>
                <Field label="Other">
                  <NumInput value={financials.purchase_closing_costs_other} onBlur={handleBlur('purchase_closing_costs_other')} disabled={!canEdit} />
                </Field>
              </div>
            </Card>

            {/* Holding Costs */}
            <Card title="Holding Costs (Monthly)">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <Field label="Insurance">
                  <NumInput value={financials.insurance_monthly} onBlur={handleBlur('insurance_monthly')} disabled={!canEdit} />
                </Field>
                <Field label="Utilities">
                  <NumInput value={financials.utilities_monthly} onBlur={handleBlur('utilities_monthly')} disabled={!canEdit} />
                </Field>
                <Field label="Taxes">
                  <NumInput value={financials.taxes_monthly} onBlur={handleBlur('taxes_monthly')} disabled={!canEdit} />
                </Field>
                <Field label="HOA">
                  <NumInput value={financials.hoa_monthly} onBlur={handleBlur('hoa_monthly')} disabled={!canEdit} />
                </Field>
                <Field label="Misc">
                  <NumInput value={financials.misc_holding_monthly} onBlur={handleBlur('misc_holding_monthly')} disabled={!canEdit} />
                </Field>
              </div>
            </Card>
```

- [ ] **Step 6: Add Renovation Items and Deal Summary**

Append to the JSX (after Holding Costs card):

```jsx
            {/* Renovation Items */}
            <DealRenovationItems leadId={leadId} workspaceId={workspaceId} canEdit={canEdit} items={items} onItemsChange={setItems} />

            {/* Deal Summary */}
            {calc && (
              <Card title="Deal Summary">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider font-medium text-[color:var(--color-text-dim)] mb-2">Costs</div>
                    <MetricRow label="Purchase Price"       value={fmtUSD(financials.purchase_price_actual)} />
                    <MetricRow label="HML Closing Costs"   value={fmtUSD(calc.hmlClosingCosts)} />
                    <MetricRow label="Purchase Closing"    value={fmtUSD(calc.purchaseClosing)} />
                    <MetricRow label="Renovation"          value={fmtUSD(calc.totalRenovationCost)} />
                    <MetricRow label="Holding Costs"       value={fmtUSD(calc.totalHoldingCosts)} />
                    <MetricRow label="Total All-In Cost"   value={fmtUSD(calc.totalAllInCost)} highlight />
                    <MetricRow label="Total Cash Invested" value={fmtUSD(calc.totalCashInvested)} highlight />
                    <MetricRow label="Break-Even Price"    value={fmtUSD(calc.breakEvenPrice)} />
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider font-medium text-[color:var(--color-text-dim)] mb-2">Profit</div>
                    {calc.expected && (
                      <>
                        <MetricRow label="Expected Sale Price"   value={fmtUSD(calc.expected.sellPrice)} />
                        <MetricRow label="Selling Costs"         value={fmtUSD(calc.expected.sellingCosts)} />
                        <MetricRow label="Expected Net Profit"   value={fmtUSD(calc.expected.netProfit)} highlight />
                        <MetricRow label="Expected ROI"          value={fmtPct(calc.expected.roi)} highlight />
                      </>
                    )}
                    {calc.actual && (
                      <>
                        <div className="mt-3 mb-1 text-[10px] uppercase tracking-wider font-medium text-[color:var(--color-success-text)]">Actual (Sold)</div>
                        <MetricRow label="Actual Sale Price"     value={fmtUSD(calc.actual.sellPrice)} />
                        <MetricRow label="Actual Net Profit"     value={fmtUSD(calc.actual.netProfit)} highlight />
                        <MetricRow label="Actual ROI"            value={fmtPct(calc.actual.roi)} highlight />
                      </>
                    )}
                    {/* Deal Rating */}
                    <div className="mt-4 flex items-center gap-2">
                      <span className="text-[11px] text-[color:var(--color-text-dim)]">Deal Rating</span>
                      <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-semibold ${dealRatingColor(calc.dealRating)}`}>
                        {calc.dealRating?.split(' - ')[0] || '—'}
                      </span>
                    </div>
                    {/* Warning flags */}
                    {calc.warnings?.map((w, i) => (
                      <div key={i} className="mt-2 text-[11px] text-[color:var(--color-warn)] flex items-center gap-1">
                        ⚠ {w}
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            )}
          </>
        )}
      </div>

      {financials && (
        <DealImportModal
          open={importOpen}
          onClose={() => setImportOpen(false)}
          onImport={handleImport}
        />
      )}
    </>
  )
}
```

- [ ] **Step 7: Check DealRenovationItems props**

Open `src/components/lead-detail/DealRenovationItems.jsx` and verify its props signature. If it uses internal state to load its own items (fetching by `leadId`), no changes needed — just pass `leadId` and `workspaceId`. If it requires `items` + `onItemsChange` props, the step above already passes them. Adjust the `<DealRenovationItems>` render in Step 6 to match whichever pattern the component actually uses.

- [ ] **Step 8: Verify build passes**

```bash
npm run build
```
Expected: `✓ built in ~16s` with no errors.

- [ ] **Step 9: Commit**

```bash
git add src/pages/ProjectDetailPage.jsx
git commit -m "feat: create ProjectDetailPage with property summary, financials, renovation items, deal summary"
```

---

## Task 4: Wire ProjectDetailPage into App Router

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Add import**

In `src/App.jsx`, add after the existing `ProjectsPage` import (line ~15):
```js
import ProjectDetailPage from './pages/ProjectDetailPage'
```

- [ ] **Step 2: Add route**

In the `/w/:workspaceId` nested routes block, add after the existing `projects` route:
```jsx
<Route path="projects" element={<ProjectsPage />} />
<Route path="projects/:leadId" element={<ProjectDetailPage />} />
```

- [ ] **Step 3: Verify build passes**

```bash
npm run build
```
Expected: `✓ built in ~16s` with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx
git commit -m "feat: add projects/:leadId route for project detail page"
```

---

## Task 5: End-to-End Verification

- [ ] **Step 1: Run dev server**

```bash
npm run dev
```

- [ ] **Step 2: Test Create Project flow**

1. Open any lead that is NOT yet `working_project` or `sold`
2. Confirm "Create Project" button appears in the header (next to "Edit lead")
3. Click "Create Project"
4. Confirm: lead status changes to `working_project` (check the status pipeline area)
5. Confirm: navigates to `/w/:id/projects/:leadId`
6. Confirm: Project detail page loads with the lead's address, beds/baths, ARV, agent name in the Property Summary card

- [ ] **Step 3: Test financial inputs**

1. On the project detail page, fill in Purchase Price → tab out
2. Fill in Hold Months, Expected Sale Price → tab out after each
3. Confirm Deal Summary updates live with correct totals
4. Add a renovation line item → confirm it appears and totals update

- [ ] **Step 4: Test View Project button**

1. Navigate back to the lead detail page for the same lead
2. Confirm button now shows "View Project →" instead of "Create Project"
3. Click it → confirm it navigates to the project detail page

- [ ] **Step 5: Test Projects list**

1. Navigate to the Projects page (sidebar)
2. Confirm the promoted lead appears in the table
3. Confirm clicking the row navigates to the project detail page (not lead detail)
4. Confirm leads that are NOT `working_project` or `sold` do NOT appear

- [ ] **Step 6: Test DealFinancialsSection is gone from lead detail**

1. Open any lead detail page
2. Scroll through — confirm there is no "Project Financials" or "Deal Tracking" section
3. Confirm `ScenariosFlat` (the quick ARV/renovation calculator) still shows

- [ ] **Step 7: Final build**

```bash
npm run build
```
Expected: `✓ built` with no errors.

- [ ] **Step 8: Push**

```bash
git push origin main
```
