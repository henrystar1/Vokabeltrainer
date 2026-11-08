import type { WatchRow } from '../../services/play'

export interface Snapshot { rank: number | null; points: number | null; rows: WatchRow[] }

/** Wen hast du seit dem letzten Stand überholt? (vorher vor dir, jetzt hinter dir) */
export function detectOvertakes(prev: Snapshot | null, cur: Snapshot): WatchRow[] {
  if (!prev || prev.points === null || cur.points === null) return []
  const out: WatchRow[] = []
  for (const r of cur.rows) {
    if (r.is_me) continue
    const before = prev.rows.find((p) => p.display_name === r.display_name && !p.is_me)
    if (before && before.points > (prev.points ?? 0) && r.points < cur.points) out.push(r)
  }
  return out.sort((a, b) => b.points - a.points)
}
