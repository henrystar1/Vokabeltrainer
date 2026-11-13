import { buildTrack, customTrackDef } from './track'

export type Pt = [number, number]

/** Länge eines geschlossenen Linienzugs. */
export function loopLength(p: Pt[]): number {
  let l = 0
  for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; l += Math.hypot(b[0] - a[0], b[1] - a[1]) }
  return l
}

/** n gleichmäßig verteilte Punkte auf dem geschlossenen Linienzug. */
export function resampleClosed(p: Pt[], n: number): Pt[] {
  const total = loopLength(p)
  const out: Pt[] = []
  let seg = 0, acc = 0
  for (let k = 0; k < n; k++) {
    const target = (total * k) / n
    while (seg < p.length - 1 && acc + Math.hypot(p[(seg + 1) % p.length][0] - p[seg][0], p[(seg + 1) % p.length][1] - p[seg][1]) < target) {
      acc += Math.hypot(p[(seg + 1) % p.length][0] - p[seg][0], p[(seg + 1) % p.length][1] - p[seg][1]); seg++
    }
    const a = p[seg], b = p[(seg + 1) % p.length]
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    const f = Math.max(0, Math.min(1, (target - acc) / L))
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f])
  }
  return out
}

/** Glättet den geschlossenen Linienzug (Mittelwert mit den Nachbarn). */
export function smoothClosed(p: Pt[], iterations: number): Pt[] {
  let cur = p
  for (let it = 0; it < iterations; it++) cur = cur.map((q, i) => { const a = cur[(i + cur.length - 1) % cur.length], b = cur[(i + 1) % cur.length]; return [(a[0] + 2 * q[0] + b[0]) / 4, (a[1] + 2 * q[1] + b[1]) / 4] as Pt })
  return cur
}

const ccw = (a: Pt, b: Pt, c: Pt) => (c[1] - a[1]) * (b[0] - a[0]) - (b[1] - a[1]) * (c[0] - a[0])
/** Kreuzt sich der geschlossene Linienzug selbst? */
export function selfIntersects(p: Pt[]): boolean {
  const n = p.length
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue
    const a = p[i], b = p[(i + 1) % n], c = p[j], d = p[(j + 1) % n]
    if (ccw(a, b, c) * ccw(a, b, d) < 0 && ccw(c, d, a) * ccw(c, d, b) < 0) return true
  }
  return false
}

export interface Fit { pts: Pt[]; length: number; error: string | null }

/** Aus einer gemalten Linie (Bildschirmpunkte) eine Strecke machen: schließen, gleichmäßig verteilen, glätten, auf `targetM` Meter skalieren, prüfen. */
export function fitDrawing(raw: Pt[], targetM: number, width: number): Fit {
  const fail = (error: string): Fit => ({ pts: [], length: 0, error })
  if (raw.length < 12) return fail('Male eine längere Linie – am besten eine Runde, die wieder beim Start ankommt.')
  const px = loopLength(raw)
  if (px < 120) return fail('Die Linie ist zu kurz.')
  const closeGap = Math.hypot(raw[0][0] - raw[raw.length - 1][0], raw[0][1] - raw[raw.length - 1][1])
  if (closeGap > px * 0.45) return fail('Der Anfang und das Ende liegen zu weit auseinander. Male eine Runde, die fast wieder am Start ankommt.')
  const N = 56
  for (let smooth = 4; smooth <= 40; smooth += 6) {
    let q = smoothClosed(resampleClosed(raw, N), smooth)
    const cx = q.reduce((s, a) => s + a[0], 0) / N, cz = q.reduce((s, a) => s + a[1], 0) / N
    const k = targetM / loopLength(q)
    q = q.map((a) => [Math.round((a[0] - cx) * k), Math.round((a[1] - cz) * k)] as Pt)
    if (selfIntersects(q)) { if (smooth >= 40) return fail('Die Strecke kreuzt sich selbst. Male eine Runde ohne Überschneidung.'); continue }
    const t = buildTrack(customTrackDef('x', q, width, 'c:x'), 6)
    let kmax = 0
    for (let i = 0; i < t.n; i++) kmax = Math.max(kmax, Math.abs(t.k[i]))
    if (kmax > 1 / (width * 0.9)) { if (smooth >= 40) return fail('Eine Kurve ist zu eng. Male sie weiter und runder, oder wähle eine größere Strecke.'); continue }
    return { pts: q, length: Math.round(t.length), error: null }
  }
  return fail('Aus der Linie lässt sich keine befahrbare Strecke machen. Versuche es mit weicheren Kurven.')
}
