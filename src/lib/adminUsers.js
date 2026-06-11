async function invoke(action, workspaceId, payload) {
  const res = await fetch('/.netlify/functions/admin-users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, workspace_id: workspaceId, ...payload }),
  })
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(data.error || 'Request failed')
  return data
}

export function createUser(workspaceId, { email, password, full_name, role }) {
  return invoke('create', workspaceId, { email, password, full_name, role })
}

export function updateUser(workspaceId, { user_id, email, password, full_name, role }) {
  return invoke('update', workspaceId, { user_id, email, password, full_name, role })
}

export function getUser(workspaceId, user_id) {
  return invoke('get', workspaceId, { user_id })
}

export function deleteUser(workspaceId, user_id) {
  return invoke('delete', workspaceId, { user_id })
}
