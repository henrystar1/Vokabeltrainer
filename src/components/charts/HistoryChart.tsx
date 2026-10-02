import type { HistoryDay } from '../../types'

/** Balken pro Tag: gesamt (hell) und davon richtig (Akzent). Reines SVG, keine Bibliothek. */
export default function HistoryChart({ days }: { days: HistoryDay[] }) {
  if (days.length === 0) return <p className="text-sm text-slate-500">Noch keine Daten.</p>
  const max = Math.max(1, ...days.map((d) => d.total))
  const W = 100 / days.length
  return (
    <div>
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-40 w-full" role="img" aria-label="Verlauf der letzten Tage">
        {days.map((d, i) => {
          const h = (d.total / max) * 36
          const hc = (d.correct / max) * 36
          return (
            <g key={d.day}>
              <rect x={i * W + W * 0.15} y={38 - h} width={W * 0.7} height={h} rx="0.8" style={{ fill: 'rgb(var(--c-violet) / 0.35)' }} />
              <rect x={i * W + W * 0.15} y={38 - hc} width={W * 0.7} height={hc} rx="0.8" style={{ fill: 'rgb(var(--c-cyan))' }} />
            </g>
          )
        })}
      </svg>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-slate-500">
        <span>{formatDay(days[0].day)}</span>
        <span>{formatDay(days[days.length - 1].day)}</span>
      </div>
    </div>
  )
}

function formatDay(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}.${m}.`
}
