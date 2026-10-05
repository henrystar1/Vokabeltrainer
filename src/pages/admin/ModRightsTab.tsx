import { useState, type ReactNode } from 'react'
import { BookOpen, Coins, Hash, Timer } from 'lucide-react'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import { Field, TextInput } from '../../components/ui/Field'
import { ErrorBox, Notice, Spinner } from '../../components/ui/States'
import { errorMessage } from '../../lib/errors'
import { useAsync } from '../../lib/useAsync'
import { adminListPublicBooks, adminSetModBook, adminSetModEditable, getAppSettings, getModEditable, staffSetSetting } from '../../services/koins'
import { SECTIONS } from './ruleDefs'

type NumMode = 'none' | 'selected' | 'all'

export function Choice({ checked, onSelect, title, text }: { checked: boolean; onSelect: () => void; title: string; text?: string }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={checked}
      className={`flex min-h-[48px] w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition ${
        checked ? 'border-accent-cyan/50 bg-accent-cyan/10' : 'border-white/10 hover:bg-white/5'
      }`}
    >
      <span className={`mt-1 h-4 w-4 shrink-0 rounded-full border-2 ${checked ? 'border-accent-cyan bg-accent-cyan' : 'border-slate-500'}`} />
      <span>
        <span className="block text-sm font-medium">{title}</span>
        {text && <span className="block text-xs text-slate-400">{text}</span>}
      </span>
    </button>
  )
}

export function Block({ icon, title, text, children }: { icon: ReactNode; title: string; text: string; children: ReactNode }) {
  return (
    <Card className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold">{icon} {title}</h2>
        <p className="mt-1 text-sm text-slate-400">{text}</p>
      </div>
      {children}
    </Card>
  )
}

/** Nur für Admins: Standard-Rechte für alle Mods und Alphamods. */
export default function ModRightsTab() {
  const settings = useAsync(getAppSettings, [])
  const editable = useAsync(getModEditable, [])
  const books = useAsync(adminListPublicBooks, [])
  const [numMode, setNumMode] = useState<NumMode | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [minutes, setMinutes] = useState<string | null>(null)

  const s = settings.data
  const flags = editable.data ?? {}
  const keysOn = Object.keys(flags).filter((k) => flags[k] && !k.startsWith('mod_'))
  const booksAll = (s?.mod_books_all ?? 1) === 1
  const setAll = (s?.mod_set_all ?? 0) === 1
  const mode: NumMode = numMode ?? (setAll ? 'all' : keysOn.length > 0 ? 'selected' : 'none')

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      settings.reload()
      editable.reload()
      books.reload()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const setNumbers = (m: NumMode) =>
    run(async () => {
      setNumMode(m)
      await staffSetSetting('mod_set_all', m === 'all' ? 1 : 0)
      if (m === 'none') for (const k of keysOn) await adminSetModEditable(k, false)
    })

  const preset = (kind: 'none' | 'standard' | 'free') =>
    run(async () => {
      await staffSetSetting('mod_books_all', kind === 'none' ? 0 : 1)
      if (kind === 'none') for (const b of books.data ?? []) if (b.mod_access) await adminSetModBook(b.id, false)
      await staffSetSetting('mod_set_all', kind === 'free' ? 1 : 0)
      if (kind !== 'free') for (const k of keysOn) await adminSetModEditable(k, false)
      await staffSetSetting('mod_shop_prices', kind === 'free' ? 1 : 0)
      await staffSetSetting('mod_timeout_max', kind === 'free' ? 60 : 1)
      setNumMode(null)
      setMinutes(null)
    })

  return (
    <div className="space-y-5">
      <Notice tone="info">
        Das ist der Standard für alle Mods und Alphamods. Für einzelne Personen kannst du ihn im Tab „Einzelne Mods“ überschreiben. Admins dürfen immer alles. Punkte ± und Artikel schenken bleiben immer bei den Admins. Änderungen gelten sofort.
      </Notice>
      {(settings.error || editable.error || books.error) && <ErrorBox message={settings.error ?? editable.error ?? books.error ?? ''} />}
      {error && <ErrorBox message={error} />}
      {(settings.loading || editable.loading || books.loading) && !s && <Spinner />}

      {s && (
        <>
          <Card className="space-y-3">
            <h2 className="text-lg font-semibold">Schnell einstellen</h2>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" disabled={busy} onClick={() => void preset('none')}>Keine Rechte</Button>
              <Button variant="secondary" disabled={busy} onClick={() => void preset('standard')}>Standard</Button>
              <Button variant="secondary" disabled={busy} onClick={() => void preset('free')}>Freier Zugriff</Button>
            </div>
            <p className="text-xs text-slate-500">
              Standard: alle Online-Bücher, keine Zahlen, keine Preise, 1 Minute stumm. Freier Zugriff: alles inklusive Preisen, bis 60 Minuten stumm.
            </p>
          </Card>

          <Block icon={<BookOpen size={18} />} title="Online-Bücher" text="Auf welche öffentlichen Bücher dürfen Mods zugreifen (Vokabeln bearbeiten, Fehlermeldungen umsetzen)?">
            <div className="grid gap-2 sm:grid-cols-2">
              <Choice checked={booksAll} onSelect={() => void run(() => staffSetSetting('mod_books_all', 1))} title="Alle Online-Bücher" text="Auch künftig neue." />
              <Choice checked={!booksAll} onSelect={() => void run(() => staffSetSetting('mod_books_all', 0))} title="Nur ausgewählte" text="Du hakst die Bücher unten an." />
            </div>
            {!booksAll && (
              <ul className="grid gap-2 sm:grid-cols-2">
                {books.data?.length === 0 && <li className="text-sm text-slate-500">Es gibt noch keine Online-Bücher.</li>}
                {books.data?.map((b) => (
                  <li key={b.id}>
                    <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg bg-white/5 px-3 text-sm">
                      <input type="checkbox" className="h-4 w-4 accent-cyan-400" checked={b.mod_access} disabled={busy} onChange={(e) => void run(() => adminSetModBook(b.id, e.target.checked))} />
                      <span className="flex-1 truncate">{b.name}</span>
                      <span className="text-xs text-slate-500">{b.language.toUpperCase()} · {b.vocab_count}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </Block>

          <Block icon={<Hash size={18} />} title="Zahlen ändern" text="Welche Regeln (Punkte, Coins, Quests, Spiele …) dürfen Mods ändern?">
            <div className="grid gap-2 sm:grid-cols-3">
              <Choice checked={mode === 'none'} onSelect={() => void setNumbers('none')} title="Keine" />
              <Choice checked={mode === 'selected'} onSelect={() => void setNumbers('selected')} title="Ausgewählte" text="Du hakst unten an." />
              <Choice checked={mode === 'all'} onSelect={() => void setNumbers('all')} title="Alle Zahlen" text="Freier Zugriff." />
            </div>
            {mode === 'selected' && (
              <div className="space-y-4">
                {SECTIONS.map((sec) => {
                  const rules = sec.rules.filter((r) => r.key in s)
                  if (rules.length === 0) return null
                  return (
                    <div key={sec.title}>
                      <p className="label-mono mb-2">{sec.title}</p>
                      <ul className="grid gap-2 sm:grid-cols-2">
                        {rules.map((r) => (
                          <li key={r.key}>
                            <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg bg-white/5 px-3 text-sm">
                              <input type="checkbox" className="h-4 w-4 accent-cyan-400" checked={!!flags[r.key]} disabled={busy} onChange={(e) => void run(() => adminSetModEditable(r.key, e.target.checked))} />
                              {r.label}
                            </label>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                })}
              </div>
            )}
          </Block>

          <Block icon={<Coins size={18} />} title="Shop-Preise" text="Dürfen Mods Preise im Shop ändern und Artikel ein- oder ausschalten?">
            <div className="grid gap-2 sm:grid-cols-2">
              <Choice checked={(s.mod_shop_prices ?? 0) === 0} onSelect={() => void run(() => staffSetSetting('mod_shop_prices', 0))} title="Nein" />
              <Choice checked={(s.mod_shop_prices ?? 0) === 1} onSelect={() => void run(() => staffSetSetting('mod_shop_prices', 1))} title="Ja" />
            </div>
          </Block>

          <Block icon={<Timer size={18} />} title="Stummschalten im Chat" text="Wie lange dürfen Mods jemanden höchstens stummschalten (in Minuten, mindestens 1)?">
            <div className="flex items-end gap-2">
              <div className="w-40">
                <Field label="Minuten">
                  <TextInput type="number" min={1} inputMode="numeric" value={minutes ?? String(s.mod_timeout_max ?? 1)} onChange={(e) => setMinutes(e.target.value)} />
                </Field>
              </div>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  const v = Number.parseInt(minutes ?? '', 10)
                  if (!Number.isInteger(v) || v < 1) return setError('Bitte mindestens 1 Minute eingeben.')
                  void run(() => staffSetSetting('mod_timeout_max', v)).then(() => setMinutes(null))
                }}
              >
                Speichern
              </Button>
            </div>
          </Block>
        </>
      )}
    </div>
  )
}
