import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import { Field, TextInput } from '../../components/ui/Field'
import { ErrorBox, Notice, Spinner } from '../../components/ui/States'
import { useLocks } from '../../features/locks/LocksProvider'
import { errorMessage } from '../../lib/errors'
import { formatDateTime } from '../../lib/format'
import { useAsync } from '../../lib/useAsync'
import { adminGetFeatureLocks, adminSetFeatureLock, type FeatureLock, type LockKey, type LockRule } from '../../services/koins'

const LABEL: Record<LockKey, string> = {
  games: 'Spiele (ganzer Menüpunkt)',
  gambling: 'Gambling',
  sprint: 'Sprint',
  duels: 'Duelle',
  chat: 'Chat',
  shop: 'Shop',
  quests: 'Quests',
}
const DAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const QUICK: Array<[string, number | null]> = [['15 Min.', 15], ['1 Std.', 60], ['1 Tag', 1440], ['bis auf Widerruf', null]]

function LockCard({ lock, onSaved }: { lock: FeatureLock; onSaved: () => void }) {
  const [rules, setRules] = useState<LockRule[]>(lock.rules)
  const [note, setNote] = useState(lock.note)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const until = lock.off_until && new Date(lock.off_until) > new Date() ? lock.off_until : null
  const farFuture = until && new Date(until).getFullYear() >= 2100

  async function save(offUntil: string | null, r: LockRule[] = rules) {
    setBusy(true)
    setError(null)
    try {
      await adminSetFeatureLock(lock.key, offUntil, r, note)
      onSaved()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const offFor = (min: number | null) => save(min === null ? '2100-01-01T00:00:00Z' : new Date(Date.now() + min * 60_000).toISOString())
  const patch = (i: number, p: Partial<LockRule>) => setRules((rs) => rs.map((r, k) => (k === i ? { ...r, ...p } : r)))

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{LABEL[lock.key]}</span>
        <span className={`rounded-full px-2.5 py-0.5 text-xs ${lock.locked_now ? 'bg-rose-500/15 text-rose-300' : 'bg-emerald-500/15 text-emerald-300'}`}>
          {lock.locked_now ? 'gerade aus' : 'an'}
        </span>
      </div>
      {until && <p className="text-xs text-amber-200">Aus {farFuture ? 'bis auf Widerruf' : `bis ${formatDateTime(until)}`}.</p>}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-400">Jetzt ausschalten für</span>
        {QUICK.map(([l, m]) => <Button key={l} variant="secondary" disabled={busy} onClick={() => void offFor(m)}>{l}</Button>)}
        {until && <Button disabled={busy} onClick={() => void save(null)}>Wieder an</Button>}
      </div>

      <div className="space-y-2">
        <p className="label-mono">Zeitplan (Berliner Zeit)</p>
        {rules.length === 0 && <p className="text-xs text-slate-500">Keine festen Zeiten. „Von = Bis“ bedeutet ganzer Tag, „Von später als Bis“ geht über Mitternacht.</p>}
        {rules.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 rounded-xl bg-white/5 p-2">
            <div className="flex gap-1">
              {DAYS.map((d, k) => {
                const on = r.days.includes(k + 1)
                return (
                  <button key={d} type="button" aria-pressed={on} onClick={() => patch(i, { days: on ? r.days.filter((x) => x !== k + 1) : [...r.days, k + 1].sort() })}
                    className={`h-9 w-9 rounded-lg text-xs ${on ? 'bg-accent-cyan/20 text-accent-cyan' : 'bg-white/5 text-slate-400'}`}>{d}</button>
                )
              })}
            </div>
            <input type="time" value={r.from} onChange={(e) => patch(i, { from: e.target.value })} className="min-h-[40px] rounded-lg border border-white/10 bg-space-900/70 px-2 text-sm" aria-label="Von" />
            <span className="text-slate-500">–</span>
            <input type="time" value={r.to} onChange={(e) => patch(i, { to: e.target.value })} className="min-h-[40px] rounded-lg border border-white/10 bg-space-900/70 px-2 text-sm" aria-label="Bis" />
            <button type="button" aria-label="Zeile löschen" onClick={() => setRules((rs) => rs.filter((_, k) => k !== i))} className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:text-rose-300"><Trash2 size={15} /></button>
          </div>
        ))}
        <Button variant="ghost" onClick={() => setRules((rs) => [...rs, { days: [1, 2, 3, 4, 5], from: '08:00', to: '15:00' }])}><Plus size={15} /> Zeit hinzufügen</Button>
      </div>

      <Field label="Notiz (nur für dich)"><TextInput value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} /></Field>
      {error && <ErrorBox message={error} />}
      <Button disabled={busy || rules.some((r) => r.days.length === 0 || !r.from || !r.to)} onClick={() => void save(until)}>Zeitplan speichern</Button>
    </Card>
  )
}

/** Funktionen kurz oder nach Zeitplan abschalten; gesperrte Menüpunkte verschwinden für alle außer Admins. */
export default function LocksTab() {
  const list = useAsync(adminGetFeatureLocks, [])
  const { reload } = useLocks()
  return (
    <div className="space-y-3">
      <Notice tone="info">Abgeschaltete Funktionen verschwinden aus dem Menü und lassen sich auch nicht mehr benutzen. Du als Admin bist immer ausgenommen, so kannst du alles testen.</Notice>
      {list.loading && !list.data && <Spinner />}
      {list.error && <ErrorBox message={list.error} onRetry={list.reload} />}
      <div className="grid gap-3 lg:grid-cols-2">
        {list.data?.map((l) => (
          <LockCard key={`${l.key}-${l.off_until}-${JSON.stringify(l.rules)}`} lock={l} onSaved={() => { list.reload(); reload() }} />
        ))}
      </div>
    </div>
  )
}
