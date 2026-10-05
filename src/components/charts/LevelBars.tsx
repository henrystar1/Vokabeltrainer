const COLORS = ['#f43f5e', '#f59e0b', '#eab308', '#22d3ee', '#34d399']

/** Wartezeit in Minuten als lesbare Angabe: sofort, 30 Min., 3 Std., 2 Tage. */
export function formatGap(minutes: number): string {
  if (minutes <= 0) return 'sofort wieder'
  if (minutes < 60) return `nach ${minutes} Min.`
  if (minutes < 1440) {
    const h = Math.round(minutes / 6) / 10
    return `nach ${String(h).replace('.', ',')} Std.`
  }
  const d = Math.round((minutes / 1440) * 10) / 10
  return `nach ${String(d).replace('.', ',')} ${d === 1 ? 'Tag' : 'Tagen'}`
}

/** `gaps`: Wartezeit je Stufe 1–4 in Minuten (aus den Regeln). Zeigt, nach wie vielen Tagen eine Vokabel wieder fällig ist. */
export default function LevelBars({ counts, gaps }: { counts: Record<string, number>; gaps?: Record<string, number> }) {
  const max = Math.max(1, ...[1, 2, 3, 4, 5].map((l) => counts[String(l)] ?? 0))
  return (
    <div className="space-y-3">
      {[1, 2, 3, 4, 5].map((l) => {
        const n = counts[String(l)] ?? 0
        return (
          <div key={l} className="flex items-center gap-3">
            <span className="w-28 shrink-0">
              <span className="label-mono block">Stufe {l}</span>
              {gaps && (
                <span className="block text-[11px] leading-tight text-slate-500">
                  {l === 5 ? 'gelernt' : `fällig ${formatGap(gaps[`learn_gap_l${l}`] ?? 0)}`}
                </span>
              )}
            </span>
            <div className="h-3 flex-1 overflow-hidden rounded-full bg-space-700">
              <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${(n / max) * 100}%`, background: COLORS[l - 1] }} />
            </div>
            <span className="w-12 shrink-0 text-right font-mono text-sm">{n}</span>
          </div>
        )
      })}
    </div>
  )
}
