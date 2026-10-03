import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../learning/random'
import { SNAKE_SIZE, newSnake, snakeDelay, step, turn } from './snake'
import { COLS, ROWS, cells, fits, hardDrop, move, newTetris, rotate, tick, type TetrisState } from './tetris'
import { BLAST_SIZE, SHAPES, canPlace, newBlast, place, shapeSize } from './blast'

describe('Snake', () => {
  it('läuft geradeaus und kehrt nicht um', () => {
    let s = newSnake(mulberry32(1))
    s = turn(s, 'left') // Umkehr wird ignoriert
    s = step(s, mulberry32(2))
    expect(s.body[0]).toEqual({ x: 9, y: 8 })
    expect(s.over).toBe(false)
  })

  it('frisst Äpfel und wächst', () => {
    let s = newSnake(mulberry32(1))
    s = { ...s, apple: { x: 9, y: 8 } }
    s = step(s, mulberry32(3))
    expect(s.score).toBe(1)
    expect(s.body).toHaveLength(4)
  })

  it('stirbt an der Wand', () => {
    let s = newSnake(mulberry32(1))
    for (let i = 0; i < SNAKE_SIZE && !s.over; i++) s = step(s, mulberry32(i))
    expect(s.over).toBe(true)
  })

  it('stirbt am eigenen Körper', () => {
    const s = { ...newSnake(mulberry32(1)), body: [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 4, y: 6 }, { x: 4, y: 5 }, { x: 4, y: 4 }, { x: 5, y: 4 }], dir: 'up' as const, next: 'left' as const, apple: { x: 0, y: 0 } }
    expect(step(s).over).toBe(true)
  })

  it('wird schneller', () => {
    expect(snakeDelay(20)).toBeLessThan(snakeDelay(0))
  })
})

describe('Tetris', () => {
  it('jede Form hat vier Zellen in jeder Drehung', () => {
    for (const t of ['I', 'O', 'T', 'S', 'Z', 'J', 'L'] as const) for (let r = 0; r < 4; r++) expect(cells(t, r)).toHaveLength(4)
  })

  it('bewegt, dreht und fällt', () => {
    let s = newTetris(mulberry32(5))
    const x0 = s.piece.x
    s = move(s, 1)
    expect(s.piece.x).toBe(x0 + 1)
    s = rotate(s)
    s = tick(s)
    expect(fits(s.board, s.piece)).toBe(true)
  })

  it('hartes Fallen setzt fest und spawnt ein neues Teil', () => {
    const s0 = newTetris(mulberry32(5))
    const s = hardDrop(s0, mulberry32(6))
    expect(s.board.flat().filter(Boolean)).toHaveLength(4)
    expect(s.piece.y).toBeLessThanOrEqual(0)
  })

  it('löscht volle Reihen und zählt Punkte', () => {
    const s0 = newTetris(mulberry32(5))
    const board = s0.board.map((r) => [...r])
    // unterste Reihe bis auf zwei Spalten füllen, dann einen waagrechten I-Block (4 breit) wäre zu breit -> O-Block füllt 2 Spalten
    for (let c = 0; c < COLS; c++) if (c !== 4 && c !== 5) board[ROWS - 1][c] = 1
    const s: TetrisState = { ...s0, board, piece: { type: 'O', rot: 0, x: 3, y: -1 } }
    // O-Zellen liegen bei x+1..x+2 → x = 3 trifft Spalten 4 und 5
    const out = hardDrop(s, mulberry32(9))
    expect(out.lines).toBe(1)
    expect(out.score).toBe(100)
  })

  it('Spielende, wenn das Feld voll ist', () => {
    const s0 = newTetris(mulberry32(5))
    const board = s0.board.map((r, i) => (i < 2 ? r.map(() => 0) : r.map((_, c) => (c === 0 ? 0 : 1))))
    const s = { ...s0, board: board.map((r, i) => (i < 4 ? r.map((_, c) => (c === 0 ? 0 : 1)) : r)) }
    let cur: TetrisState = s
    for (let i = 0; i < 30 && !cur.over; i++) cur = hardDrop(cur, mulberry32(i))
    expect(cur.over).toBe(true)
  })
})

describe('Block Blast', () => {
  it('Formen sind gültig', () => {
    for (const sh of SHAPES) {
      const { w, h } = shapeSize(sh)
      expect(w).toBeLessThanOrEqual(5)
      expect(h).toBeLessThanOrEqual(5)
      expect(new Set(sh.map((c) => c.join(','))).size).toBe(sh.length)
    }
  })

  it('legt Teile und zählt Zellen', () => {
    const s0 = { ...newBlast(mulberry32(1)), tray: [[[0, 0], [1, 0]], [[0, 0]], [[0, 0]]] as number[][][] }
    const s = place(s0, 0, 0, 0)
    expect(s.score).toBe(2)
    expect(s.grid[0][0] && s.grid[0][1]).toBe(true)
    expect(s.tray[0]).toBeNull()
  })

  it('lehnt ungültige Züge ab', () => {
    const s0 = { ...newBlast(mulberry32(1)), tray: [[[0, 0], [1, 0]], [[0, 0]], [[0, 0]]] as number[][][] }
    expect(place(s0, 0, BLAST_SIZE - 1, 0)).toBe(s0)
    const s = place(s0, 0, 0, 0)
    expect(canPlace(s.grid, [[0, 0]], 0, 0)).toBe(false)
  })

  it('löscht volle Reihen mit Bonus', () => {
    const grid = Array.from({ length: BLAST_SIZE }, (_, r) => Array.from({ length: BLAST_SIZE }, (_, c) => r === 0 && c < BLAST_SIZE - 1))
    const s0 = { grid, tray: [[[0, 0]], [[0, 0]], [[0, 0]]] as number[][][], score: 0, over: false }
    const s = place(s0, 0, BLAST_SIZE - 1, 0)
    expect(s.grid[0].some(Boolean)).toBe(false)
    expect(s.score).toBe(1 + 10)
  })

  it('Spielende, wenn nichts mehr passt', () => {
    const grid = Array.from({ length: BLAST_SIZE }, (_, r) => Array.from({ length: BLAST_SIZE }, (_, c) => !(r === 0 && c === 0) && (r + c) % 2 === 0 || (r === 0 && c === 0)))
    // Schachbrett: 1x1 passt noch, 2er-Teile nicht
    const s0 = { grid, tray: [[[0, 0], [1, 0]], [[0, 0], [1, 0]], [[0, 0]]] as number[][][], score: 0, over: false }
    const s = place(s0, 2, 1, 0)
    expect(s.over).toBe(true)
  })
})
