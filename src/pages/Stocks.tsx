import { useCallback, useEffect, useRef, useState } from 'react'
import { TrendingDown, TrendingUp } from 'lucide-react'
import Card from '../components/ui/Card'
import PageHeader from '../components/ui/PageHeader'
import { ErrorBox, Notice, Spinner } from '../components/ui/States'
import { useAsync } from '../lib/useAsync'
import { errorMessage } from '../lib/errors'
import { useWallet } from '../features/koins/WalletProvider'
import { fetchQuote, stockConfig, stockHistory, stockList, stockReport, stockTrade, type StockRow } from '../services/stocks'

const usd = (c: number | null) => (c === null ? '–' : (c / 100).toLocaleString('de-DE', { style: 'currency', currency: 'USD' }))
const REFRESH_MS = 60_000

/** Börse: echte Kurse (Finnhub, im Browser geholt), Handel mit Coins. Kurse zählen erst, wenn mehrere Personen ähnliche Werte melden. */
export default function Stocks() {
  const wallet = useWallet()
  const cfg = useAsync(stockConfig, [])
  const list = useAsync(stockList, [])
  const hist = useAsync(stockHistory, [])
  const [sel, setSel] = useState<string | null>(null)
  const [qty, setQty] = useState('1')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const cfgRef = useRef(cfg.data)
  cfgRef.current = cfg.data

  const poll = useCallback(async () => {
    const c = cfgRef.current
    if (!c || !c.key || document.visibilityState !== 'visible') { void list.reload(); return }
    for (const s of c.symbols) {
      const q = await fetchQuote(s, c.key)
      if (q) { try { await stockReport(s, q.c, q.pc) } catch { /* Kurs wird später erneut gemeldet */ } }
    }
    void list.reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!cfg.data) return
    void poll()
    const t = window.setInterval(() => void poll(), REFRESH_MS)
    return () => window.clearInterval(t)
  }, [cfg.data, poll])

  const rows = list.data ?? []
  const cur: StockRow | undefined = rows.find((r) => r.symbol === sel) ?? rows[0]
  const n = Math.max(0, Math.floor(Number(qty) || 0))
  const rate = cfg.data?.fee_permille ?? 0
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
      <PageHeader eyebrow="Echte Aktienkurse, gehandelt mit Coins. Kauf und Verkauf kosten eine kleine Gebühr." title="Börse" />
      {cfg.error && <ErrorBox message={cfg.error} onRetry={cfg.reload} />}
      {(cfg.loading || list.loading) && !list.data && <Spinner />}
      {cfg.data && !cfg.data.key && <Notice>Der Admin hat noch keinen Kursdienst-Schlüssel eingetragen. Kurse gibt es erst danach.</Notice>}
      {cfg.data && cfg.data.key && rows.length > 0 && !rows.some((r) => r.fresh) && <Notice>Die Kurse werden gerade bestätigt (es müssen mehrere Personen online sein). Das dauert meist eine Minute.</Notice>}
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
                      <span className="block text-sm">{usd(r.price_cents)}</span>
                      <span className="block text-xs text-slate-400">{r.unit_koins ?? '–'} Coins{!r.fresh && r.price_cents !== null ? ' (veraltet)' : ''}</span>
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
              <p className="text-sm text-slate-400">{usd(cur.price_cents)} · {cur.unit_koins ?? '–'} Coins pro Aktie</p>
              <label className="mt-3 block space-y-1">
                <span className="label-mono">Anzahl</span>
                <input type="number" inputMode="numeric" min={1} value={qty} onChange={(e) => setQty(e.target.value)} className="min-h-[44px] w-full rounded-lg border border-white/15 bg-space-900/60 px-3" />
              </label>
              <p className="mt-2 text-sm text-slate-300" aria-live="polite">{n} × {cur.unit_koins ?? '–'} = {gross.toLocaleString('de-DE')} Coins · Gebühr {fee.toLocaleString('de-DE')}</p>
              <div className="mt-3 flex gap-2">
                <button type="button" disabled={busy || !cur.fresh || n < 1} onClick={() => void trade('buy')} className="min-h-[44px] flex-1 rounded-lg bg-emerald-500 px-3 font-semibold text-slate-950 disabled:opacity-40">Kaufen</button>
                <button type="button" disabled={busy || !cur.fresh || n < 1 || cur.shares < n} onClick={() => void trade('sell')} className="min-h-[44px] flex-1 rounded-lg bg-rose-500 px-3 font-semibold text-white disabled:opacity-40">Verkaufen</button>
              </div>
              {!cur.fresh && <p className="mt-2 text-xs text-amber-300">Kein aktueller Kurs – Handel gerade nicht möglich.</p>}
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
