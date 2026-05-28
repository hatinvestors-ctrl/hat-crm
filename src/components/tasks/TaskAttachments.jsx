import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatDateTime } from '../../lib/calculations'

const BUCKET = 'task-attachments'

function formatBytes(bytes) {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function TaskAttachments({ taskId, workspaceId, userId, canEdit, onChange }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)

  const load = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('task_attachments')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at', { ascending: false })
    setItems(data || [])
    setLoading(false)
    onChange?.((data || []).length)
  }

  useEffect(() => { if (taskId) load() }, [taskId])

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null); setUploading(true)
    try {
      // Path must start with workspace_id/ to satisfy RLS storage policy.
      const path = `${workspaceId}/${taskId}/${Date.now()}-${file.name}`
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file)
      if (upErr) throw upErr
      const { error: dbErr } = await supabase.from('task_attachments').insert({
        task_id: taskId, uploaded_by: userId, file_name: file.name, file_path: path,
        file_size: file.size, file_type: file.type,
      })
      if (dbErr) throw dbErr
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const handleDownload = async (item) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(item.file_path, 60)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
    else if (error) alert(error.message)
  }

  const handleDelete = async (item) => {
    if (!confirm(`Delete "${item.file_name}"?`)) return
    await supabase.storage.from(BUCKET).remove([item.file_path])
    await supabase.from('task_attachments').delete().eq('id', item.id)
    await load()
  }

  return (
    <div>
      {canEdit && (
        <div className="mb-2">
          <label className="inline-flex">
            <span className="inline-flex items-center gap-2 px-2.5 h-7 text-[11.5px] bg-[color:var(--color-bg-elev-2)] hover:bg-[color:var(--color-accent-soft)] hover:text-[color:var(--color-accent-text)] border border-[color:var(--color-line)] rounded cursor-pointer transition-colors">
              {uploading ? 'Uploading…' : '📎 Upload file'}
            </span>
            <input type="file" onChange={handleUpload} disabled={uploading} className="hidden" />
          </label>
        </div>
      )}

      {error && <div className="p-2 bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-text)] text-[11.5px] rounded mb-2">{error}</div>}

      {loading ? (
        <div className="text-[12px] text-[color:var(--color-text-dim)]">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-[12px] text-[color:var(--color-text-dim)] py-1">No attachments.</div>
      ) : (
        <ul className="divide-y divide-[color:var(--color-line)]">
          {items.map(item => (
            <li key={item.id} className="flex items-center justify-between py-1.5 gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-medium text-[color:var(--color-text)] truncate">{item.file_name}</div>
                <div className="text-[10.5px] text-[color:var(--color-text-dim)]">
                  {formatBytes(item.file_size)} · {formatDateTime(item.created_at)}
                </div>
              </div>
              <div className="flex gap-0.5 shrink-0">
                <button onClick={() => handleDownload(item)} className="text-[11px] px-1.5 py-0.5 text-[color:var(--color-accent-text)] hover:bg-[color:var(--color-accent-soft)] rounded transition-colors">Get</button>
                {canEdit && (
                  <button onClick={() => handleDelete(item)} className="text-[11px] px-1.5 py-0.5 text-[color:var(--color-danger-text)] hover:bg-[color:var(--color-danger-soft)] rounded transition-colors">×</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
