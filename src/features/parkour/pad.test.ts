import { describe, expect, it } from 'vitest'
import { generateLevel } from './generator'
import { Builder } from './levels'
import { PH, newBody, stepBody } from './engine'
import { reachable } from './reach'
import { BotState, botStep, newBot } from './bots'

describe('Sprungpad', () => {
  const lv = new Builder(30).ground(0, 29).pad(5).pillar(9, 12, 4).exit(25).build('t', '')
  it('schleudert hoch, und der Läufer landet oben auf der Mauer', () => {
    const b = newBody(5 * 32 + 5, 10 * 32 - PH - 0.5)
    let minY = 1e9, landed = false
    for (let i = 0; i < 240 && !landed; i++) { stepBody(b, { move: 1, jump: false }, lv, {}, null, 1 / 60); minY = Math.min(minY, b.y); landed = b.ground && i > 5 }
    expect(minY).toBeLessThan(3 * 32)
    expect(b.x / 32).toBeGreaterThan(9)
    expect(b.y + PH).toBeCloseTo(4 * 32, 0) // steht oben auf der Mauer
  })
  it('generierte Level haben ein Pad und sind erreichbar', () => {
    for (const [seed, n] of [['abc', 8], ['q', 14]] as const) {
      const g = generateLevel(seed, n)
      expect(g.rows.some((r) => r.includes('J'))).toBe(true)
      expect(reachable(g).ok, `${seed}:${n}`).toBe(true)
    }
  }, 300000)
  it('sehr hohe Schwierigkeit: Level bleiben gültig (Pad, Turm, Ausgang), die Suche nach einem Weg wäre dort zu teuer', () => {
    for (const [seed, n] of [['xyz', 30], ['m', 60], ['k', 45]] as const) {
      const g = generateLevel(seed, n)
      expect(g.rows.some((r) => r.includes('J'))).toBe(true)
      expect(g.exit.w).toBeGreaterThan(0)
      expect(g.cols).toBeLessThan(1400)
    }
  })
  it('Bots (Können 3) schaffen Level mit Pad', () => {
    let ok = 0
    for (const n of [8, 9, 10, 11]) {
      const g = generateLevel('seed', n)
      const s: BotState = newBot(0, g, 5, 3, n)
      for (let t = 0; t < 240; t += 1 / 60) { const r = botStep(g, s, 1 / 60); if (r === 'exit') { ok++; break } if (r === 'out') break }
    }
    console.log('Bots mit Pad: ok', ok, 'von 4')
    expect(ok).toBeGreaterThanOrEqual(3)
  }, 300000)
})
