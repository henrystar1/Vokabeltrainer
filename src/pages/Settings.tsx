import { useEffect, useState, type FormEvent } from 'react'
import { BookOpen, KeyRound, LogOut, User } from 'lucide-react'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import { Field, Select, TextInput } from '../components/ui/Field'
import PageHeader from '../components/ui/PageHeader'
import { ErrorBox, Notice } from '../components/ui/States'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../features/auth/AuthProvider'
import { useSettings } from '../features/settings/SettingsProvider'
import { normalizeQuestionCount } from '../features/settings/rules'
import { errorMessage } from '../lib/errors'
import { useAsync } from '../lib/useAsync'
import { listLanguages } from '../services/books'
import { updateDisplayName } from '../services/settings'
import { setPanic, usePanic } from '../features/panic/panic'
import { setHidePresence, setTagsHidden } from '../services/koins'

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-[48px] cursor-pointer items-center justify-between gap-4 rounded-xl border border-white/10 bg-space-900/50 px-4">
      <span className="text-sm">{label}</span>
      <input type="checkbox" className="h-5 w-5 accent-cyan-400" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

export default function Settings() {
  const { user, displayName, role, setDisplayNameLocal, signOut, tagsHidden, hidePresence, refreshProfile } = useAuth()
  const { settings, update } = useSettings()
  const panic = usePanic()
  const languages = useAsync(listLanguages, [])
  const [name, setName] = useState(displayName ?? '')
  const [count, setCount] = useState(String(settings.words_per_round))
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<'konto' | 'lernen' | 'sicherheit'>('konto')
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [newPw2, setNewPw2] = useState('')

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

  async function changePassword(e: FormEvent) {
    e.preventDefault()
    if (!user?.email) return
    if (newPw.length < 8) return setError('Das neue Passwort braucht mindestens 8 Zeichen.')
    if (newPw !== newPw2) return setError('Die beiden neuen Passwörter sind nicht gleich.')
    if (newPw === oldPw) return setError('Das neue Passwort muss anders sein als das alte.')
    setBusy(true)
    await run(async () => {
      // Erst das aktuelle Passwort prüfen, damit niemand mit einem offenen Gerät das Konto übernehmen kann.
      const { error: bad } = await supabase.auth.signInWithPassword({ email: user.email!, password: oldPw })
      if (bad) throw new Error('Das aktuelle Passwort stimmt nicht.')
      const { error: fail } = await supabase.auth.updateUser({ password: newPw })
      if (fail) throw fail
      setOldPw('')
      setNewPw('')
      setNewPw2('')
    }, 'Passwort geändert.')
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

  const tabs = [
    { id: 'konto', label: 'Konto', icon: User },
    { id: 'lernen', label: 'Lernen', icon: BookOpen },
    { id: 'sicherheit', label: 'Passwort', icon: KeyRound },
  ] as const

  return (
    <div>
      <PageHeader eyebrow="Konfiguration" title="Einstellungen" />
      <div className="max-w-2xl space-y-4">
        <div role="tablist" className="glass inline-flex flex-wrap rounded-xl p-1">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => { setTab(id); setMessage(null); setError(null) }}
              className={`inline-flex min-h-[44px] items-center gap-2 rounded-lg px-4 text-sm font-medium transition ${tab === id ? 'bg-accent-cyan/15 text-accent-cyan' : 'text-slate-400 hover:text-white'}`}
            >
              <Icon size={16} /> {label}
            </button>
          ))}
        </div>

        {message && <Notice tone="ok">{message}</Notice>}
        {error && <ErrorBox message={error} />}

        {panic && (
          <Card className="mb-4">
            <Toggle label="Ausgeblendete Bereiche auf diesem Gerät wieder anzeigen" checked={false} onChange={(v) => { if (v) setPanic(false) }} />
          </Card>
        )}
        {tab === 'konto' && (
          <Card>
            <p className="label-mono mb-4">Profil</p>
            <form onSubmit={saveName} className="space-y-4">
              <Field label="Anzeigename" hint="Erscheint in der Rangliste und im Chat.">
                <TextInput maxLength={30} value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <p className="text-sm text-slate-400">
                Angemeldet als {user?.email}
                {role !== 'user' && <span className="ml-2 rounded-full border border-accent-cyan/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-accent-cyan">{role === 'admin' ? 'Admin' : role === 'alphamod' ? 'Alphamod' : 'Mod'}</span>}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" busy={busy} disabled={name.trim() === (displayName ?? '')}>Namen speichern</Button>
                <Button variant="secondary" onClick={() => void signOut()}>
                  <LogOut size={16} /> Abmelden
                </Button>
              </div>
            </form>
            <div className="mt-5 border-t border-white/10 pt-4">
              <label className="flex min-h-[44px] cursor-pointer items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-cyan-400"
                  checked={tagsHidden}
                  onChange={(e) => void setTagsHidden(e.target.checked).then(refreshProfile).catch((err) => setError(errorMessage(err)))}
                />
                <span>
                  <span className="block font-medium">Tags ausblenden</span>
                  <span className="block text-xs text-slate-400">Neben deinem Namen erscheint dann weder ein gekaufter Tag noch „Admin“, „Alphamod“ oder „Mod“ – in Chat, Ranglisten und Spielen.</span>
                </span>
              </label>
              <label className="mt-2 flex min-h-[44px] cursor-pointer items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-cyan-400"
                  checked={hidePresence}
                  onChange={(e) => void setHidePresence(e.target.checked).then(refreshProfile).catch((err) => setError(errorMessage(err)))}
                />
                <span>
                  <span className="block font-medium">Nicht in „Wer ist da?“ zeigen</span>
                  <span className="block text-xs text-slate-400">Andere sehen dann weder, dass du online bist, noch wann du zuletzt da warst. Du selbst siehst dich weiterhin.</span>
                </span>
              </label>
            </div>
          </Card>
        )}

        {tab === 'lernen' && (
          <>
            <Card className="space-y-4">
              <p className="label-mono">Sprache und Richtung</p>
              <Field label="Lernsprache">
                <Select value={settings.learn_language} onChange={(e) => void run(() => update({ learn_language: e.target.value }))}>
                  {languages.data?.map((l) => (
                    <option key={l.code} value={l.code}>{l.name}</option>
                  ))}
                </Select>
              </Field>
              <div className="space-y-2">
                <Toggle label="Fremdsprache → Deutsch" checked={settings.direction_to_german} onChange={(v) => setDirection('direction_to_german', v)} />
                <Toggle label="Deutsch → Fremdsprache" checked={settings.direction_to_foreign} onChange={(v) => setDirection('direction_to_foreign', v)} />
              </div>
            </Card>
            <Card className="space-y-4">
              <p className="label-mono">Runde</p>
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
          </>
        )}

        {tab === 'sicherheit' && (
          <Card>
            <p className="label-mono mb-4">Passwort ändern</p>
            <form onSubmit={changePassword} className="space-y-4">
              <Field label="Aktuelles Passwort">
                <TextInput type="password" autoComplete="current-password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
              </Field>
              <Field label="Neues Passwort" hint="Mindestens 8 Zeichen.">
                <TextInput type="password" autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
              </Field>
              <Field label="Neues Passwort wiederholen">
                <TextInput type="password" autoComplete="new-password" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} />
              </Field>
              <Button type="submit" busy={busy} disabled={!oldPw || !newPw || !newPw2}>Passwort ändern</Button>
            </form>
          </Card>
        )}
      </div>
    </div>
  )
}
