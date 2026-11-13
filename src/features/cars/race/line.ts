import type { Car, CarStats, Input } from './physics'
import type { Track } from './track'

/** Ideallinie einer Strecke: der kürzeste Weg durch die Kurven innerhalb der Fahrbahn (Gummiband-Verfahren), dazu Geschwindigkeitsprofile je Auto. */
export interface RaceLine {
  t: Track
  /** Punkte der Linie (gleiche Indizes wie die Strecke) */
  x: Float32Array
  z: Float32Array
  /** Seitlicher Versatz zur Streckenmitte (m, + = rechts) */
  off: Float32Array
  /** Krümmung der Linie (1/m, immer ≥ 0) */
  k: Float32Array
  cache: Map<string, Float32Array>
}

const wrap = (d: number) => { while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d }

export function buildRaceLine(t: Track, margin = 3.2, iterations = 140): RaceLine {
  const n = t.n, half = t.def.width / 2
  const lim = Math.max(0, half - margin)
  const ds = t.length / n
  const K = Math.max(2, Math.round(14 / ds))
  const off = new Float32Array(n)
  const px = new Float32Array(n), pz = new Float32Array(n)
  for (let i = 0; i < n; i++) { px[i] = t.x[i]; pz[i] = t.z[i] }
  const nx = new Float32Array(n), nz = new Float32Array(n)
  for (let i = 0; i < n; i++) { nx[i] = -t.tz[i]; nz[i] = t.tx[i] }
  const qx = new Float32Array(n), qz = new Float32Array(n)
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < n; i++) {
      const a = (i + n - K) % n, b = (i + K) % n
      const mx = 0.5 * px[i] + 0.25 * (px[a] + px[b]), mz = 0.5 * pz[i] + 0.25 * (pz[a] + pz[b])
      const o = Math.max(-lim, Math.min(lim, (mx - t.x[i]) * nx[i] + (mz - t.z[i]) * nz[i]))
      off[i] = o
      qx[i] = t.x[i] + nx[i] * o; qz[i] = t.z[i] + nz[i] * o
    }
    px.set(qx); pz.set(qz)
  }
  const k = new Float32Array(n)
  const j = Math.max(2, Math.round(10 / ds))
  for (let i = 0; i < n; i++) {
    const a = (i + n - j) % n, b = (i + j) % n
    const v1x = px[i] - px[a], v1z = pz[i] - pz[a], v2x = px[b] - px[i], v2z = pz[b] - pz[i]
    const cr = v1x * v2z - v1z * v2x, dt = v1x * v2x + v1z * v2z
    const ang = Math.atan2(Math.abs(cr), dt)
    const len = (Math.hypot(v1x, v1z) + Math.hypot(v2x, v2z)) / 2 || 1
    k[i] = ang / len
  }
  return { t, x: px, z: pz, off, k, cache: new Map() }
}

/** Seitliche Beschleunigung, die ein Fahrer mit `skill` aus dem Auto herausholt (m/s²). */
const latAcc = (st: CarStats, skill: number) => (28 + st.turn * 7) * (0.72 + 0.28 * skill) / (1 + Math.max(0, st.top - 90) / 260)

/** Sollgeschwindigkeit entlang der Linie (m/s): Kurvengrenze, dazu rückwärts gerechnet die Bremswege. */
export function speedProfile(line: RaceLine, st: CarStats, skill: number): Float32Array {
  const key = `${st.top.toFixed(1)}|${st.acc.toFixed(1)}|${st.brake.toFixed(1)}|${st.turn}|${skill.toFixed(2)}`
  const hit = line.cache.get(key)
  if (hit) return hit
  const n = line.t.n, ds = line.t.length / n
  const a = latAcc(st, skill), topEff = st.top * (0.86 + 0.14 * skill)
  const v = new Float32Array(n)
  for (let i = 0; i < n; i++) v[i] = Math.min(topEff, Math.sqrt(a / Math.max(line.k[i], 1e-4)))
  const b = st.brake * 0.7
  for (let r = 0; r < 2; r++) for (let i = n - 1; i >= 0; i--) { const nx = (i + 1) % n; v[i] = Math.min(v[i], Math.sqrt(v[nx] * v[nx] + 2 * b * ds)) }
  line.cache.set(key, v)
  return v
}

/** Eingaben für ein Auto, das der Ideallinie folgt (Bots und Fahrassistent). lane = Versatz zur Linie in m. */
export function botSteer(c: Car, st: CarStats, line: RaceLine, skill: number, lane = 0): Input {
  const t = line.t, n = t.n, ds = t.length / n
  const prof = speedProfile(line, st, skill)
  const v = Math.max(0, c.v)
  const i = c.idx
  const j = (i + Math.max(2, Math.round((6 + v * 0.22) / ds))) % n
  const tx = line.x[j] - t.tz[j] * lane, tz = line.z[j] + t.tx[j] * lane
  const d = wrap(Math.atan2(tx - c.x, tz - c.z) - c.h)
  const dev = Math.hypot(line.x[i] - c.x, line.z[i] - c.z)
  const vt = prof[(i + 2) % n] / (1 + Math.max(0, dev - 3) * 0.06)
  return { gas: v < vt, brake: v > vt + 1.5 + v * 0.03, left: d > 0.022, right: d < -0.022 }
}
