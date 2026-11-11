import { useState } from 'react'
import { ErrorBox, Spinner } from '../../components/ui/States'
import { useAsync } from '../../lib/useAsync'
import { errorMessage } from '../../lib/errors'
import { adminStockGetKey, adminStockRemove, adminStockSave, adminStockSetKey, stockList } from '../../services/stocks'

/** Admin: Finnhub-Schlüssel und die handelbaren Aktien. */
export default function StocksTab() {
  const key = useAsync(adminStockGetKey, [])
  const list = useAsync(stockList, [])
  const [k, setK] = useState<string | null>(null)
  const [sym, setSym] = useState('')
  const [name, setName] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  async function run(f: () => Promise<unknown>, ok: string) {
    setMsg(null)
    try { await f(); setMsg(ok); await Promise.all([key.reload(), list.reload()]) } catch (e) { setMsg(errorMessage(e)) }
  }
  if (key.loading && key.data === undefined) return <Spinner />
  return (
    <div className="max-w-2xl space-y-5">
      <p className="text-sm text-slate-400">Die Kurse holt der Browser der Nutzer bei Finnhub (kostenloser Schlüssel von finnhub.io). Ein Kurs gilt erst, wenn mindestens 2 Personen einen ähnlichen Wert melden (deine eigene Meldung gilt sofort). Der Schlüssel ist für eingeloggte Nutzer sichtbar. Zahlen (Coins pro Dollar, Gebühr, Alter) stehen unter „Zahlen“.</p>
      {key.error && <ErrorBox message={key.error} onRetry={key.reload} />}
      <section className="glass space-y-2 rounded-2xl p-4">
        <h2 className="font-semibold">Finnhub-Schlüssel</h2>
        <input value={k ?? key.data ?? ''} onChange={(e) => setK(e.target.value)} className="min-h-[44px] w-full rounded-lg border border-white/15 bg-space-900/60 px-3 font-mono text-sm" placeholder="API-Schlüssel" autoComplete="off" />
        <button type="button" onClick={() => void run(() => adminStockSetKey(k ?? key.data ?? ''), 'Schlüssel gespeichert.')} className="min-h-[44px] rounded-lg bg-accent-cyan px-4 font-semibold text-slate-950">Speichern</button>
      </section>
      <section className="glass space-y-3 rounded-2xl p-4">
        <h2 className="font-semibold">Aktien</h2>
        <div className="flex flex-wrap gap-2">
          <input value={sym} onChange={(e) => setSym(e.target.value)} placeholder="Kürzel, z. B. AAPL" className="min-h-[44px] w-40 rounded-lg border border-white/15 bg-space-900/60 px-3" />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, z. B. Apple" className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-white/15 bg-space-900/60 px-3" />
          <button type="button" onClick={() => void run(async () => { await adminStockSave(sym, name); setSym(''); setName('') }, 'Aktie gespeichert.')} className="min-h-[44px] rounded-lg bg-accent-cyan px-4 font-semibold text-slate-950">Hinzufügen</button>
        </div>
        <ul className="divide-y divide-white/5 text-sm">
          {list.data?.map((r) => (
            <li key={r.symbol} className="flex items-center gap-2 py-2">
              <span className="w-20 font-semibold">{r.symbol}</span>
              <span className="min-w-0 flex-1 truncate text-slate-300">{r.name}</span>
              <span className="text-xs text-slate-500">{r.price_cents !== null ? `${(r.price_cents / 100).toFixed(2)} $${r.fresh ? '' : ' (alt)'}` : 'kein Kurs'}</span>
              <button type="button" onClick={() => { if (confirm(`${r.symbol} entfernen? Bestände werden zum Einsatz zurückgezahlt.`)) void run(() => adminStockRemove(r.symbol), 'Aktie entfernt.') }} className="min-h-[36px] rounded-lg border border-white/15 px-2 text-xs hover:bg-white/10">Entfernen</button>
            </li>
          ))}
        </ul>
      </section>
      {msg && <p className="text-sm text-slate-300" role="status">{msg}</p>}
    </div>
  )
}
