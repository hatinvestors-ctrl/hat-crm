import { supabase } from './supabase'
import { escapeLike } from './safeQuery'

// Normalize for comparison: lowercase, strip punctuation, collapse spaces,
// expand common abbreviations so "5959 Buckley Dr" matches "5959 buckley drive".
export function normalizeAddress(s) {
  if (!s) return ''
  let n = String(s).toLowerCase()
    .replace(/[.,#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  // Expand common suffix abbreviations to their full form
  const map = [
    [/\b(st|str)\b\.?/g,    'street'],
    [/\b(rd)\b\.?/g,        'road'],
    [/\b(dr)\b\.?/g,        'drive'],
    [/\b(ave|av)\b\.?/g,    'avenue'],
    [/\b(blvd)\b\.?/g,      'boulevard'],
    [/\b(ln)\b\.?/g,        'lane'],
    [/\b(ct)\b\.?/g,        'court'],
    [/\b(cir)\b\.?/g,       'circle'],
    [/\b(pkwy)\b\.?/g,      'parkway'],
    [/\b(hwy)\b\.?/g,       'highway'],
    [/\b(ter)\b\.?/g,       'terrace'],
    [/\b(pl)\b\.?/g,        'place'],
    [/\b(n|north)\b\.?/g,   'n'],
    [/\b(s|south)\b\.?/g,   's'],
    [/\b(e|east)\b\.?/g,    'e'],
    [/\b(w|west)\b\.?/g,    'w'],
  ]
  map.forEach(([re, rep]) => { n = n.replace(re, rep) })
  return n.replace(/\s+/g, ' ').trim()
}

// Mirrors the SQL index normalization exactly:
//   TRIM(LOWER(REGEXP_REPLACE(address, '[.,\s#]+', ' ', 'g')))
// Use this for pre-dedup checks against DB data (e.g. CSV import).
export function normalizeAddressForDB(addr) {
  if (!addr) return ''
  return addr.replace(/[.,\s#]+/g, ' ').toLowerCase().trim()
}

// Returns array of leads with the same (normalized) address in the workspace.
// Optionally excludes a specific lead id (when editing).
export async function findDuplicateLeads(workspaceId, address, excludeLeadId = null) {
  if (!workspaceId || !address?.trim()) return []
  const norm = normalizeAddress(address)
  if (norm.length < 4) return []

  // Coarse SQL prefilter — use the first numeric part (street number) to narrow results
  const firstToken = norm.split(' ')[0]
  let q = supabase
    .from('leads')
    .select('id, address, city, status, follow_up_date')
    .eq('workspace_id', workspaceId)
    .ilike('address', `${escapeLike(firstToken)}%`)
    .limit(25)
  if (excludeLeadId) q = q.neq('id', excludeLeadId)

  const { data, error } = await q
  if (error || !data) return []
  return data.filter(l => normalizeAddress(l.address) === norm)
}
