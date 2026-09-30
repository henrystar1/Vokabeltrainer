import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../features/auth/AuthProvider'
import { errorMessage } from '../../lib/errors'
import Button from '../../components/ui/Button'
import { Field, TextInput } from '../../components/ui/Field'
import { ErrorBox } from '../../components/ui/States'
import AuthLayout from './AuthLayout'

export default function Login() {
  const { signIn, user, recovering } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (user && !recovering) return <Navigate to={from} replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signIn(email, password)
      navigate(from, { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title="Anmelden" subtitle="Willkommen zurück an Bord.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="E-Mail">
          <TextInput type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Passwort">
          <TextInput type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <ErrorBox message={error} />}
        <Button type="submit" busy={busy} className="w-full">
          Anmelden
        </Button>
      </form>
      <div className="mt-5 flex justify-between text-sm">
        <Link to="/passwort-vergessen" className="text-slate-400 hover:text-accent-cyan">
          Passwort vergessen?
        </Link>
        <Link to="/registrieren" className="text-accent-cyan hover:underline">
          Konto erstellen
        </Link>
      </div>
    </AuthLayout>
  )
}
