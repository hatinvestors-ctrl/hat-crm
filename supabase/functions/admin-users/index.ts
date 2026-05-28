// Edge Function: admin-users
// Admin-only operations on Supabase Auth users (create / update / delete).
// Verifies caller is a workspace admin before doing anything privileged.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonError('Missing Authorization header', 401)

    // 1. Verify the caller via their JWT
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser()
    if (callerErr || !caller) return jsonError('Invalid token', 401)

    // 2. Service-role client for privileged operations
    const admin = createClient(supabaseUrl, serviceRoleKey)

    const body = await req.json()
    const { action, workspace_id } = body
    if (!workspace_id) return jsonError('workspace_id is required', 400)

    // 3. Verify caller is an admin of that workspace
    const { data: membership, error: memErr } = await admin
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspace_id)
      .eq('user_id', caller.id)
      .single()
    if (memErr || !membership) return jsonError('Not a member of this workspace', 403)
    if (membership.role !== 'admin') return jsonError('Admin role required', 403)

    // 4. Dispatch
    if (action === 'create') {
      const { email, password, full_name, role } = body
      if (!email || !password) return jsonError('email and password are required', 400)
      if (password.length < 6) return jsonError('Password must be at least 6 characters', 400)
      if (!['admin','regular','readonly'].includes(role)) return jsonError('Invalid role', 400)

      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: full_name || email.split('@')[0] },
      })
      if (createErr) return jsonError(createErr.message, 400)

      // Profile is auto-created by the on_auth_user_created trigger.
      // Add to workspace
      const { error: wmErr } = await admin.from('workspace_members').insert({
        workspace_id, user_id: created.user.id, role, invited_by: caller.id,
      })
      if (wmErr) return jsonError(wmErr.message, 400)

      return jsonOk({ user: created.user })
    }

    if (action === 'update') {
      const { user_id, email, password, full_name, role } = body
      if (!user_id) return jsonError('user_id is required', 400)

      // Update auth fields
      const authUpdates: Record<string, unknown> = {}
      if (email) authUpdates.email = email
      if (password) {
        if (password.length < 6) return jsonError('Password must be at least 6 characters', 400)
        authUpdates.password = password
      }
      if (full_name !== undefined) authUpdates.user_metadata = { full_name }
      if (Object.keys(authUpdates).length) {
        const { error: authErr } = await admin.auth.admin.updateUserById(user_id, authUpdates)
        if (authErr) return jsonError(authErr.message, 400)
      }

      // Sync profile
      if (full_name !== undefined) {
        await admin.from('profiles').update({ full_name }).eq('id', user_id)
      }

      // Update workspace role (only within this workspace)
      if (role) {
        if (!['admin','regular','readonly'].includes(role)) return jsonError('Invalid role', 400)
        // Prevent admin from demoting themselves to leave the workspace without an admin
        if (user_id === caller.id && role !== 'admin') {
          const { count } = await admin
            .from('workspace_members')
            .select('id', { count: 'exact', head: true })
            .eq('workspace_id', workspace_id)
            .eq('role', 'admin')
          if (!count || count <= 1) return jsonError('Cannot demote the last admin', 400)
        }
        const { error: wmErr } = await admin
          .from('workspace_members')
          .update({ role })
          .eq('workspace_id', workspace_id)
          .eq('user_id', user_id)
        if (wmErr) return jsonError(wmErr.message, 400)
      }

      return jsonOk({ ok: true })
    }

    if (action === 'delete') {
      const { user_id } = body
      if (!user_id) return jsonError('user_id is required', 400)
      if (user_id === caller.id) return jsonError('You cannot delete yourself', 400)

      // Cascade-delete auth user (workspace_members, profiles cleaned via FK ON DELETE CASCADE)
      const { error: delErr } = await admin.auth.admin.deleteUser(user_id)
      if (delErr) return jsonError(delErr.message, 400)
      return jsonOk({ ok: true })
    }

    return jsonError('Unknown action', 400)
  } catch (e) {
    return jsonError((e as Error).message || 'Server error', 500)
  }
})

function jsonOk(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
