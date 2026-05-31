import { useState, useEffect } from 'react'
import Modal from '../ui/Modal'
import Input from '../ui/Input'
import Select from '../ui/Select'
import Button from '../ui/Button'
import { USER_ROLES } from '../../lib/constants'
import { createUser, updateUser } from '../../lib/adminUsers'

const EMPTY = { full_name: '', email: '', password: '', role: 'member' }

export default function CreateUserModal({ open, onClose, workspaceId, editUser, onSaved }) {
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)

  const isEdit = !!editUser

  useEffect(() => {
    if (open) {
      setForm(isEdit
        ? { full_name: editUser.profiles?.full_name || '', email: '', password: '', role: editUser.role }
        : EMPTY
      )
      setError(null)
    }
  }, [open, editUser])

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const submit = async () => {
    if (!isEdit && (!form.full_name.trim() || !form.email.trim() || !form.password.trim())) {
      setError('Full name, email and password are required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (isEdit) {
        const patch = { user_id: editUser.user_id, role: form.role }
        if (form.full_name.trim()) patch.full_name = form.full_name.trim()
        if (form.password.trim()) patch.password = form.password.trim()
        await updateUser(workspaceId, patch)
      } else {
        await createUser(workspaceId, {
          full_name: form.full_name.trim(),
          email:     form.email.trim(),
          password:  form.password.trim(),
          role:      form.role,
        })
      }
      onSaved?.()
      onClose?.()
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
      title={isEdit ? 'Edit User' : 'Create User'}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} loading={saving}>{isEdit ? 'Save Changes' : 'Create User'}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          label="Full Name"
          placeholder="Jane Smith"
          value={form.full_name}
          onChange={set('full_name')}
          required={!isEdit}
        />
        {!isEdit && (
          <Input
            label="Email"
            type="email"
            placeholder="jane@example.com"
            value={form.email}
            onChange={set('email')}
            required
          />
        )}
        <Input
          label={isEdit ? 'New Password (leave blank to keep current)' : 'Password'}
          type="password"
          placeholder={isEdit ? 'Leave blank to keep unchanged' : 'Min 6 characters'}
          value={form.password}
          onChange={set('password')}
          required={!isEdit}
        />
        <Select
          label="Role"
          options={USER_ROLES.map(r => ({ value: r.value, label: `${r.label} — ${r.description}` }))}
          value={form.role}
          onChange={set('role')}
        />
        {error && (
          <div className="p-2 bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-text)] text-[12px] rounded">
            {error}
          </div>
        )}
      </div>
    </Modal>
  )
}
