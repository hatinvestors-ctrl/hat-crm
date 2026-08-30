import { useState } from 'react'
import { Navigate, useOutletContext } from 'react-router-dom'
import Topbar from '../components/Topbar'
import WorkspaceSettingsForm from '../components/settings/WorkspaceSettingsForm'
import UserManagement from '../components/settings/UserManagement'
import ActionTriggersForm from '../components/settings/ActionTriggersForm'
import MlsRefreshForm from '../components/settings/MlsRefreshForm'
import MailServerForm from '../components/settings/MailServerForm'
import NotificationTriggersForm from '../components/settings/NotificationTriggersForm'
import AssigneeNotificationsForm from '../components/settings/AssigneeNotificationsForm'
import UnderwritingSettingsForm from '../components/settings/UnderwritingSettingsForm'

const TABS = [
  { id: 'workspace',      label: 'Workspace' },
  { id: 'underwriting',   label: 'Underwriting' },
  { id: 'triggers',       label: 'Action Triggers' },
  { id: 'mls',            label: 'MLS Auto-Refresh' },
  { id: 'mail',           label: 'Mail Server' },
  { id: 'notifications',  label: 'Notifications' },
  { id: 'assignee_notif', label: 'Assignee Notifications' },
  { id: 'users',          label: 'Users' },
]

export default function SettingsPage() {
  const { workspace, workspaceId, members, user, userRole } = useOutletContext()
  const [tab, setTab] = useState('workspace')
  const [reloadKey, setReloadKey] = useState(0)

  if (userRole !== 'admin') {
    return <Navigate to={`/w/${workspaceId}`} replace />
  }

  return (
    <>
      <Topbar
        title="Settings"
        breadcrumbs={[{ label: workspace.name, to: `/w/${workspaceId}` }, { label: 'Settings' }]}
      />
      <div className="px-6 py-4 max-w-4xl">
        <div className="flex gap-1 border-b border-[color:var(--color-line)] mb-5">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 h-9 text-[13px] font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-[color:var(--color-accent)] text-[color:var(--color-text)]'
                  : 'border-transparent text-[color:var(--color-text-muted)] hover:text-[color:var(--color-text)]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'workspace' && (
          <WorkspaceSettingsForm workspace={workspace} canEdit={userRole === 'admin'} onUpdated={() => window.location.reload()} />
        )}
        {tab === 'underwriting' && (
          <UnderwritingSettingsForm workspace={workspace} canEdit={userRole === 'admin'} onUpdated={() => window.location.reload()} />
        )}
        {tab === 'triggers' && (
          <ActionTriggersForm workspace={workspace} canEdit={userRole === 'admin'} onUpdated={() => window.location.reload()} />
        )}
        {tab === 'mls' && (
          <MlsRefreshForm workspace={workspace} canEdit={userRole === 'admin'} onUpdated={() => window.location.reload()} />
        )}
        {tab === 'mail' && (
          <MailServerForm workspace={workspace} canEdit={userRole === 'admin'} onUpdated={() => window.location.reload()} />
        )}
        {tab === 'notifications' && (
          <NotificationTriggersForm workspace={workspace} canEdit={userRole === 'admin'} onUpdated={() => window.location.reload()} />
        )}
        {tab === 'assignee_notif' && (
          <AssigneeNotificationsForm
            workspaceId={workspaceId}
            members={members}
            canEdit={userRole === 'admin'}
          />
        )}
        {tab === 'users' && (
          <UserManagement
            key={reloadKey}
            workspaceId={workspaceId}
            members={members}
            currentUserId={user.id}
            canEdit={userRole === 'admin'}
            onChange={() => { setReloadKey(k => k + 1); window.location.reload() }}
          />
        )}
      </div>
    </>
  )
}
