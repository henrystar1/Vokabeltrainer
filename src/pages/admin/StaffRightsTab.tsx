import { useState } from 'react'
import { BookOpen, Coins, Hash, RotateCcw, Timer } from 'lucide-react'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import { Field, TextInput } from '../../components/ui/Field'
import { ErrorBox, Notice, Spinner } from '../../components/ui/States'
import { errorMessage } from '../../lib/errors'
import { useAsync } from '../../lib/useAsync'
import {
  adminGetStaffRights,
  adminListPublicBooks,
  adminListStaff,
  adminResetStaffRights,
  adminSetStaffBook,
  adminSetStaffRights,
  adminSetStaffSetting,
  getAppSettings,
  type RightMode,
  type StaffRights,
  type StaffRow,
} from '../../services/koins'
import { Block, Choice } from './ModRightsTab'
import { SECTIONS } from './ruleDefs'

const ROLE = { mod: 'Mod', alphamod: 'Alphamod' } as const

/** Rechte für jeden Mod und Alphamod einzeln: eigene Einstellung oder der Standard aus „Mod-Rechte“. */
export default function StaffRightsTab() {
  const staff = useAsync(adminListStaff, [])
  const [sel, setSel] = useState<string | null>(null)
  const person = staff.data?.find((x) => x.user_id === sel) ?? null

  return (
    <div className="space-y-5">
      <Notice tone="info">
        Wähle eine Person und stelle ein, was sie darf. „Standard“ übernimmt die Einstellung aus dem Tab „Mod-Rechte“. Ein Alphamod hat nur den goldenen Tag – alles andere bekommt er hier von dir.
      </Notice>
      {staff.error && <ErrorBox message={staff.error} onRetry={staff.reload} />}
      {staff.loading && !staff.data && <Spinner />}
      {staff.data?.length === 0 && <p className="text-sm text-slate-500">Es gibt noch keine Mods oder Alphamods. Ernenne sie unter „Benutzer“.</p>}
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {staff.data?.map((x) => (
          <li key={x.user_id}>
            <button
              type="button"
              onClick={() => setSel(x.user_id)}
              aria-pressed={x.user_id === sel}
              className={`w-full rounded-xl border px-4 py-3 text-left transition ${x.user_id === sel ? 'border-accent-cyan/50 bg-accent-cyan/10' : 'border-white/10 hover:bg-white/5'}`}
            >
              <span className="block font-medium">{x.display_name}</span>
              <span className="block text-xs text-slate-400">
                {ROLE[x.role]} · {summary(x)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {person && <Editor key={person.user_id} person={person} onChanged={staff.reload} />}
    </div>
  )
}

function summary(x: StaffRow): string {
  const own = x.books_mode !== null || x.set_mode !== null || x.shop !== null || x.timeout_max !== null
  return own ? 'eigene Rechte' : 'Standard'
}

function Editor({ person, onChanged }: { person: StaffRow; onChanged: () => void }) {
  const rights = useAsync(() => adminGetStaffRights(person.user_id), [person.user_id])
  const books = useAsync(adminListPublicBooks, [])
  const settings = useAsync(getAppSettings, [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [minutes, setMinutes] = useState<string | null>(null)
  const r = rights.data

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      rights.reload()
      onChanged()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const patch = (change: Partial<Pick<StaffRights, 'books_mode' | 'set_mode' | 'shop' | 'timeout_max'>>) => {
    if (!r) return Promise.resolve()
    return run(() => adminSetStaffRights(person.user_id, { books_mode: r.books_mode, set_mode: r.set_mode, shop: r.shop, timeout_max: r.timeout_max, ...change }))
  }

  const modeChoices = (value: RightMode | null, set: (m: RightMode | null) => void, labels: [string, string, string]) => (
    <div className="grid gap-2 sm:grid-cols-4">
      <Choice checked={value === null} onSelect={() => set(null)} title="Standard" text="wie bei allen Mods" />
      <Choice checked={value === 'none'} onSelect={() => set('none')} title={labels[0]} />
      <Choice checked={value === 'selected'} onSelect={() => set('selected')} title={labels[1]} text="Du hakst unten an." />
      <Choice checked={value === 'all'} onSelect={() => set('all')} title={labels[2]} />
    </div>
  )

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">{person.display_name} <span className="text-sm font-normal text-slate-400">({ROLE[person.role]})</span></h2>
        <Button variant="secondary" disabled={busy} onClick={() => void run(() => adminResetStaffRights(person.user_id)).then(() => setMinutes(null))}>
          <RotateCcw size={15} /> Auf Standard zurücksetzen
        </Button>
      </div>
      {error && <ErrorBox message={error} />}
      {(rights.loading && !r) && <Spinner />}
      {rights.error && <ErrorBox message={rights.error} onRetry={rights.reload} />}

      {r && (
        <>
          <Block icon={<BookOpen size={18} />} title="Online-Bücher" text="Auf welche öffentlichen Bücher darf diese Person zugreifen?">
            {modeChoices(r.books_mode, (m) => void patch({ books_mode: m }), ['Keine', 'Ausgewählte', 'Alle'])}
            {r.books_mode === 'selected' && (
              <ul className="grid gap-2 sm:grid-cols-2">
                {books.data?.map((b) => (
                  <li key={b.id}>
                    <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg bg-white/5 px-3 text-sm">
                      <input type="checkbox" className="h-4 w-4 accent-cyan-400" checked={r.book_ids.includes(b.id)} disabled={busy} onChange={(e) => void run(() => adminSetStaffBook(person.user_id, b.id, e.target.checked))} />
                      <span className="flex-1 truncate">{b.name}</span>
                      <span className="text-xs text-slate-500">{b.language.toUpperCase()}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </Block>

          <Block icon={<Hash size={18} />} title="Zahlen ändern" text="Welche Regeln darf diese Person ändern?">
            {modeChoices(r.set_mode, (m) => void patch({ set_mode: m }), ['Keine', 'Ausgewählte', 'Alle'])}
            {r.set_mode === 'selected' && settings.data && (
              <div className="space-y-4">
                {SECTIONS.map((sec) => {
                  const rules = sec.rules.filter((x) => x.key in (settings.data ?? {}))
                  if (rules.length === 0) return null
                  return (
                    <div key={sec.title}>
                      <p className="label-mono mb-2">{sec.title}</p>
                      <ul className="grid gap-2 sm:grid-cols-2">
                        {rules.map((x) => (
                          <li key={x.key}>
                            <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg bg-white/5 px-3 text-sm">
                              <input type="checkbox" className="h-4 w-4 accent-cyan-400" checked={r.setting_keys.includes(x.key)} disabled={busy} onChange={(e) => void run(() => adminSetStaffSetting(person.user_id, x.key, e.target.checked))} />
                              {x.label}
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

          <Block icon={<Coins size={18} />} title="Shop-Preise" text="Darf diese Person Preise ändern und Artikel ein- oder ausschalten?">
            <div className="grid gap-2 sm:grid-cols-3">
              <Choice checked={r.shop === null} onSelect={() => void patch({ shop: null })} title="Standard" />
              <Choice checked={r.shop === false} onSelect={() => void patch({ shop: false })} title="Nein" />
              <Choice checked={r.shop === true} onSelect={() => void patch({ shop: true })} title="Ja" />
            </div>
          </Block>

          <Card className="space-y-3">
            <h2 className="flex items-center gap-2 text-lg font-semibold"><Timer size={18} /> Stummschalten im Chat</h2>
            <p className="text-sm text-slate-400">Längste Dauer in Minuten. Leer lassen = Standard.</p>
            <div className="flex items-end gap-2">
              <div className="w-40">
                <Field label="Minuten">
                  <TextInput type="number" min={1} inputMode="numeric" value={minutes ?? (r.timeout_max === null ? '' : String(r.timeout_max))} onChange={(e) => setMinutes(e.target.value)} placeholder="Standard" />
                </Field>
              </div>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  const raw = (minutes ?? '').trim()
                  const v = raw === '' ? null : Number.parseInt(raw, 10)
                  if (v !== null && (!Number.isInteger(v) || v < 1)) return setError('Bitte mindestens 1 Minute eingeben oder das Feld leeren.')
                  void patch({ timeout_max: v }).then(() => setMinutes(null))
                }}
              >
                Speichern
              </Button>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
