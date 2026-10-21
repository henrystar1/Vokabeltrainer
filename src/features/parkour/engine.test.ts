import { describe, expect, it } from 'vitest'
import { checkpointAt, inExit, newBody, pressedMap, spawnAt, stepBody, PW, PH } from './engine'
import { LEVELS, ROWS, TILE } from './levels'

const dt = 1 / 60
function run(b: ReturnType<typeof newBody>, lv = LEVELS[0], inp: { move: number; jump: boolean }, secs: number, other: { x: number; y: number } | null = null) {
  let r: 'ok' | 'dead' = 'ok'
  for (let i = 0; i < secs * 60 && r === 'ok'; i++) r = stepBody(b, inp, lv, pressedMap(lv, [b, other]), other, dt)
  return r
}

describe('parkour', () => {
  it('Level sind gültig: Ausgang, Checkpoints, Plattenpaare, Spawns frei', () => {
    for (const lv of LEVELS) {
      expect(lv.rows).toHaveLength(ROWS)
      expect(lv.exit.w).toBeGreaterThan(0)
      expect(lv.checkpoints.length).toBeGreaterThan(1)
      for (const ch of ['a', 'b', 'c']) {
        const doors = lv.rows.join('').includes(ch.toUpperCase()) || lv.rows.join('').includes(String.fromCharCode(ch.charCodeAt(0) + 23))
        const n = lv.plates.filter((p) => p.ch === ch).length
        if (doors) expect(n).toBeGreaterThanOrEqual(2)
      }
      for (const host of [true, false]) {
        const s = spawnAt(lv, host, null)
        const b = newBody(s.x, s.y)
        expect(run(b, lv, { move: 0, jump: false }, 1)).toBe('ok')
        expect(b.ground).toBe(true)
      }
    }
  })
  it('Springen: eine Kachel hoch geht, drei hohe Säule nicht allein', () => {
    const lv = LEVELS[0]
    const s = spawnAt(lv, true, null)
    const b = newBody(s.x, s.y)
    run(b, lv, { move: 0, jump: false }, 0.5)
    const y0 = b.y
    let top = y0
    stepBody(b, { move: 0, jump: true }, lv, {}, null, dt)
    for (let i = 0; i < 80; i++) { stepBody(b, { move: 0, jump: true }, lv, {}, null, dt); top = Math.min(top, b.y) }
    const h = y0 - top
    expect(h).toBeGreaterThan(2 * TILE)
    expect(h).toBeLessThan(3 * TILE)
    expect(h + PH).toBeGreaterThan(3 * TILE) // mit Räuberleiter reicht es
  })
  it('Stacheln und Abgrund töten', () => {
    const lv = LEVELS[0]
    const b = newBody(20 * TILE + 4, 10 * TILE - PH - 0.5)
    expect(run(b, lv, { move: 0, jump: false }, 1)).toBe('dead')
    const c = newBody(12 * TILE + 2, 10 * TILE - PH - 0.5)
    expect(run(c, lv, { move: 1, jump: false }, 3)).toBe('dead') // Lücke bei Spalte 12–14
  })
  it('Platte öffnet Tür, Partner geht durch', () => {
    const lv = LEVELS[0]
    const door = 38 * TILE
    const walker = newBody(35 * TILE, 10 * TILE - PH - 0.5)
    run(walker, lv, { move: 1, jump: false }, 3, null)
    expect(walker.x + PW).toBeLessThan(door + 1) // Tür zu: bleibt davor stehen
    const holder = { x: 33 * TILE + 5, y: 10 * TILE - PH }
    expect(pressedMap(lv, [holder]).a).toBe(true)
    run(walker, lv, { move: 1, jump: false }, 3, holder)
    expect(walker.x).toBeGreaterThan(door + TILE)
  })
  it('Räuberleiter: auf Partner landen und auf die Säule springen', () => {
    const lv = LEVELS[0]
    const partner = { x: 45 * TILE + 4, y: 10 * TILE - PH }
    const b = newBody(45 * TILE + 6, 10 * TILE - PH - 60)
    run(b, lv, { move: 0, jump: false }, 0.5, partner)
    expect(b.y).toBeCloseTo(partner.y - PH, 0)
    run(b, lv, { move: 0, jump: true }, 0.05, partner)
    run(b, lv, { move: 1, jump: true }, 0.6, partner)
    expect(b.y + PH).toBeLessThanOrEqual(7 * TILE + 1) // oben auf der Säule (Oberkante Zeile 7)
  })
  it('Ausgang und Checkpoint werden erkannt', () => {
    const lv = LEVELS[0]
    expect(inExit(lv, { x: lv.exit.x * TILE + 4, y: 8 * TILE })).toBe(true)
    expect(inExit(lv, { x: 3 * TILE, y: 8 * TILE })).toBe(false)
    expect(checkpointAt(lv, { x: lv.checkpoints[0] * TILE, y: 10 * TILE - PH })).toBe(lv.checkpoints[0])
  })
})
