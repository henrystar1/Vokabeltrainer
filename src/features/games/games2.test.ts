import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../learning/random'
import { addTile, canMove, move, newBoard, slideRow } from './game2048'
import { makeDeck, pairsForLevel } from './memory'
import { moleGap, moleUpTime, nextHole, MOLE_HOLES } from './mole'
import { BH, BW, PADDLE_Y, launch, newBricks, stepBricks } from './bricks'
import { parseSticker, stickerBody, STICKERS } from '../chat/stickers'

describe('2048', () => {
  it('verschmilzt gleiche Nachbarn genau einmal', () => {
    expect(slideRow([2, 2, 2, 2])).toEqual({ row: [4, 4, 0, 0], gained: 8 })
    expect(slideRow([2, 2, 4, 0])).toEqual({ row: [4, 4, 0, 0], gained: 4 })
    expect(slideRow([0, 2, 0, 2])).toEqual({ row: [4, 0, 0, 0], gained: 4 })
  })
  it('bewegt in alle vier Richtungen', () => {
    const b = [[2, 0, 0, 2], [0, 0, 0, 0], [0, 0, 0, 0], [4, 0, 0, 4]]
    expect(move(b, 'left').board[0]).toEqual([4, 0, 0, 0])
    expect(move(b, 'right').board[0]).toEqual([0, 0, 0, 4])
    expect(move(b, 'up').board[0]).toEqual([2, 0, 0, 2])
    expect(move(b, 'down').board[3]).toEqual([4, 0, 0, 4])
    expect(move(b, 'down').board[2]).toEqual([2, 0, 0, 2])
  })
  it('Startfeld hat zwei Kacheln; volles Feld ohne Paare ist Ende', () => {
    const b = newBoard(mulberry32(1))
    expect(b.flat().filter((v) => v > 0)).toHaveLength(2)
    expect(addTile(b, mulberry32(2)).flat().filter((v) => v > 0)).toHaveLength(3)
    const full = [[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]]
    expect(canMove(full)).toBe(false)
    expect(move(full, 'left').moved).toBe(false)
  })
})

describe('Memory', () => {
  it('Deck hat jedes Symbol genau zweimal', () => {
    const d = makeDeck(5, mulberry32(3))
    expect(d).toHaveLength(10)
    const counts = new Map<string, number>()
    for (const c of d) counts.set(c.symbol, (counts.get(c.symbol) ?? 0) + 1)
    expect([...counts.values()].every((n) => n === 2)).toBe(true)
  })
  it('Paare wachsen bis höchstens 12', () => {
    expect(pairsForLevel(1)).toBe(3)
    expect(pairsForLevel(4)).toBe(6)
    expect(pairsForLevel(99)).toBe(12)
  })
})

describe('Maulwurf', () => {
  it('wird schneller und wählt nie dasselbe Loch', () => {
    expect(moleUpTime(30)).toBeLessThan(moleUpTime(0))
    expect(moleGap(30)).toBeLessThan(moleGap(0))
    expect(moleUpTime(999)).toBeGreaterThanOrEqual(400)
    const rng = mulberry32(5)
    let prev: number | null = null
    for (let i = 0; i < 200; i++) {
      const h = nextHole(prev, rng)
      expect(h).not.toBe(prev)
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThan(MOLE_HOLES)
      prev = h
    }
  })
})

describe('Bricks', () => {
  it('Ball verloren kostet ein Leben, nach drei ist Schluss', () => {
    let s = launch(newBricks())
    for (let life = 0; life < 3; life++) {
      s = { ...s, launched: true, x: 5, y: BH + 50, vx: 0, vy: 100 }
      s = stepBricks(s, 0.016, 5)
    }
    expect(s.over).toBe(true)
  })
  it('trifft einen Stein: Punkt und Stein weg', () => {
    let s = launch(newBricks())
    s = { ...s, x: 20, y: 80, vx: 0, vy: -200 }
    for (let i = 0; i < 20; i++) s = stepBricks(s, 0.016, BW / 2)
    expect(s.score).toBeGreaterThanOrEqual(1)
    expect(s.bricks.filter((b) => !b).length).toBe(s.score)
  })
  it('Schläger wirft den Ball nach oben zurück', () => {
    let s = launch(newBricks())
    s = { ...s, launched: true, x: BW / 2, y: PADDLE_Y - 6, vx: 0, vy: 300 }
    s = stepBricks(s, 0.016, BW / 2)
    expect(s.vy).toBeLessThan(0)
  })
})

describe('Sticker', () => {
  it('erkennt nur bekannte Sticker im richtigen Format', () => {
    expect(parseSticker(stickerBody(STICKERS[0].id))?.id).toBe(STICKERS[0].id)
    expect(parseSticker(':sticker:gibtsnicht:')).toBeNull()
    expect(parseSticker('hallo :sticker:gg:')).toBeNull()
    expect(new Set(STICKERS.map((s) => s.id)).size).toBe(STICKERS.length)
  })
})
