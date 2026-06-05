# Duplicate Lead Prevention — Design Spec

**Date:** 2026-06-05  
**Status:** Approved  
**Scope:** Add a database-level unique constraint on leads address per workspace, clean up existing duplicates, and handle the constraint error gracefully in the UI.

---

## Problem

The `leads` table has no unique constraint on address. All duplicate prevention is application-level only, which means duplicates can slip through via:
- Different normalization logic across import scripts
- Race conditions between concurrent inserts
- Scripts that have no dedup logic at all (e.g. `insert-redfin-leads.mjs`)
- Manual "Create anyway" override in the UI

A known duplicate exists: **2852 Ernest Street, Jacksonville FL 32205**.

---

## Solution

### 1. Clean Up Existing Duplicates

Before adding the constraint, find all duplicate address groups (per workspace) and delete the newer duplicate(s), keeping the oldest record.

Run a SQL query to identify duplicates, then delete all but the earliest `created_at` per `(workspace_id, normalized_address)` group.

### 2. Add Unique Expression Index (Migration)

```sql
CREATE UNIQUE INDEX leads_workspace_address_unique_idx
ON leads (
  workspace_id,
  LOWER(REGEXP_REPLACE(address, '[.,\s#]+', ' ', 'g'))
);
```

- Scoped per workspace (multi-tenant safe)
- Normalizes case, punctuation, and whitespace
- "Ernest Street", "Ernest St", "ernest  street" all produce the same normalized key
- Applied via Supabase migration file

### 3. Handle Constraint Violation in UI

Two places do lead inserts in the frontend:

**LeadForm.jsx** — manual lead creation  
Catch Postgres error code `23505` (unique_violation) on the `.insert()` call and show: _"A lead with this address already exists in your workspace."_

**CSVImport.jsx** — bulk CSV import  
On bulk insert, if any row triggers `23505`, surface which addresses were skipped as duplicates in the import summary.

---

## What's NOT in Scope

- Normalizing import scripts (they will simply get a DB error on duplicate, which is acceptable)
- Merging duplicate leads (out of scope for now)
- UI for finding/resolving duplicates

---

## Files Affected

| File | Change |
|---|---|
| `supabase/migrations/YYYYMMDDHHMMSS_leads_unique_address.sql` | New migration with unique index |
| `src/components/leads/LeadForm.jsx` | Catch `23505` error, show friendly message |
| `src/components/leads/CSVImport.jsx` | Catch `23505` errors per row, report skipped |

---

## Success Criteria

- No two leads in the same workspace can have the same normalized address
- Attempting to create a duplicate via the UI shows a clear, friendly error
- Existing duplicate (2852 Ernest St) is cleaned up before migration runs
- Migration applies cleanly to production Supabase
