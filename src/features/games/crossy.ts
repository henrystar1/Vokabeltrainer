import type { Rng } from '../learning/random'

export const COLS = 9
export const VIEW_ROWS = 11
const IDLE_LIMIT = 8

export interface Car { x: number; len: number }
export interface Row { type: 'grass' | 'road'; dir: 1 | -1; speed: number; cars: Car[]; trees: number[] }
export interface CrossyState { rows: Row[]; col: number; row: number; best: number; idle: number; over: boolean }

function makeRow(index: number, rng: Rng): Row {
  if (index < 2 || rng() < 0.4) {
    const trees: number[] = []
    if (index >= 2) {
      const n = Math.floor(rng() * 4)
      while (trees.length < n) {
        const c = Math.floor(rng() * COLS)
        if (!trees.includes(c)) trees.push(c)
      }
    }
    return { type: 'grass', dir: 1, speed: 0, cars: [], trees }
  }
  const dir: 1 | -1 = rng() < 0.5 ? 1 : -1
  const speed = 1.4 + rng() * 2.2 + Math.min(index, 60) * 0.02
  const n = 1 + Math.floor(rng() * 3)
  const span = COLS + 6
  const cars: Car[] = []
  for (let i = 0; i < n; i++) cars.push({ x: (i * span) / n + rng() * 1.2 - 3, len: rng() < 0.3 ? 2 : 1 })
  return { type: 'road', dir, speed, cars, trees: [] }
}

function ensure(s: CrossyState, upTo: number, rng: Rng): Row[] {
  if (s.rows.length > upTo) return s.rows
  const rows = [...s.rows]
  while (rows.length <= upTo) rows.push(makeRow(rows.length, rng))
  return rows
}

export function newCrossy(rng: Rng = Math.random): CrossyState {
  const s: CrossyState = { rows: [], col: Math.floor(COLS / 2), row: 0, best: 0, idle: 0, over: false }
  return { ...s, rows: ensure(s, VIEW_ROWS + 6, rng) }
}

/** Trifft ein Auto die Hühner-Zelle? Das Huhn belegt [col+0.15, col+0.85]. */
function hit(s: CrossyState): boolean {
  const r = s.rows[s.row]
  if (!r || r.type !== 'road') return false
  return r.cars.some((c) => c.x < s.col + 0.85 && c.x + c.len > s.col + 0.15)
}

export function move(s: CrossyState, dx: number, dy: number, rng: Rng = Math.random): CrossyState {
  if (s.over) return s
  const col = s.col + dx
  const row = s.row + dy
  if (col < 0 || col >= COLS || row < 0) return s
  const rows = ensure(s, row + VIEW_ROWS + 6, rng)
  if (rows[row].trees.includes(col)) return s
  const progress = row > s.best
  const next: CrossyState = { ...s, rows, col, row, best: progress ? row : s.best, idle: progress ? 0 : s.idle }
  return hit(next) ? { ...next, over: true } : next
}

export function stepCrossy(s: CrossyState, dt: number): CrossyState {
  if (s.over) return s
  const span = COLS + 6
  const rows = s.rows.map((r) =>
    r.type === 'road'
      ? { ...r, cars: r.cars.map((c) => {
          let x = c.x + r.dir * r.speed * dt
          if (r.dir > 0 && x > COLS + 3) x -= span
          if (r.dir < 0 && x + c.len < -3) x += span
          return { ...c, x }
        }) }
      : r,
  )
  const next = { ...s, rows, idle: s.idle + dt }
  return hit(next) || next.idle > IDLE_LIMIT ? { ...next, over: true } : next
}
