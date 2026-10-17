import { describe, expect, it } from 'vitest'
import { FLIGHT, MIN_SEP, angDist, land, landingAngle, levelConfig, newCore, stepCore } from './coreball'
import { clickerRaw, clickerScore, clicksToNext } from './clicker'
import { currentCps, peakCps } from './cps'

function rng(seed: number) {
  let x = seed
  return () => ((x = (x * 1664525 + 1013904223) % 4294967296) / 4294967296)
}

describe('Coreball', () => {
  it('Level werden schwerer', () => {
    const a = levelConfig(1), b = levelConfig(10)
    expect(b.speed).toBeGreaterThan(a.speed)
    expect(b.pre).toBeGreaterThan(a.pre)
    expect(b.balls).toBeGreaterThan(a.balls)
    expect(a.reverseEvery).toBe(0)
    expect(b.reverseEvery).toBeGreaterThan(0)
    expect(b.wobble).toBeGreaterThan(0)
  })
  it('Treffer auf eine steckende Kugel beendet das Spiel', () => {
    const s = newCore(rng(1))
    expect(land(s, s.pins[0] + 0.05)).toBe('hit')
    expect(s.over).toBe(true)
  })
  it('Vorgesetzte Kugeln haben Abstand', () => {
    for (let lv = 1; lv < 20; lv++) {
      const s = newCore(rng(lv))
      s.level = lv
      const t = newCore(rng(lv + 100))
      for (let i = 0; i < t.pins.length; i++) for (let j = i + 1; j < t.pins.length; j++) expect(angDist(t.pins[i], t.pins[j])).toBeGreaterThan(MIN_SEP)
    }
  })
  it('ein Bot mit Vorhalt kommt weit', () => {
    const r = rng(7)
    const s = newCore(r)
    let guard = 0
    while (!s.over && s.level < 16 && guard++ < 200000) {
      stepCore(s, 1 / 60)
      const at = landingAngle(s)
      if (s.pins.every((p) => angDist(p, at) > MIN_SEP + 0.03)) {
        // Kugel fliegt FLIGHT, der Kern dreht sich weiter: Winkel passt, weil landingAngle das vorhersagt.
        land(s, at, r)
      }
    }
    expect(s.over).toBe(false)
    expect(s.level).toBeGreaterThanOrEqual(16)
    expect(s.placed).toBeGreaterThan(60)
    expect(FLIGHT).toBeGreaterThan(0)
  })
})

describe('Klicker', () => {
  it('0,1 Punkte pro Klick, gewertet nur gerade Zahlen', () => {
    expect(clickerRaw(7)).toBeCloseTo(0.7)
    expect(clickerScore(19)).toBe(0)
    expect(clickerScore(20)).toBe(2)
    expect(clickerScore(39)).toBe(2)
    expect(clickerScore(40)).toBe(4)
    expect(clickerScore(200)).toBe(20)
    expect(clicksToNext(0)).toBe(20)
    expect(clicksToNext(5)).toBe(15)
    expect(clicksToNext(20)).toBe(20)
  })
})

describe('CPS', () => {
  it('Bestwert in einer Sekunde', () => {
    const times = [0, 100, 200, 300, 400, 2000, 2050, 2100]
    expect(peakCps(times)).toBe(5)
    expect(peakCps([])).toBe(0)
    expect(peakCps([0, 1000])).toBe(1)
    expect(peakCps([0, 999])).toBe(2)
    expect(currentCps(times, 2200)).toBe(3)
    expect(currentCps(times, 3500)).toBe(0)
  })
})
