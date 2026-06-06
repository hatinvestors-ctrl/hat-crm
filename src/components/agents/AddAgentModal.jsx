// src/components/agents/AddAgentModal.jsx
import { useState, useEffect } from 'react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import Input from '../ui/Input'
import { supabase } from '../../lib/supabase'

export default function AddAgentModal({ open, onClose, workspaceId, onAdded, initialValues, agentId }) {
  const isEdit = Boolean(agentId)
  const [form, setForm] = useState({ name: '', email: '', phone: '', brokerage: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (open) {
      setForm({
        name:      initialValues?.name      || '',
        email:     initialValues?.email     || '',
        phone:     initialValues?.phone     || '',
        brokerage: initialValues?.brokerage || '',
      })
      setError(null)
    }
  }, [open, initialValues])

  const update = patch => setForm(prev => ({ ...prev, ...patch }))

  const handleSave = async () => {
    if (!form.email?.trim()) { setError('Email is required.'); return }
    setSaving(true)
    setError(null)
    try {
      let data, err
      if (isEdit) {
        ;({ data, error: err } = await supabase
          .from('agents')
          .update({
            name:       form.name.trim()      || null,
            email:      form.email.trim().toLowerCase(),
            phone:      form.phone.trim()     || null,
            brokerage:  form.brokerage.trim() || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', agentId)
          .select()
          .single())
      } else {
        ;({ data, error: err } = await supabase
          .from('agents')
          .upsert(
            {
              workspace_id: workspaceId,
              name:         form.name.trim()      || null,
              email:        form.email.trim().toLowerCase(),
              phone:        form.phone.trim()     || null,
              brokerage:    form.brokerage.trim() || null,
              updated_at:   new Date().toISOString(),
            },
            { onConflict: 'workspace_id,email' }
          )
          .select()
          .single())
      }
      if (err) throw err
      onAdded?.(data)
      if (!isEdit) setForm({ name: '', email: '', phone: '', brokerage: '' })
      onClose()
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
      title={isEdit ? 'Edit Agent' : 'Add Agent'}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} loading={saving}>{isEdit ? 'Save' : 'Add Agent'}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input label="Email *" type="email" value={form.email} onChange={e => update({ email: e.target.value })} autoFocus />
        <Input label="Name" value={form.name} onChange={e => update({ name: e.target.value })} />
        <Input label="Brokerage" value={form.brokerage} onChange={e => update({ brokerage: e.target.value })} />
        <Input label="Phone" value={form.phone} onChange={e => update({ phone: e.target.value })} />
        {error && <div className="text-[12px] text-[color:var(--color-danger-text)] bg-[color:var(--color-danger-soft)] px-3 py-2 rounded">{error}</div>}
      </div>
    </Modal>
  )
}
