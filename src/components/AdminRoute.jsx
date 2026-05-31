// src/components/AdminRoute.jsx
import { Navigate, Outlet, useOutletContext } from 'react-router-dom'

export default function AdminRoute() {
  const { userRole, workspaceId } = useOutletContext()
  if (userRole === 'admin') return <Outlet />
  return <Navigate to={`/w/${workspaceId}/today`} replace />
}
