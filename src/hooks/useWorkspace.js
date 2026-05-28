import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export function useWorkspace(userId) {
  const { workspaceId } = useParams()
  const [workspace, setWorkspace] = useState(null)
  const [userRole, setUserRole] = useState(null)
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!workspaceId || !userId) {
      setLoading(false)
      return
    }
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        console.log('[useWorkspace] Loading workspace', workspaceId, 'for user', userId)

        const { data: ws, error: wsErr } = await supabase
          .from('workspaces')
          .select('*')
          .eq('id', workspaceId)
          .single()
        console.log('[useWorkspace] workspaces query:', { ws, wsErr })
        if (wsErr) throw new Error('workspaces: ' + wsErr.message)

        const { data: membership, error: memErr } = await supabase
          .from('workspace_members')
          .select('role')
          .eq('workspace_id', workspaceId)
          .eq('user_id', userId)
          .single()
        console.log('[useWorkspace] membership query:', { membership, memErr })
        if (memErr) throw new Error('membership: ' + memErr.message)

        const { data: allMembers, error: allErr } = await supabase
          .from('workspace_members')
          .select('id, user_id, role, created_at, profiles(id, full_name, avatar_url)')
          .eq('workspace_id', workspaceId)
        console.log('[useWorkspace] all members query:', { allMembers, allErr })
        if (allErr) throw new Error('members: ' + allErr.message)

        if (!cancelled) {
          setWorkspace(ws)
          setUserRole(membership.role)
          setMembers(allMembers || [])
          console.log('[useWorkspace] State updated successfully')
        }
      } catch (e) {
        console.error('[useWorkspace] FAILED:', e.message)
        if (!cancelled) setError(e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [workspaceId, userId])

  return { workspace, userRole, members, loading, error, workspaceId }
}

export function useUserWorkspaces(userId) {
  const [workspaces, setWorkspaces] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!userId) {
      setLoading(false)
      return
    }
    let cancelled = false
    async function load() {
      setLoading(true)
      const { data, error } = await supabase
        .from('workspace_members')
        .select('role, workspace:workspaces(id, name, slug, logo_url)')
        .eq('user_id', userId)
      if (!cancelled) {
        if (!error && data) {
          setWorkspaces(data.map(d => ({ ...d.workspace, role: d.role })).filter(w => w.id))
        }
        setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [userId])

  return { workspaces, loading }
}
