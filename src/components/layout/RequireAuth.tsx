import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../../features/auth/AuthProvider'
import { Spinner } from '../ui/States'

export default function RequireAuth() {
  const { user, loading, recovering } = useAuth()
  const location = useLocation()
  if (loading) return <Spinner label="Wird geladen …" />
  if (recovering) return <Navigate to="/passwort-neu" replace />
  if (!user) return <Navigate to="/anmelden" replace state={{ from: location.pathname + location.search }} />
  return <Outlet />
}
