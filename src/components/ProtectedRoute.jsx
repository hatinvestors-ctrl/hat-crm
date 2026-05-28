import { Navigate, useLocation } from 'react-router-dom'
import LoadingSpinner from './ui/LoadingSpinner'

export default function ProtectedRoute({ user, loading, children }) {
  const location = useLocation()
  if (loading) return <LoadingSpinner fullPage label="Loading…" />
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  return children
}
