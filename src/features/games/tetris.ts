import { shuffle, type Rng } from '../learning/random'

export const COLS = 10
export const ROWS = 20

export type PieceType = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L'
export const TYPES: PieceType[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L']

/** Grundform je Teil als Zellen in einem Raster; Drehungen werden berechnet. */
const BASE: Record<PieceType, number[][]> = {
  I: [[0, 1], [1, 1], [2, 1], [3, 1]],
  O: [[1, 0], [2, 0], [1, 1], [2, 1]],
  T: [[1, 0], [0, 1], [1, 1], [2, 1]],
  S: [[1, 0], [2, 0], [0, 1], [1, 1]],
  Z: [[0, 0], [1, 0], [1, 1], [2, 1]],
  J: [[0, 0], [0, 1], [1, 1], [2, 1]],
  L: [[2, 0], [0, 1], [1, 1], [2, 1]],
}
const SIZE: Record<PieceType, number> = { I: 4, O: 4, T: 3, S: 3, Z: 3, J: 3, L: 3 }

/** Zellen eines Teils in Drehung `rot` (0–3), relativ zur linken oberen Ecke seines Rasters. */
export function cells(type: PieceType, rot: number): number[][] {
  if (type === 'O') return BASE.O
  const n = SIZE[type]
  let c = BASE[type]
  for (let i = 0; i < ((rot % 4) + 4) % 4; i++) c = c.map(([x, y]) => [n - 1 - y, x])
  return c
}

export interface Piece { type: PieceType; rot: number; x: number; y: number }

export interface TetrisState {
  /** 0 = leer, sonst Index von TYPES + 1. */
  board: number[][]
  piece: Piece
  queue: PieceType[]
  score: number
  lines: number
  over: boolean
}

const emptyBoard = (): number[][] => Array.from({ length: ROWS }, () => Array<number>(COLS).fill(0))

function refill(queue: PieceType[], rng: Rng): PieceType[] {
  return queue.length >= 7 ? queue : [...queue, ...shuffle(TYPES, rng)]
}

const spawn = (type: PieceType): Piece => ({ type, rot: 0, x: 3, y: -1 })

export function fits(board: number[][], p: Piece): boolean {
  return cells(p.type, p.rot).every(([cx, cy]) => {
    const x = p.x + cx
    const y = p.y + cy
    return x >= 0 && x < COLS && y < ROWS && (y < 0 || board[y][x] === 0)
  })
}

export function newTetris(rng: Rng = Math.random): TetrisState {
  const queue = refill([], rng)
  const type = queue.shift() as PieceType
  return { board: emptyBoard(), piece: spawn(type), queue: refill(queue, rng), score: 0, lines: 0, over: false }
}

export const level = (lines: number): number => 1 + Math.floor(lines / 10)
export const tetrisDelay = (lines: number): number => Math.max(90, 700 - (level(lines) - 1) * 65)

const LINE_POINTS = [0, 100, 300, 500, 800]

function lock(s: TetrisState, rng: Rng): TetrisState {
  const board = s.board.map((r) => [...r])
  const idx = TYPES.indexOf(s.piece.type) + 1
  for (const [cx, cy] of cells(s.piece.type, s.piece.rot)) {
    const y = s.piece.y + cy
    if (y < 0) return { ...s, over: true }
    board[y][s.piece.x + cx] = idx
  }
  const kept = board.filter((r) => r.some((c) => c === 0))
  const cleared = ROWS - kept.length
  const full = [...Array.from({ length: cleared }, () => Array<number>(COLS).fill(0)), ...kept]
  const queue = [...s.queue]
  const next = spawn(queue.shift() as PieceType)
  const out: TetrisState = {
    board: full,
    piece: next,
    queue: refill(queue, rng),
    score: s.score + LINE_POINTS[cleared],
    lines: s.lines + cleared,
    over: false,
  }
  return fits(full, next) ? out : { ...out, over: true }
}

export function move(s: TetrisState, dx: number): TetrisState {
  if (s.over) return s
  const p = { ...s.piece, x: s.piece.x + dx }
  return fits(s.board, p) ? { ...s, piece: p } : s
}

export function rotate(s: TetrisState): TetrisState {
  if (s.over) return s
  const rot = (s.piece.rot + 1) % 4
  for (const dx of [0, -1, 1, -2, 2]) {
    const p = { ...s.piece, rot, x: s.piece.x + dx }
    if (fits(s.board, p)) return { ...s, piece: p }
  }
  return s
}

/** Ein Schritt nach unten; setzt das Teil fest, wenn es nicht weiter geht. */
export function tick(s: TetrisState, rng: Rng = Math.random): TetrisState {
  if (s.over) return s
  const p = { ...s.piece, y: s.piece.y + 1 }
  return fits(s.board, p) ? { ...s, piece: p } : lock(s, rng)
}

export function hardDrop(s: TetrisState, rng: Rng = Math.random): TetrisState {
  if (s.over) return s
  let p = s.piece
  while (fits(s.board, { ...p, y: p.y + 1 })) p = { ...p, y: p.y + 1 }
  return lock({ ...s, piece: p }, rng)
}

/** Position, an der das Teil landen würde (für den Schatten). */
export function ghost(s: TetrisState): Piece {
  let p = s.piece
  while (fits(s.board, { ...p, y: p.y + 1 })) p = { ...p, y: p.y + 1 }
  return p
}
