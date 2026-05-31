// src/components/AdminRoute.jsx
import { Navigate, Outlet, useOutletContext } from 'react-router-dom'

export default function AdminRoute() {
  const ctx = useOutletContext()
  const { userRole, workspaceId } = ctx
  if (userRole === 'admin') return <Outlet context={ctx} />
  return <Navigate to={`/w/${workspaceId}/today`} replace />
}
