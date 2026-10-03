import type { Rng } from '../learning/random'

export interface Point { x: number; y: number }
export type Dir = 'up' | 'down' | 'left' | 'right'

export const SNAKE_SIZE = 16

const DELTA: Record<Dir, Point> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } }
const OPPOSITE: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' }

export interface SnakeState {
  /** Kopf zuerst. */
  body: Point[]
  dir: Dir
  /** Richtung, die beim nächsten Schritt gilt (verhindert Umkehr innerhalb eines Schritts). */
  next: Dir
  apple: Point
  score: number
  over: boolean
}

function randomFree(body: readonly Point[], rng: Rng): Point {
  const free: Point[] = []
  for (let y = 0; y < SNAKE_SIZE; y++) for (let x = 0; x < SNAKE_SIZE; x++) if (!body.some((p) => p.x === x && p.y === y)) free.push({ x, y })
  return free[Math.floor(rng() * free.length)]
}

export function newSnake(rng: Rng = Math.random): SnakeState {
  const body = [{ x: 8, y: 8 }, { x: 7, y: 8 }, { x: 6, y: 8 }]
  return { body, dir: 'right', next: 'right', apple: randomFree(body, rng), score: 0, over: false }
}

export function turn(s: SnakeState, d: Dir): SnakeState {
  return d === OPPOSITE[s.dir] ? s : { ...s, next: d }
}

export function step(s: SnakeState, rng: Rng = Math.random): SnakeState {
  if (s.over) return s
  const d = DELTA[s.next]
  const head = { x: s.body[0].x + d.x, y: s.body[0].y + d.y }
  if (head.x < 0 || head.y < 0 || head.x >= SNAKE_SIZE || head.y >= SNAKE_SIZE) return { ...s, dir: s.next, over: true }
  const eats = head.x === s.apple.x && head.y === s.apple.y
  // Der Schwanz rückt nach, wenn nicht gefressen wird – dort darf der Kopf also hin.
  const solid = eats ? s.body : s.body.slice(0, -1)
  if (solid.some((p) => p.x === head.x && p.y === head.y)) return { ...s, dir: s.next, over: true }
  const body = [head, ...(eats ? s.body : s.body.slice(0, -1))]
  if (!eats) return { ...s, body, dir: s.next }
  if (body.length >= SNAKE_SIZE * SNAKE_SIZE) return { ...s, body, dir: s.next, score: s.score + 1, over: true }
  return { ...s, body, dir: s.next, score: s.score + 1, apple: randomFree(body, rng) }
}

/** Schrittdauer in ms: wird mit jedem fünften Apfel schneller. */
export const snakeDelay = (score: number): number => Math.max(65, 140 - Math.floor(score / 5) * 12)
