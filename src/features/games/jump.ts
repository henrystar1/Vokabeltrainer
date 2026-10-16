import type { Rng } from '../learning/random'

export const JW = 480
export const JH = 320
export const PW = 18
export const PH = 26
export const SPEED = 230
export const JUMP_V = 640
export const GRAVITY = 1900
export const PLAT_H = 14

export interface Plat { x: number; y: number; w: number }
export interface Coin { x: number; y: number; got: boolean }

export interface JumpState {
  x: number
  y: number
  vx: number
  vy: number
  onGround: boolean
  /** Restzeit, in der man nach dem Runterlaufen von der Kante noch springen darf. */
  coyote: number
  plats: Plat[]
  coins: Coin[]
  genX: number
  genY: number
  maxX: number
  coinsGot: number
  cam: number
  over: boolean
}

export interface JumpInput { move: number; jump: boolean }

/** Punkte: 1 je 50 Pixel Strecke, 5 je Münze. */
export const jumpScore = (s: Pick<JumpState, 'maxX' | 'coinsGot'>): number => Math.floor(s.maxX / 50) + s.coinsGot * 5

/** Größte Lücke an Position x (wächst langsam); bei Anstieg kleiner, damit alles erreichbar bleibt. */
export const maxGap = (x: number, rise: number): number => {
  const g = Math.min(65 + x / 40, 130)
  return rise > 20 ? Math.min(g, 95) : g
}

function generate(s: JumpState, rng: Rng, until: number): void {
  while (s.genX < until) {
    const dy = Math.round((rng() * 120 - 60) / 10) * 10 // -60 … +60
    let y = Math.max(150, Math.min(290, s.genY + dy))
    const rise = s.genY - y
    const gap = 30 + rng() * (maxGap(s.genX, rise) - 30)
    const w = Math.max(70, 150 - s.genX / 60) * (0.8 + rng() * 0.4)
    const x = s.genX + gap
    s.plats.push({ x, y, w })
    if (rng() < 0.55) s.coins.push({ x: x + w / 2, y: y - 34, got: false })
    s.genX = x + w
    s.genY = y
  }
}

export function newJump(rng: Rng = Math.random): JumpState {
  const s: JumpState = {
    x: 60, y: 240 - PH, vx: 0, vy: 0, onGround: true, coyote: 0,
    plats: [{ x: -40, y: 240, w: 340 }], coins: [], genX: 300, genY: 240,
    maxX: 60, coinsGot: 0, cam: 0, over: false,
  }
  generate(s, rng, 1400)
  return s
}

/** Ein Zeitschritt (Plattformen sind von unten durchlässig, man landet nur von oben). */
export function stepJump(s0: JumpState, dt: number, input: JumpInput, rng: Rng = Math.random): JumpState {
  if (s0.over) return s0
  const s: JumpState = { ...s0, plats: [...s0.plats], coins: s0.coins.map((c) => ({ ...c })) }
  const move = Math.max(-1, Math.min(1, input.move))
  s.vx = move * SPEED
  if (input.jump && (s.onGround || s.coyote > 0)) {
    s.vy = -JUMP_V
    s.onGround = false
    s.coyote = 0
  }
  s.vy = Math.min(s.vy + GRAVITY * dt, 950)
  const prevBottom = s.y + PH
  s.x = Math.max(s.cam, s.x + s.vx * dt)
  s.y += s.vy * dt

  let landed = false
  if (s.vy >= 0) {
    for (const p of s.plats) {
      if (s.x + PW > p.x && s.x < p.x + p.w && prevBottom <= p.y + 3 && s.y + PH >= p.y) {
        s.y = p.y - PH
        s.vy = 0
        landed = true
        break
      }
    }
  }
  if (landed) {
    s.onGround = true
    s.coyote = 0.1
  } else {
    if (s.onGround) s.coyote = 0.1
    else s.coyote = Math.max(0, s.coyote - dt)
    s.onGround = false
  }

  for (const c of s.coins) {
    if (!c.got && Math.abs(c.x - (s.x + PW / 2)) < 18 && Math.abs(c.y - (s.y + PH / 2)) < 22) {
      c.got = true
      s.coinsGot += 1
    }
  }
  s.maxX = Math.max(s.maxX, s.x)
  s.cam = Math.max(s.cam, s.x - 150)
  generate(s, rng, s.cam + JW + 500)
  s.plats = s.plats.filter((p) => p.x + p.w > s.cam - 80)
  s.coins = s.coins.filter((c) => c.x > s.cam - 80)
  if (s.y > JH + 60) s.over = true
  return s
}
