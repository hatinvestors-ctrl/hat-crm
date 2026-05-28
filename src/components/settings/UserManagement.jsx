import { useState } from 'react'
import Card from '../ui/Card'
import Button from '../ui/Button'
import { supabase } from '../../lib/supabase'
import { USER_ROLES, ROLE_MAP } from '../../lib/constants'
import { formatDate } from '../../lib/calculations'
import InviteUserModal from './InviteUserModal'

export default function UserManagement({ workspaceId, members, currentUserId, canEdit, onChange }) {
  const [showInvite, setShowInvite] = useState(false)

  const changeRole = async (memberId, newRole) => {
    await supabase.from('workspace_members').update({ role: newRole }).eq('id', memberId)
    onChange?.()
  }

  const removeMember = async (memberId, name) => {
    if (!confirm(`Remove ${name} from this workspace?`)) return
    await supabase.from('workspace_members').delete().eq('id', memberId)
    onChange?.()
  }

  return (
    <Card
      title="Users"
      action={canEdit && <Button size="sm" onClick={() => setShowInvite(true)}>+ Invite User</Button>}
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
              <tr key={m.id}>
                <td className="px-4 py-2.5">
                  <div className="font-medium text-[color:var(--color-text)]">
                    {m.profiles?.full_name || 'User'} {isCurrent && <span className="text-[11px] text-[color:var(--color-text-dim)] font-normal">(you)</span>}
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  {canEdit && !isCurrent ? (
                    <select
                      value={m.role}
                      onChange={e => changeRole(m.id, e.target.value)}
                      className="text-[12px] h-7 px-2 bg-[color:var(--color-bg-input)] border border-[color:var(--color-line)] text-[color:var(--color-text)] rounded focus:outline-none focus:border-[color:var(--color-accent)]"
                    >
                      {USER_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  ) : (
                    <span className="text-[13px] text-[color:var(--color-text-muted)]">{ROLE_MAP[m.role]?.label || m.role}</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-[color:var(--color-text-dim)] text-[11.5px]">{formatDate(m.created_at)}</td>
                <td className="px-4 py-2.5 text-right">
                  {canEdit && !isCurrent && (
                    <button onClick={() => removeMember(m.id, m.profiles?.full_name || 'user')} className="text-[12px] text-[color:var(--color-danger-text)] hover:underline">
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <InviteUserModal
        open={showInvite}
        onClose={() => setShowInvite(false)}
        workspaceId={workspaceId}
        invitedBy={currentUserId}
        onInvited={() => { setShowInvite(false); onChange?.() }}
      />
    </Card>
  )
}
