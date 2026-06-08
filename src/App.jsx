import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import ProtectedRoute from './components/ProtectedRoute'
import AdminRoute from './components/AdminRoute'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import WorkspaceSelectorPage from './pages/WorkspaceSelectorPage'
import DashboardPage from './pages/DashboardPage'
import TodayPage from './pages/TodayPage'
import InboxPage from './pages/InboxPage'
import LeadsPage from './pages/LeadsPage'
import LeadDetailPage from './pages/LeadDetailPage'
import AgentsPage from './pages/AgentsPage'
import TasksPage from './pages/TasksPage'
import ProjectsPage from './pages/ProjectsPage'
import ProjectDetailPage from './pages/ProjectDetailPage'
import ImportPage from './pages/ImportPage'
import SettingsPage from './pages/SettingsPage'
import NotFoundPage from './pages/NotFoundPage'

export default function App() {
  const { user, loading, signIn, signUp, signOut } = useAuth()

  return (
    <Routes>
      <Route
        path="/login"
        element={
          user
            ? <Navigate to="/" replace />
            : <LoginPage signIn={signIn} signUp={signUp} />
        }
      />

      <Route
        path="/"
        element={
          <ProtectedRoute user={user} loading={loading}>
            <WorkspaceSelectorPage user={user} onSignOut={signOut} />
          </ProtectedRoute>
        }
      />

      <Route
        path="/w/:workspaceId"
        element={
          <ProtectedRoute user={user} loading={loading}>
            <Layout user={user} onSignOut={signOut} />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="today" element={<TodayPage />} />
        <Route path="inbox" element={<InboxPage />} />
        <Route path="leads" element={<LeadsPage />} />
        <Route path="leads/:leadId" element={<LeadDetailPage />} />
        <Route path="agents" element={<AgentsPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="tasks/:taskId" element={<TasksPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/:leadId" element={<ProjectDetailPage />} />
        <Route element={<AdminRoute />}>
          <Route path="import" element={<ImportPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
