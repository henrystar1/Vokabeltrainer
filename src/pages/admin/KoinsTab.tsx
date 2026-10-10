import { useState, type ReactNode } from 'react'
import { Copy, Gift, Trash2 } from 'lucide-react'
import Button from '../../components/ui/Button'
import { Field, Select, TextInput } from '../../components/ui/Field'
import { ErrorBox, Notice, Spinner } from '../../components/ui/States'
import { formatDateTime } from '../../lib/format'
import { MAX_GRANT, parseCoins } from '../../lib/coins'
import { errorMessage } from '../../lib/errors'
import { useAsync } from '../../lib/useAsync'
import { adminListUsers } from '../../services/admin'
import {
  adminCreateCodes,
  adminDeleteCode,
  adminGrantKoins,
  adminListCodes,
  adminListItems,
  adminSetItem,
  getAppSettings,
} from '../../services/koins'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="glass space-y-4 rounded-2xl p-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  )
}

export function CodesSection() {
  const codes = useAsync(adminListCodes, [])
  const settings = useAsync(getAppSettings, [])
  const [amount, setAmount] = useState('')
  const [count, setCount] = useState('1')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fresh, setFresh] = useState<string[]>([])

  async function create() {
    setBusy(true)
    setError(null)
    try {
      const a = Number.parseInt(amount, 10)
      const n = Math.max(1, Math.min(50, Number.parseInt(count, 10) || 1))
      setFresh(await adminCreateCodes(Number.isInteger(a) && a > 0 ? a : null, n, note))
      codes.reload()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="Codes">
      <p className="text-sm text-slate-400">
        Ein Code gilt für genau eine Einlösung und wird danach gelöscht. Gib den Code einem Freund weiter.
        Leer lassen = Standardmenge ({settings.data?.code_default_amount ?? 500} Coins).
      </p>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Coins">
          <TextInput type="number" min={1} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(settings.data?.code_default_amount ?? 500)} />
        </Field>
        <Field label="Anzahl">
          <TextInput type="number" min={1} max={50} inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} />
        </Field>
        <Field label="Notiz (für wen?)">
          <TextInput value={note} maxLength={100} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="flex items-end">
          <Button busy={busy} onClick={() => void create()} className="w-full">
            <Gift size={16} /> Erstellen
          </Button>
        </div>
      </div>
      {error && <ErrorBox message={error} />}
      {fresh.length > 0 && (
        <Notice tone="ok">
          <p className="mb-2 font-medium">Neue Codes:</p>
          <ul className="space-y-1">
            {fresh.map((c) => (
              <li key={c} className="flex items-center gap-2 font-mono">
                {c}
                <button type="button" aria-label="Kopieren" className="p-1 text-slate-300 hover:text-white" onClick={() => void navigator.clipboard?.writeText(c)}>
                  <Copy size={14} />
                </button>
              </li>
            ))}
          </ul>
        </Notice>
      )}
      <div>
        <p className="label-mono mb-2">Offene Codes</p>
        {codes.loading && !codes.data && <Spinner />}
        {codes.error && <ErrorBox message={codes.error} onRetry={codes.reload} />}
        {codes.data?.length === 0 && <p className="text-sm text-slate-500">Keine offenen Codes.</p>}
        <ul className="space-y-1">
          {codes.data?.map((c) => (
            <li key={c.code} className="flex min-h-[44px] flex-wrap items-center justify-between gap-2 rounded-lg bg-white/5 px-3 text-sm">
              <span>
                <span className="font-mono">{c.code}</span> · {c.amount} Coins{c.note ? ` · ${c.note}` : ''}
                <span className="ml-2 text-xs text-slate-500">{formatDateTime(c.created_at)}</span>
              </span>
              <button
                type="button"
                aria-label="Code löschen"
                className="p-2 text-slate-400 hover:text-rose-300"
                onClick={() => void adminDeleteCode(c.code).then(codes.reload).catch((e) => setError(errorMessage(e)))}
              >
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  )
}

export function GrantSection() {
  const users = useAsync(adminListUsers, [])
  const [userId, setUserId] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function grant() {
    const a = parseCoins(amount)
    if (!userId || !Number.isSafeInteger(a) || a === 0 || Math.abs(a) > MAX_GRANT) return setError('Bitte Nutzer und einen Betrag (ungleich 0, höchstens 1 Billiarde) wählen.')
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const balance = await adminGrantKoins(userId, a, note)
      setDone(`Erledigt. Neues Guthaben: ${Number(balance).toLocaleString('de-DE')} Coins.`)
      users.reload()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="Coins schenken oder abziehen">
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Nutzer">
          <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Auswählen …</option>
            {users.data?.map((u) => (
              <option key={u.user_id} value={u.user_id}>
                {u.display_name} ({Number(u.koins).toLocaleString('de-DE')})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Betrag (negativ = abziehen)" hint="Auch 1k, 2,5m, 1mrd, 1b (Billion)">
          <TextInput inputMode="text" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Notiz">
          <TextInput value={note} maxLength={100} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="flex items-end">
          <Button busy={busy} onClick={() => void grant()} className="w-full">Ausführen</Button>
        </div>
      </div>
      {error && <ErrorBox message={error} />}
      {done && <Notice tone="ok">{done}</Notice>}
    </Section>
  )
}

export function ItemsSection() {
  const items = useAsync(adminListItems, [])
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [kind, setKind] = useState('all')
  const [query, setQuery] = useState('')
  const KIND_LABEL: Record<string, string> = { avatar: 'Profilbilder', color: 'Farben', effect: 'Effekte', theme: 'Themes', tag: 'Tags' }
  const shown = (items.data ?? []).filter((i) => (kind === 'all' || i.kind === kind) && i.name.toLowerCase().includes(query.trim().toLowerCase()))

  async function save(id: string, price: number, active: boolean) {
    setError(null)
    try {
      await adminSetItem(id, price, active)
      items.reload()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <Section title="Shop-Preise">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-48">
          <Field label="Art">
            <Select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="all">Alle</option>
              {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </Field>
        </div>
        <div className="min-w-[12rem] flex-1">
          <Field label="Suchen">
            <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name des Artikels" />
          </Field>
        </div>
      </div>
      {items.loading && !items.data && <Spinner />}
      {error && <ErrorBox message={error} />}
      {items.data && shown.length === 0 && <p className="text-sm text-slate-500">Nichts gefunden.</p>}
      <ul className="grid gap-2 sm:grid-cols-2">
        {shown.map((i) => (
          <li key={i.id} className={`flex min-h-[48px] items-center gap-2 rounded-lg bg-white/5 px-3 text-sm ${i.active ? '' : 'opacity-50'}`}>
            <span className="flex-1 truncate">
              {i.name} <span className="text-xs text-slate-500">{KIND_LABEL[i.kind] ?? i.kind}</span>
            </span>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              aria-label={`Preis ${i.name}`}
              className="min-h-[36px] w-20 rounded-lg border border-white/10 bg-space-900/70 px-2 text-right font-mono"
              value={draft[i.id] ?? String(i.price)}
              onChange={(e) => setDraft({ ...draft, [i.id]: e.target.value })}
              onBlur={() => {
                const p = Number.parseInt(draft[i.id] ?? '', 10)
                if (Number.isInteger(p) && p >= 0 && p !== i.price) void save(i.id, p, i.active)
              }}
            />
            <label className="flex items-center gap-1 text-xs text-slate-400">
              <input type="checkbox" className="h-4 w-4 accent-cyan-400" checked={i.active} onChange={(e) => void save(i.id, i.price, e.target.checked)} />
              aktiv
            </label>
          </li>
        ))}
      </ul>
    </Section>
  )
}
