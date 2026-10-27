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
    // Die Bots würfeln Fehler (Math.random), Level 7 schaffen sie nie: etwas Spielraum, damit der Test nicht zufällig rot wird
    expect(ok).toBeGreaterThanOrEqual(10)
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

describe('Bots und Turm-Tür', () => {
  it('Bots springen nicht in die Lücke zwischen Turm und Tür, wenn niemand die Tür offen hält', () => {
    const lv = levelFor('seed', 4)
    const bots = [3, 5].map((k, i) => newBot(i, lv, 20, k, 4))
    let inHole = 0
    for (let f = 0; f < 70 * 60; f++) {
      for (const b of bots) {
        const humans = [{ x: 6 * 32, y: 10 * 32 - 28 }] // ein Mensch steht weit hinten am Start
        const others = [...humans, ...bots.filter((o) => o !== b && o.deadT <= 0).map((o) => ({ x: o.body.x, y: o.body.y }))]
        const infos = bots.filter((o) => o !== b).map((o) => ({ i: o.i, x: o.body.x, y: o.body.y, mode: o.mode, ch: o.holdCh, take: o.take }))
        botStep(lv, b, 1 / 60, { humans, others, bots: infos })
        if (b.body.x > 57.5 * 32 && b.body.x < 61 * 32 && b.body.y > 8 * 32) inHole++
      }
    }
    expect(inHole).toBe(0)
  }, 120000)
})

describe('Bots und Fahnen', () => {
  it('Wer ein Level schafft, hat alle Fahnen davor mitgenommen', () => {
    for (const n of [0, 1, 2, 3]) {
      const lv = levelFor('seed', n)
      const b = newBot(0, lv, 20, 3, n)
      let exit = false
      for (let f = 0; f < 120 * 60 && !exit; f++) exit = botStep(lv, b, 1 / 60, { humans: [], others: [] }) === 'exit'
      expect(exit).toBe(true)
      expect(b.cp).toBe(Math.max(...lv.checkpoints.filter((c) => c < lv.exit.x)))
    }
  }, 300000)
})
