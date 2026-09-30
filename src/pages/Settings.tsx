import { useEffect, useState, type FormEvent } from 'react'
import { LogOut } from 'lucide-react'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import { Field, Select, TextInput } from '../components/ui/Field'
import PageHeader from '../components/ui/PageHeader'
import { ErrorBox, Notice } from '../components/ui/States'
import { useAuth } from '../features/auth/AuthProvider'
import { useSettings } from '../features/settings/SettingsProvider'
import { normalizeQuestionCount } from '../features/settings/rules'
import { errorMessage } from '../lib/errors'
import { useAsync } from '../lib/useAsync'
import { listLanguages } from '../services/books'
import { updateDisplayName } from '../services/settings'

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-[48px] cursor-pointer items-center justify-between gap-4 rounded-xl border border-white/10 bg-space-900/50 px-4">
      <span className="text-sm">{label}</span>
      <input type="checkbox" className="h-5 w-5 accent-cyan-400" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

export default function Settings() {
  const { user, displayName, setDisplayNameLocal, signOut } = useAuth()
  const { settings, update } = useSettings()
  const languages = useAsync(listLanguages, [])
  const [name, setName] = useState(displayName ?? '')
  const [count, setCount] = useState(String(settings.words_per_round))
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => setName(displayName ?? ''), [displayName])
  useEffect(() => setCount(String(settings.words_per_round)), [settings.words_per_round])

  const both = settings.direction_to_foreign && settings.direction_to_german

  async function run(fn: () => Promise<void>, ok = 'Gespeichert.') {
    setError(null)
    setMessage(null)
    try {
      await fn()
      setMessage(ok)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  async function saveName(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (trimmed.length < 2 || trimmed.length > 30) return setError('Der Anzeigename braucht 2 bis 30 Zeichen.')
    if (!user) return
    setBusy(true)
    await run(async () => {
      await updateDisplayName(user.id, trimmed)
      setDisplayNameLocal(trimmed)
    })
    setBusy(false)
  }

  function setDirection(key: 'direction_to_foreign' | 'direction_to_german', value: boolean) {
    const other = key === 'direction_to_foreign' ? settings.direction_to_german : settings.direction_to_foreign
    if (!value && !other) return setError('Mindestens eine Richtung muss aktiv bleiben.')
    void run(() => update({ [key]: value }))
  }

  function commitCount() {
    const n = normalizeQuestionCount(Number.parseInt(count, 10), both)
    setCount(String(n))
    if (n !== settings.words_per_round) void run(() => update({ words_per_round: n }))
  }

  return (
    <div>
      <PageHeader eyebrow="Konfiguration" title="Einstellungen" />
      <div className="max-w-2xl space-y-4">
        {message && <Notice tone="ok">{message}</Notice>}
        {error && <ErrorBox message={error} />}

        <Card>
          <p className="label-mono mb-4">Profil</p>
          <form onSubmit={saveName} className="space-y-4">
            <Field label="Anzeigename" hint="Erscheint in der Rangliste.">
              <TextInput maxLength={30} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <p className="text-sm text-slate-400">Angemeldet als {user?.email}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" busy={busy} disabled={name.trim() === (displayName ?? '')}>Namen speichern</Button>
              <Button variant="secondary" onClick={() => void signOut()}>
                <LogOut size={16} /> Abmelden
              </Button>
            </div>
          </form>
        </Card>

        <Card className="space-y-4">
          <p className="label-mono">Lernen</p>
          <Field label="Lernsprache">
            <Select value={settings.learn_language} onChange={(e) => void run(() => update({ learn_language: e.target.value }))}>
              {languages.data?.map((l) => (
                <option key={l.code} value={l.code}>{l.name}</option>
              ))}
            </Select>
          </Field>
          <div className="space-y-2">
            <Toggle label="Deutsch → Fremdsprache" checked={settings.direction_to_foreign} onChange={(v) => setDirection('direction_to_foreign', v)} />
            <Toggle label="Fremdsprache → Deutsch" checked={settings.direction_to_german} onChange={(v) => setDirection('direction_to_german', v)} />
          </div>
          <Field
            label="Abfragen pro Runde (1–200)"
            hint={both ? `Bei beiden Richtungen wird jede Vokabel zweimal abgefragt – die Zahl ist gerade (${Math.floor(settings.words_per_round / 2)} Vokabeln).` : undefined}
          >
            <TextInput
              inputMode="numeric"
              value={count}
              onChange={(e) => setCount(e.target.value)}
              onBlur={commitCount}
              onKeyDown={(e) => e.key === 'Enter' && commitCount()}
            />
          </Field>
          <Toggle label="Groß-/Kleinschreibung beachten" checked={settings.case_sensitive} onChange={(v) => void run(() => update({ case_sensitive: v }))} />
        </Card>
      </div>
    </div>
  )
}
