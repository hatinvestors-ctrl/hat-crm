import { escapeLike } from './safeQuery.js'
// `supabase` is imported lazily inside findDuplicateLeads() below (Capability
// #9) rather than statically here, so the pure normalizeAddress()/
// normalizeAddressForDB()/streetCore() helpers in this file stay importable
// from plain Node scripts (e.g. scripts/enrich-property-cli.mjs) without
// pulling in src/lib/supabase.js, which requires Vite's import.meta.env and
// crashes under plain `node`. No behavior change for existing callers —
// Vite/webpack handle dynamic import() the same as static for bundled code.

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

const STREET_SUFFIXES = new Set([
  'street', 'st', 'road', 'rd', 'drive', 'dr', 'avenue', 'ave', 'av',
  'boulevard', 'blvd', 'lane', 'ln', 'court', 'ct', 'circle', 'cir',
  'parkway', 'pkwy', 'highway', 'hwy', 'terrace', 'ter', 'place', 'pl',
  'way', 'trail', 'trl', 'run', 'path', 'loop',
])

// Extract house number and street name words without suffix for fuzzy matching.
// "2712 cherrywood road" → { num: "2712", words: ["cherrywood"] }
// Exported (Capability #9) so src/lib/propertyEnrichment.js can reuse the exact
// same house-number/street-name split for public-record address matching,
// instead of re-implementing it.
export function streetCore(norm) {
  const parts = norm.split(' ')
  if (parts.length < 2) return null
  const num = parts[0]
  if (!/^\d/.test(num)) return null
  const words = parts.slice(1).filter(w => !STREET_SUFFIXES.has(w))
  if (!words.length) return null
  return { num, words: words.join(' ') }
}

// Returns array of leads with the same (normalized) address in the workspace.
// Optionally excludes a specific lead id (when editing).
// Each result has a `fuzzy` boolean — true means suffix-only difference (soft warning).
export async function findDuplicateLeads(workspaceId, address, excludeLeadId = null) {
  if (!workspaceId || !address?.trim()) return []
  const norm = normalizeAddress(address)
  if (norm.length < 4) return []
  const { supabase } = await import('./supabase.js')

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

  const inputCore = streetCore(norm)
  const seen = new Set()
  const results = []

  for (const l of data) {
    const lNorm = normalizeAddress(l.address)
    const exact = lNorm === norm
    let fuzzy = false
    if (!exact && inputCore) {
      const lCore = streetCore(lNorm)
      fuzzy = lCore?.num === inputCore.num && lCore?.words === inputCore.words
    }
    if ((exact || fuzzy) && !seen.has(l.id)) {
      seen.add(l.id)
      results.push({ ...l, fuzzy: !exact })
    }
  }
  return results
}
