# Projects Redesign — Design Spec
**Date:** 2026-06-08
**Status:** Approved

---

## Context

The deal financials feature was just built and wired into the lead detail page. The user wants a cleaner separation: leads are for evaluating properties, projects are for managing active deals. A lead gets explicitly promoted to a project via a button, and all financial tracking lives in the project entity — not the lead.

---

## What Changes

### Lead Detail Page

- **Remove** `DealFinancialsSection` (the full financial input form — was just added, now removed)
- **Keep** `ScenariosFlat` (quick conservative/expected/optimistic calc stays on the lead)
- **Add** a "Create Project" / "View Project →" button in the lead header action area:
  - If `lead.status` is NOT `working_project` or `sold`: show **"Create Project"** button
  - Clicking it: sets `lead.status = 'working_project'`, creates a `deal_financials` row seeded from `lead.offer_price` (purchase) and `lead.arv` (expected sell), then navigates to `/w/:workspaceId/projects/:leadId`
  - If lead is already a project: show **"View Project →"** link that navigates to the project detail page

### Projects List Page (`/w/:id/projects`)

- Already built as `ProjectsPage.jsx` — keep as-is with one change:
- **Filter:** show only leads with `status IN ('working_project', 'sold')` — i.e. only explicitly promoted leads, not offer_accepted or any other status
- Each row links to `/w/:id/projects/:leadId` (the new project detail page, not the lead detail)
- Existing stats bar, table, analytics remain

### New: Project Detail Page (`/w/:id/projects/:leadId`)

New page at `src/pages/ProjectDetailPage.jsx`.

**Header bar**
- ← Back to Projects (navigates to `/projects`)
- Property address + status badge (`Active Project` / `Sold`)
- "View Lead →" link that opens `/leads/:leadId`

**Property Summary card** — read-only, pulled from the lead record
- Address, city, state
- Beds / Baths / Sqft / Year built
- Purchase price (from `lead.offer_price` or `lead.asking_price`)
- ARV (from `lead.arv`)
- Listing agent name

**Financial Inputs** — editable, saved to `deal_financials`
- Hard Money Loan: lender amount, interest rate %, points %, title lender insurance, interest portion, doc stamps, intangible tax, extension fee
- Purchase Closing Costs: title & closing costs, other
- Holding Costs (monthly): insurance, utilities, taxes, HOA, misc; plus hold months
- Assumptions: selling cost %, LTV %, renovation financing (Cash/Financed), points charged on

**Renovation Items** — the full `DealRenovationItems` table (categories, estimated vs actual cost, status per item)

**Expected Sale Price** — single input field (`expected_sell_price`). No conservative/optimistic scenarios here.

**Actual Sale** — `actual_sale_price` + `sold_date` fields (always visible, filled when property sells)

**Deal Summary** — live-calculated, read-only display
- Total all-in cost
- Total cash invested
- Expected profit & ROI (from expected_sell_price)
- Actual profit & ROI (from actual_sale_price, shown when filled)
- Break-even sale price
- Deal rating badge (A/B/C/D)
- Warning flags (all-in vs ARV > 75%, profit < $30K)

---

## Files Changed

| Action | Path |
|---|---|
| Modify | `src/pages/LeadDetailPage.jsx` — remove DealFinancialsSection import/render; add Create Project / View Project button |
| Modify | `src/pages/ProjectsPage.jsx` — filter to `working_project` + `sold` only; row links to project detail |
| Modify | `src/App.jsx` — add route `projects/:leadId` → ProjectDetailPage |
| Create | `src/pages/ProjectDetailPage.jsx` — new project detail page |

`DealFinancialsSection.jsx`, `DealRenovationItems.jsx`, `DealImportModal.jsx`, `dealCalculations.js` — kept as-is, reused by ProjectDetailPage.

---

## "Create Project" Button Logic

```js
const isProject = ['working_project', 'sold'].includes(lead.status)

// If not a project:
// 1. PATCH leads SET status='working_project' WHERE id=lead.id
// 2. INSERT deal_financials { lead_id, workspace_id, purchase_price_actual: lead.offer_price, expected_sell_price: lead.arv }
// 3. navigate(`/w/${workspaceId}/projects/${lead.id}`)

// If already a project:
// Show "View Project →" link to /projects/:leadId
```

The button lives in the `LeadDetailHeader` action area (same row as Edit button), visible to `canEdit` users only.

---

## Routing

```jsx
// In App.jsx, inside /w/:workspaceId nested routes:
<Route path="projects" element={<ProjectsPage />} />
<Route path="projects/:leadId" element={<ProjectDetailPage />} />
```

---

## Verification

1. Open any lead → confirm "Create Project" button appears in header
2. Click it → lead status becomes `working_project`, navigates to `/projects/:leadId`
3. Project detail page loads with property summary from lead + empty financial inputs
4. Fill in HML fields → they save on blur
5. Add renovation line items → totals update live
6. Fill in expected sale price → Deal Summary updates live
7. Return to lead detail → button now shows "View Project →"
8. Navigate to Projects page → lead appears in list (not before clicking Create Project)
9. Fill actual sale price → actual profit/ROI appear in Deal Summary
10. `npm run build` passes
