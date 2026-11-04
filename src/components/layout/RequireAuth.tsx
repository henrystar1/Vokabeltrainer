import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { Ban, Hourglass } from 'lucide-react'
import { useAuth } from '../../features/auth/AuthProvider'
import Button from '../ui/Button'
import { Spinner } from '../ui/States'

export default function RequireAuth() {
  const { user, loading, recovering, blocked, approved, signOut, refreshProfile } = useAuth()
  const location = useLocation()
  const waiting = !!user && !blocked && !approved
  // Wartet das Konto auf die Freischaltung, regelmäßig nachsehen, ob ein Admin es aktiviert hat.
  useEffect(() => {
    if (!waiting) return
    const t = window.setInterval(() => { void refreshProfile().catch(() => undefined) }, 15_000)
    return () => window.clearInterval(t)
  }, [waiting, refreshProfile])
  if (loading) return <Spinner label="Wird geladen …" />
  if (recovering) return <Navigate to="/passwort-neu" replace />
  if (!user) return <Navigate to="/anmelden" replace state={{ from: location.pathname + location.search }} />
  if (blocked) {
    return (
      <div className="flex min-h-full items-center justify-center px-6 py-16">
        <div className="glass max-w-md rounded-2xl p-8 text-center">
          <Ban className="mx-auto text-rose-400" size={36} />
          <h1 className="mt-4 text-2xl font-semibold">Konto gesperrt</h1>
          <p className="mt-2 text-sm text-slate-400">
            Dein Konto wurde von einem Admin gesperrt. Wenn du denkst, dass das ein Irrtum ist, frag bitte bei ihm nach.
          </p>
          <Button className="mt-6" variant="secondary" onClick={() => void signOut()}>
            Abmelden
          </Button>
        </div>
      </div>
    )
  }
  if (waiting) {
    return (
      <div className="flex min-h-full items-center justify-center px-6 py-16">
        <div className="glass max-w-md rounded-2xl p-8 text-center">
          <Hourglass className="mx-auto text-accent-cyan" size={36} />
          <h1 className="mt-4 text-2xl font-semibold">Fast geschafft</h1>
          <p className="mt-2 text-sm text-slate-400">
            Dein Konto muss noch von einem Admin freigeschaltet werden. Sobald das passiert ist, geht es hier automatisch weiter.
          </p>
          <div className="mt-6 flex justify-center gap-2">
            <Button onClick={() => void refreshProfile().catch(() => undefined)}>Neu prüfen</Button>
            <Button variant="secondary" onClick={() => void signOut()}>Abmelden</Button>
          </div>
        </div>
      </div>
    )
  }
  return <Outlet />
}
