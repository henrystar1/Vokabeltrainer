import { useState } from 'react'
import { useAsync } from '../../lib/useAsync'
import { errorMessage } from '../../lib/errors'
import { adminStockRemove, adminStockSave, stockList } from '../../services/stocks'

/** Admin: die handelbaren Spiel-Aktien (Grundpreis in Coins). */
export default function StocksTab() {
  const list = useAsync(stockList, [])
  const [price, setPrice] = useState('1000')
  const [sym, setSym] = useState('')
  const [name, setName] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  async function run(f: () => Promise<unknown>, ok: string) {
    setMsg(null)
    try { await f(); setMsg(ok); await list.reload() } catch (e) { setMsg(errorMessage(e)) }
  }
  return (
    <div className="max-w-2xl space-y-5">
      <p className="text-sm text-slate-400">Die Kurse werden vom Server selbst berechnet und schwanken im Minutentakt um den Grundpreis (kein Schlüssel nötig, funktioniert immer). Der Grundpreis ist in Coins. Wie stark die Kurse schwanken und die Gebühr stellst du unter „Zahlen“ ein.</p>
      <section className="glass space-y-3 rounded-2xl p-4">
        <h2 className="font-semibold">Aktien</h2>
        <div className="flex flex-wrap gap-2">
          <input value={sym} onChange={(e) => setSym(e.target.value)} placeholder="Kürzel, z. B. AAPL" className="min-h-[44px] w-40 rounded-lg border border-white/15 bg-space-900/60 px-3" />
          <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="numeric" aria-label="Grundpreis in Coins" placeholder="Grundpreis" className="min-h-[44px] w-32 rounded-lg border border-white/15 bg-space-900/60 px-3" />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, z. B. Apple" className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-white/15 bg-space-900/60 px-3" />
          <button type="button" onClick={() => void run(async () => { await adminStockSave(sym, name, Math.floor(Number(price) || 0)); setSym(''); setName('') }, 'Aktie gespeichert.')} className="min-h-[44px] rounded-lg bg-accent-cyan px-4 font-semibold text-slate-950">Hinzufügen</button>
        </div>
        <ul className="divide-y divide-white/5 text-sm">
          {list.data?.map((r) => (
            <li key={r.symbol} className="flex items-center gap-2 py-2">
              <span className="w-20 font-semibold">{r.symbol}</span>
              <span className="min-w-0 flex-1 truncate text-slate-300">{r.name}</span>
              <span className="text-xs text-slate-500">{r.unit_koins} Coins (Grundpreis {r.base_koins})</span>
              <button type="button" onClick={() => { if (confirm(`${r.symbol} entfernen? Bestände werden zum Einsatz zurückgezahlt.`)) void run(() => adminStockRemove(r.symbol), 'Aktie entfernt.') }} className="min-h-[36px] rounded-lg border border-white/15 px-2 text-xs hover:bg-white/10">Entfernen</button>
            </li>
          ))}
        </ul>
      </section>
      {msg && <p className="text-sm text-slate-300" role="status">{msg}</p>}
    </div>
  )
}
