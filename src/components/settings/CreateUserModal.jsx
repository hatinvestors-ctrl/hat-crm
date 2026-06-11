import { useState, useEffect } from 'react'
import Modal from '../ui/Modal'
import Input from '../ui/Input'
import Select from '../ui/Select'
import Button from '../ui/Button'
import { USER_ROLES } from '../../lib/constants'
import { createUser, updateUser } from '../../lib/adminUsers'

const EMPTY = { full_name: '', email: '', password: '', role: 'regular', addExisting: false }

export default function CreateUserModal({ open, onClose, workspaceId, editUser, onSaved }) {
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)
  const [showPassword, setShowPassword] = useState(false)

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
        if (form.email.trim()) patch.email = form.email.trim()
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
        <Input
          label={isEdit ? 'New Email (leave blank to keep current)' : 'Email'}
          type="email"
          autoComplete="off"
          placeholder={isEdit ? 'Enter new email address' : 'jane@example.com'}
          value={form.email}
          onChange={set('email')}
          required={!isEdit}
        />
        {!form.addExisting && (
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wide text-[color:var(--color-text-muted)]">
              {isEdit ? 'New Password (leave blank to keep current)' : 'Password'}
              {!isEdit && <span className="text-[color:var(--color-danger-text)]"> *</span>}
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder={isEdit ? 'Leave blank to keep unchanged' : 'Min 6 characters'}
                value={form.password}
                onChange={set('password')}
                className="w-full h-8 px-2.5 pr-8 text-[13px] rounded-md bg-[color:var(--color-bg-input)] text-[color:var(--color-text)] placeholder:text-[color:var(--color-text-faint)] border border-[color:var(--color-line)] hover:border-[color:var(--color-line-strong)] transition-colors focus:outline-none focus:border-[color:var(--color-accent)] focus:ring-1 focus:ring-[color:var(--color-accent)]"
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[color:var(--color-text-dim)] hover:text-[color:var(--color-text)] transition-colors"
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
          </div>
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
