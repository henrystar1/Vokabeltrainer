export const BW = 360
export const BH = 480
export const PADDLE_W = 76
export const PADDLE_H = 12
export const PADDLE_Y = BH - 34
export const BALL_R = 7
export const COLS_B = 8
export const ROWS_B = 6
export const BRICK_W = BW / COLS_B
export const BRICK_H = 20
export const TOP = 56

export interface BricksState {
  paddleX: number
  x: number
  y: number
  vx: number
  vy: number
  bricks: boolean[]
  score: number
  lives: number
  launched: boolean
  level: number
  over: boolean
}

const freshBricks = (): boolean[] => Array<boolean>(COLS_B * ROWS_B).fill(true)
const baseSpeed = (level: number) => 250 + (level - 1) * 30

export function newBricks(): BricksState {
  return { paddleX: BW / 2, x: BW / 2, y: PADDLE_Y - BALL_R - 1, vx: 0, vy: 0, bricks: freshBricks(), score: 0, lives: 3, launched: false, level: 1, over: false }
}

/** Ball vom Schläger abstoßen. */
export function launch(s: BricksState): BricksState {
  if (s.launched || s.over) return s
  const sp = baseSpeed(s.level)
  return { ...s, launched: true, vx: sp * 0.35, vy: -sp * 0.94 }
}

export function brickRect(i: number): { x: number; y: number; w: number; h: number } {
  return { x: (i % COLS_B) * BRICK_W, y: TOP + Math.floor(i / COLS_B) * BRICK_H, w: BRICK_W, h: BRICK_H }
}

/** Ein Zeitschritt. `target` = gewünschte Mitte des Schlägers. */
export function stepBricks(s0: BricksState, dt: number, target: number): BricksState {
  if (s0.over) return s0
  let s: BricksState = { ...s0, paddleX: Math.max(PADDLE_W / 2, Math.min(BW - PADDLE_W / 2, target)) }
  if (!s.launched) return { ...s, x: s.paddleX, y: PADDLE_Y - BALL_R - 1 }

  let { x, y, vx, vy } = s
  x += vx * dt
  y += vy * dt
  if (x < BALL_R) { x = BALL_R; vx = Math.abs(vx) }
  if (x > BW - BALL_R) { x = BW - BALL_R; vx = -Math.abs(vx) }
  if (y < BALL_R) { y = BALL_R; vy = Math.abs(vy) }

  // Schläger
  if (vy > 0 && y + BALL_R >= PADDLE_Y && y + BALL_R <= PADDLE_Y + PADDLE_H + 8 && Math.abs(x - s.paddleX) <= PADDLE_W / 2 + BALL_R) {
    const off = Math.max(-1, Math.min(1, (x - s.paddleX) / (PADDLE_W / 2)))
    const sp = Math.hypot(vx, vy)
    const ang = off * 1.05 // Bogenmaß gegenüber der Senkrechten
    vx = sp * Math.sin(ang)
    vy = -sp * Math.cos(ang)
    y = PADDLE_Y - BALL_R
  }

  // Steine
  const bricks = [...s.bricks]
  let score = s.score
  for (let i = 0; i < bricks.length; i++) {
    if (!bricks[i]) continue
    const r = brickRect(i)
    const cx = Math.max(r.x, Math.min(x, r.x + r.w))
    const cy = Math.max(r.y, Math.min(y, r.y + r.h))
    const dx = x - cx
    const dy = y - cy
    if (dx * dx + dy * dy <= BALL_R * BALL_R) {
      bricks[i] = false
      score += 1
      if (Math.abs(dx) > Math.abs(dy)) vx = dx > 0 ? Math.abs(vx) : -Math.abs(vx)
      else vy = dy > 0 ? Math.abs(vy) : -Math.abs(vy)
      break
    }
  }

  let level = s.level
  let nextBricks = bricks
  if (bricks.every((b) => !b)) {
    level += 1
    nextBricks = freshBricks()
    return { ...s, x: s.paddleX, y: PADDLE_Y - BALL_R - 1, vx: 0, vy: 0, launched: false, bricks: nextBricks, score, level }
  }

  // Ball verloren
  if (y - BALL_R > BH) {
    const lives = s.lives - 1
    return { ...s, bricks, score, lives, over: lives <= 0, launched: false, x: s.paddleX, y: PADDLE_Y - BALL_R - 1, vx: 0, vy: 0 }
  }
  return { ...s, x, y, vx, vy, bricks: nextBricks, score, level }
}
