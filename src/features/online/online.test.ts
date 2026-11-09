import { describe, expect, it } from 'vitest'
import { HOME_LANE, HOUSE, TRACK, cellOf } from './ludoBoard'
import { FLEET, canPlace, randomFleet, shipCells } from './ships'

describe('Mensch-ärgere-dich-nicht-Brett', () => {
  it('hat 40 verschiedene, lückenlos benachbarte Felder', () => {
    expect(new Set(TRACK.map((c) => c.join(','))).size).toBe(40)
    for (let i = 0; i < 40; i++) {
      const [a, b] = [TRACK[i], TRACK[(i + 1) % 40]]
      expect(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])).toBe(1)
    }
  })
  it('Ziel- und Hausfelder liegen nicht auf dem Rundweg und nicht doppelt', () => {
    const track = new Set(TRACK.map((c) => c.join(',')))
    const others = [...HOME_LANE.flat(), ...HOUSE.flat()].map((c) => c.join(','))
    expect(new Set(others).size).toBe(32)
    for (const o of others) expect(track.has(o)).toBe(false)
  })
  it('Startfelder liegen je 10 Felder auseinander', () => {
    expect(cellOf(1, 0, 0)).toEqual(TRACK[10])
    expect(cellOf(3, 12, 0)).toEqual(TRACK[2])
    expect(cellOf(2, 41, 0)).toEqual(HOME_LANE[2][1])
  })
})

describe('Schiffe versenken', () => {
  it('zufällige Flotte ist gültig', () => {
    for (let i = 0; i < 50; i++) {
      const f = randomFleet()
      expect(f.map((s) => s.len).sort()).toEqual([...FLEET].sort())
      const cells = f.flatMap(shipCells)
      expect(new Set(cells).size).toBe(17)
      expect(cells.every((c) => c >= 0 && c < 100)).toBe(true)
    }
  })
  it('erkennt Überlappung und Rand', () => {
    expect(canPlace({ len: 5, r: 0, c: 6, h: true }, [])).toBe(false)
    expect(canPlace({ len: 3, r: 0, c: 0, h: false }, [{ len: 2, r: 1, c: 0, h: true }])).toBe(false)
    expect(canPlace({ len: 3, r: 5, c: 5, h: false }, [{ len: 2, r: 1, c: 0, h: true }])).toBe(true)
  })
})
