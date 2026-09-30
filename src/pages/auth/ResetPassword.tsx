import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../features/auth/AuthProvider'
import { errorMessage } from '../../lib/errors'
import Button from '../../components/ui/Button'
import { Field, TextInput } from '../../components/ui/Field'
import { ErrorBox, Notice, Spinner } from '../../components/ui/States'
import AuthLayout from './AuthLayout'

export default function ResetPassword() {
  const { recovering, user, loading, setNewPassword } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (loading) return <Spinner />

  if (!recovering && !user) {
    return (
      <AuthLayout title="Link ungültig">
        <Notice tone="warn">Der Link ist abgelaufen oder wurde schon benutzt. Bitte fordere einen neuen an.</Notice>
        <Link to="/passwort-vergessen" className="btn-primary mt-6 w-full">
          Neuen Link anfordern
        </Link>
      </AuthLayout>
    )
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (password.length < 8) return setError('Das Passwort braucht mindestens 8 Zeichen.')
    setBusy(true)
    setError(null)
    try {
      await setNewPassword(password)
      navigate('/', { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title="Neues Passwort">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Neues Passwort" hint="Mindestens 8 Zeichen.">
          <TextInput type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <ErrorBox message={error} />}
        <Button type="submit" busy={busy} className="w-full">
          Passwort speichern
        </Button>
      </form>
    </AuthLayout>
  )
}
