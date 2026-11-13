import { describe, expect, it } from 'vitest'
import { STATS, botInput, crash, startCar, statsFor, stepCar, type Bot } from './physics'
import { buildRaceLine } from './line'
import { TRACKS, advance, buildTrack, curveAhead, pointAt, project } from './track'

describe('Strecken', () => {
  it.each(TRACKS.map((t) => [t.name, t] as const))('%s: geschlossen, sinnvoll lang, Punkte gleichmäßig', (_n, def) => {
    const t = buildTrack(def)
    expect(t.length).toBeGreaterThan(500)
    expect(t.length).toBeLessThan(def.id >= 6 ? 20000 : 2500)
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

  it('Zusammenstoß schiebt auseinander und beschädigt', () => {
    const me = { ...startCar(t, 0), x: 0, z: 0, h: 0, v: 30 }
    const r = crash(me, STATS.sportwagen, { x: 0, z: 3, h: 0, v: 0 }, { len: 4.5, wid: 1.9 }, 1)
    expect(r).not.toBeNull()
    expect(r!.z).toBeLessThan(0)
    expect(r!.dmg).toBeGreaterThan(5)
    expect(r!.v).toBeLessThan(30)
    expect(crash(me, STATS.sportwagen, { x: 30, z: 0, h: 0, v: 0 }, { len: 4.5, wid: 1.9 }, 1)).toBeNull()
  })

  it('Hitbox ist ein Rechteck: seitlich knapp daneben trifft nicht', () => {
    const me = { ...startCar(t, 0), x: 0, z: 0, h: 0, v: 0 }
    expect(crash(me, STATS.sportwagen, { x: 2.5, z: 0, h: 0, v: 0 }, { len: 4.5, wid: 1.9 }, 1)).toBeNull()
    expect(crash(me, STATS.sportwagen, { x: 1.5, z: 0, h: 0, v: 0 }, { len: 4.5, wid: 1.9 }, 1)).not.toBeNull()
  })

  it('Wandtreffer macht Schaden, Totalschaden lässt das Auto liegen', () => {
    let c = { ...startCar(t, 0), v: 60 }
    for (let i = 0; i < 60 * 30; i++) c = stepCar(c, { gas: true, brake: false, left: false, right: false }, 1 / 60, t, STATS.sportwagen)
    expect(c.dmg).toBeGreaterThan(5)
    const w = { ...startCar(t, 0), v: 20, dmg: 100 }
    const r = stepCar(w, { gas: true, brake: false, left: false, right: false }, 1, t, STATS.sportwagen)
    expect(r.v).toBeLessThan(20)
  })

  it('Bremse + Lenken driftet, ohne Bremse nicht', () => {
    let a = { ...startCar(t, 0), v: 40 }, b = { ...startCar(t, 0), v: 40 }
    for (let i = 0; i < 40; i++) {
      a = stepCar(a, { gas: false, brake: true, left: true, right: false }, 1 / 60, t, STATS.sportwagen)
      b = stepCar(b, { gas: true, brake: false, left: true, right: false }, 1 / 60, t, STATS.sportwagen)
    }
    expect(Math.abs(a.slip)).toBeGreaterThan(0.15)
    expect(Math.abs(b.slip)).toBeLessThan(0.01)
    let c = { ...startCar(t, 0), v: 40 }
    for (let i = 0; i < 40; i++) c = stepCar(c, { gas: false, brake: true, left: true, right: false }, 1 / 60, t, STATS.sportwagen, true, false)
    expect(Math.abs(c.slip)).toBeLessThan(0.01)
  })

  it('unbekannte Autoart fährt wie ein Kleinwagen', () => {
    expect(statsFor('xyz')).toEqual(STATS.kleinwagen)
  })
})

describe('Bots', () => {
  it.each(TRACKS.filter((d) => d.id < 6).map((d) => [d.name, d] as const))('%s: Bot schafft 3 Runden in vernünftiger Zeit und bleibt auf der Strecke', (_n, def) => {
    const tr = buildTrack(def)
    const line = buildRaceLine(tr)
    const bot: Bot = { car: startCar(tr, 0), kind: 'limousine', color: '#fff', name: 'B', skill: 0.85, lane: 0, wobble: 0, finished: null, st: statsFor('limousine') }
    let time = 0, worst = 0
    const total = 3 * tr.length
    while (bot.car.total < total && time < 400) {
      bot.car = stepCar(bot.car, botInput(bot, line, time), 1 / 60, tr, bot.st, true, false)
      worst = Math.max(worst, project(tr, bot.car.x, bot.car.z, bot.car.idx).dist)
      time += 1 / 60
    }
    expect(bot.car.total).toBeGreaterThanOrEqual(total)
    expect(time).toBeLessThan(300)
    expect(worst).toBeLessThan(def.width / 2 + 2.5)
  })
})

describe('Autos und Tempo', () => {
  it('eigene Höchstgeschwindigkeit skaliert das Fahrwerk', () => {
    expect(statsFor('sportwagen').top * 3.6).toBeCloseTo(240, 3)
    expect(statsFor('sportwagen', 260).top * 3.6).toBeCloseTo(260, 3)
    expect(statsFor('sportwagen', 260).acc).toBeGreaterThan(statsFor('sportwagen').acc)
    expect(statsFor('xyz', null).top * 3.6).toBeCloseTo(150, 3)
  })
  it('Rennwagen sind schneller als Kleinwagen', () => {
    const k = (kind: string) => { const tr = buildTrack(TRACKS[0]); let c = startCar(tr, 0); for (let i = 0; i < 60 * 2.5; i++) c = stepCar(c, { gas: true, brake: false, left: false, right: false }, 1 / 60, tr, statsFor(kind), true); return c.v }
    expect(k('rennwagen')).toBeGreaterThan(k('kleinwagen') + 12)
  })
  it.each(['rennwagen', 'hypercar', 'monstertruck', 'oldtimer'])('Bot mit %s schafft alle Strecken ohne an die Leitplanke zu gehen', (kind) => {
    for (const def of TRACKS.filter((d) => d.id < 6)) {
      const tr = buildTrack(def)
      const line = buildRaceLine(tr)
      const bot: Bot = { car: startCar(tr, 0), kind, color: '#fff', name: 'B', skill: 0.9, lane: 0, wobble: 0, finished: null, st: statsFor(kind) }
      let time = 0, worst = 0
      while (bot.car.total < 2 * tr.length && time < 400) {
        bot.car = stepCar(bot.car, botInput(bot, line, time), 1 / 60, tr, bot.st, true, false)
        worst = Math.max(worst, project(tr, bot.car.x, bot.car.z, bot.car.idx).dist)
        time += 1 / 60
      }
      expect(bot.car.total, `${kind} auf ${def.name}`).toBeGreaterThanOrEqual(2 * tr.length)
      expect(worst, `${kind} auf ${def.name}`).toBeLessThan(def.width / 2 + 3.5)
    }
  })
})
