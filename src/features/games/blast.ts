import type { Rng } from '../learning/random'

export const BLAST_SIZE = 8

/** Formen als Zellen (x, y). */
export const SHAPES: number[][][] = [
  [[0, 0]],
  [[0, 0], [1, 0]],
  [[0, 0], [0, 1]],
  [[0, 0], [1, 0], [2, 0]],
  [[0, 0], [0, 1], [0, 2]],
  [[0, 0], [1, 0], [2, 0], [3, 0]],
  [[0, 0], [0, 1], [0, 2], [0, 3]],
  [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]],
  [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]],
  [[0, 0], [1, 0], [0, 1], [1, 1]],
  [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]],
  [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2]],
  [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2]],
  [[0, 0], [0, 1], [1, 1]],
  [[1, 0], [0, 1], [1, 1]],
  [[0, 0], [1, 0], [0, 1]],
  [[0, 0], [1, 0], [1, 1]],
  [[0, 0], [0, 1], [0, 2], [1, 2]],
  [[1, 0], [1, 1], [1, 2], [0, 2]],
  [[0, 0], [1, 0], [0, 1], [0, 2]],
  [[0, 0], [1, 0], [1, 1], [1, 2]],
  [[0, 0], [1, 0], [2, 0], [0, 1], [0, 2]],
  [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]],
  [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]],
  [[2, 0], [2, 1], [0, 2], [1, 2], [2, 2]],
  [[0, 0], [1, 0], [2, 0], [1, 1]],
  [[1, 0], [0, 1], [1, 1], [1, 2]],
  [[1, 0], [0, 1], [1, 1], [2, 1]],
  [[0, 0], [0, 1], [1, 1], [1, 2]],
  [[1, 0], [2, 0], [0, 1], [1, 1]],
]

export const shapeSize = (shape: number[][]): { w: number; h: number } => ({
  w: Math.max(...shape.map(([x]) => x)) + 1,
  h: Math.max(...shape.map(([, y]) => y)) + 1,
})

export interface BlastState {
  /** true = belegt. */
  grid: boolean[][]
  /** Drei Teile; null = schon gelegt. */
  tray: Array<number[][] | null>
  score: number
  over: boolean
}

const emptyGrid = (): boolean[][] => Array.from({ length: BLAST_SIZE }, () => Array<boolean>(BLAST_SIZE).fill(false))

export function canPlace(grid: boolean[][], shape: number[][], col: number, row: number): boolean {
  return shape.every(([x, y]) => {
    const c = col + x
    const r = row + y
    return c >= 0 && r >= 0 && c < BLAST_SIZE && r < BLAST_SIZE && !grid[r][c]
  })
}

export const canPlaceAnywhere = (grid: boolean[][], shape: number[][]): boolean => {
  for (let r = 0; r < BLAST_SIZE; r++) for (let c = 0; c < BLAST_SIZE; c++) if (canPlace(grid, shape, c, r)) return true
  return false
}

const randomTray = (rng: Rng): number[][][] => Array.from({ length: 3 }, () => SHAPES[Math.floor(rng() * SHAPES.length)])

export function newBlast(rng: Rng = Math.random): BlastState {
  return { grid: emptyGrid(), tray: randomTray(rng), score: 0, over: false }
}

/** Legt Teil `index` mit der linken oberen Ecke bei (col,row). Ungültige Züge ändern nichts. */
export function place(s: BlastState, index: number, col: number, row: number, rng: Rng = Math.random): BlastState {
  const shape = s.tray[index]
  if (s.over || !shape || !canPlace(s.grid, shape, col, row)) return s
  const grid = s.grid.map((r) => [...r])
  for (const [x, y] of shape) grid[row + y][col + x] = true
  const fullRows = grid.map((r, i) => (r.every(Boolean) ? i : -1)).filter((i) => i >= 0)
  const fullCols = Array.from({ length: BLAST_SIZE }, (_, c) => c).filter((c) => grid.every((r) => r[c]))
  for (const r of fullRows) for (let c = 0; c < BLAST_SIZE; c++) grid[r][c] = false
  for (const c of fullCols) for (let r = 0; r < BLAST_SIZE; r++) grid[r][c] = false
  const n = fullRows.length + fullCols.length
  const score = s.score + shape.length + 10 * n * n
  let tray: Array<number[][] | null> = s.tray.map((t, i) => (i === index ? null : t))
  if (tray.every((t) => t === null)) tray = randomTray(rng)
  const over = !tray.some((t) => t && canPlaceAnywhere(grid, t))
  return { grid, tray, score, over }
}
