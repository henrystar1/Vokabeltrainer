import { useState } from 'react'
import { useAsync } from '../../lib/useAsync'
import { errorMessage } from '../../lib/errors'
import { adminStockAdjust, adminStockHoldings, adminStockRemove, adminStockSave, adminStockTune, adminStockTuneList, stockList, type StockTune } from '../../services/stocks'

/** Admin: die handelbaren Spiel-Aktien (Startpreis in Coins). */
export default function StocksTab() {
  const list = useAsync(stockList, [])
  const tune = useAsync(adminStockTuneList, [])
  const holders = useAsync(() => adminStockHoldings(null), [])
  const [price, setPrice] = useState('1000')
  const [sym, setSym] = useState('')
  const [name, setName] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  async function run(f: () => Promise<unknown>, ok: string) {
    setMsg(null)
    try { await f(); setMsg(ok); await list.reload(); await tune.reload(); await holders.reload() } catch (e) { setMsg(errorMessage(e)) }
  }
  return (
    <div className="max-w-2xl space-y-5">
      <p className="text-sm text-slate-400">Die Kurse berechnet der Server selbst (kein Schlüssel nötig, funktioniert immer): Sie steigen im Schnitt um den eingestellten Wert pro Woche (Standard 50 %) und schwanken zufällig darum. Der Startpreis ist in Coins. Wie stark die Kurse schwanken und die Gebühr stellst du unter „Zahlen“ ein.</p>
      <section className="glass space-y-3 rounded-2xl p-4">
        <h2 className="font-semibold">Aktien</h2>
        <div className="flex flex-wrap gap-2">
          <input value={sym} onChange={(e) => setSym(e.target.value)} placeholder="Kürzel, z. B. AAPL" className="min-h-[44px] w-40 rounded-lg border border-white/15 bg-space-900/60 px-3" />
          <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="numeric" aria-label="Startpreis in Coins" placeholder="Startpreis" className="min-h-[44px] w-32 rounded-lg border border-white/15 bg-space-900/60 px-3" />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, z. B. Apple" className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-white/15 bg-space-900/60 px-3" />
          <button type="button" onClick={() => void run(async () => { await adminStockSave(sym, name, Math.floor(Number(price) || 0)); setSym(''); setName('') }, 'Aktie gespeichert.')} className="min-h-[44px] rounded-lg bg-accent-cyan px-4 font-semibold text-slate-950">Hinzufügen</button>
        </div>
        <ul className="divide-y divide-white/5 text-sm">
          {list.data?.map((r) => (
            <li key={r.symbol} className="flex items-center gap-2 py-2">
              <span className="w-20 font-semibold">{r.symbol}</span>
              <span className="min-w-0 flex-1 truncate text-slate-300">{r.name}</span>
              <span className="text-xs text-slate-500">{r.unit_koins} Coins (Startpreis {r.base_koins})</span>
              <button type="button" onClick={() => { if (confirm(`${r.symbol} entfernen? Bestände werden zum Einsatz zurückgezahlt.`)) void run(() => adminStockRemove(r.symbol), 'Aktie entfernt.') }} className="min-h-[36px] rounded-lg border border-white/15 px-2 text-xs hover:bg-white/10">Entfernen</button>
            </li>
          ))}
        </ul>
      </section>
      <section className="glass space-y-3 rounded-2xl p-4">
        <h2 className="font-semibold">Kurs-Trend je Aktie</h2>
        <p className="text-xs text-slate-400">Trend in % pro Woche: leer = der allgemeine Wert (Standard 50), negativ = der Kurs sinkt langsam (z. B. −10). Der Multiplikator in % regelt, wie stark BANK (Gewinn der Spielbank) und SHOPX (Ausgaben im Shop) auf ihren Treiber reagieren: 100 = normal, 25 = ein Viertel, 0 = gar nicht.</p>
        <ul className="divide-y divide-white/5 text-sm">
          {tune.data?.map((t) => <TuneRow key={`${t.symbol}-${t.trend}-${t.mult}`} t={t} onSave={(trend, mult) => void run(() => adminStockTune(t.symbol, trend, mult), `${t.symbol}: gespeichert.`)} />)}
        </ul>
      </section>
      <section className="glass space-y-3 rounded-2xl p-4">
        <h2 className="font-semibold">Wer hat welche Aktien?</h2>
        {holders.data && holders.data.length === 0 && <p className="text-sm text-slate-400">Noch hält niemand Aktien.</p>}
        <ul className="divide-y divide-white/5 text-sm">
          {holders.data?.map((h) => (
            <li key={`${h.user_id}-${h.symbol}`} className="flex flex-wrap items-center gap-2 py-2">
              <span className="w-20 font-semibold">{h.symbol}</span>
              <span className="min-w-0 flex-1 truncate">{h.name}</span>
              <span className="tabular-nums">{h.shares.toLocaleString('de-DE')} Stück</span>
              <button type="button" onClick={() => void run(() => adminStockAdjust(h.user_id, h.symbol, -h.shares), `${h.name}: ${h.symbol} abgezogen.`)} className="min-h-[40px] rounded-lg border border-rose-400/40 px-3 text-xs text-rose-300 hover:bg-rose-500/10">Alle abziehen</button>
            </li>
          ))}
        </ul>
      </section>
      {msg && <p className="text-sm text-slate-300" role="status">{msg}</p>}
    </div>
  )
}

function TuneRow({ t, onSave }: { t: StockTune; onSave: (trend: number | null, mult: number) => void }) {
  const [trend, setTrend] = useState(t.trend === null ? '' : String(t.trend))
  const [mult, setMult] = useState(String(t.mult))
  const parse = () => { const tr = trend.trim() === '' ? null : Number(trend.replace(',', '.')); return { tr, m: Number(mult.replace(',', '.')) } }
  const save = (trOverride?: number | null) => { const { tr, m } = parse(); onSave(trOverride === undefined ? tr : trOverride, Number.isFinite(m) ? m : 100) }
  return (
    <li className="flex flex-wrap items-center gap-2 py-2">
      <span className="w-20 font-semibold">{t.symbol}</span>
      <label className="flex items-center gap-1 text-xs text-slate-400">Trend %/Woche
        <input value={trend} onChange={(e) => setTrend(e.target.value)} inputMode="decimal" placeholder="normal" aria-label={`Trend ${t.symbol}`} className="min-h-[40px] w-24 rounded-lg border border-white/15 bg-space-900/60 px-2 text-white" />
      </label>
      {t.driver && (
        <label className="flex items-center gap-1 text-xs text-slate-400">Multiplikator %
          <input value={mult} onChange={(e) => setMult(e.target.value)} inputMode="decimal" aria-label={`Multiplikator ${t.symbol}`} className="min-h-[40px] w-20 rounded-lg border border-white/15 bg-space-900/60 px-2 text-white" />
        </label>
      )}
      <button type="button" onClick={() => save()} className="min-h-[40px] rounded-lg bg-accent-cyan px-3 text-xs font-semibold text-slate-950">Speichern</button>
      <button type="button" onClick={() => { setTrend('-10'); save(-10) }} className="min-h-[40px] rounded-lg border border-white/15 px-2 text-xs hover:bg-white/10">Langsam sinken (−10 %)</button>
      <button type="button" onClick={() => { setTrend(''); save(null) }} className="min-h-[40px] rounded-lg border border-white/15 px-2 text-xs hover:bg-white/10">Normal</button>
    </li>
  )
}
