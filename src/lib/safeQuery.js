// Sanitizers for user-supplied values that get fed into Supabase queries.
//
// Why this exists:
//   1. PostgREST .or() treats commas, parens, and dots as syntax. Unescaped
//      user input lets an attacker inject extra filter clauses.
//   2. PostgreSQL ilike treats `%` and `_` as wildcards. Without escaping, a
//      user typing `%` matches everything.
//
// We use these wrappers everywhere user input goes into .or() / .ilike() filters.

// Escape PostgreSQL LIKE/ILIKE metacharacters so they're treated literally.
// `\` itself must be escaped first to avoid double-escape.
export function escapeLike(s) {
  if (s === null || s === undefined) return ''
  return String(s).replace(/[\\%_]/g, '\\$&')
}

// Reject any character that has meaning inside a PostgREST .or() expression.
// We don't need to allow them — every CRM filter is plain alphanumeric text.
// Strip them rather than escape (PostgREST escaping rules are fragile).
export function sanitizeForOr(s) {
  if (s === null || s === undefined) return ''
  return String(s).replace(/[,()*]/g, ' ').replace(/\s+/g, ' ').trim()
}

// Combined helper for the common case: prep a value for a PostgREST .or() expression
// where it'll be wrapped in `%...%` ilike syntax.
export function safeOrIlikeValue(s) {
  return escapeLike(sanitizeForOr(s))
}
