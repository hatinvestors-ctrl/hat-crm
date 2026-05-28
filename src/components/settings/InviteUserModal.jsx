import { useState } from 'react'
import Modal from '../ui/Modal'
import Input from '../ui/Input'
import Select from '../ui/Select'
import Button from '../ui/Button'
import { supabase } from '../../lib/supabase'
import { USER_ROLES } from '../../lib/constants'

export default function InviteUserModal({ open, onClose, workspaceId, invitedBy, onInvited }) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('regular')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const submit = async () => {
    setSaving(true)
    setError(null)
    try {
      // MVP: find existing profile by user_id from auth.users → not directly readable.
      // Instead, search profiles where the user has already signed up.
      // We expect admins to have the user sign up first, then add them by email.
      const { data: profile, error: pErr } = await supabase
        .from('profiles')
        .select('id, full_name')
        .ilike('full_name', email.split('@')[0])
        .maybeSingle()

      // Best-effort: try to find an existing profile via a known user_id from an RPC
      // For MVP we ask the user to sign up first, then the admin can add them.
      // Fallback: try inserting using rpc to look up the user by email — requires backend support.
      if (!profile) {
        throw new Error(
          'The user must sign up first. Ask them to register, then refresh this page and invite them.'
        )
      }

      const { error: insErr } = await supabase.from('workspace_members').insert({
        workspace_id: workspaceId,
        user_id: profile.id,
        role,
        invited_by: invitedBy,
      })
      if (insErr) throw insErr
      onInvited?.()
      setEmail('')
      setRole('regular')
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Invite User"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} loading={saving} disabled={!email}>Add to Workspace</Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-[11.5px] text-[color:var(--color-text-dim)] leading-relaxed">
          For now, the person must sign up first at the login page. Then enter their name below to add them to this workspace.
        </p>
        <Input label="Name or email" placeholder="user@example.com" value={email} onChange={e => setEmail(e.target.value)} required />
        <Select
          label="Role"
          options={USER_ROLES.map(r => ({ value: r.value, label: `${r.label} — ${r.description}` }))}
          value={role}
          onChange={e => setRole(e.target.value)}
        />
        {error && <div className="p-2 bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-text)] text-[12px] rounded">{error}</div>}
      </div>
    </Modal>
  )
}
