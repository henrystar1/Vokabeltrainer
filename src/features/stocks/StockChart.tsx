import { useEffect, useMemo, useState } from 'react'
import { stockChart } from '../../services/stocks'
import { downsample, plot, type ChartPoint } from './chart'

const DAYS = [5, 10, 20, 100] as const

/** Liniendiagramm des Kursverlaufs einer Aktie; Zeitraum einstellbar (5, 10, 20, 100 Tage). */
export default function StockChart({ symbol, reloadKey }: { symbol: string; reloadKey: number }) {
  const [days, setDays] = useState<number>(() => { try { return Number(localStorage.getItem('stockdays')) || 5 } catch { return 5 } })
  const [pts, setPts] = useState<ChartPoint[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    let off = false
    stockChart(symbol, days).then((r) => { if (!off) { setPts(r); setErr(null) } }).catch((e: unknown) => { if (!off) setErr(e instanceof Error ? e.message : 'Fehler') })
    return () => { off = true }
  }, [symbol, days, reloadKey])
  const W = 600; const H = 220
  const view = useMemo(() => (pts ? downsample(pts, 300) : []), [pts])
  const pl = useMemo(() => plot(view, W, H, 10), [view])
  const [hover, setHover] = useState<number | null>(null)
  const hp = hover !== null && view[hover] ? view[hover] : null
  const fmtDate = (t: number) => new Date(t * 1000).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  const up = (pl?.changePct ?? 0) >= 0
  const col = up ? '#34d399' : '#fb7185'
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2" role="group" aria-label="Zeitraum">
        {DAYS.map((d) => (
          <button key={d} type="button" aria-pressed={days === d} onClick={() => { setDays(d); try { localStorage.setItem('stockdays', String(d)) } catch { /* ohne Speicher */ } }}
            className={`min-h-[40px] rounded-lg border px-3 text-sm ${days === d ? 'border-accent-cyan bg-accent-cyan/20 text-white' : 'border-white/15 text-slate-300 hover:bg-white/10'}`}>{d} Tage</button>
        ))}
        {pl && <span className={`ml-auto text-sm ${up ? 'text-emerald-400' : 'text-rose-400'}`}>{up ? '+' : ''}{pl.changePct.toFixed(1).replace('.', ',')} % im Zeitraum</span>}
      </div>
      {err && <p className="text-sm text-rose-300">{err}</p>}
      {pts && !pl && <p className="rounded-xl bg-white/5 p-4 text-sm text-slate-400">Für diesen Zeitraum gibt es noch nicht genug Kursdaten. Der Verlauf füllt sich mit der Zeit.</p>}
      {pl && (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full touch-pan-y rounded-xl bg-black/30" role="img" aria-label={`Kursverlauf der letzten ${days} Tage`}
            onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); const fx = ((e.clientX - r.left) / r.width) * W; let b = 0; let bd = Infinity; view.forEach((q, i) => { const d = Math.abs(pl.x(q.t) - fx); if (d < bd) { bd = d; b = i } }); setHover(b) }}
            onPointerLeave={() => setHover(null)}>
            {[0, 0.5, 1].map((f) => <line key={f} x1={10} x2={W - 10} y1={10 + f * (H - 20)} y2={10 + f * (H - 20)} stroke="#fff" strokeOpacity=".08" />)}
            <path d={pl.area} fill={col} fillOpacity=".12" />
            <path d={pl.path} fill="none" stroke={col} strokeWidth="2" strokeLinejoin="round" />
            {hp && <><line x1={pl.x(hp.t)} x2={pl.x(hp.t)} y1={10} y2={H - 10} stroke="#fff" strokeOpacity=".4" /><circle cx={pl.x(hp.t)} cy={pl.y(hp.p)} r="4" fill={col} /></>}
          </svg>
          <p className="mt-1 flex flex-wrap justify-between gap-2 text-xs text-slate-400" aria-live="polite">
            <span>{hp ? `${fmtDate(hp.t)}: ${hp.p.toLocaleString('de-DE')} Coins` : `Jetzt: ${pl.last.toLocaleString('de-DE')} Coins`}</span>
            <span>Tief {pl.min.toLocaleString('de-DE')} · Hoch {pl.max.toLocaleString('de-DE')}</span>
          </p>
        </>
      )}
    </div>
  )
}
