import { describe, expect, it } from 'vitest'
import { BK, BUNKER, BUNKER_OBSTACLES, bunkerClamp, bunkerSpotNear, hatchK, inBunkerHall, liftY, parseLoadout } from './bunker'
import { groundAt } from './foot'
import { hillH } from './mountains'

describe('KSK-Bunker', () => {
  it('Eingang liegt auf flachem Boden, Halle unter dem Gelände', () => {
    expect(hillH(BUNKER.ex, BUNKER.ez)).toBe(0)
    expect(hillH(BUNKER.kx, BUNKER.kz)).toBe(0)
    expect(inBunkerHall(BUNKER.ex, BUNKER.ez)).toBe(true)
    expect(groundAt(100, 1420, BUNKER.y, -2)).toBe(BUNKER.y)
  })
  it('bunkerClamp hält in der Halle und schiebt aus Möbeln heraus', () => {
    const c = bunkerClamp(0, 0)
    expect(inBunkerHall(c.x, c.z)).toBe(true)
    for (const o of BUNKER_OBSTACLES) {
      const m = bunkerClamp((o.x0 + o.x1) / 2, (o.z0 + o.z1) / 2)
      expect(m.x > o.x0 && m.x < o.x1 && m.z > o.z0 && m.z < o.z1).toBe(false)
    }
  })
  it('Fahrstuhl und Wege sind frei begehbar', () => {
    const l = bunkerClamp(BK.lift.x, BK.lift.z)
    expect(Math.hypot(l.x - BK.lift.x, l.z - BK.lift.z)).toBeLessThan(0.01)
    const p = bunkerClamp(BK.lift.x, BK.lift.z + 12)
    expect(Math.hypot(p.x - BK.lift.x, p.z - BK.lift.z - 12)).toBeLessThan(0.01)
  })
  it('Bedienstellen', () => {
    expect(bunkerSpotNear(BUNKER.kx, BUNKER.kz + 1, 0, false)?.kind).toBe('keypad')
    expect(bunkerSpotNear(BUNKER.ex, BUNKER.ez, 0, false)).toBeNull()
    expect(bunkerSpotNear(BUNKER.ex, BUNKER.ez, 0, true)?.kind).toBe('lift_down')
    expect(bunkerSpotNear(BK.lift.x, BK.lift.z, -2, true)?.kind).toBe('lift_up')
    expect(bunkerSpotNear(BK.tune.x, BK.tune.z, -2, true)?.kind).toBe('tune')
    expect(bunkerSpotNear(BK.drone.x, BK.drone.z - 2, -2, true)?.kind).toBe('drone')
  })
  it('Animationskurven', () => {
    expect(hatchK(0)).toBe(0); expect(hatchK(1)).toBe(1); expect(liftY(0)).toBeCloseTo(0); expect(liftY(1)).toBe(BUNKER.y)
  })
  it('parseLoadout prüft Farbe und Waffe', () => {
    expect(parseLoadout(null).weapon).toBe('minigun')
    expect(parseLoadout({ color: 'rot', weapon: 'rocket', items: [] }).color).toBe('#3d4a32')
    expect(parseLoadout({ color: '#112233', weapon: 'rocket', items: [] }).weapon).toBe('minigun')
    expect(parseLoadout({ color: '#112233', weapon: 'rocket', items: ['w_rocket', 'x'] })).toEqual({ color: '#112233', weapon: 'rocket', items: ['w_rocket'] })
  })
})
