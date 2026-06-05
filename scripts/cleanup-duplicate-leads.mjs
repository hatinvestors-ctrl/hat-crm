// scripts/cleanup-duplicate-leads.mjs
// Run once before applying the unique-address migration.
// Finds duplicate leads per workspace (by normalized address) and deletes
// all but the oldest (earliest created_at).
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// Load .env manually (no dotenv package needed)
const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dirname, '..', '.env')
const envVars = {}
try {
  const envContent = readFileSync(envPath, 'utf8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim()
    envVars[key] = val
  }
} catch (e) {
  console.error('Could not load .env:', e.message)
  process.exit(1)
}

const SUPABASE_URL = envVars.VITE_SUPABASE_URL || envVars.SUPABASE_URL
const SERVICE_ROLE_KEY = envVars.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

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

console.log(`Fetched ${leads.length} leads.`)

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
