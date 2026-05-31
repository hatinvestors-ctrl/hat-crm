import { useState } from 'react'
import Card from '../ui/Card'
import Button from '../ui/Button'
import { ROLE_MAP } from '../../lib/constants'
import { formatDate } from '../../lib/calculations'
import { deleteUser } from '../../lib/adminUsers'
import CreateUserModal from './CreateUserModal'

export default function UserManagement({ workspaceId, members, currentUserId, canEdit, onChange }) {
  const [showCreate, setShowCreate] = useState(false)
  const [editUser,   setEditUser]   = useState(null)
  const [busyId,     setBusyId]     = useState(null)

  const handleDelete = async (m) => {
    if (!confirm(`Remove ${m.profiles?.full_name || 'this user'} from the workspace? This also deletes their account.`)) return
    setBusyId(m.user_id)
    try {
      await deleteUser(workspaceId, m.user_id)
      onChange?.()
    } catch (e) {
      alert(e.message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <Card
        title="Users"
        action={canEdit && <Button size="sm" onClick={() => setShowCreate(true)}>+ Add User</Button>}
        padding={false}
      >
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-[10.5px] uppercase tracking-wider text-[color:var(--color-text-dim)] border-b border-[color:var(--color-line)]">
              <th className="px-4 py-2.5 text-left font-medium">Name</th>
              <th className="px-4 py-2.5 text-left font-medium">Role</th>
              <th className="px-4 py-2.5 text-left font-medium">Joined</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[color:var(--color-line)]">
            {members.map(m => {
              const isCurrent = m.user_id === currentUserId
              return (
                <tr key={m.id} className={busyId === m.user_id ? 'opacity-50' : ''}>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-[color:var(--color-text)]">
                      {m.profiles?.full_name || 'User'}
                      {isCurrent && <span className="ml-1 text-[11px] text-[color:var(--color-text-dim)] font-normal">(you)</span>}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-[color:var(--color-text-muted)]">
                    {ROLE_MAP[m.role]?.label || m.role}
                  </td>
                  <td className="px-4 py-2.5 text-[color:var(--color-text-dim)] text-[11.5px]">
                    {formatDate(m.created_at)}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {canEdit && !isCurrent && (
                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => setEditUser(m)}
                          className="text-[12px] text-[color:var(--color-accent-text)] hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(m)}
                          disabled={busyId === m.user_id}
                          className="text-[12px] text-[color:var(--color-danger-text)] hover:underline disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>

      <CreateUserModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        workspaceId={workspaceId}
        onSaved={() => { setShowCreate(false); onChange?.() }}
      />

      <CreateUserModal
        open={!!editUser}
        onClose={() => setEditUser(null)}
        workspaceId={workspaceId}
        editUser={editUser}
        onSaved={() => { setEditUser(null); onChange?.() }}
      />
    </>
  )
}
