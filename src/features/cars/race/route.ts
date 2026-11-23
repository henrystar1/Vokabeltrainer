/** Wegelinie auf dem Straßenraster: kürzester Weg (Dijkstra) zwischen zwei Punkten, immer auf Straßen, nie in mehrere Richtungen. */
export type Pt = [number, number]

interface Snap { p: Pt; /** Endknoten des Straßenstücks */ ends: [[number, number], [number, number]] }

const snapTo = (x: number, z: number, P: number, K: number): Snap => {
  const cl = (v: number) => Math.max(-K, Math.min(K, v))
  const i = cl(Math.round(x / P)), j = cl(Math.round(z / P))
  const dv = Math.abs(x - i * P), dh = Math.abs(z - j * P)
  if (dv <= dh) {
    // senkrechte Straße x = i·P, Stück zwischen j0 und j0+1
    const zc = Math.max(-K * P, Math.min(K * P, z)), j0 = Math.min(K - 1, Math.max(-K, Math.floor(zc / P)))
    return { p: [i * P, zc], ends: [[i, j0], [i, j0 + 1]] }
  }
  const xc = Math.max(-K * P, Math.min(K * P, x)), i0 = Math.min(K - 1, Math.max(-K, Math.floor(xc / P)))
  return { p: [xc, j * P], ends: [[i0, j], [i0 + 1, j]] }
}

export function streetRoute(sx: number, sz: number, tx: number, tz: number, P = 120, K = 6): Pt[] {
  const a = snapTo(sx, sz, P, K), b = snapTo(tx, tz, P, K)
  const same = a.ends[0][0] === b.ends[0][0] && a.ends[0][1] === b.ends[0][1] && a.ends[1][0] === b.ends[1][0] && a.ends[1][1] === b.ends[1][1]
  const out: Pt[] = [[sx, sz], a.p]
  if (!same) {
    const N = 2 * K + 1, id = (i: number, j: number) => (i + K) * N + (j + K)
    const dist = new Float64Array(N * N).fill(Infinity), prev = new Int32Array(N * N).fill(-1), done = new Uint8Array(N * N)
    const start = a.ends.map(([i, j]) => ({ i, j, d: Math.hypot(a.p[0] - i * P, a.p[1] - j * P) }))
    for (const s of start) { const k = id(s.i, s.j); if (s.d < dist[k]) dist[k] = s.d }
    for (;;) {
      let u = -1, best = Infinity
      for (let k = 0; k < N * N; k++) if (!done[k] && dist[k] < best) { best = dist[k]; u = k }
      if (u < 0) break
      done[u] = 1
      const ui = Math.floor(u / N) - K, uj = (u % N) - K
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const vi = ui + di, vj = uj + dj
        if (Math.abs(vi) > K || Math.abs(vj) > K) continue
        const v = id(vi, vj)
        if (dist[u] + P < dist[v]) { dist[v] = dist[u] + P; prev[v] = u }
      }
    }
    let bk = -1, bc = Infinity
    for (const [i, j] of b.ends) { const k = id(i, j), c = dist[k] + Math.hypot(b.p[0] - i * P, b.p[1] - j * P); if (c < bc) { bc = c; bk = k } }
    const chain: Pt[] = []
    for (let k = bk; k >= 0; k = prev[k]) chain.push([(Math.floor(k / N) - K) * P, ((k % N) - K) * P])
    chain.reverse()
    out.push(...chain)
    out.push(b.p)
  }
  out.push([tx, tz])
  // doppelte Punkte und Zacken (Hin-und-her auf demselben Stück) entfernen
  const res: Pt[] = []
  for (const p of out) {
    const l = res[res.length - 1]
    if (l && Math.hypot(l[0] - p[0], l[1] - p[1]) < 0.5) continue
    res.push(p)
  }
  for (let i = 1; i + 1 < res.length;) {
    const [x0, z0] = res[i - 1], [x1, z1] = res[i], [x2, z2] = res[i + 1]
    const dx1 = x1 - x0, dz1 = z1 - z0, dx2 = x2 - x1, dz2 = z2 - z1
    if (dx1 * dx2 + dz1 * dz2 < -1e-6 && Math.abs(dx1 * dz2 - dz1 * dx2) < 1e-6) { res.splice(i, 1); continue } // Rückwärtsstück
    i++
  }
  return res
}
