import { useState } from 'react'
import Card from '../ui/Card'
import Input from '../ui/Input'
import Button from '../ui/Button'
import { supabase } from '../../lib/supabase'

export default function WorkspaceSettingsForm({ workspace, canEdit, onUpdated }) {
  const [name, setName] = useState(workspace.name)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)

  const save = async () => {
    setSaving(true); setError(null); setSaved(false)
    const { data, error: e } = await supabase
      .from('workspaces')
      .update({ name })
      .eq('id', workspace.id)
      .select()
      .single()
    setSaving(false)
    if (e) setError(e.message)
    else { setSaved(true); onUpdated?.(data) }
  }

  return (
    <Card title="Workspace Settings">
      <div className="space-y-3 max-w-md">
        <Input label="Workspace Name" value={name} onChange={e => setName(e.target.value)} disabled={!canEdit} />
        {error && <div className="p-2 bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-text)] text-[12px] rounded">{error}</div>}
        {saved && <div className="p-2 bg-[color:var(--color-success-soft)] text-[color:var(--color-success-text)] text-[12px] rounded">Settings saved.</div>}
        {canEdit && <Button onClick={save} loading={saving}>Save Settings</Button>}
      </div>
    </Card>
  )
}
