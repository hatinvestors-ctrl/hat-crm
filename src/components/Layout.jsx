import { useEffect, useState } from 'react'
import { Navigate, Outlet, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useWorkspace } from '../hooks/useWorkspace'
import Sidebar from './Sidebar'
import LoadingSpinner from './ui/LoadingSpinner'

export const WorkspaceContext = {}

export default function Layout({ user, onSignOut }) {
  const { workspaceId } = useParams()
  const { workspace, userRole, members, loading, error } = useWorkspace(user.id)
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    if (!user?.id) return
    supabase.from('profiles').select('*').eq('id', user.id).single().then(({ data }) => {
      setProfile(data)
    })
  }, [user?.id])

  if (loading) return <LoadingSpinner fullPage label="Loading workspace…" />
  if (error || !workspace || !userRole) {
    return <Navigate to="/" replace />
  }

  return (
    <div className="flex min-h-screen bg-[color:var(--color-bg)]">
      <Sidebar workspace={workspace} userRole={userRole} userId={user.id} profile={profile} onSignOut={onSignOut} />
      <main className="flex-1 min-w-0 flex flex-col">
        <Outlet context={{ user, profile, workspace, userRole, members, workspaceId }} />
      </main>
    </div>
  )
}
