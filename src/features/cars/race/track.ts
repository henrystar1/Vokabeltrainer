/** Rennstrecken: geschlossene Kurven aus Stützpunkten (Catmull-Rom), fein abgetastet. Reine Logik, testbar. */
export interface TrackDef { id: number; name: string; text: string; width: number; laps: number; theme: 'gras' | 'wueste' | 'schnee' | 'stadt' | 'nacht' | 'herbst'; pts: Array<[number, number]> }

const R = (n: number, f: (i: number) => [number, number]): Array<[number, number]> => Array.from({ length: n }, (_, i) => f(i))

export const TRACKS: TrackDef[] = [
  { id: 0, name: 'Sonnenring', text: 'Breiter Oval-Kurs mit sanften Kurven – ideal zum Einstieg.', width: 17, laps: 3, theme: 'gras',
    pts: [[0, -120], [90, -110], [150, -40], [150, 50], [90, 115], [0, 125], [-90, 115], [-150, 50], [-150, -40], [-90, -110]] },
  { id: 1, name: 'Schlangenpass', text: 'Viele S-Kurven hintereinander. Früh abbremsen und die Kurve vorausschauen.', width: 15, laps: 3, theme: 'herbst',
    pts: [[-160, 0], [-110, -60], [-60, 10], [-10, -70], [40, 0], [90, -70], [150, -20], [160, 60], [100, 100], [40, 40], [-20, 110], [-80, 70], [-140, 90]] },
  { id: 2, name: 'Haarnadel-Berg', text: 'Enge Spitzkehren und lange Gerade. Wer bremst, gewinnt.', width: 14, laps: 3, theme: 'schnee',
    pts: [[-170, -80], [30, -90], [140, -70], [165, -10], [120, 30], [20, 20], [-70, 40], [-60, 100], [60, 130], [170, 110], [175, 170], [-40, 175], [-160, 150], [-185, 60], [-180, -20]] },
  { id: 3, name: 'Stadtkurs', text: 'Rechte Winkel zwischen Häuserblocks – kurze Geraden, harte Ecken.', width: 16, laps: 3, theme: 'stadt',
    pts: [[-120, -100], [20, -100], [110, -100], [130, -40], [70, -10], [70, 50], [130, 70], [130, 130], [20, 130], [-40, 90], [-100, 130], [-150, 80], [-120, 10], [-150, -40]] },
  { id: 4, name: 'Wüstenschleife', text: 'Weite Bögen und eine lange Zielgerade, Staub und Felsen am Rand.', width: 18, laps: 3, theme: 'wueste',
    pts: [[-150, 0], [-100, -90], [0, -130], [110, -100], [170, -20], [130, 70], [40, 110], [-30, 60], [-80, 100], [-150, 80]] },
  { id: 5, name: 'Nachtflug', text: 'Verschlungene Strecke bei Nacht mit Leuchtstreifen am Rand.', width: 15, laps: 3, theme: 'nacht',
    pts: R(16, (i) => { const a = (i / 16) * Math.PI * 2; const r = 140 + (i % 2 ? 26 : -22) + Math.sin(a * 3) * 14; return [Math.cos(a) * r * 1.25, Math.sin(a) * r] }) },
]

export interface Track {
  def: TrackDef
  /** Abtastpunkte entlang der Mitte */
  x: Float32Array; z: Float32Array
  /** Fahrtrichtung (Einheitsvektor) je Punkt */
  tx: Float32Array; tz: Float32Array
  /** Strecke vom Start bis zu diesem Punkt (m) */
  s: Float32Array
  /** Krümmung je Punkt (1/m, + = Rechtskurve von oben gesehen) */
  k: Float32Array
  n: number
  length: number
}

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t)
}

/** Baut die abgetastete Strecke (ca. alle 3 m ein Punkt). */
export function buildTrack(def: TrackDef, step = 3): Track {
  const P = def.pts
  const m = P.length
  const raw: Array<[number, number]> = []
  for (let i = 0; i < m; i++) {
    const p0 = P[(i + m - 1) % m], p1 = P[i], p2 = P[(i + 1) % m], p3 = P[(i + 2) % m]
    const seg = Math.hypot(p2[0] - p1[0], p2[1] - p1[1])
    const cnt = Math.max(4, Math.ceil(seg / 1.5))
    for (let j = 0; j < cnt; j++) { const t = j / cnt; raw.push([catmull(p0[0], p1[0], p2[0], p3[0], t), catmull(p0[1], p1[1], p2[1], p3[1], t)]) }
  }
  // gleichmäßig nach Bogenlänge neu abtasten
  const cum = [0]
  for (let i = 1; i <= raw.length; i++) { const a = raw[i - 1], b = raw[i % raw.length]; cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1])) }
  const total = cum[cum.length - 1]
  const n = Math.max(16, Math.round(total / step))
  const len = total
  const x = new Float32Array(n), z = new Float32Array(n), tx = new Float32Array(n), tz = new Float32Array(n), s = new Float32Array(n), k = new Float32Array(n)
  let j = 0
  for (let i = 0; i < n; i++) {
    const d = (i / n) * len
    while (j < raw.length - 1 && cum[j + 1] < d) j++
    const a = raw[j], b = raw[(j + 1) % raw.length]
    const seg = cum[j + 1] - cum[j] || 1
    const f = (d - cum[j]) / seg
    x[i] = a[0] + (b[0] - a[0]) * f; z[i] = a[1] + (b[1] - a[1]) * f; s[i] = d
  }
  for (let i = 0; i < n; i++) {
    const a = (i + n - 1) % n, b = (i + 1) % n
    const dx = x[b] - x[a], dz = z[b] - z[a]
    const l = Math.hypot(dx, dz) || 1
    tx[i] = dx / l; tz[i] = dz / l
  }
  for (let i = 0; i < n; i++) {
    const a = (i + n - 2) % n, b = (i + 2) % n
    const cross = tx[a] * tz[b] - tz[a] * tx[b]
    const ang = Math.asin(Math.max(-1, Math.min(1, cross)))
    k[i] = ang / (4 * (len / n))
  }
  return { def, x, z, tx, tz, s, k, n, length: len }
}

export interface Proj { i: number; s: number; lat: number; /** Abstand zur Mitte (immer ≥ 0) */ dist: number }

/** Nächster Streckenpunkt (mit Hinweis auf den letzten Index: sucht nur im Umfeld, sonst überall). */
export function project(t: Track, px: number, pz: number, hint = -1): Proj {
  let best = -1, bd = Infinity
  const scan = (from: number, to: number) => {
    for (let q = from; q <= to; q++) {
      const i = ((q % t.n) + t.n) % t.n
      const dx = px - t.x[i], dz = pz - t.z[i]
      const d = dx * dx + dz * dz
      if (d < bd) { bd = d; best = i }
    }
  }
  if (hint >= 0) scan(hint - 30, hint + 30)
  if (best < 0 || bd > 60 * 60) { bd = Infinity; scan(0, t.n - 1) }
  const dx = px - t.x[best], dz = pz - t.z[best]
  // seitlicher Versatz: + = rechts der Fahrtrichtung (x nach rechts, z nach unten → rechts = (-tz, tx) von oben gesehen negiert)
  const lat = dx * -t.tz[best] + dz * t.tx[best]
  return { i: best, s: t.s[best], lat, dist: Math.abs(lat) }
}

/** Punkt auf der Strecke bei Position s (m, wird umgebrochen) mit seitlichem Versatz. */
export function pointAt(t: Track, s: number, lat = 0): { x: number; z: number; hx: number; hz: number; i: number } {
  const i = Math.round((((s % t.length) + t.length) % t.length) / (t.length / t.n)) % t.n
  return { x: t.x[i] - t.tz[i] * lat, z: t.z[i] + t.tx[i] * lat, hx: t.tx[i], hz: t.tz[i], i }
}

/** Fortschritt entlang mehrerer Runden (stetig): vorheriger Wert + kleinster Zuwachs. */
export function advance(total: number, projS: number, length: number): number {
  const lapBase = Math.floor(total / length) * length
  let cand = lapBase + projS
  while (cand - total > length / 2) cand -= length
  while (total - cand > length / 2) cand += length
  return cand
}

/** Wie stark ist die Kurve in den nächsten `ahead` Metern (Vorzeichen: + rechts)? Max-Betrag zählt, dazu Abstand. */
export function curveAhead(t: Track, i: number, ahead: number): { k: number; dist: number } {
  const step = t.length / t.n
  const cnt = Math.ceil(ahead / step)
  let best = 0, at = 0
  for (let q = 1; q <= cnt; q++) { const kk = t.k[(i + q) % t.n]; if (Math.abs(kk) > Math.abs(best)) { best = kk; at = q * step } }
  return { k: best, dist: at }
}
