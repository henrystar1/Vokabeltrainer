import { describe, expect, it } from 'vitest'
import { newWalker, stepWalker } from './foot'
import { buildingAt } from './interior'
import { HOSPITAL, POLICE, cityPush } from './city'
import { hospitalBed, poiNear, pois, spotNear } from './poi'

describe('Besondere Häuser', () => {
  it('Bank, Krankenhaus, Polizeiwache, vier Shops, zwei Fitnessstudios, verschieden und mit Tür', () => {
    const p = pois()
    expect(p.filter((q) => q.kind === 'bank')).toHaveLength(1)
    expect(p.filter((q) => q.kind === 'hospital')).toHaveLength(1)
    expect(p.filter((q) => q.kind === 'police')).toHaveLength(1)
    expect(p.filter((q) => q.kind === 'shop')).toHaveLength(4)
    expect(p.filter((q) => q.kind === 'gym')).toHaveLength(2)
    expect(new Set(p.map((q) => q.b)).size).toBe(p.length)
    for (const q of p) expect(Number.isFinite(q.x + q.z)).toBe(true)
  })
  it('Bank hat Tresor-Stelle, Krankenhaus Betten, Fitnessstudio Geräte, Shop eine Theke – alles im Haus', () => {
    for (const q of pois()) {
      for (const s of q.spots) if (s.kind !== 'atm' || buildingAt(s.x, s.z)) expect(buildingAt(s.x, s.z)).toBe(q.b)
      if (q.kind === 'bank') { expect(q.spots.some((s) => s.kind === 'vault')).toBe(true); expect(q.vault).toBeTruthy() }
      if (q.kind === 'hospital') { expect(q.beds!.length).toBeGreaterThan(3); for (const b of q.beds!) expect(buildingAt(b.x, b.z)).toBe(q.b) }
      if (q.kind === 'gym') expect(q.spots.filter((s) => s.kind === 'machine').length).toBeGreaterThan(5)
      if (q.kind === 'police') { expect(q.spots.some((s) => s.kind === 'armory')).toBe(true); expect(q.spots.some((s) => s.kind === 'steal')).toBe(true) }
      if (q.kind === 'weapons') expect(q.spots.some((s) => s.kind === 'weapons')).toBe(true)
      if (q.kind === 'shop') expect(q.spots.some((s) => s.kind === 'counter')).toBe(true)
    }
  })
  it('Polizeiwache liegt weit weg von der Bank', () => {
    const b = pois().find((q) => q.kind === 'bank')!, c = pois().find((q) => q.kind === 'police')!
    expect(Math.hypot(b.x - c.x, b.z - c.z)).toBeGreaterThan(400)
  })
  it('Polizeihof: Tür zeigt zum Parkplatz, Startplätze liegen in der offenen Garage', () => {
    const c = pois().find((q) => q.kind === 'police')!
    expect(c.nz).toBeLessThan(-0.9)
    expect(c.x).toBeGreaterThan(POLICE.lot.x0); expect(c.x).toBeLessThan(POLICE.lot.x1)
    expect(c.z).toBeGreaterThan(POLICE.lot.z1 - 1)
    for (const s of POLICE.slots) { const h = cityPush(s.x, s.z); expect(h === null || h.lo !== undefined).toBe(true) }
    // der Parkplatz selbst ist frei
    expect(cityPush((POLICE.lot.x0 + POLICE.lot.x1) / 2, (POLICE.lot.z0 + POLICE.lot.z1) / 2)).toBeNull()
  })
  it('Krankenhaus und Wache haben ein Ankleidezimmer, das Krankenhaus Betten und Garagenplätze', () => {
    const h = pois().find((q) => q.kind === 'hospital')!, c = pois().find((q) => q.kind === 'police')!
    expect(h.spots.some((s) => s.kind === 'dress')).toBe(true)
    expect(c.spots.some((s) => s.kind === 'dress')).toBe(true)
    expect(h.beds?.length ?? 0).toBeGreaterThan(5)
    expect(h.nz).toBeLessThan(-0.9)
    for (const s of HOSPITAL.slots) { const k = cityPush(s.x, s.z); expect(k === null || k.lo !== undefined).toBe(true) }
    expect(Math.hypot(h.x - c.x, h.z - c.z)).toBeGreaterThan(300)
  })
  it('poiNear findet das Haus an der Tür, spotNear die Bedienstelle', () => {
    const q = pois()[0]
    expect(poiNear(q.x, q.z)?.id).toBe(q.id)
    const s = q.spots[0]
    expect(spotNear(s.x, s.z)?.spot).toBe(s)
    expect(spotNear(s.x + 80, s.z)).toBeNull()
  })
  it('Aufwachplätze im Krankenhaus sind begehbar (nicht im Bett)', () => {
    const b = hospitalBed()
    let w = newWalker(b.x, b.z, b.h)
    const x0 = w.x, z0 = w.z
    for (let i = 0; i < 10; i++) w = stepWalker(w, { fwd: false, back: false, left: false, right: false }, 1 / 30)
    expect(Math.hypot(w.x - x0, w.z - z0)).toBeLessThan(0.05)
  })
  it('Tresen versperrt den Weg', () => {
    const q = pois().find((p) => p.kind === 'bank')!
    const c = q.solids[0]
    const cx = (c.x0 + c.x1) / 2, cz = (c.z0 + c.z1) / 2
    const long = c.x1 - c.x0 > c.z1 - c.z0
    let w = newWalker(long ? cx : c.x0 - 3, long ? c.z0 - 3 : cz, long ? 0 : Math.PI / 2)
    for (let i = 0; i < 90; i++) w = stepWalker(w, { fwd: true, back: false, left: false, right: false }, 1 / 30)
    // ohne Richtung zu kennen: er darf nicht mitten im Tresen stehen
    expect(!(w.x > c.x0 + 0.1 && w.x < c.x1 - 0.1 && w.z > c.z0 + 0.1 && w.z < c.z1 - 0.1)).toBe(true)
  })
})
