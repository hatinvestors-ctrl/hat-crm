import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUserWorkspaces } from '../hooks/useWorkspace'
import { supabase } from '../lib/supabase'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import Input from '../components/ui/Input'
import { ROLE_MAP } from '../lib/constants'

export default function WorkspaceSelectorPage({ user, onSignOut }) {
  const navigate = useNavigate()
  const { workspaces, loading } = useUserWorkspaces(user.id)
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!loading && workspaces.length === 1) {
      navigate(`/w/${workspaces[0].id}`, { replace: true })
    }
  }, [loading, workspaces, navigate])

  const create = async () => {
    if (!newName.trim()) return
    setCreating(true); setError(null)
    try {
      const slug = newName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Math.random().toString(36).slice(2, 6)
      const { data: ws, error: e } = await supabase
        .from('workspaces')
        .insert({ name: newName.trim(), slug, created_by: user.id })
        .select().single()
      if (e) throw e
      const { error: memErr } = await supabase.from('workspace_members').insert({
        workspace_id: ws.id, user_id: user.id, role: 'admin',
      })
      if (memErr) throw memErr
      navigate(`/w/${ws.id}`, { replace: true })
    } catch (e) {
      setError(e.message)
    } finally {
      setCreating(false)
    }
  }

  if (loading) return <LoadingSpinner fullPage label="Loading workspaces…" />

  return (
    <div className="min-h-screen bg-[color:var(--color-bg)]">
      {/* Header strip */}
      <header className="h-12 border-b border-[color:var(--color-line)] flex items-center justify-between px-6">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-sm bg-[color:var(--color-accent)] text-white flex items-center justify-center text-[11px] font-bold">H</div>
          <span className="text-[13px] font-semibold text-[color:var(--color-text)]">HatInvestors CRM</span>
        </div>
        <div className="flex items-center gap-3 text-[12px] text-[color:var(--color-text-muted)]">
          <span>{user.email}</span>
          <button onClick={onSignOut} className="hover:text-[color:var(--color-text)] transition-colors">Sign out</button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-16">
        <div className="mb-8">
          <p className="text-[12px] uppercase tracking-wider text-[color:var(--color-text-dim)]">Workspaces</p>
          <h1 className="text-[24px] font-semibold text-[color:var(--color-text)] tracking-tight mt-1">
            Choose where to work
          </h1>
        </div>

        {workspaces.length === 0 ? (
          <div className="border border-dashed border-[color:var(--color-line)] rounded-lg p-10 text-center">
            <h2 className="text-[15px] font-semibold text-[color:var(--color-text)]">No workspace yet</h2>
            <p className="text-[13px] text-[color:var(--color-text-muted)] mt-1 mb-4">
              Create your first workspace to start tracking deals.
            </p>
            <Button onClick={() => setCreateOpen(true)}>Create Workspace</Button>
          </div>
        ) : (
          <ul className="border border-[color:var(--color-line)] rounded-lg overflow-hidden divide-y divide-[color:var(--color-line)]">
            {workspaces.map(ws => (
              <li key={ws.id}>
                <button
                  onClick={() => navigate(`/w/${ws.id}`)}
                  className="w-full text-left px-5 py-3.5 flex items-center justify-between gap-3 hover:bg-[color:var(--color-bg-elev)] focus-visible:bg-[color:var(--color-bg-elev)] transition-colors group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-7 h-7 rounded bg-[color:var(--color-bg-elev-2)] border border-[color:var(--color-line)] text-[color:var(--color-text-muted)] flex items-center justify-center text-[12px] font-semibold shrink-0">
                      {ws.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[14px] font-medium text-[color:var(--color-text)] truncate">{ws.name}</div>
                      <div className="text-[11.5px] text-[color:var(--color-text-dim)]">{ROLE_MAP[ws.role]?.label}</div>
                    </div>
                  </div>
                  <span className="text-[color:var(--color-text-dim)] group-hover:text-[color:var(--color-text-muted)] transition-colors">→</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {workspaces.length > 0 && (
          <div className="mt-4 flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => setCreateOpen(true)}>+ New Workspace</Button>
          </div>
        )}

        <Modal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          title="New Workspace"
          size="sm"
          footer={
            <>
              <Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={create} loading={creating} disabled={!newName.trim()}>Create</Button>
            </>
          }
        >
          <Input
            label="Name"
            placeholder="e.g. HAT Investors"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            required
            autoFocus
          />
          {error && <div className="mt-3 p-2 bg-[color:var(--color-danger-soft)] text-[color:var(--color-danger-text)] text-[12px] rounded">{error}</div>}
        </Modal>
      </main>
    </div>
  )
}
