import { supabase } from './supabase'

// Wraps the admin-users Edge Function for create / update / delete.
async function invoke(action, workspaceId, payload) {
  const { data, error } = await supabase.functions.invoke('admin-users', {
    body: { action, workspace_id: workspaceId, ...payload },
  })
  if (error) {
    // Supabase wraps non-2xx as error; try to extract our JSON error message
    let detail = error.message
    try {
      const ctx = await error.context?.json?.()
      if (ctx?.error) detail = ctx.error
    } catch (_) {}
    throw new Error(detail)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

export function createUser(workspaceId, { email, password, full_name, role }) {
  return invoke('create', workspaceId, { email, password, full_name, role })
}

export function updateUser(workspaceId, { user_id, email, password, full_name, role }) {
  return invoke('update', workspaceId, { user_id, email, password, full_name, role })
}

export function deleteUser(workspaceId, user_id) {
  return invoke('delete', workspaceId, { user_id })
}
