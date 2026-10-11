import { useCallback, useEffect, useState } from 'react'
import { Ban, Download, Eye, Trash2 } from 'lucide-react'
import Button from '../../../components/ui/Button'
import { TextInput } from '../../../components/ui/Field'
import Modal from '../../../components/ui/Modal'
import { EmptyState, ErrorBox, Notice, Spinner } from '../../../components/ui/States'
import StlViewer from '../../../components/print/StlViewer'
import { OrderProgress, StatusChip, useStlMesh } from '../../../components/print/parts'
import { useSignedUrls } from '../../../features/print/hooks'
import { errorMessage } from '../../../lib/errors'
import { formatDate } from '../../../lib/format'
import { acceptsDirectly, centsToInput, euro, parseEuroToCents, type PrintStatus } from '../../../lib/printShop'
import {
  adminPrintAction, adminPrintBan, adminPrintDeleteOrder, adminPrintOrders, downloadPrintFile, removePrintFiles,
  type AdminPrintOrder, type PrintAction,
} from '../../../services/printShop'

/** Warteschlange: alles, was noch zu tun ist, in der Reihenfolge, in der es dran ist. */
export default function QueueTab() {
  const [scope, setScope] = useState<'open' | 'done'>('open')
  const [orders, setOrders] = useState<AdminPrintOrder[] | null>(null)
  const [fetchedAt, setFetchedAt] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setOrders(await adminPrintOrders(scope))
      setFetchedAt(Date.now())
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [scope])

  useEffect(() => {
    setOrders(null)
    void load()
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void load() }, 15_000)
    return () => window.clearInterval(t)
  }, [load])

  const count = (s: PrintStatus) => (orders ?? []).filter((o) => o.status === s).length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1.5">
          {(['open', 'done'] as const).map((s) => (
            <button key={s} type="button" onClick={() => setScope(s)} className={`min-h-[40px] rounded-xl px-4 text-sm font-medium ${scope === s ? 'bg-accent-cyan/10 text-accent-cyan' : 'text-slate-400 hover:bg-white/5'}`}>
              {s === 'open' ? 'Offen' : 'Archiv'}
            </button>
          ))}
        </div>
        {scope === 'open' && orders && (
          <div className="flex flex-wrap gap-2 text-xs">
            <Chip n={count('angefragt')} label="neu" hot />
            <Chip n={count('druckt')} label="im Druck" />
            <Chip n={count('in_bearbeitung')} label="zu drucken" />
            <Chip n={count('preis_vorgeschlagen')} label="warten auf Kunde" />
            <Chip n={count('lieferbereit')} label="zur Übergabe" />
          </div>
        )}
      </div>

      {error && <ErrorBox message={error} onRetry={() => void load()} />}
      {!orders && !error && <Spinner />}
      {orders?.length === 0 && <EmptyState title={scope === 'open' ? 'Nichts zu tun' : 'Noch nichts im Archiv'} text={scope === 'open' ? 'Neue Anfragen erscheinen hier von selbst.' : undefined} />}
      {orders?.map((o) => <OrderRow key={o.id} order={o} fetchedAt={fetchedAt} onChanged={() => void load()} />)}
    </div>
  )
}

function Chip({ n, label, hot }: { n: number; label: string; hot?: boolean }) {
  return <span className={`rounded-full border px-3 py-1 ${n > 0 && hot ? 'border-amber-400/40 bg-amber-400/10 text-amber-200' : 'border-white/10 bg-white/5 text-slate-300'}`}><b className="tabular-nums">{n}</b> {label}</span>
}

function OrderRow({ order: o, fetchedAt, onChanged }: { order: AdminPrintOrder; fetchedAt: number; onChanged: () => void }) {
  const [price, setPrice] = useState(centsToInput(o.price_cents ?? o.offer_cents ?? o.estimate_cents))
  const [minutes, setMinutes] = useState(String(o.print_minutes ?? 60))
  const [note, setNote] = useState(o.admin_note)
  const [pct, setPct] = useState(o.progress_override != null ? String(o.progress_override) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewer, setViewer] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const thumbs = useSignedUrls(o.photo_paths)

  const priceCents = parseEuroToCents(price)
  const minutesN = Number(minutes)
  const minutesOk = Number.isInteger(minutesN) && minutesN >= 1
  const direct = priceCents != null && acceptsDirectly(o, priceCents)
  const open = o.status === 'angefragt' || o.status === 'preis_vorgeschlagen'

  async function act(action: PrintAction, opts: { priceCents?: number | null; minutes?: number | null; note?: string | null; progress?: number | null } = {}) {
    setBusy(true)
    setError(null)
    try {
      await adminPrintAction(o.id, action, { note, ...opts })
      onChanged()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function ban() {
    const reason = window.prompt(`${o.user_name} für den Shop sperren? Grund (optional):`, 'Spam')
    if (reason === null) return
    setBusy(true)
    try {
      await adminPrintBan(o.user_id, reason, null, true)
      onChanged()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    try {
      const paths = await adminPrintDeleteOrder(o.id)
      await removePrintFiles(paths).catch(() => undefined)
      onChanged()
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  async function saveStl() {
    if (!o.upload_path) return
    try {
      const blob = await downloadPrintFile(o.upload_path)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${o.title.replace(/[^\wäöüÄÖÜß-]+/g, '_')}.stl`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <article className="glass space-y-3 rounded-2xl p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold">
            {o.title}
            {o.rush_cents > 0 && <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-bold uppercase text-space-950">Express</span>}
          </h3>
          <p className="mt-1 text-xs text-slate-400">
            von <b className="text-slate-200">{o.user_name}</b>{o.user_banned && <span className="text-rose-300"> (gesperrt)</span>} · {formatDate(o.created_at)} · {o.kind === 'shop' ? 'Shop' : 'Eigene Anfrage'}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <StatusChip status={o.status} />
          <span className="text-lg font-semibold tabular-nums">{euro(o.final_cents)}</span>
        </div>
      </header>

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-300">
        {o.color_hex && <span className="inline-flex items-center gap-1.5"><span className="h-4 w-4 rounded-full border border-white/30" style={{ background: o.color_hex }} />{o.color_name}</span>}
        <span>{o.qty}×</span>
        {o.custom_text && <span>Text: <b>„{o.custom_text}“</b></span>}
        {o.discount_percent > 0 && <span className="text-emerald-300">{o.discount_percent} % Rabatt (Coins bezahlt)</span>}
        {o.dims_mm && <span className="text-slate-400">{o.dims_mm.x} × {o.dims_mm.y} × {o.dims_mm.z} mm · {o.volume_cm3} cm³</span>}
      </p>
      {o.kind === 'custom' && (
        <p className="text-sm text-slate-400">
          Richtpreis: <b className="text-slate-200">{euro(o.estimate_cents)}</b> · Wunschpreis: <b className="text-slate-200">{euro(o.offer_cents)}</b>
          {o.price_cents != null && <> · dein Preis: <b className="text-slate-200">{euro(o.price_cents)}</b></>}
        </p>
      )}
      {o.description && <p className="whitespace-pre-wrap rounded-xl bg-white/[0.03] p-3 text-sm text-slate-300">{o.description}</p>}

      {(o.upload_path || o.photo_paths.length > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          {o.upload_path && (
            <>
              <Button variant="secondary" onClick={() => setViewer(true)}><Eye size={15} /> 3D ansehen</Button>
              <Button variant="secondary" onClick={() => void saveStl()}><Download size={15} /> STL laden</Button>
            </>
          )}
          {o.photo_paths.map((p) => thumbs[p] && (
            <a key={p} href={thumbs[p]} target="_blank" rel="noreferrer" className="block h-16 w-16 overflow-hidden rounded-lg border border-white/10">
              <img src={thumbs[p]} alt="Foto zur Anfrage" className="h-full w-full object-cover" />
            </a>
          ))}
        </div>
      )}

      {o.status === 'druckt' && <OrderProgress order={o} fetchedAt={fetchedAt} />}

      {/* Aktionen */}
      {open && (
        <div className="space-y-3 rounded-xl border border-white/10 bg-space-900/40 p-4">
          <div className="grid gap-2 sm:grid-cols-[8rem_8rem_1fr]">
            <label className="space-y-1"><span className="label-mono">Preis (€)</span><TextInput inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
            <label className="space-y-1"><span className="label-mono">Druckzeit (min)</span><TextInput inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} /></label>
            <label className="space-y-1"><span className="label-mono">Nachricht an den Kunden</span><TextInput value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="z. B. wegen Stützen etwas teurer / Grund für Ablehnung" /></label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button busy={busy} disabled={priceCents == null || !minutesOk} onClick={() => void act('accept', { priceCents, minutes: minutesN })}>
              {direct ? 'Annehmen' : o.status === 'preis_vorgeschlagen' ? 'Neuen Preis vorschlagen' : 'Preis vorschlagen'}
            </Button>
            <Button variant="danger" busy={busy} onClick={() => void act('reject')}>Ablehnen</Button>
            <Button variant="ghost" onClick={() => void ban()} disabled={busy || o.user_banned}><Ban size={15} /> Sperren</Button>
          </div>
          {!direct && priceCents != null && <p className="text-xs text-slate-500">Der Kunde hat diesen Preis noch nicht gesehen – er muss ihn erst annehmen.</p>}
        </div>
      )}

      {o.status === 'in_bearbeitung' && (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-white/10 bg-space-900/40 p-4">
          <label className="space-y-1"><span className="label-mono">Druckzeit (min)</span><TextInput className="!w-32" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} /></label>
          <Button busy={busy} disabled={!minutesOk} onClick={() => void act('start', { minutes: minutesN })}>Druck starten</Button>
          <Button variant="danger" busy={busy} onClick={() => void act('reject')}>Ablehnen</Button>
        </div>
      )}

      {o.status === 'druckt' && (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-white/10 bg-space-900/40 p-4">
          <label className="space-y-1"><span className="label-mono">Fortschritt von Hand (%)</span><TextInput className="!w-28" inputMode="numeric" value={pct} onChange={(e) => setPct(e.target.value)} placeholder="auto" /></label>
          <Button variant="secondary" busy={busy} disabled={pct.trim() === '' || !(Number(pct) >= 0 && Number(pct) <= 100)} onClick={() => void act('progress', { progress: Math.round(Number(pct)) })}>Setzen</Button>
          <Button variant="ghost" busy={busy} onClick={() => { setPct(''); void act('progress', { progress: null }) }}>Automatisch</Button>
          <span className="flex-1" />
          <Button busy={busy} onClick={() => void act('ready')}>Fertig gedruckt</Button>
          <Button variant="ghost" busy={busy} onClick={() => void act('back')}>Zurück</Button>
        </div>
      )}

      {o.status === 'lieferbereit' && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-4">
          <span className="flex-1 text-sm text-emerald-100">Übergeben und <b>{euro(o.final_cents)}</b> kassiert?</span>
          <Button busy={busy} onClick={() => void act('delivered')}>Übergeben</Button>
          <Button variant="ghost" busy={busy} onClick={() => void act('back')}>Zurück</Button>
        </div>
      )}

      {(o.status === 'geliefert' || o.status === 'abgelehnt' || o.status === 'storniert') && (
        <div className="flex justify-end">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-400">Endgültig löschen (inkl. Dateien)?</span>
              <Button variant="danger" busy={busy} onClick={() => void remove()}>Löschen</Button>
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Nein</Button>
            </div>
          ) : (
            <Button variant="ghost" onClick={() => setConfirmDelete(true)}><Trash2 size={15} /> Löschen</Button>
          )}
        </div>
      )}

      {error && <Notice tone="warn">{error}</Notice>}
      {viewer && o.upload_path && <ModelModal path={o.upload_path} color={o.color_hex ?? '#22d3ee'} title={o.title} onClose={() => setViewer(false)} />}
    </article>
  )
}

function ModelModal({ path, color, title, onClose }: { path: string; color: string; title: string; onClose: () => void }) {
  const { mesh, loading, error } = useStlMesh(path)
  return (
    <Modal title={title} onClose={onClose} wide>
      {loading && <Spinner label="Modell wird geladen …" />}
      {error && <Notice tone="warn">{error}</Notice>}
      {mesh && <StlViewer mesh={mesh} color={color} className="h-[60vh] w-full" />}
    </Modal>
  )
}
