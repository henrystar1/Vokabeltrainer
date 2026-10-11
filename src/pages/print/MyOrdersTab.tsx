import { useState } from 'react'
import { ChevronDown, Package } from 'lucide-react'
import Button from '../../components/ui/Button'
import { TextInput } from '../../components/ui/Field'
import { EmptyState, Notice } from '../../components/ui/States'
import { OrderProgress, StatusChip } from '../../components/print/parts'
import { formatDate } from '../../lib/format'
import { errorMessage } from '../../lib/errors'
import { euro, invoiceFor, parseEuroToCents, FINAL_STATUSES } from '../../lib/printShop'
import { cancelPrintOrder, respondPrintOrder, type PrintOrder } from '../../services/printShop'

interface Props {
  orders: PrintOrder[]
  fetchedAt: number
  onChanged: () => void
  onShop: () => void
}

export default function MyOrdersTab({ orders, fetchedAt, onChanged, onShop }: Props) {
  if (orders.length === 0) {
    return <EmptyState title="Noch keine Bestellungen" text="Stöbere im Shop oder schick eine eigene Anfrage." action={<Button onClick={onShop}>Zum Shop</Button>} />
  }
  const active = orders.filter((o) => !FINAL_STATUSES.includes(o.status))
  const past = orders.filter((o) => FINAL_STATUSES.includes(o.status))
  return (
    <div className="space-y-6">
      {active.length > 0 && (
        <section className="space-y-3">
          <h2 className="label-mono">Laufend</h2>
          {active.map((o) => <OrderCard key={o.id} order={o} fetchedAt={fetchedAt} onChanged={onChanged} />)}
        </section>
      )}
      {past.length > 0 && (
        <section className="space-y-3">
          <h2 className="label-mono">Abgeschlossen</h2>
          {past.map((o) => <OrderCard key={o.id} order={o} fetchedAt={fetchedAt} onChanged={onChanged} />)}
        </section>
      )}
    </div>
  )
}

function OrderCard({ order: o, fetchedAt, onChanged }: { order: PrintOrder; fetchedAt: number; onChanged: () => void }) {
  const [showInvoice, setShowInvoice] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [counter, setCounter] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const inv = invoiceFor(o)
  const counterCents = parseEuroToCents(counter)
  const final = FINAL_STATUSES.includes(o.status)
  const showProgress = !final || o.status === 'geliefert'

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      onChanged()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
      setConfirmCancel(false)
    }
  }

  return (
    <article className={`glass space-y-4 rounded-2xl p-5 ${final && o.status !== 'geliefert' ? 'opacity-75' : ''}`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-semibold">{o.title}</h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
            {o.color_hex && <span className="inline-flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded-full border border-white/30" style={{ background: o.color_hex }} />{o.color_name}</span>}
            {o.qty > 1 && <span>{o.qty} Stück</span>}
            {o.custom_text && <span>„{o.custom_text}“</span>}
            {o.rush_cents > 0 && <span className="text-amber-300">Beschleunigt</span>}
            {o.discount_percent > 0 && <span className="text-emerald-300">{o.discount_percent} % Rabatt</span>}
            <span>{formatDate(o.created_at)}</span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <StatusChip status={o.status} />
          <span className="text-xl font-semibold tabular-nums">{euro(o.final_cents)}</span>
          {o.kind === 'custom' && o.price_cents == null && o.estimate_cents != null && <span className="text-[11px] text-slate-500">Richtpreis</span>}
          {o.kind === 'custom' && o.price_cents == null && o.estimate_cents == null && <span className="text-[11px] text-slate-500">Preis folgt</span>}
        </div>
      </header>

      {showProgress && <OrderProgress order={o} fetchedAt={fetchedAt} />}

      {o.status === 'preis_vorgeschlagen' && (
        <div className="space-y-3 rounded-xl border border-amber-400/30 bg-amber-400/5 p-4">
          <p className="text-sm text-amber-100">
            Preisvorschlag: <b className="text-lg">{euro(o.final_cents)}</b>
            {o.discount_percent > 0 || o.rush_cents > 0 ? <span className="text-xs text-amber-200/70"> (inkl. Rabatt/Express)</span> : null}
          </p>
          {o.admin_note && <p className="text-sm text-slate-300">„{o.admin_note}“</p>}
          <div className="flex flex-wrap items-end gap-2">
            <Button busy={busy} onClick={() => void run(() => respondPrintOrder(o.id, 'accept'))}>Annehmen</Button>
            <Button variant="danger" busy={busy} onClick={() => void run(() => respondPrintOrder(o.id, 'decline'))}>Ablehnen</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TextInput className="!w-40" inputMode="decimal" placeholder="Dein Gegenvorschlag" value={counter} onChange={(e) => setCounter(e.target.value)} aria-label="Gegenvorschlag in Euro" />
            <Button variant="secondary" busy={busy} disabled={counterCents == null} onClick={() => void run(() => respondPrintOrder(o.id, 'counter', counterCents ?? 0))}>Vorschlagen</Button>
          </div>
        </div>
      )}

      {o.status === 'abgelehnt' && <Notice tone="warn">Abgelehnt{o.admin_note ? `: ${o.admin_note}` : '.'} Eingesetzte Coins hast du zurück.</Notice>}
      {o.status !== 'preis_vorgeschlagen' && o.status !== 'abgelehnt' && o.admin_note && <p className="text-sm text-slate-300">Notiz: „{o.admin_note}“</p>}
      {o.status === 'angefragt' && <p className="text-sm text-slate-400">Ich schaue mir deine Anfrage an. Du bekommst eine Nachricht, sobald es etwas Neues gibt.</p>}

      {inv.itemCents != null && (
        <div>
          <button type="button" onClick={() => setShowInvoice((v) => !v)} className="inline-flex min-h-[36px] items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200" aria-expanded={showInvoice}>
            <ChevronDown size={15} className={`transition ${showInvoice ? 'rotate-180' : ''}`} /> Rechnung
          </button>
          {showInvoice && (
            <div className="mt-2 rounded-xl border border-white/10 bg-space-900/50 p-4 text-sm">
              <ul className="space-y-1.5">
                {inv.lines.map((l, i) => <li key={i} className="flex justify-between gap-3 text-slate-300"><span>{l.label}</span><span className="tabular-nums">{euro(l.cents)}</span></li>)}
                {inv.discountCents > 0 && <li className="flex justify-between gap-3 text-emerald-300"><span>Rabatt {o.discount_percent} %</span><span className="tabular-nums">−{euro(inv.discountCents)}</span></li>}
                {inv.rushCents > 0 && <li className="flex justify-between gap-3 text-amber-300"><span>Beschleunigt</span><span className="tabular-nums">+{euro(inv.rushCents)}</span></li>}
              </ul>
              <div className="mt-3 flex items-baseline justify-between border-t border-white/10 pt-3"><span className="label-mono">Gesamt</span><span className="text-lg font-semibold tabular-nums">{euro(inv.totalCents)}</span></div>
              <p className="mt-1 text-right text-[11px] text-slate-500">Bezahlt wird bei der Übergabe.</p>
              {o.print_minutes != null && o.status !== 'angefragt' && o.status !== 'preis_vorgeschlagen' && <p className="mt-1 flex items-center justify-end gap-1 text-[11px] text-slate-500"><Package size={11} /> Druckzeit ca. {o.print_minutes} min</p>}
            </div>
          )}
        </div>
      )}

      {error && <Notice tone="warn">{error}</Notice>}

      {(o.status === 'angefragt' || o.status === 'in_bearbeitung') && (
        <div className="flex justify-end">
          {confirmCancel ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-400">Wirklich abbrechen?</span>
              <Button variant="danger" busy={busy} onClick={() => void run(() => cancelPrintOrder(o.id))}>Ja, abbrechen</Button>
              <Button variant="ghost" onClick={() => setConfirmCancel(false)}>Nein</Button>
            </div>
          ) : (
            <Button variant="ghost" onClick={() => setConfirmCancel(true)}>Abbrechen</Button>
          )}
        </div>
      )}
    </article>
  )
}
