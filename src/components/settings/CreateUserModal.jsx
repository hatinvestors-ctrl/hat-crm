import { useState, useEffect } from 'react'
import Modal from '../ui/Modal'
import Input from '../ui/Input'
import Select from '../ui/Select'
import Button from '../ui/Button'
import { USER_ROLES } from '../../lib/constants'
import { createUser, updateUser } from '../../lib/adminUsers'

const EMPTY = { full_name: '', email: '', password: '', role: 'member', addExisting: false }

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
    if (!isEdit && !form.addExisting && (!form.full_name.trim() || !form.email.trim() || !form.password.trim())) {
      setError('Full name, email and password are required.')
      return
    }
    if (!isEdit && form.addExisting && !form.email.trim()) {
      setError('Email is required.')
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
          full_name: form.full_name.trim() || form.email.split('@')[0],
          email:     form.email.trim(),
          password:  form.password.trim() || Math.random().toString(36).slice(-10),
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
      title={isEdit ? 'Edit User' : (form.addExisting ? 'Add Existing User' : 'Create New User')}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} loading={saving}>{isEdit ? 'Save Changes' : (form.addExisting ? 'Add to Workspace' : 'Create User')}</Button>
        </>
      }
    >
      <div className="space-y-3">
        {!isEdit && (
          <div className="flex rounded-md border border-[color:var(--color-line)] overflow-hidden text-[11.5px] font-semibold w-fit">
            {[{v: false, l: 'New User'}, {v: true, l: 'Add Existing'}].map(({v, l}) => (
              <button key={String(v)} type="button"
                onClick={() => setForm(f => ({ ...EMPTY, addExisting: v, role: f.role }))}
                className={`px-3 py-1.5 transition-colors ${form.addExisting === v ? 'bg-[color:var(--color-accent)] text-white' : 'bg-[color:var(--color-bg-elev-2)] text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]'}`}>
                {l}
              </button>
            ))}
          </div>
        )}
        {!isEdit && !form.addExisting && (
          <Input
            label="Full Name"
            placeholder="Jane Smith"
            value={form.full_name}
            onChange={set('full_name')}
            required
          />
        )}
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
        {!form.addExisting && (
          <Input
            label={isEdit ? 'New Password (leave blank to keep current)' : 'Password'}
            type="password"
            placeholder={isEdit ? 'Leave blank to keep unchanged' : 'Min 6 characters'}
            value={form.password}
            onChange={set('password')}
            required={!isEdit}
          />
        )}
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
