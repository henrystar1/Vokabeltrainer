import { describe, expect, it } from 'vitest'
import { LEVELS, TILE, type Level } from './levels'
import { generateLevel } from './generator'
import { inExit, newBody, spawnAt, stepBody, type Body } from './engine'

/** Sucht allein (alle Platten gedrückt = Türen offen, Brücken fest) einen Weg vom Start zum Ausgang. Prüft nur die Geometrie. */
export function reachable(lv: Level): { ok: boolean; maxX: number } {
  const all = { a: true, b: true, c: true }
  const s = spawnAt(lv, true, null)
  const start = newBody(s.x, s.y)
  const key = (b: Body) => `${Math.round(b.x / 6)},${Math.round(b.y / 6)},${Math.round(b.vx / 70)},${Math.round(b.vy / 120)},${b.air},${b.ground ? 1 : 0},${b.jumpHeld ? 1 : 0}`
  const seen = new Set<string>([key(start)])
  let frontier: Body[] = [start]
  let maxX = 0
  const acts = [{ move: 1, jump: false }, { move: 1, jump: true }, { move: 0, jump: false }, { move: -1, jump: false }, { move: 0, jump: true }, { move: -1, jump: true }]
  let guard = 0
  while (frontier.length && guard++ < 2500) {
    const next: Body[] = []
    for (const b of frontier) {
      for (const a of acts) {
        const c = { ...b }
        let dead = false
        for (let i = 0; i < 6 && !dead; i++) dead = stepBody(c, a, lv, all, null, 1 / 60) !== 'ok'
        if (dead) continue
        if (inExit(lv, c)) return { ok: true, maxX: c.x }
        const k = key(c)
        if (seen.has(k)) continue
        seen.add(k)
        maxX = Math.max(maxX, c.x)
        next.push(c)
      }
    }
    // Nur die am weitesten rechts liegenden Zustände weiterverfolgen (Speicher begrenzen)
    next.sort((p, q) => q.x - p.x)
    frontier = next.slice(0, 1500)
  }
  return { ok: false, maxX }
}

describe('Erreichbarkeit (Geometrie)', () => {
  LEVELS.forEach((lv, i) => {
    it(`Level ${i + 1} ist allein mit offenen Türen erreichbar`, () => {
      const r = reachable(lv)
      if (!r.ok) console.log(`Level ${i + 1} bleibt bei Spalte`, Math.floor(r.maxX / TILE))
      expect(r.ok).toBe(true)
    }, 120000)
  })
})

describe('Türen und Platten', () => {
  it('Platte vor und hinter jeder Tür liegen so nah beieinander, dass die Leine reicht', () => {
    const all = [...LEVELS, ...[8, 9, 10, 12, 15, 20, 30, 40].map((n) => generateLevel('abc', n)), ...[8, 11, 14, 25].map((n) => generateLevel('xyz', n))]
    all.forEach((lv, i) => {
      lv.rows.forEach((row, y) => {
        for (let x = 0; x < lv.cols; x++) {
          const ch = row[x]
          if (ch < 'A' || ch > 'C' || y !== 0) continue
          const c = ch.toLowerCase()
          const xs = lv.plates.filter((p) => p.ch === c).map((p) => p.x)
          const left = Math.max(...xs.filter((v) => v < x)), right = Math.min(...xs.filter((v) => v > x))
          if (Number.isFinite(left) && Number.isFinite(right)) expect(right - left, `Level ${i + 1}, Tür bei Spalte ${x}`).toBeLessThanOrEqual(16)
          expect(Number.isFinite(left), `Level ${i + 1}, Tür bei Spalte ${x}: Platte davor`).toBe(true)
          expect(Number.isFinite(right), `Level ${i + 1}, Tür bei Spalte ${x}: Platte dahinter`).toBe(true)
        }
      })
    })
  })
})
