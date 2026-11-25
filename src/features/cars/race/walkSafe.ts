export type Pt = [number, number]

/** Freie Strecke auf dem Boden: alle 2 m geprüft, ob etwas im Weg steht. */
export function clearPath(blocked: (x: number, z: number) => boolean, ax: number, az: number, bx: number, bz: number): boolean {
  const d = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(d / 2))
  for (let i = 1; i <= n; i++) { const t = i / n; if (blocked(ax + (bx - ax) * t, az + (bz - az) * t)) return false }
  return true
}

/**
 * Wegfindung für Figuren im Freien (Sanitäter, Polizisten …): läuft geradeaus, wenn frei – sonst über das Straßennetz um die Häuser herum.
 * Die Straßenroute wird je `key` kurz zwischengespeichert (kein Dijkstra pro Bild).
 */
export function makeSafeNav(blocked: (x: number, z: number) => boolean, route: (sx: number, sz: number, tx: number, tz: number) => Pt[], now: () => number = () => Date.now()) {
  const cache = new Map<string, { t: number; tx: number; tz: number; pts: Pt[] }>()
  return (key: string, from: { x: number; z: number }, to: { x: number; z: number }): { x: number; z: number } => {
    if (clearPath(blocked, from.x, from.z, to.x, to.z)) return { x: to.x, z: to.z }
    const nowT = now()
    let c = cache.get(key)
    if (!c || nowT - c.t > 1500 || Math.hypot(c.tx - to.x, c.tz - to.z) > 4) {
      c = { t: nowT, tx: to.x, tz: to.z, pts: route(from.x, from.z, to.x, to.z) }
      cache.set(key, c)
      if (cache.size > 64) for (const k of cache.keys()) { cache.delete(k); if (cache.size <= 32) break }
    }
    // weitester Wegpunkt, der von hier frei erreichbar ist (aber mindestens 2 m entfernt)
    let pick: Pt | null = null
    for (let i = 0; i < c.pts.length; i++) {
      const p = c.pts[i]
      if (Math.hypot(p[0] - from.x, p[1] - from.z) < 2.5) continue
      if (clearPath(blocked, from.x, from.z, p[0], p[1])) pick = p
      else if (pick) break
    }
    return pick ? { x: pick[0], z: pick[1] } : { x: to.x, z: to.z }
  }
}
