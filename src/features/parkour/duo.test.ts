import { describe, expect, it } from 'vitest'
import { duo } from './duoSim'
import { levelFor } from './generator'
import { botStep, newBot } from './bots'
import { newBody, stepBody } from './engine'
describe('zwei Bots auf einem Level', () => {
  it('Doppelbrücke (Level 6): beide kommen durch, ohne sich in die Brücke zu stürzen', () => {
    for (const sk of [[3, 3], [4, 4], [2, 3], [5, 5]]) {
      const r = duo(5, sk, 100)
      expect({ sk, ok: r.ok, deaths: Math.min(r.deaths, 4) }).toEqual({ sk, ok: true, deaths: Math.min(r.deaths, 4) })
      expect(r.deaths).toBeLessThanOrEqual(4)
    }
  }, 300000)
  it('Level 1 bis 14 mit zwei Profi-Bots: fast alle Level werden gemeinsam geschafft', () => {
    let ok = 0
    const bad: number[] = []
    for (let n = 0; n < 14; n++) { if (duo(n, [3, 3], 150).ok) ok++; else bad.push(n + 1) }
    console.log('duo ok', ok, 'nicht:', bad.join(','))
    expect(ok).toBeGreaterThanOrEqual(11)
  }, 600000)
})

describe('Bot und Turm', () => {
  it('ein Bot hinter dem Tor klettert auf den Turm, um einem Menschen die Tür zu öffnen', () => {
    const lv = levelFor('seed', 4) // Turm: Treppe bei Spalte 10 bis 23, Platte oben, Tür bei 26
    const b = newBot(0, lv, 20, 3, 4)
    Object.assign(b.body, { x: 24 * 32, y: 10 * 32 - 28 - 0.5 }); b.deadT = 0; b.grace = 0
    let top = false
    for (let f = 0; f < 60 * 60; f++) {
      botStep(lv, b, 1 / 60, { humans: [{ x: 6 * 32, y: 10 * 32 - 28 }], others: [{ x: 6 * 32, y: 10 * 32 - 28 }] })
      if (b.body.y < 100 && b.mode === 'hold') { top = true; break }
    }
    expect(top).toBe(true)
  }, 120000)
  it('niemand kommt über den oberen Bildrand hinaus', () => {
    const lv = levelFor('seed', 0)
    const bd = newBody(5 * 32, 10 * 32 - 28 - 0.5)
    let minY = 1e9
    for (let f = 0; f < 600; f++) { stepBody(bd, { move: 0, jump: f % 20 < 10, airJumps: 3, jet: true }, lv, {}, null, 1 / 60); minY = Math.min(minY, bd.y) }
    expect(minY).toBeGreaterThanOrEqual(0)
  })
})
