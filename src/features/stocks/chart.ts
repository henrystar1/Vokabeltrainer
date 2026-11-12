export interface ChartPoint { t: number; p: number }

/** Reduziert viele Punkte auf höchstens `max` (gleichmäßig), behält erstes und letztes. */
export function downsample(pts: ChartPoint[], max: number): ChartPoint[] {
  if (pts.length <= max || max < 3) return pts
  const out: ChartPoint[] = []
  const step = (pts.length - 1) / (max - 1)
  for (let i = 0; i < max; i++) out.push(pts[Math.round(i * step)])
  return out
}

export interface Plot { path: string; area: string; min: number; max: number; first: number; last: number; changePct: number; x: (t: number) => number; y: (p: number) => number }

/** Rechnet Punkte in SVG-Koordinaten um (Breite w, Höhe h, Rand pad). */
export function plot(pts: ChartPoint[], w: number, h: number, pad = 8): Plot | null {
  if (pts.length < 2) return null
  const t0 = pts[0].t; const t1 = pts[pts.length - 1].t
  const lo = Math.min(...pts.map((q) => q.p)); const hi = Math.max(...pts.map((q) => q.p))
  const span = hi - lo || Math.max(hi, 1) * 0.02
  const x = (t: number) => pad + ((t - t0) / Math.max(t1 - t0, 1)) * (w - 2 * pad)
  const y = (p: number) => h - pad - ((p - lo) / span) * (h - 2 * pad)
  const d = pts.map((q, i) => `${i ? 'L' : 'M'}${x(q.t).toFixed(1)} ${y(q.p).toFixed(1)}`).join(' ')
  const area = `${d} L${x(t1).toFixed(1)} ${h - pad} L${x(t0).toFixed(1)} ${h - pad} Z`
  const first = pts[0].p; const last = pts[pts.length - 1].p
  return { path: d, area, min: lo, max: hi, first, last, changePct: first ? ((last - first) / first) * 100 : 0, x, y }
}
