import { Builder, LEVELS, type Level } from './levels'

/** Kleiner deterministischer Zufallsgenerator: beide Spieler bekommen aus derselben Zahl dasselbe Level. */
export function rng(seed: string): () => number {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19) }
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const CHANNELS = ['a', 'b', 'c']

/**
 * Zufälliges Level Nummer n (0-basiert, ab den handgebauten Leveln). Je höher n, desto mehr Abschnitte, breitere
 * Stachelfelder, schmalere Plattformen und häufiger Brücken, Türme und Türketten. Alles bleibt innerhalb der
 * Sprungreichweite (Doppelsprung: ~7 Kacheln weit, ~5 hoch), Zusammenarbeit ist über Platten, Türen und Brücken nötig.
 */
export function generateLevel(seed: string, n: number): Level {
  const r = rng(`${seed}:${n}`)
  const d = Math.max(1, n - LEVELS.length + 1) // Schwierigkeit 1, 2, 3 …
  const pick = (a: number, b: number) => a + Math.floor(r() * (b - a + 1))
  const g = new Builder(1400)
  let x = 0
  g.ground(0, 1399)
  g.cp(8)
  x = 14
  const pieces = Math.min(30, 5 + d + Math.floor(d / 2)) // wird mit jedem Level länger, ohne Obergrenze der Schwierigkeit
  const kinds = ['spikes', 'chain', 'bridge', 'pillar', 'platforms', 'tower', 'double', 'pad', 'padchain', 'sky'] as const
  let ch = pick(0, 2)
  let last = ''
  for (let i = 0; i < pieces; i++) {
    // schwere Stücke kommen mit steigender Schwierigkeit häufiger
    const pool: Array<(typeof kinds)[number]> = ['spikes', 'chain', 'pillar', 'platforms']
    if (d >= 1) pool.push('bridge', 'pad')
    if (d >= 1) pool.push('sky')
    if (d >= 2) pool.push('padchain')
    if (d >= 4) pool.push('sky', 'pad', 'padchain')
    if (d >= 2) pool.push('tower', 'bridge')
    if (d >= 3) pool.push('double', 'tower', 'platforms')
    let kind = pool[pick(0, pool.length - 1)]
    if (kind === last) kind = pool[pick(0, pool.length - 1)]
    if (i === 1) kind = 'pad' // jedes zufällige Level hat mindestens ein Sprungpad
    last = kind
    const c = CHANNELS[ch++ % 3]
    switch (kind) {
      case 'spikes': {
        const fields = pick(1, Math.min(6, 1 + Math.floor(d / 2)))
        for (let k = 0; k < fields; k++) {
          const w = pick(3, Math.min(7, 3 + Math.ceil(d / 2)))
          g.spikes(x, x + w - 1)
          x += w + pick(2, 3)
        }
        break
      }
      case 'chain':
        g.chain(c, x)
        x += 9
        if (d >= 4 && r() < 0.5) { g.spikes(x + 2, x + 4); x += 6 }
        break
      case 'bridge':
        g.bridgeGap(c, x)
        x += 18
        break
      case 'pillar':
        g.pillar(x, x + 1, 7).plate(c, x, 6).door(c, x + 6).plate(c, x + 9)
        x += 10
        break
      case 'platforms': {
        const count = pick(3, Math.min(14, 3 + Math.ceil(d / 2)))
        const wide = d >= 4 ? 1 : 2
        const spots: Array<{ x: number; top: number }> = []
        let px = x + (d >= 3 ? pick(3, 4) : 3)
        let top = 8
        for (let k = 0; k < count; k++) {
          top = d >= 5 ? Math.max(4, Math.min(8, top + pick(-1, 2))) : Math.max(5, Math.min(8, top + pick(-1, 1))) // nach oben höchstens eine Zeile je Schritt: sonst nicht mehr machbar
          spots.push({ x: px, top })
          px += wide + (d >= 7 ? 4 : d >= 3 ? pick(3, 4) : 3) // Lücken über 4 Kacheln bei einer 1 Kachel breiten Plattform sind nicht mehr machbar
        }
        // Abgrund genau von hier bis kurz hinter die letzte Plattform (höchstens 3 Kacheln Lücke zum Boden)
        const groundStart = spots[spots.length - 1].x + wide + 3
        g.clear(x, groundStart - 1)
        for (const sp of spots) g.plat(sp.x, sp.x + wide - 1, sp.top)
        x = groundStart + 1
        break
      }
      case 'pad':
        // Hohe Mauer: nur mit dem Sprungpad zu überwinden (oben drauf landen, auf der anderen Seite hinunterspringen)
        g.pad(x)
        if (d >= 2) g.spikes(x + 1, x + 3)
        g.pillar(x + 4, x + 7, 4)
        x += 11
        break
      case 'padchain':
        // Mit dem Pad auf die hohe Plattform: dort hält die Platte die Tür offen, der andere geht durch und hält von drüben
        g.pad(x).pillar(x + 4, x + 8, 4).plate(c, x + 6, 3).door(c, x + 13).plate(c, x + 17)
        x += 21
        break
      case 'sky': {
        // Pad-Turm: mit dem Pad hoch, Plattformen nach rechts, Pad, ein Stück zurück nach links und höher, Pad, wieder nach rechts, dann über die Mauer.
        // Je weiter, desto mehr Plattformen, schmaler, weiter auseinander, mit Stacheln darunter.
        const n = d >= 9 ? 4 : d >= 5 ? 3 : d >= 2 ? 2 : 1
        const w = d >= 6 ? 1 : d >= 1 && n === 1 ? 3 : 2
        const gap = d >= 8 ? 5 : d >= 4 ? 4 : 3
        g.cp2(x)
        x += 6
        g.padTower(x, n, w, gap, d >= 2)
        x = g.towerEnd + 1
        break
      }
      case 'tower':
        // Platte oben auf dem Turm, Tür 4 Kacheln dahinter, niedrige Säule mit Platte (Leine: Platten höchstens 16 Kacheln auseinander)
        g.tower(c, x).door(c, x + 16).pillar(x + 20, x + 21, 7).plate(c, x + 20, 6)
        x += 26
        break
      case 'double': {
        const c2 = CHANNELS[ch++ % 3]
        g.plate(c, x).bridge(c, x + 3, x + 14).spikes(x + 3, x + 14).plate(c, x + 17).plate(c2, x + 20)
        g.bridge(c2, x + 23, x + 34).spikes(x + 23, x + 34).plate(c2, x + 37)
        x += 40
        break
      }
    }
    x += 3
    if (i % 2 === 1) { g.cp(x); x += 3 }
  }
  g.exit(x + 2)
  const end = x + 6
  return g.buildCropped(end, `${n + 1} · Endlos ${d}`, 'Zufälliges Level, das mit jedem weiteren schwerer wird. Auf das Sprungpad (J) treten, um hoch hinaus zu kommen – dann nach rechts steuern und auf der hohen Mauer landen.')
}

/** Level n: zuerst die handgebauten, danach zufällige ohne Ende. */
export function levelFor(seed: string, n: number): Level {
  return n < LEVELS.length ? LEVELS[n] : generateLevel(seed, n)
}
