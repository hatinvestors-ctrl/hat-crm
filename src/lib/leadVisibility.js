// src/lib/leadVisibility.js

/**
 * Applies a Supabase visibility filter for non-admin users.
 * Admins see all leads. Members/readonly see only:
 *   - leads they created
 *   - leads assigned to them
 *   - leads marked visible_to_all
 */
export function applyLeadVisibility(query, userId, userRole) {
  if (userRole === 'admin') return query
  return query.or(`created_by.eq.${userId},assigned_to.eq.${userId},visible_to_all.eq.true`)
}
