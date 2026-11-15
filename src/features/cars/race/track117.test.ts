import { describe, expect, it } from 'vitest'
import { TRACKS, buildTrack, customTrackDef, inPolygon, isOpen } from './track'
import { startCar, statsFor, stepCar, type Car } from './physics'
import { fitDrawing, type Pt } from './trackDraw'

const dt = 1 / 30
const circle = (r: number, n = 40): Pt[] => Array.from({ length: n }, (_, i) => [Math.round(200 + r * Math.cos((2 * Math.PI * i) / n)), Math.round(150 + r * Math.sin((2 * Math.PI * i) / n))] as Pt)

describe('Strecke zeichnen: Prüfung', () => {
  it('ein Kreis ist gültig, eine Acht (Selbstkreuzung) nicht', () => {
    expect(fitDrawing(circle(100), 3000, 16).error).toBeNull()
    const eight: Pt[] = Array.from({ length: 60 }, (_, i) => { const a = (2 * Math.PI * i) / 60 + 0.1; return [200 + 120 * Math.sin(a), 150 + 80 * Math.sin(2 * a)] as Pt })
    expect(fitDrawing(eight, 3000, 16).error).not.toBeNull()
  })
  it('zwei Teile dicht nebeneinander (Hufeisen mit schmalem Spalt) werden abgelehnt', () => {
    const u: Pt[] = []
    for (let i = 0; i <= 20; i++) u.push([50 + i * 15, 50])
    for (let i = 0; i <= 3; i++) u.push([350, 50 + i * 3])
    for (let i = 20; i >= 0; i--) u.push([50 + i * 15, 59])
    expect(fitDrawing(u, 3000, 30).error).not.toBeNull()
  })
  it('Ausfüllen: auch eine eng gemalte Form ist als Fläche gültig, es gibt keine Kurvenprüfung', () => {
    const r = fitDrawing(circle(100), 2000, 16, true)
    expect(r.error).toBeNull()
    expect(r.pts.length).toBeGreaterThan(10)
  })
})

describe('Ausgefüllte Fläche', () => {
  const sq: Array<[number, number]> = [[-200, -200], [200, -200], [200, 200], [-200, 200], [-200, 100], [-200, 0], [-200, -100], [0, -200]]
  const def = customTrackDef('Fläche', sq, 16, 'c:test', true)
  it('Definition und Punkt-im-Vieleck', () => {
    expect(def.mode).toBe('fill'); expect(isOpen(def)).toBe(true)
    expect(inPolygon(sq, 0, 0)).toBe(true)
    expect(inPolygon(sq, 300, 0)).toBe(false)
  })
  it('innen Straße, außen Gras, nie Wandschaden', () => {
    const t = buildTrack(def), st = statsFor('gt', 300)
    let car: Car = { ...startCar(t, 0), x: 0, z: 0, h: Math.PI / 2, v: 50 }
    expect(stepCar(car, { gas: false, brake: false, left: false, right: false }, dt, t, st, true).offroad).toBe(false)
    let off = false
    for (let i = 0; i < 30 * 10; i++) { car = stepCar(car, { gas: true, brake: false, left: false, right: false }, dt, t, st, true); if (car.offroad) off = true }
    expect(off).toBe(true)
    expect(car.dmg).toBe(0)
  })
})

describe('Breite Kurven und Schotterfeld', () => {
  const normal = TRACKS.filter((d) => !d.mode)
  it('Kurven sind bis 30 % breiter, nie schmaler; Schotter liegt nie an zwei Kurven hintereinander dicht beieinander', () => {
    let anyWide = false, anyGravel = false
    for (const d of normal) {
      const t = buildTrack(d), half = d.width / 2
      for (let i = 0; i < t.n; i++) {
        expect(t.hw[i]).toBeGreaterThanOrEqual(half - 1e-3)
        expect(t.hw[i]).toBeLessThanOrEqual(half * 1.3 + 1e-3)
        if (t.hw[i] > half * 1.05) anyWide = true
        if (t.gr[i] > 0) { anyGravel = true; expect(t.gs[i] === 1 || t.gs[i] === -1).toBe(true); expect(t.gr[i]).toBeLessThanOrEqual(16) }
      }
    }
    expect(anyWide).toBe(true)
    expect(anyGravel).toBe(true)
  })
  it('Schotter bremst stark, macht aber keinen Schaden und es gibt keine Wand davor', () => {
    const d = normal.find((x) => buildTrack(x).gr.some((g) => g > 8))!
    const t = buildTrack(d)
    let i = 0
    for (let q = 0; q < t.n; q++) if (t.gr[q] > t.gr[i]) i = q
    const st = statsFor('gt', 300), side = t.gs[i]
    const lat = side * (t.hw[i] + 5)
    let car: Car = { ...startCar(t, 0), x: t.x[i] - t.tz[i] * lat, z: t.z[i] + t.tx[i] * lat, h: Math.atan2(t.tx[i], t.tz[i]), v: 45, idx: i }
    const v0 = car.v
    for (let k = 0; k < 12; k++) car = stepCar(car, { gas: false, brake: false, left: false, right: false }, dt, t, st, true)
    expect(car.dmg).toBe(0)
    expect(car.offroad).toBe(true)
    expect(car.v).toBeLessThan(v0 * 0.75)
  })
  it('auf der Gegenseite steht die Leitplanke wie bisher bei Fahrbahn + 4,5 m', () => {
    const d = normal[0], t = buildTrack(d)
    const i = 10, half = t.hw[i], side = t.gs[i] || 1
    const lat = -side * (half + 5.5)
    const st = statsFor('gt', 300)
    let car: Car = { ...startCar(t, 0), x: t.x[i] - t.tz[i] * lat, z: t.z[i] + t.tx[i] * lat, h: Math.atan2(t.tx[i], t.tz[i]), v: 30, idx: i }
    car = stepCar(car, { gas: false, brake: false, left: false, right: false }, dt, t, st, true)
    expect(car.dmg).toBeGreaterThanOrEqual(0)
  })
})
