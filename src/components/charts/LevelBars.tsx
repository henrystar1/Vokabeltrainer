const COLORS = ['#f43f5e', '#f59e0b', '#eab308', '#22d3ee', '#34d399']

export default function LevelBars({ counts }: { counts: Record<string, number> }) {
  const max = Math.max(1, ...[1, 2, 3, 4, 5].map((l) => counts[String(l)] ?? 0))
  return (
    <div className="space-y-3">
      {[1, 2, 3, 4, 5].map((l) => {
        const n = counts[String(l)] ?? 0
        return (
          <div key={l} className="flex items-center gap-3">
            <span className="label-mono w-16 shrink-0">Stufe {l}</span>
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
