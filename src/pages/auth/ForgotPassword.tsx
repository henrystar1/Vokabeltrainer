import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../features/auth/AuthProvider'
import { errorMessage } from '../../lib/errors'
import Button from '../../components/ui/Button'
import { Field, TextInput } from '../../components/ui/Field'
import { ErrorBox, Notice } from '../../components/ui/States'
import AuthLayout from './AuthLayout'

export default function ForgotPassword() {
  const { sendReset } = useAuth()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await sendReset(email)
      setSent(true)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title="Passwort vergessen" subtitle="Wir schicken dir einen Link zum Zurücksetzen.">
      {sent ? (
        <Notice tone="ok">Falls ein Konto mit dieser E-Mail existiert, ist der Link unterwegs.</Notice>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="E-Mail">
            <TextInput type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {error && <ErrorBox message={error} />}
          <Button type="submit" busy={busy} className="w-full">
            Link senden
          </Button>
        </form>
      )}
      <Link to="/anmelden" className="mt-5 block text-sm text-accent-cyan hover:underline">
        Zurück zur Anmeldung
      </Link>
    </AuthLayout>
  )
}
