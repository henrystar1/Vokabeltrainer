import type { Rng } from '../learning/random'

export const N = 4
export type Board = number[][]
export type Dir2048 = 'up' | 'down' | 'left' | 'right'

const empty = (): Board => Array.from({ length: N }, () => Array<number>(N).fill(0))

/** Neues Feld mit zwei Startkacheln. */
export function newBoard(rng: Rng = Math.random): Board {
  return addTile(addTile(empty(), rng), rng)
}

/** Setzt eine 2 (90 %) oder 4 (10 %) auf ein zufälliges freies Feld. */
export function addTile(b: Board, rng: Rng = Math.random): Board {
  const free: Array<[number, number]> = []
  b.forEach((row, y) => row.forEach((v, x) => { if (v === 0) free.push([y, x]) }))
  if (free.length === 0) return b
  const [y, x] = free[Math.floor(rng() * free.length)]
  return b.map((row, ry) => row.map((v, rx) => (ry === y && rx === x ? (rng() < 0.9 ? 2 : 4) : v)))
}

/** Eine Zeile nach links schieben; gleiche Nachbarn verschmelzen genau einmal. */
export function slideRow(row: readonly number[]): { row: number[]; gained: number } {
  const tiles = row.filter((v) => v !== 0)
  const out: number[] = []
  let gained = 0
  for (let i = 0; i < tiles.length; i++) {
    if (i + 1 < tiles.length && tiles[i] === tiles[i + 1]) {
      out.push(tiles[i] * 2)
      gained += tiles[i] * 2
      i++
    } else out.push(tiles[i])
  }
  while (out.length < row.length) out.push(0)
  return { row: out, gained }
}

const transpose = (b: Board): Board => b[0].map((_, x) => b.map((row) => row[x]))
const mirror = (b: Board): Board => b.map((row) => [...row].reverse())

export function move(b: Board, dir: Dir2048): { board: Board; gained: number; moved: boolean } {
  let work = b
  if (dir === 'up' || dir === 'down') work = transpose(work)
  if (dir === 'right' || dir === 'down') work = mirror(work)
  let gained = 0
  work = work.map((row) => {
    const r = slideRow(row)
    gained += r.gained
    return r.row
  })
  if (dir === 'right' || dir === 'down') work = mirror(work)
  if (dir === 'up' || dir === 'down') work = transpose(work)
  const moved = work.some((row, y) => row.some((v, x) => v !== b[y][x]))
  return { board: work, gained, moved }
}

export function canMove(b: Board): boolean {
  return (['up', 'down', 'left', 'right'] as const).some((d) => move(b, d).moved)
}
