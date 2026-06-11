// Admin user management via Supabase Auth Admin API.
// POST /.netlify/functions/admin-users
// body: { action: 'create'|'update'|'delete', workspace_id, ...fields }
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY

const HEADERS = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-allow-methods': 'POST,OPTIONS',
}

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`,
  }
}

async function findUserByEmail(email) {
  // Search auth users by email via admin API
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}&page=1&per_page=1`, {
    headers: authHeaders(),
  })
  if (!res.ok) return null
  const data = await res.json()
  const users = data.users || []
  return users.find(u => u.email?.toLowerCase() === email.toLowerCase()) || null
}

async function createUser({ email, password, full_name, role, workspace_id }) {
  // 1. Try to create auth user; if already exists, look them up instead
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name } }),
  })
  const body = await res.json()

  let userId
  if (!res.ok) {
    // If already registered, find existing user and just add to workspace
    if (body.message?.includes('already been registered') || body.code === 'email_exists') {
      const existing = await findUserByEmail(email)
      if (!existing) throw new Error(body.message || 'User already exists but could not be found.')
      userId = existing.id
    } else {
      throw new Error(body.message || body.msg || 'Failed to create auth user')
    }
  } else {
    userId = body.id
  }

  // 2. Upsert profile
  await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
    method: 'POST',
    headers: { ...authHeaders(), Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ id: userId, full_name }),
  })

  // 3. Upsert workspace member (in case they're already a member, update role)
  const memRes = await fetch(`${SUPABASE_URL}/rest/v1/workspace_members?workspace_id=eq.${workspace_id}&user_id=eq.${userId}`, {
    method: 'POST',
    headers: { ...authHeaders(), Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ workspace_id, user_id: userId, role }),
  })
  if (!memRes.ok) {
    const err = await memRes.text()
    throw new Error(`Failed to add workspace member: ${err}`)
  }

  return { user_id: userId, full_name, email, role }
}

async function updateUser({ user_id, email, password, full_name, role, workspace_id }) {
  // Update auth user (email/password)
  const patch = {}
  if (email) patch.email = email
  if (password) patch.password = password
  if (full_name) patch.user_metadata = { full_name }

  if (Object.keys(patch).length > 0) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user_id}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(patch),
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.message || 'Failed to update auth user')
    }
  }

  // Update profile name
  if (full_name) {
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user_id}`, {
      method: 'PATCH',
      headers: { ...authHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify({ full_name }),
    })
  }

  // Update role
  if (role && workspace_id) {
    await fetch(`${SUPABASE_URL}/rest/v1/workspace_members?workspace_id=eq.${workspace_id}&user_id=eq.${user_id}`, {
      method: 'PATCH',
      headers: { ...authHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify({ role }),
    })
  }

  return { ok: true }
}

async function getUser({ user_id }) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user_id}`, {
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error('Failed to fetch user')
  const u = await res.json()
  return { email: u.email || '' }
}

async function deleteUser({ user_id, workspace_id }) {
  // Remove from workspace
  await fetch(`${SUPABASE_URL}/rest/v1/workspace_members?workspace_id=eq.${workspace_id}&user_id=eq.${user_id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })

  // Delete auth user
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user_id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || 'Failed to delete user')
  }

  return { ok: true }
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS })
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: HEADERS })

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return new Response(JSON.stringify({ error: 'Supabase credentials not configured.' }), { status: 500, headers: HEADERS })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const { action, ...payload } = body

    let result
    if (action === 'create') result = await createUser(payload)
    else if (action === 'update') result = await updateUser(payload)
    else if (action === 'delete') result = await deleteUser(payload)
    else if (action === 'get') result = await getUser(payload)
    else throw new Error(`Unknown action: ${action}`)

    return new Response(JSON.stringify(result), { status: 200, headers: HEADERS })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || String(err) }), { status: 500, headers: HEADERS })
  }
}
