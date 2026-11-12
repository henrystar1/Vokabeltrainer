import { describe, expect, it } from 'vitest'
import { LANES, PLAYER_X, moveLane, startRun, stepRun } from './carRun'

describe('Autobahn-Spiel', () => {
  it('Spurwechsel bleibt in den Grenzen', () => {
    let s = startRun()
    s = moveLane(moveLane(moveLane(s, -1), -1), -1)
    expect(s.lane).toBe(0)
    s = moveLane(moveLane(moveLane(moveLane(s, 1), 1), 1), 1)
    expect(s.lane).toBe(LANES - 1)
  })
  it('Zusammenstoß beendet das Spiel, andere Spur nicht', () => {
    const base = { ...startRun(), spawnIn: 99, obstacles: [{ id: 1, lane: 1, x: PLAYER_X + 0.02, kind: 'suv', color: '#fff' }] }
    expect(stepRun({ ...base, lane: 1 }, 0.01).over).toBe(true)
    expect(stepRun({ ...base, lane: 0 }, 0.01).over).toBe(false)
  })
  it('wird schneller, zählt Strecke und lässt immer eine Spur frei', () => {
    let s = startRun()
    let seed = 7
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
    const v0 = s.speed
    for (let i = 0; i < 2000 && !s.over; i++) {
      s = stepRun(s, 0.03, rand)
      const near = new Set(s.obstacles.filter((o) => o.x > 0.85).map((o) => o.lane))
      expect(near.size).toBeLessThan(LANES)
      // einfache KI weicht aus
      if (s.obstacles.some((o) => o.lane === s.lane && o.x > PLAYER_X && o.x < PLAYER_X + 0.3)) s = moveLane(s, s.lane === 0 ? 1 : -1)
    }
    expect(s.speed).toBeGreaterThan(v0)
    expect(s.dist).toBeGreaterThan(0)
  })
  it('beendetes Spiel bleibt stehen', () => {
    const s = { ...startRun(), over: true }
    expect(stepRun(s, 1)).toBe(s)
    expect(moveLane(s, 1)).toBe(s)
  })
})
