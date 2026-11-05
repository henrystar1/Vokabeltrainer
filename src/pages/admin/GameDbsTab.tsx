import { useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import { Field, TextInput } from '../../components/ui/Field'
import { ErrorBox, Notice, Spinner } from '../../components/ui/States'
import { errorMessage } from '../../lib/errors'
import { useAsync } from '../../lib/useAsync'
import { adminGameDbAdd, adminGameDbDelete, adminGameDbMove, adminGameDbUpdate, adminGameDbsList, parkourUsageGet, type GameDbRow } from '../../services/play'

/** Verwaltung → Spiel-Datenbanken: Supabase-Projekte, über die Parkour in Echtzeit läuft. */
export default function GameDbsTab() {
  const list = useAsync(adminGameDbsList, [])
  const usage = useAsync(parkourUsageGet, [])
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try { await fn(); list.reload(); usage.reload() } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  const rows = list.data ?? []
  const active = rows.filter((r) => r.active)
  const slot = usage.data?.slot ?? 0
  const current = active[Math.min(slot, active.length - 1)]

  return (
    <div className="space-y-4">
      <Card className="space-y-2">
        <p className="text-sm text-slate-300">
          Parkour läuft in Echtzeit über fremde Supabase-Projekte (nur Realtime, ohne Tabellen). Es wird zuerst das oberste genutzt. Ist dessen Monatsbudget voll
          (Verwaltung → Zahlen → Parkour-Monatsbudget), wechselt das Spiel automatisch zum nächsten. Sind alle voll, ist Parkour bis Monatsende gesperrt.
        </p>
        {usage.data && (
          <p className="text-sm text-slate-400">
            Diesen Monat: <b className="text-slate-200">{(usage.data.month ?? 0).toLocaleString('de-DE')}</b> von {(usage.data.budget ?? 0).toLocaleString('de-DE')} Nachrichten.
            {current && <> Gerade aktiv: <b className="text-accent-cyan">{current.name || current.url}</b>.</>}
          </p>
        )}
        <Notice tone="info">Trag hier nur den Publishable Key (beginnt mit sb_publishable_) ein, niemals einen geheimen Schlüssel. Der Besitzer des Projekts muss Realtime nicht extra einrichten.</Notice>
      </Card>

      {error && <ErrorBox message={error} />}
      {list.loading && !list.data ? <Spinner /> : list.error ? <ErrorBox message={list.error} onRetry={list.reload} /> : null}

      {rows.map((r, i) => (
        <DbCard key={`${r.id}${r.url}${r.key}${r.name}${r.active}`} row={r} first={i === 0} last={i === rows.length - 1} isCurrent={current?.id === r.id} busy={busy}
          onSave={(n, u, k, a) => run(() => adminGameDbUpdate(r.id, n, u, k, a))}
          onDelete={() => { if (window.confirm(`„${r.name || r.url}“ wirklich entfernen?`)) void run(() => adminGameDbDelete(r.id)) }}
          onMove={(d) => void run(() => adminGameDbMove(r.id, d))} />
      ))}

      <Card className="space-y-3">
        <h3 className="font-semibold">Neue Spiel-Datenbank hinzufügen</h3>
        <Field label="Name (nur für dich)"><TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Spiel 3 (Anna)" /></Field>
        <Field label="Projekt-URL"><TextInput value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxxx.supabase.co" autoCapitalize="off" autoCorrect="off" /></Field>
        <Field label="Publishable Key"><TextInput value={key} onChange={(e) => setKey(e.target.value)} placeholder="sb_publishable_…" autoCapitalize="off" autoCorrect="off" /></Field>
        <Button busy={busy} onClick={() => void run(async () => { await adminGameDbAdd(name, url, key); setName(''); setUrl(''); setKey('') })} disabled={!url.trim() || !key.trim()}>
          <Plus size={16} /> Hinzufügen
        </Button>
        <p className="text-xs text-slate-500">Neue Einträge kommen ans Ende der Liste und werden erst genutzt, wenn die davor voll sind. Bis das Spiel bei allen die neue Liste lädt, können bis zu 5 Minuten vergehen.</p>
      </Card>
    </div>
  )
}

function DbCard({ row, first, last, isCurrent, busy, onSave, onDelete, onMove }: {
  row: GameDbRow; first: boolean; last: boolean; isCurrent: boolean; busy: boolean
  onSave: (name: string, url: string, key: string, active: boolean) => void
  onDelete: () => void
  onMove: (d: -1 | 1) => void
}) {
  const [name, setName] = useState(row.name)
  const [url, setUrl] = useState(row.url)
  const [key, setKey] = useState(row.key)
  const changed = name !== row.name || url !== row.url || key !== row.key
  return (
    <Card className={`space-y-3 ${row.active ? '' : 'opacity-60'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">{row.name || 'Ohne Namen'} {isCurrent && <span className="ml-2 rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-300">aktiv</span>}{!row.active && <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-xs text-slate-300">pausiert</span>}</p>
        <div className="flex gap-1">
          <button type="button" aria-label="Nach oben" disabled={first || busy} onClick={() => onMove(-1)} className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-white/10 disabled:opacity-30"><ArrowUp size={16} /></button>
          <button type="button" aria-label="Nach unten" disabled={last || busy} onClick={() => onMove(1)} className="flex h-10 w-10 items-center justify-center rounded-lg hover:bg-white/10 disabled:opacity-30"><ArrowDown size={16} /></button>
          <button type="button" aria-label="Entfernen" disabled={busy} onClick={onDelete} className="flex h-10 w-10 items-center justify-center rounded-lg text-rose-300 hover:bg-rose-500/10"><Trash2 size={16} /></button>
        </div>
      </div>
      <Field label="Name"><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Projekt-URL"><TextInput value={url} onChange={(e) => setUrl(e.target.value)} autoCapitalize="off" autoCorrect="off" /></Field>
      <Field label="Publishable Key"><TextInput value={key} onChange={(e) => setKey(e.target.value)} autoCapitalize="off" autoCorrect="off" /></Field>
      <div className="flex flex-wrap gap-2">
        <Button busy={busy} disabled={!changed} onClick={() => onSave(name, url, key, row.active)}>Speichern</Button>
        <Button variant="secondary" disabled={busy} onClick={() => onSave(name, url, key, !row.active)}>{row.active ? 'Pausieren' : 'Wieder nutzen'}</Button>
      </div>
    </Card>
  )
}
