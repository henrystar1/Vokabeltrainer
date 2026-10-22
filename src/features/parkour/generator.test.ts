import { describe, expect, it } from 'vitest'
import { generateLevel, levelFor, rng } from './generator'
import { LEVELS, ROWS } from './levels'
import { newBody, spawnAt, stepBody, pressedMap } from './engine'

describe('Level-Zufallsgenerator', () => {
  it('ist deterministisch: gleiche Zahl, gleiches Level', () => {
    const a = generateLevel('abc', 9), b = generateLevel('abc', 9), c = generateLevel('abd', 9)
    expect(a.rows).toEqual(b.rows)
    expect(a.rows).not.toEqual(c.rows)
    expect(rng('x')()).toBe(rng('x')())
  })
  it('levelFor nimmt zuerst die handgebauten', () => {
    expect(levelFor('s', 0)).toBe(LEVELS[0])
    expect(levelFor('s', LEVELS.length).name).toContain('Endlos')
  })
  it('viele Level sind gültig, werden länger und schwerer', () => {
    let prevLen = 0
    for (let n = LEVELS.length; n < LEVELS.length + 60; n++) {
      for (const seed of ['a', 'b', 'c']) {
        const lv = generateLevel(seed, n)
        expect(lv.rows).toHaveLength(ROWS)
        expect(lv.exit.w).toBe(2)
        expect(lv.exit.h).toBe(3)
        expect(lv.cols).toBeLessThan(1400)
        expect(lv.checkpoints.length).toBeGreaterThan(1)
        // Türen und Brücken haben immer mindestens zwei Platten desselben Kanals
        const flat = lv.rows.join('')
        for (const ch of ['a', 'b', 'c']) {
          const uses = flat.includes(ch.toUpperCase()) || flat.includes(String.fromCharCode(ch.charCodeAt(0) + 23))
          if (uses) expect(lv.plates.filter((p) => p.ch === ch).length).toBeGreaterThanOrEqual(2)
        }
        // Stachelfelder sind höchstens 6 Kacheln breit, Gruben unter Brücken genau 12
        for (const row of lv.rows.slice(0, 11)) for (const m of row.matchAll(/\^+/g)) expect(m[0].length).toBeLessThanOrEqual(12)
        for (const host of [true, false]) {
          const sp = spawnAt(lv, host, null)
          const b = newBody(sp.x, sp.y)
          let r: 'ok' | 'dead' | 'lost' = 'ok'
          for (let i = 0; i < 60 && r === 'ok'; i++) r = stepBody(b, { move: 0, jump: false }, lv, pressedMap(lv, [b]), null, 1 / 60)
          expect(r).toBe('ok')
        }
      }
    }
    const early = generateLevel('s', LEVELS.length).cols, late = generateLevel('s', LEVELS.length + 25).cols
    expect(late).toBeGreaterThan(early)
    prevLen = late
    expect(prevLen).toBeGreaterThan(300)
  })
})
