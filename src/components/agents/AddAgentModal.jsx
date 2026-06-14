// src/components/agents/AddAgentModal.jsx
import { useState, useEffect } from 'react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import Input from '../ui/Input'
import { supabase } from '../../lib/supabase'
import { AGENT_TYPES, RELATIONSHIP_STATUSES } from '../../lib/constants'

const selectCls = 'w-full text-[13px] px-2 h-9 bg-[color:var(--color-bg)] border border-[color:var(--color-line)] rounded text-[color:var(--color-text)] focus:outline-none focus:border-[color:var(--color-accent)]'

export default function AddAgentModal({ open, onClose, workspaceId, onAdded, initialValues, agentId }) {
  const isEdit = Boolean(agentId)
  const [form, setForm] = useState({
    name: '', email: '', phone: '', brokerage: '',
    agent_type: 'realtor', relationship_status: 'new',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (open) {
      setForm({
        name:                initialValues?.name                || '',
        email:               initialValues?.email               || '',
        phone:               initialValues?.phone               || '',
        brokerage:           initialValues?.brokerage           || '',
        agent_type:          initialValues?.agent_type          || 'realtor',
        relationship_status: initialValues?.relationship_status || 'new',
      })
      setError(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const update = patch => setForm(prev => ({ ...prev, ...patch }))

  const handleSave = async () => {
    if (!form.email?.trim()) { setError('Email is required.'); return }
    setSaving(true)
    setError(null)
    try {
      const payload = {
        name:                form.name.trim()      || null,
        email:               form.email.trim().toLowerCase(),
        phone:               form.phone.trim()     || null,
        brokerage:           form.brokerage.trim() || null,
        agent_type:          form.agent_type,
        relationship_status: form.relationship_status,
        updated_at:          new Date().toISOString(),
      }
      let data, err
      if (isEdit) {
        ;({ data, error: err } = await supabase
          .from('agents')
          .update(payload)
          .eq('id', agentId)
          .select()
          .single())
      } else {
        ;({ data, error: err } = await supabase
          .from('agents')
          .upsert(
            { workspace_id: workspaceId, ...payload },
            { onConflict: 'workspace_id,email' }
          )
          .select()
          .single())
      }
      if (err) throw err
      onAdded?.(data)
      if (!isEdit) setForm({ name: '', email: '', phone: '', brokerage: '', agent_type: 'realtor', relationship_status: 'new' })
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

        <div>
          <label className="block text-[11px] uppercase tracking-wider font-medium text-[color:var(--color-text-muted)] mb-1">Contact Type</label>
          <select value={form.agent_type} onChange={e => update({ agent_type: e.target.value })} className={selectCls}>
            {AGENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-[11px] uppercase tracking-wider font-medium text-[color:var(--color-text-muted)] mb-1">Relationship Status</label>
          <select value={form.relationship_status} onChange={e => update({ relationship_status: e.target.value })} className={selectCls}>
            {RELATIONSHIP_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>

        {error && <div className="text-[12px] text-[color:var(--color-danger-text)] bg-[color:var(--color-danger-soft)] px-3 py-2 rounded">{error}</div>}
      </div>
    </Modal>
  )
}
