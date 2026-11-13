import { useEffect, useState } from 'react'
import { TrendingDown, TrendingUp } from 'lucide-react'
import Card from '../components/ui/Card'
import PageHeader from '../components/ui/PageHeader'
import { ErrorBox, Notice, Spinner } from '../components/ui/States'
import { useAsync } from '../lib/useAsync'
import { errorMessage } from '../lib/errors'
import { useWallet } from '../features/koins/WalletProvider'
import StockChart from '../features/stocks/StockChart'
import { stockHistory, stockList, stockTrade, type StockRow } from '../services/stocks'

const REFRESH_MS = 30_000
const FEE_PERMILLE_FALLBACK = 10

const DRIVER_HINT: Record<string, string> = {
  BANK: 'Diese Aktie hängt an der Spielbank: Gewinnt die Bank beim Gambling viel, steigt der Kurs. Gewinnen Spieler viel, fällt er.',
  SHOPX: 'Diese Aktie hängt am Shop: Werden im Vokabeltrainer viele Coins ausgegeben (Shop, Autos, Plus), steigt der Kurs.',
}

/** Börse: Spiel-Aktien, deren Kurse der Server simuliert; Handel mit Coins. */
export default function Stocks() {
  const wallet = useWallet()
  const list = useAsync(stockList, [])
  const hist = useAsync(stockHistory, [])
  const [tick, setTick] = useState(0)
  const [sel, setSel] = useState<string | null>(null)
  const [qty, setQty] = useState('1')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => {
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void list.reload(); setTick((n) => n + 1) }, REFRESH_MS)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const rows = list.data ?? []
  const cur: StockRow | undefined = rows.find((r) => r.symbol === sel) ?? rows[0]
  const n = Math.max(0, Math.floor(Number(qty) || 0))
  const rate = FEE_PERMILLE_FALLBACK
  const gross = cur?.unit_koins ? cur.unit_koins * n : 0
  const fee = Math.ceil((gross * rate) / 1000)
  const invested = rows.reduce((a, r) => a + (r.unit_koins ? r.unit_koins * r.shares : 0), 0)
  const spent = rows.reduce((a, r) => a + r.cost, 0)

  async function trade(side: 'buy' | 'sell') {
    if (!cur || n < 1) return
    setBusy(true); setMsg(null)
    try {
      const bal = await stockTrade(cur.symbol, side, n)
      wallet.setBalance(bal)
      setMsg({ ok: true, text: `${side === 'buy' ? 'Gekauft' : 'Verkauft'}: ${n} × ${cur.symbol}.` })
      await Promise.all([list.reload(), hist.reload()])
    } catch (e) { setMsg({ ok: false, text: errorMessage(e) }) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Spiel-Aktien: Die Kurse schwanken ständig. Kauf und Verkauf kosten eine kleine Gebühr." title="Börse" />
      {list.error && <ErrorBox message={list.error} onRetry={list.reload} />}
      {list.loading && !list.data && <Spinner />}
      {rows.length === 0 && list.data && <Notice>Noch keine Aktien eingerichtet.</Notice>}
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <ul className="divide-y divide-white/5">
            {rows.map((r) => {
              const diff = r.price_cents !== null && r.prev_close_cents ? ((r.price_cents - r.prev_close_cents) / r.prev_close_cents) * 100 : null
              return (
                <li key={r.symbol}>
                  <button type="button" onClick={() => setSel(r.symbol)} className={`flex min-h-[52px] w-full items-center gap-3 px-2 py-2 text-left hover:bg-white/5 ${cur?.symbol === r.symbol ? 'bg-white/10' : ''}`}>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{r.symbol}</span>
                      <span className="block truncate text-xs text-slate-400">{r.name}{r.shares > 0 ? ` · du hast ${r.shares}` : ''}</span>
                    </span>
                    <span className="text-right">
                      <span className="block text-sm font-semibold">{r.unit_koins ?? '–'} Coins</span>
                      <span className="block text-xs text-slate-500">Startpreis {r.base_koins}</span>
                    </span>
                    {diff !== null && (
                      <span className={`flex w-20 items-center justify-end gap-1 text-xs ${diff >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {diff >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}{diff >= 0 ? '+' : ''}{diff.toFixed(2)} %
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </Card>
        <div className="space-y-4">
          {cur && (
            <Card>
              <h2 className="font-semibold">{cur.name} ({cur.symbol})</h2>
              {DRIVER_HINT[cur.symbol] && <p className="mt-1 rounded-lg bg-amber-400/10 px-3 py-1.5 text-xs text-amber-200">{DRIVER_HINT[cur.symbol]}</p>}
              <p className="text-sm text-slate-400">{cur.unit_koins ?? '–'} Coins pro Aktie</p>
              <div className="mt-3"><StockChart symbol={cur.symbol} reloadKey={tick} /></div>
              <label className="mt-3 block space-y-1">
                <span className="label-mono">Anzahl</span>
                <input type="number" inputMode="numeric" min={1} value={qty} onChange={(e) => setQty(e.target.value)} className="min-h-[44px] w-full rounded-lg border border-white/15 bg-space-900/60 px-3" />
              </label>
              <p className="mt-2 text-sm text-slate-300" aria-live="polite">{n} × {cur.unit_koins ?? '–'} = {gross.toLocaleString('de-DE')} Coins · Gebühr {fee.toLocaleString('de-DE')}</p>
              <div className="mt-3 flex gap-2">
                <button type="button" disabled={busy || n < 1} onClick={() => void trade('buy')} className="min-h-[44px] flex-1 rounded-lg bg-emerald-500 px-3 font-semibold text-slate-950 disabled:opacity-40">Kaufen</button>
                <button type="button" disabled={busy || n < 1 || cur.shares < n} onClick={() => void trade('sell')} className="min-h-[44px] flex-1 rounded-lg bg-rose-500 px-3 font-semibold text-white disabled:opacity-40">Verkaufen</button>
              </div>
              {msg && <p className={`mt-2 text-sm ${msg.ok ? 'text-emerald-300' : 'text-rose-300'}`} role="status">{msg.text}</p>}
            </Card>
          )}
          <Card>
            <h2 className="font-semibold">Mein Depot</h2>
            <p className="text-sm text-slate-300">Wert jetzt: {invested.toLocaleString('de-DE')} Coins · Einsatz: {spent.toLocaleString('de-DE')} Coins</p>
            {hist.data && hist.data.length > 0 && (
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs text-slate-400">
                {hist.data.map((t, i) => <li key={i}>{new Date(t.at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })} · {t.side === 'buy' ? 'Kauf' : 'Verkauf'} {t.shares} × {t.symbol} ({t.total.toLocaleString('de-DE')} Coins)</li>)}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
