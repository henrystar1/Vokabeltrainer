import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../../features/auth/AuthProvider'
import { errorMessage } from '../../lib/errors'
import Button from '../../components/ui/Button'
import { Field, TextInput } from '../../components/ui/Field'
import { ErrorBox, Notice } from '../../components/ui/States'
import AuthLayout from './AuthLayout'

export default function Register() {
  const { signUp, user } = useAuth()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmSent, setConfirmSent] = useState(false)

  if (user) return <Navigate to="/" replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const trimmed = name.trim()
    if (trimmed.length < 2 || trimmed.length > 30) return setError('Der Anzeigename braucht 2 bis 30 Zeichen.')
    if (password.length < 8) return setError('Das Passwort braucht mindestens 8 Zeichen.')
    setBusy(true)
    try {
      const { needsConfirmation } = await signUp(email, password, trimmed)
      if (needsConfirmation) setConfirmSent(true)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (confirmSent) {
    return (
      <AuthLayout title="Fast geschafft">
        <Notice tone="ok">
          Wir haben dir eine E-Mail geschickt. Bitte bestätige deine Adresse über den Link darin – danach kannst du dich anmelden.
        </Notice>
        <Link to="/anmelden" className="btn-primary mt-6 w-full">
          Zur Anmeldung
        </Link>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Konto erstellen" subtitle="Dein Anzeigename erscheint in der Rangliste.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Anzeigename">
          <TextInput autoComplete="nickname" required maxLength={30} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="E-Mail">
          <TextInput type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Passwort" hint="Mindestens 8 Zeichen.">
          <TextInput type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {error && <ErrorBox message={error} />}
        <Button type="submit" busy={busy} className="w-full">
          Registrieren
        </Button>
      </form>
      <p className="mt-5 text-sm text-slate-400">
        Schon ein Konto?{' '}
        <Link to="/anmelden" className="text-accent-cyan hover:underline">
          Anmelden
        </Link>
      </p>
    </AuthLayout>
  )
}
