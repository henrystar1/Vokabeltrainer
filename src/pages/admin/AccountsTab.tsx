import { useState } from 'react'
import { Dices } from 'lucide-react'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import { Field, TextArea, TextInput } from '../../components/ui/Field'
import { ErrorBox, Notice } from '../../components/ui/States'
import { errorMessage } from '../../lib/errors'
import { adminCreateUser, adminCreateUsers, type NewAccountResult } from '../../services/admin'

const CHARS = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export function randomPassword(n = 10): string {
  const a = new Uint32Array(n)
  crypto.getRandomValues(a)
  return Array.from(a, (x) => CHARS[x % CHARS.length]).join('')
}

/** Konten anlegen, ohne dass eine Bestätigungs-Mail nötig ist (auch erfundene Adressen wie name@vokabeltrainer.com). */
export default function AccountsTab() {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [pw, setPw] = useState('')
  const [bulk, setBulk] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [results, setResults] = useState<NewAccountResult[] | null>(null)

  async function createOne() {
    setBusy(true); setError(null); setMessage(null); setResults(null)
    try {
      const r = await adminCreateUser({ email, password: pw, name })
      setMessage(`Konto „${r.display_name}“ (${r.email}) ist angelegt. Kennwort: ${pw}`)
      setEmail(''); setName(''); setPw('')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const rows = bulk.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [name2, email2, password2] = l.split(/[;\t]/).map((x) => x.trim())
    return { name: name2 ?? '', email: email2 ?? '', password: password2 || randomPassword() }
  })

  async function createMany() {
    setBusy(true); setError(null); setMessage(null); setResults(null)
    try {
      const r = await adminCreateUsers(rows)
      setResults(r.map((x, i) => ({ ...x, display_name: x.ok ? `${x.display_name} · Kennwort: ${rows[i].password}` : x.display_name })))
      if (r.every((x) => x.ok)) setBulk('')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <Notice tone="info">
        Die Konten sind sofort benutzbar, es wird keine Mail verschickt. Die E-Mail darf erfunden sein (z. B. <span className="font-mono">user@vokabeltrainer.com</span>), sie dient nur zum Anmelden.
        Bei erfundenen Adressen funktioniert „Passwort vergessen“ nicht – ein neues Kennwort setzt du in „Benutzer“ über den Schraubenschlüssel.
      </Notice>
      {message && <Notice tone="ok"><span className="select-all break-all">{message}</span></Notice>}
      {error && <ErrorBox message={error} />}

      <Card className="space-y-3">
        <p className="label-mono">Ein Konto</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="E-Mail"><TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@vokabeltrainer.com" autoCapitalize="none" /></Field>
          <Field label="Anzeigename (optional)"><TextInput value={name} maxLength={24} onChange={(e) => setName(e.target.value)} /></Field>
        </div>
        <Field label="Kennwort (mindestens 6 Zeichen)">
          <div className="flex gap-2">
            <TextInput value={pw} onChange={(e) => setPw(e.target.value)} className="font-mono" autoComplete="off" />
            <Button variant="secondary" onClick={() => setPw(randomPassword())} aria-label="Kennwort erzeugen"><Dices size={16} /></Button>
          </div>
        </Field>
        <Button busy={busy} disabled={!email.includes('@') || pw.length < 6} onClick={() => void createOne()}>Konto anlegen</Button>
      </Card>

      <Card className="space-y-3">
        <p className="label-mono">Viele Konten (z. B. eine Klasse)</p>
        <Field label="Eine Zeile pro Person: Name;E-Mail;Kennwort" hint="Das Kennwort darf fehlen, dann wird eines erzeugt. Höchstens 60 Zeilen.">
          <TextArea value={bulk} onChange={(e) => setBulk(e.target.value)} rows={6} className="font-mono text-xs" placeholder={'Lena;lena@vokabeltrainer.com;lena123\nTom;tom@vokabeltrainer.com'} />
        </Field>
        <Button busy={busy} disabled={rows.length === 0 || rows.length > 60} onClick={() => void createMany()}>{rows.length} Konten anlegen</Button>
        {results && (
          <ul className="space-y-1 text-sm">
            {results.map((r, i) => (
              <li key={i} className={`rounded-lg px-3 py-1.5 ${r.ok ? 'bg-emerald-500/10 text-emerald-200' : 'bg-rose-500/10 text-rose-200'}`}>
                <span className="font-mono">{r.email}</span> – {r.ok ? r.display_name : r.error}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
