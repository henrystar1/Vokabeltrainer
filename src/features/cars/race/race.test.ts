import { describe, expect, it } from 'vitest'
import { STATS, botInput, pushApart, startCar, statsFor, stepCar, type Bot } from './physics'
import { TRACKS, advance, buildTrack, curveAhead, pointAt, project } from './track'

describe('Strecken', () => {
  it.each(TRACKS.map((t) => [t.name, t] as const))('%s: geschlossen, sinnvoll lang, Punkte gleichmäßig', (_n, def) => {
    const t = buildTrack(def)
    expect(t.length).toBeGreaterThan(500)
    expect(t.length).toBeLessThan(2500)
    const gap = Math.hypot(t.x[0] - t.x[t.n - 1], t.z[0] - t.z[t.n - 1])
    expect(gap).toBeLessThan(t.length / t.n * 2)
    for (let i = 0; i < t.n; i++) expect(Math.hypot(t.tx[i], t.tz[i])).toBeCloseTo(1, 3)
  })

  it('project und pointAt passen zusammen (Versatz rechts = positiv)', () => {
    const t = buildTrack(TRACKS[0])
    const p = pointAt(t, 100, 5)
    const pr = project(t, p.x, p.z)
    expect(pr.lat).toBeGreaterThan(4)
    expect(pr.lat).toBeLessThan(6)
    expect(Math.abs(pr.s - 100)).toBeLessThan(6)
  })

  it('advance zählt Runden stetig, auch rückwärts über die Linie', () => {
    const L = 1000
    expect(advance(990, 5, L)).toBeCloseTo(1005)
    expect(advance(1005, 990, L)).toBeCloseTo(990)
    expect(advance(-10, 995, L)).toBeCloseTo(-5)
  })

  it('Krümmung: Rechtskurve positiv', () => {
    const t = buildTrack(TRACKS[0])
    // Sonnenring läuft im Uhrzeigersinn von oben gesehen mit z nach unten → irgendwo muss es Kurven geben
    const c = curveAhead(t, 0, 400)
    expect(Math.abs(c.k)).toBeGreaterThan(0.001)
  })
})

describe('Fahren', () => {
  const t = buildTrack(TRACKS[0])
  it('Gas beschleunigt, Bremse bremst, Gras ist langsamer', () => {
    let c = startCar(t, 0)
    for (let i = 0; i < 120; i++) c = stepCar(c, { gas: true, brake: false, left: false, right: false }, 1 / 60, t, STATS.sportwagen)
    expect(c.v).toBeGreaterThan(10)
    const v1 = c.v
    for (let i = 0; i < 60; i++) c = stepCar(c, { gas: false, brake: true, left: false, right: false }, 1 / 60, t, STATS.sportwagen)
    expect(c.v).toBeLessThan(v1 - 8)
  })

  it('Links lenken dreht nach links (Richtung wächst)', () => {
    let c = { ...startCar(t, 0), v: 20 }
    const h0 = c.h
    for (let i = 0; i < 30; i++) c = stepCar(c, { gas: true, brake: false, left: true, right: false }, 1 / 60, t, STATS.limousine)
    expect(c.h).toBeGreaterThan(h0)
  })

  it('Auto bleibt hinter der Leitplanke', () => {
    let c = { ...startCar(t, 0), v: 40 }
    // stur geradeaus in die Kurve
    for (let i = 0; i < 60 * 30; i++) c = stepCar(c, { gas: true, brake: false, left: false, right: false }, 1 / 60, t, STATS.sportwagen)
    expect(project(t, c.x, c.z).dist).toBeLessThan(t.def.width / 2 + 6)
  })

  it('Zusammenstoß schiebt auseinander', () => {
    const r = pushApart({ x: 0, z: 0, v: 10 }, { x: 1, z: 0 })
    expect(r.hit).toBe(true)
    expect(r.dx).toBeLessThan(0)
    expect(pushApart({ x: 0, z: 0, v: 0 }, { x: 20, z: 0 }).hit).toBe(false)
  })

  it('unbekannte Autoart fährt wie ein Kleinwagen', () => {
    expect(statsFor('xyz')).toBe(STATS.kleinwagen)
  })
})

describe('Bots', () => {
  it.each(TRACKS.map((d) => [d.name, d] as const))('%s: Bot schafft 3 Runden in vernünftiger Zeit und bleibt auf der Strecke', (_n, def) => {
    const tr = buildTrack(def)
    const bot: Bot = { car: startCar(tr, 0), kind: 'limousine', color: '#fff', name: 'B', skill: 0.85, lane: 0, wobble: 0, finished: null }
    let time = 0, worst = 0
    const total = 3 * tr.length
    while (bot.car.total < total && time < 400) {
      bot.car = stepCar(bot.car, botInput(bot, tr, time), 1 / 60, tr, statsFor(bot.kind))
      worst = Math.max(worst, project(tr, bot.car.x, bot.car.z, bot.car.idx).dist)
      time += 1 / 60
    }
    expect(bot.car.total).toBeGreaterThanOrEqual(total)
    expect(time).toBeLessThan(300)
    expect(worst).toBeLessThan(def.width / 2 + 2.5)
  })
})
