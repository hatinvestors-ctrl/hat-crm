# Duplicate Lead Prevention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a database-level unique constraint on `(workspace_id, normalized_address)` in the leads table, clean up existing duplicates first, and surface a friendly error in the UI when the constraint is violated.

**Architecture:** A Supabase SQL migration creates an expression unique index that normalizes addresses at the DB level. Before the migration runs, a cleanup script finds and deletes duplicate leads (keeping the oldest). The two UI insert points (LeadForm and CSVImport) catch Postgres error code `23505` and show a user-friendly message instead of a raw DB error.

**Tech Stack:** Supabase (Postgres), React (JSX), Supabase JS client (`@supabase/supabase-js`)

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `supabase/migrations/20260605000000_leads_unique_address.sql` | Create | Unique expression index on leads |
| `scripts/cleanup-duplicate-leads.mjs` | Create | One-time script to delete duplicates before migration |
| `src/components/leads/LeadForm.jsx` | Modify | Catch `23505` on insert, show friendly message |
| `src/components/leads/CSVImport.jsx` | Modify | Catch `23505` on bulk insert, report skipped addresses |

---

## Task 1: Write the cleanup script

Find all duplicate leads per workspace (by normalized address) and delete all but the oldest one.

**Files:**
- Create: `scripts/cleanup-duplicate-leads.mjs`

- [ ] **Step 1: Create the script**

```js
// scripts/cleanup-duplicate-leads.mjs
// Run once before applying the unique-address migration.
// Finds duplicate leads per workspace (by normalized address) and deletes
// all but the oldest (earliest created_at).
import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Same normalization the migration will use:
//   LOWER(REGEXP_REPLACE(address, '[.,\s#]+', ' ', 'g'))
// We replicate it in JS to preview what will be deleted.
function normalizeAddr(addr) {
  return addr.replace(/[.,\s#]+/g, ' ').toLowerCase().trim()
}

const { data: leads, error } = await supabase
  .from('leads')
  .select('id, workspace_id, address, created_at')
  .order('created_at', { ascending: true })

if (error) { console.error('Fetch failed:', error.message); process.exit(1) }

// Group by (workspace_id, normalizedAddress)
const groups = new Map()
for (const lead of leads) {
  const key = `${lead.workspace_id}::${normalizeAddr(lead.address)}`
  if (!groups.has(key)) groups.set(key, [])
  groups.get(key).push(lead)
}

// Collect IDs to delete (all but first/oldest in each group)
const toDelete = []
for (const [, group] of groups) {
  if (group.length > 1) {
    const [keep, ...dupes] = group // already sorted oldest-first
    console.log(`Keep: ${keep.id} "${keep.address}" (${keep.created_at})`)
    for (const d of dupes) {
      console.log(`  Delete: ${d.id} "${d.address}" (${d.created_at})`)
      toDelete.push(d.id)
    }
  }
}

if (!toDelete.length) {
  console.log('No duplicates found. Safe to run migration.')
  process.exit(0)
}

console.log(`\nDeleting ${toDelete.length} duplicate lead(s)…`)
const { error: delErr } = await supabase
  .from('leads')
  .delete()
  .in('id', toDelete)

if (delErr) { console.error('Delete failed:', delErr.message); process.exit(1) }
console.log('Done. Safe to run migration.')
```

- [ ] **Step 2: Run the script (dry-run pass — just review output, script logs before deleting)**

```bash
node scripts/cleanup-duplicate-leads.mjs
```

Expected output (will vary):
```
Keep: <uuid> "2852 Ernest Street" (2026-05-01T...)
  Delete: <uuid> "2852 Ernest St" (2026-05-15T...)

Deleting 1 duplicate lead(s)…
Done. Safe to run migration.
```

If output says "No duplicates found" — skip to Task 2.

- [ ] **Step 3: Commit**

```bash
git add scripts/cleanup-duplicate-leads.mjs
git commit -m "script: add one-time cleanup for duplicate leads before migration"
```

---

## Task 2: Create the Supabase migration

**Files:**
- Create: `supabase/migrations/20260605000000_leads_unique_address.sql`

- [ ] **Step 1: Create the migrations directory and migration file**

```bash
mkdir -p supabase/migrations
```

```sql
-- supabase/migrations/20260605000000_leads_unique_address.sql
-- Prevents duplicate leads per workspace by normalized address.
-- Normalization: lowercase, collapse punctuation/spaces/# to a single space.
CREATE UNIQUE INDEX leads_workspace_address_unique_idx
ON leads (
  workspace_id,
  LOWER(REGEXP_REPLACE(address, '[.,\s#]+', ' ', 'g'))
);
```

- [ ] **Step 2: Apply the migration to your Supabase project**

Go to your Supabase dashboard → SQL Editor, paste the SQL above, and run it.

Expected: `CREATE INDEX` success message. If you see a unique constraint violation error, re-run the cleanup script from Task 1 first.

- [ ] **Step 3: Verify the index exists**

In Supabase SQL Editor:
```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'leads' AND indexname = 'leads_workspace_address_unique_idx';
```

Expected: one row with the index definition.

- [ ] **Step 4: Verify the constraint works**

In Supabase SQL Editor, try inserting a duplicate (replace the IDs/address with real values from your data):
```sql
-- This should fail with: ERROR: duplicate key value violates unique constraint
INSERT INTO leads (workspace_id, address, status, created_by)
SELECT workspace_id, address, 'new_lead', created_by
FROM leads
LIMIT 1;
```

Expected: `ERROR: duplicate key value violates unique constraint "leads_workspace_address_unique_idx"`

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260605000000_leads_unique_address.sql
git commit -m "feat: add unique constraint on leads address per workspace"
```

---

## Task 3: Handle the constraint error in LeadForm

When a user creates a lead that hits the unique index, catch error code `23505` and show a clear message instead of the raw Postgres error.

**Files:**
- Modify: `src/components/leads/LeadForm.jsx:244-252`

- [ ] **Step 1: Update the insert block in `handleSubmit`**

Find this block (around line 244):

```js
      } else {
        payload.workspace_id = workspaceId
        payload.created_by = userId
        const { data: created, error: insErr } = await supabase
          .from('leads')
          .insert(payload)
          .select()
          .single()
        if (insErr) throw insErr
        await logLeadCreated(created.id, userId)
        onSaved?.(created)
      }
```

Replace with:

```js
      } else {
        payload.workspace_id = workspaceId
        payload.created_by = userId
        const { data: created, error: insErr } = await supabase
          .from('leads')
          .insert(payload)
          .select()
          .single()
        if (insErr) {
          if (insErr.code === '23505') {
            throw new Error('A lead with this address already exists in your workspace.')
          }
          throw insErr
        }
        await logLeadCreated(created.id, userId)
        onSaved?.(created)
      }
```

- [ ] **Step 2: Also remove the "Create anyway" path from being a bypass**

The `forceDuplicate` checkbox currently lets users bypass the app-level dedup check. Now that the DB enforces uniqueness, a user checking "Create anyway" will hit the DB constraint and get the error above. No code change needed — the existing UI flow is acceptable: the warning still appears, but the override no longer works for true duplicates. This is intentional.

- [ ] **Step 3: Commit**

```bash
git add src/components/leads/LeadForm.jsx
git commit -m "feat: catch DB unique constraint violation in LeadForm with friendly error"
```

---

## Task 4: Handle the constraint error in CSVImport

When a bulk import hits the unique index, report which rows were skipped rather than aborting the whole import.

**Files:**
- Modify: `src/components/leads/CSVImport.jsx:150-156`

- [ ] **Step 1: Switch bulk insert to row-by-row on constraint violation**

Find this block (around line 150):

```js
      const { data, error: insErr } = await supabase.from('leads').insert(deduped).select('id')
      if (insErr) throw insErr
      setResult({
        imported: data.length,
        skipped: rows.length - records.length,
        duplicatesSkipped,
      })
      onDone?.()
```

Replace with:

```js
      // Try bulk insert first; if any row hits the unique constraint, fall back to row-by-row
      let imported = 0
      let dbDuplicatesSkipped = 0
      const { data: bulkData, error: bulkErr } = await supabase.from('leads').insert(deduped).select('id')
      if (bulkErr && bulkErr.code === '23505') {
        // Fall back: insert one by one, skip constraint violations
        for (const rec of deduped) {
          const { error: rowErr } = await supabase.from('leads').insert(rec).select('id').single()
          if (rowErr?.code === '23505') {
            dbDuplicatesSkipped++
          } else if (rowErr) {
            throw rowErr
          } else {
            imported++
          }
        }
      } else if (bulkErr) {
        throw bulkErr
      } else {
        imported = bulkData.length
      }

      setResult({
        imported,
        skipped: rows.length - records.length,
        duplicatesSkipped: duplicatesSkipped + dbDuplicatesSkipped,
      })
      onDone?.()
```

- [ ] **Step 2: Commit**

```bash
git add src/components/leads/CSVImport.jsx
git commit -m "feat: handle DB unique constraint in CSVImport, skip duplicates row-by-row"
```

---

## Task 5: Manual verification

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Test LeadForm duplicate rejection**

1. Open the app, go to Leads, click "New Lead"
2. Enter the address of an existing lead (e.g. one you know is already in the DB)
3. Uncheck "Create anyway" (or don't check it) and click "Create Lead"
4. Expected: the app-level warning banner appears
5. Check "Create anyway" and click "Create Lead"
6. Expected: error message "A lead with this address already exists in your workspace." (from DB constraint)

- [ ] **Step 3: Test CSVImport duplicate handling**

1. Create a small CSV with one new address and one address that already exists in the DB:
   ```
   Address,City,State
   9999 New Street,Jacksonville,FL
   2852 Ernest Street,Jacksonville,FL
   ```
2. Import it via the CSV Import page
3. Expected result banner: "Imported 1 lead. Skipped 1 duplicate address."
