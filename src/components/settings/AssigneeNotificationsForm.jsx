import { useState, useEffect } from 'react'
import Card from '../ui/Card'
import Button from '../ui/Button'
import { supabase } from '../../lib/supabase'
import { ASSIGNEE_NOTIFICATION_EVENTS } from '../../lib/leadNotifications'

export default function AssigneeNotificationsForm({ workspaceId, members, canEdit }) {
  // prefs: { [userId]: { [eventKey]: boolean } }
  const [prefs, setPrefs]     = useState({})
  const [saving, setSaving]   = useState({}) // { [userId]: boolean }
  const [saved, setSaved]     = useState({}) // { [userId]: boolean }
  const [error, setError]     = useState(null)

  useEffect(() => {
    if (!workspaceId) return
    supabase
      .from('workspace_members')
      .select('user_id, notification_prefs')
      .eq('workspace_id', workspaceId)
      .then(({ data, error }) => {
        if (error) { setError(error.message); return }
        const map = {}
        for (const row of data || []) map[row.user_id] = row.notification_prefs || {}
        setPrefs(map)
      })
  }, [workspaceId])

  const toggle = (userId, eventKey) => {
    setPrefs(prev => {
      const userPrefs = prev[userId] ?? {}
      // Missing key = true (default enabled), explicit false = disabled
      const current = userPrefs[eventKey] !== false
      return { ...prev, [userId]: { ...userPrefs, [eventKey]: !current } }
    })
    setSaved(prev => ({ ...prev, [userId]: false }))
  }

  const saveUser = async (userId) => {
    setSaving(prev => ({ ...prev, [userId]: true }))
    setError(null)
    const { error: err } = await supabase
      .from('workspace_members')
      .update({ notification_prefs: prefs[userId] || {} })
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
    setSaving(prev => ({ ...prev, [userId]: false }))
    if (err) { setError(err.message); return }
    setSaved(prev => ({ ...prev, [userId]: true }))
  }

  const isChecked = (userId, eventKey) => {
    const userPrefs = prefs[userId] ?? {}
    return userPrefs[eventKey] !== false
  }

  return (
    <Card title="Assignee Notifications">
      <p className="text-[12px] text-[color:var(--color-text-muted)] mb-4">
        Control which email notifications each team member receives for leads assigned to them.
        All notifications are enabled by default.
      </p>

      {error && (
        <div className="mb-3 text-[12px] text-[color:var(--color-danger-text)] bg-[color:var(--color-danger-soft)] px-3 py-2 rounded">
          {error}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-[11.5px]">
          <thead>
            <tr className="border-b border-[color:var(--color-line)]">
              <th className="text-left pb-2 pr-3 font-semibold text-[color:var(--color-text-muted)] min-w-[120px]">Member</th>
              {ASSIGNEE_NOTIFICATION_EVENTS.map(ev => (
                <th key={ev.key} className="pb-2 px-1 font-medium text-[color:var(--color-text-muted)] text-center max-w-[70px]">
                  <span className="block leading-tight">{ev.label}</span>
                </th>
              ))}
              <th className="pb-2 pl-3 w-20"></th>
            </tr>
          </thead>
          <tbody>
            {(members || []).map(member => {
              const profile = member.profiles
              const uid     = member.user_id
              const name    = profile?.full_name || uid?.slice(0, 8) || 'Unknown'
              return (
                <tr key={uid} className="border-b border-[color:var(--color-line)] last:border-0">
                  <td className="py-2 pr-3">
                    <span className="font-medium text-[color:var(--color-text)]">{name}</span>
                    <span className="ml-1.5 text-[10px] text-[color:var(--color-text-dim)] capitalize">{member.role}</span>
                  </td>
                  {ASSIGNEE_NOTIFICATION_EVENTS.map(ev => (
                    <td key={ev.key} className="py-2 px-1 text-center">
                      <input
                        type="checkbox"
                        checked={isChecked(uid, ev.key)}
                        onChange={() => toggle(uid, ev.key)}
                        disabled={!canEdit}
                        className="accent-[color:var(--color-accent)] w-3.5 h-3.5"
                        title={ev.label}
                      />
                    </td>
                  ))}
                  <td className="py-2 pl-3">
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => saveUser(uid)}
                        loading={saving[uid]}
                        disabled={!canEdit || saving[uid]}
                      >
                        Save
                      </Button>
                      {saved[uid] && (
                        <span className="text-[10.5px] text-[color:var(--color-success-text)]">✓</span>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
