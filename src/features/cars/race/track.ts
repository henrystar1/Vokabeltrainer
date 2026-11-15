/** Rennstrecken: geschlossene Kurven aus Stützpunkten (Catmull-Rom), fein abgetastet. Reine Logik, testbar. */
export interface TrackDef { id: number; /** Rangliste/Online: 't0'…'t10' oder 'c:<uuid>' */ key?: string; name: string; text: string; width: number; laps: number; theme: 'gras' | 'wueste' | 'schnee' | 'stadt' | 'nacht' | 'herbst'; pts: Array<[number, number]>; /** 'free' = endloses Übungsfeld (kein Ziel, keine Wände), 'disc' = Kreisfläche ohne Barrieren */ mode?: 'free' | 'disc' | 'fill' | 'city' | 'stunt'; /** Größter seitlicher Versatz der Ideallinie (m), z. B. bei der Kreisfläche */ lineMax?: number }

const R = (n: number, f: (i: number) => [number, number]): Array<[number, number]> => Array.from({ length: n }, (_, i) => f(i))

/** Langgezogener Kurs: zwei lange Geraden (Halblänge `half`) und zwei Halbkreise (Radius `r`); `bend` = sanfte S-Kurven auf den Geraden (m). */
function stadium(half: number, r: number, straightPts: number, bend = 0): Array<[number, number]> {
  const p: Array<[number, number]> = []
  for (let i = 0; i < straightPts; i++) { const x = -half + (2 * half * i) / straightPts; p.push([x, -r + bend * Math.sin((i / straightPts) * Math.PI * 2)]) }
  for (let i = 1; i < 8; i++) { const a = -Math.PI / 2 + (Math.PI * i) / 8; p.push([half + Math.cos(a) * r * 0.9, Math.sin(a) * r]) }
  for (let i = 0; i < straightPts; i++) { const x = half - (2 * half * i) / straightPts; p.push([x, r - bend * Math.sin((i / straightPts) * Math.PI * 2)]) }
  for (let i = 1; i < 8; i++) { const a = Math.PI / 2 + (Math.PI * i) / 8; p.push([-half + Math.cos(a) * r * 0.9, Math.sin(a) * r]) }
  return p
}

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
  { id: 6, name: 'Highspeed-Ring', text: 'Rund 9 km mit zwei kilometerlangen Geraden – hier zeigt sich, was ein Auto kann.', width: 26, laps: 2, theme: 'gras', pts: stadium(1600, 380, 4) },
  { id: 7, name: 'Endlos-Highway', text: 'Über 10 km, Geraden von 5 km Länge mit sanften Bögen. Für Höchstgeschwindigkeit.', width: 28, laps: 2, theme: 'wueste', pts: stadium(2500, 260, 6, 110) },
  { id: 8, name: 'Alpen-Marathon', text: 'Rund 8 km: eine lange Gerade, dann Berg-Kurven bis zur Haarnadel.', width: 20, laps: 2, theme: 'schnee',
    pts: [[-1300, 0], [-100, -10], [1100, 0], [1900, -120], [2150, -420], [1950, -740], [1350, -860], [900, -640], [500, -940], [0, -1160], [-650, -940], [-960, -620], [-1560, -540], [-2000, -330], [-1900, -90]] },
  { id: 9, name: 'Kontinent-Express', text: 'Die Königsstrecke: rund 15 km, 6-km-Gerade, Bögen und lange Kurven.', width: 24, laps: 2, theme: 'herbst', pts: stadium(3000, 420, 8, 150) },
  { id: 10, name: 'Drift-Arena', text: 'Extrabreite Fahrbahn (48 m) mit weiten, langen Bögen – zum Quer-Driften, ohne anzuecken.', width: 48, laps: 3, theme: 'nacht',
    pts: R(20, (i) => { const a = (i / 20) * Math.PI * 2; const r = 400 + 115 * Math.sin(2 * a + 0.6) + 65 * Math.cos(3 * a); return [Math.cos(a) * r * 1.35, Math.sin(a) * r] }) },
  { id: 11, name: 'Endlos-Asphalt', text: 'Unendlich großes Feld zum Driften-Üben: kein Ziel, keine Wände, nur Asphalt mit Übungskreisen.', width: 60, laps: 1, theme: 'stadt', mode: 'free',
    pts: R(48, (i) => { const a = (i / 48) * Math.PI * 2; return [Math.cos(a) * 120, Math.sin(a) * 120] }) },
  { id: 12, name: 'Drift-Kreis', text: 'Riesige runde Asphaltfläche, die Mitte ist komplett Straße, ohne Barrieren: Kreise driften, quer durchfahren, Runden sammeln.', width: 304, laps: 5, theme: 'wueste', mode: 'disc', lineMax: 45,
    pts: R(96, (i) => { const a = (i / 96) * Math.PI * 2; return [Math.cos(a) * 150, Math.sin(a) * 150] }) },
  { id: 13, name: 'Stadt', text: 'Offene Stadt mit Häuserblöcken, Straßen, engen Gassen, Parks und einer Brücke (Rampen oder mit dem Flugauto). Frei herumfahren, kein Ziel.', width: 24, laps: 1, theme: 'stadt', mode: 'city',
    pts: R(48, (i) => { const a = (i / 48) * Math.PI * 2; return [Math.cos(a) * 120, Math.sin(a) * 120] }) },
  { id: 14, name: 'Stunt-Park', text: 'Looping (ab 100 km/h), Hügel, Schanzen mit Landerampen und eine riesige Sprungrampe auf offener Fläche. Kein Ziel.', width: 24, laps: 1, theme: 'wueste', mode: 'stunt',
    pts: R(48, (i) => { const a = (i / 48) * Math.PI * 2; return [Math.cos(a) * 120, Math.sin(a) * 120] }) },
]

export const trackKey = (d: TrackDef): string => d.key ?? `t${d.id}`

/** Eigene (gemalte) Strecke als Streckendefinition. */
export function customTrackDef(name: string, pts: Array<[number, number]>, width: number, key: string, fill = false): TrackDef {
  return fill
    ? { id: -1, key, name, text: 'Eigene Fläche', width, laps: 1, theme: 'stadt', pts, mode: 'fill' }
    : { id: -1, key, name, text: 'Eigene Strecke', width, laps: 2, theme: 'gras', pts }
}

/** Übungsfläche ohne Ziel (Endlos-Feld oder ausgefüllte Fläche). */
export const isOpen = (d: TrackDef): boolean => d.mode === 'free' || d.mode === 'fill' || d.mode === 'city' || d.mode === 'stunt'

/** Liegt (x,z) im Vieleck? */
export function inPolygon(p: Array<[number, number]>, x: number, z: number): boolean {
  let ins = false
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i], b = p[j]
    if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) ins = !ins
  }
  return ins
}

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
  /** halbe Straßenbreite je Punkt (in Kurven breiter, wie bei der Formel 1) */
  hw: Float32Array
  /** Breite des Schotterfelds außen (m, 0 = keins) und seine Seite (+1/-1 = Vorzeichen des seitlichen Versatzes) */
  gr: Float32Array
  gs: Int8Array
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
  let len = total
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
  if (!def.mode) {
    // zu enge Kurven entschärfen: Radius mindestens halbe Breite + 9 m, damit Randstein und Leitplanke nie ineinander laufen
    const w = Math.max(2, Math.round(10 / step)), rmin = def.width / 2 + 9
    const mx = new Float32Array(n), mz = new Float32Array(n)
    for (let it = 0; it < 120; it++) {
      let moved = 0
      for (let i = 0; i < n; i++) {
        const a = (i + n - w) % n, b = (i + w) % n
        const ax = x[i] - x[a], az = z[i] - z[a], bx = x[b] - x[i], bz = z[b] - z[i], cx = x[a] - x[b], cz = z[a] - z[b]
        const cr = Math.abs(ax * bz - az * bx)
        const r = cr < 1e-6 ? Infinity : (Math.hypot(ax, az) * Math.hypot(bx, bz) * Math.hypot(cx, cz)) / (2 * cr)
        if (r < rmin) { mx[i] = ((x[a] + x[b]) / 2 - x[i]) * 0.4; mz[i] = ((z[a] + z[b]) / 2 - z[i]) * 0.4; moved++ } else { mx[i] = 0; mz[i] = 0 }
      }
      if (!moved) break
      for (let i = 0; i < n; i++) { x[i] += mx[i]; z[i] += mz[i] }
    }
    let acc = 0
    for (let i = 0; i < n; i++) { s[i] = acc; acc += Math.hypot(x[(i + 1) % n] - x[i], z[(i + 1) % n] - z[i]) }
    len = acc
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
  const half = def.width / 2
  const hw = new Float32Array(n).fill(half), gr = new Float32Array(n), gs = new Int8Array(n)
  if (!def.mode) widen(x, z, k, n, len, half, hw, gr, gs)
  return { def, x, z, tx, tz, s, k, hw, gr, gs, n, length: len }
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

/** Liefert eine Prüfung „liegt (x,z) näher als r an irgendeinem Streckenpunkt?“ (Raster, auch für Strecken, die an sich selbst vorbeilaufen). */
export function roadProximity(t: Track): (x: number, z: number, r: number) => boolean {
  const CELL = 60
  const grid = new Map<string, number[]>()
  for (let i = 0; i < t.n; i++) { const key = `${Math.floor(t.x[i] / CELL)},${Math.floor(t.z[i] / CELL)}`; const a = grid.get(key); if (a) a.push(i); else grid.set(key, [i]) }
  return (x, z, r) => {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL), reach = Math.ceil(r / CELL)
    for (let gx = cx - reach; gx <= cx + reach; gx++) for (let gz = cz - reach; gz <= cz + reach; gz++) {
      const a = grid.get(`${gx},${gz}`)
      if (a) for (const i of a) if (Math.hypot(t.x[i] - x, t.z[i] - z) < r) return true
    }
    return false
  }
}


/** Kurven breiter machen (bis +30 %) und außen ein Schotterfeld anlegen – aber nur an jeder zweiten Kurve, nie mehrere hintereinander. */
function widen(x: Float32Array, z: Float32Array, k: Float32Array, n: number, len: number, half: number, hw: Float32Array, gr: Float32Array, gs: Int8Array) {
  const step = len / n
  const W = Math.max(1, Math.round(45 / step))
  const cm = new Float32Array(n)
  for (let i = 0; i < n; i++) { let m = 0; for (let q = -W; q <= W; q++) m = Math.max(m, Math.abs(k[(i + q + n) % n])); cm[i] = m }
  // Kurven finden: zusammenhängende Stücke mit starker Krümmung
  const thr = 1 / Math.max(160, 7 * half * 2)
  const runs: Array<{ a: number; b: number; sg: number }> = []
  let first = 0
  while (first < n && cm[first] > thr) first++
  if (first === n) return
  let i0 = -1, pk = 0, sg = 0
  for (let q = 1; q <= n; q++) {
    const i = (first + q) % n
    if (cm[i] > thr) {
      if (i0 < 0) { i0 = q; pk = 0 }
      if (Math.abs(k[i]) > pk) { pk = Math.abs(k[i]); sg = Math.sign(k[i]) }
    } else if (i0 >= 0) { runs.push({ a: first + i0, b: first + q - 1, sg }); i0 = -1 }
  }
  const G = Math.min(16, 9 + half * 0.35)
  const grid = new Map<string, number[]>()
  const CELL = 60
  for (let i = 0; i < n; i++) { const key = `${Math.floor(x[i] / CELL)},${Math.floor(z[i] / CELL)}`; const a = grid.get(key); if (a) a.push(i); else grid.set(key, [i]) }
  const clear = (i: number, r: number) => {
    const cx = Math.floor(x[i] / CELL), cz = Math.floor(z[i] / CELL), reach = Math.ceil(r / CELL)
    for (let gx = cx - reach; gx <= cx + reach; gx++) for (let gz = cz - reach; gz <= cz + reach; gz++) for (const j of grid.get(`${gx},${gz}`) ?? []) {
      const d = Math.min(Math.abs(j - i), n - Math.abs(j - i))
      if (d * step > 150 && Math.hypot(x[j] - x[i], z[j] - z[i]) < r) return false
    }
    return true
  }
  let prev: boolean = false
  const ramp = Math.round(20 / step)
  for (const r of runs) {
    const long = (r.b - r.a) * step >= 25
    const give: boolean = long && !prev
    prev = give
    if (!give) continue
    for (let q = r.a - ramp * 2; q <= r.b + ramp * 2; q++) {
      const i = ((q % n) + n) % n
      const f = Math.max(0, Math.min(1, Math.min(q - (r.a - ramp * 2), r.b + ramp * 2 - q) / ramp))
      const g = G * f
      if (g < 1) continue
      if (!clear(i, hw[i] + 4.5 + g + 8)) continue
      gr[i] = g; gs[i] = -r.sg
    }
  }
}
