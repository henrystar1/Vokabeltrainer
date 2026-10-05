import type { Rng } from '../learning/random'

export const FW = 288
export const FH = 420
export const GROUND = 28
export const BIRD_X = 76
export const BIRD_R = 11
export const PIPE_W = 50
const GAP = 124
const SPACING = 190
const SPEED = 112
const GRAVITY = 980
const FLAP_V = -310

export interface Pipe { x: number; gapY: number; passed: boolean }
export interface FlappyState { y: number; vy: number; pipes: Pipe[]; score: number; started: boolean; over: boolean; t: number }

export const newFlappy = (): FlappyState => ({ y: FH / 2 - 20, vy: 0, pipes: [], score: 0, started: false, over: false, t: 0 })

export function flap(s: FlappyState): FlappyState {
  return s.over ? s : { ...s, started: true, vy: FLAP_V }
}

function spawn(rng: Rng): Pipe {
  const margin = 60
  return { x: FW + 20, gapY: margin + GAP / 2 + rng() * (FH - GROUND - 2 * margin - GAP), passed: false }
}

/** Ein Zeitschritt (dt in Sekunden). Vor dem ersten Flügelschlag schwebt der Vogel nur. */
export function stepFlappy(s: FlappyState, dt: number, rng: Rng = Math.random): FlappyState {
  if (s.over) return s
  const t = s.t + dt
  if (!s.started) return { ...s, t, y: FH / 2 - 20 + Math.sin(t * 4) * 6 }
  const vy = s.vy + GRAVITY * dt
  const y = s.y + vy * dt
  let pipes = s.pipes.map((p) => ({ ...p, x: p.x - SPEED * dt }))
  if (pipes.length === 0 || pipes[pipes.length - 1].x < FW - SPACING) pipes = [...pipes, spawn(rng)]
  pipes = pipes.filter((p) => p.x > -PIPE_W - 4)
  let score = s.score
  pipes = pipes.map((p) => {
    if (!p.passed && p.x + PIPE_W < BIRD_X - BIRD_R) {
      score += 1
      return { ...p, passed: true }
    }
    return p
  })
  let over = y - BIRD_R < 0 || y + BIRD_R > FH - GROUND
  for (const p of pipes) {
    const overlapX = BIRD_X + BIRD_R > p.x && BIRD_X - BIRD_R < p.x + PIPE_W
    if (overlapX && (y - BIRD_R < p.gapY - GAP / 2 || y + BIRD_R > p.gapY + GAP / 2)) over = true
  }
  return { ...s, y, vy, pipes, score, over, t }
}

export const PIPE_GAP = GAP
