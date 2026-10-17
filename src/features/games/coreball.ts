import type { Rng } from '../learning/random'

/** Coreball: Schieß Kugeln auf den drehenden Kern. Berührt eine Kugel eine schon steckende, ist es vorbei. Jedes Level wird schwerer. */
export const CW = 360
export const CH = 520
export const CX = 180
export const CY = 170
export const CORE_R = 44
export const PIN_L = 64
export const BALL_R = 8
/** Flugzeit der Kugel vom Schützen bis zum Kern (Sekunden). */
export const FLIGHT = 0.14
/** Mindestabstand (Bogenmaß) zwischen zwei Kugeln am Kern. */
export const MIN_SEP = 0.3
const TAU = Math.PI * 2

export interface LevelConfig {
  balls: number
  pre: number
  /** Grundgeschwindigkeit in rad/s. */
  speed: number
  /** Sekunden, nach denen die Drehrichtung wechselt (0 = nie). */
  reverseEvery: number
  /** Geschwindigkeit pendelt (ab Level 6). */
  wobble: number
}

export function levelConfig(level: number): LevelConfig {
  return {
    balls: Math.min(3 + level, 8),
    pre: Math.min(1 + level, 6),
    speed: Math.min(1.0 + 0.25 * level, 3.6),
    reverseEvery: level >= 3 ? Math.max(1.6, 4.2 - level * 0.25) : 0,
    wobble: level >= 6 ? Math.min(0.2 + (level - 6) * 0.06, 0.6) : 0,
  }
}

export interface CoreState {
  angle: number
  vel: number
  dir: 1 | -1
  pins: number[]
  level: number
  left: number
  placed: number
  over: boolean
  t: number
  sinceFlip: number
}

export const norm = (a: number): number => ((a % TAU) + TAU) % TAU
export const angDist = (a: number, b: number): number => {
  const d = Math.abs(norm(a) - norm(b))
  return Math.min(d, TAU - d)
}

function setupLevel(s: CoreState, rng: Rng): void {
  const cfg = levelConfig(s.level)
  s.pins = []
  let guard = 0
  while (s.pins.length < cfg.pre && guard++ < 500) {
    const a = rng() * TAU
    if (s.pins.every((p) => angDist(p, a) > 0.55)) s.pins.push(a)
  }
  for (let i = s.pins.length; i < cfg.pre; i++) s.pins.push((i / cfg.pre) * TAU)
  s.left = cfg.balls
  s.sinceFlip = 0
}

export function newCore(rng: Rng = Math.random): CoreState {
  const s: CoreState = { angle: 0, vel: 1.3, dir: 1, pins: [], level: 1, left: 0, placed: 0, over: false, t: 0, sinceFlip: 0 }
  setupLevel(s, rng)
  return s
}

/** Aktuelle Drehgeschwindigkeit (rad/s) inklusive Pendeln. */
function targetVel(s: CoreState): number {
  const cfg = levelConfig(s.level)
  return s.dir * cfg.speed * (1 + cfg.wobble * Math.sin(s.t * 2.2))
}

export function stepCore(s: CoreState, dt: number): void {
  if (s.over) return
  const cfg = levelConfig(s.level)
  s.t += dt
  s.sinceFlip += dt
  if (cfg.reverseEvery > 0 && s.sinceFlip >= cfg.reverseEvery) {
    s.dir = s.dir === 1 ? -1 : 1
    s.sinceFlip = 0
  }
  const k = Math.min(1, dt * 5)
  s.vel += (targetVel(s) - s.vel) * k
  s.angle = norm(s.angle + s.vel * dt)
}

/** Winkel (relativ zum Kern), an dem eine jetzt abgeschossene Kugel ankäme (sie kommt von unten = +90°). */
export function landingAngle(s: CoreState, flight = FLIGHT): number {
  return norm(Math.PI / 2 - (s.angle + s.vel * flight))
}

export type LandResult = 'hit' | 'ok' | 'level'

/** Kugel kommt am Kern an. `at` = Winkel relativ zum Kern. */
export function land(s: CoreState, at: number, rng: Rng = Math.random): LandResult {
  if (s.over) return 'hit'
  if (s.pins.some((p) => angDist(p, at) < MIN_SEP)) {
    s.over = true
    return 'hit'
  }
  s.pins.push(at)
  s.placed += 1
  s.left -= 1
  if (s.left <= 0) {
    s.level += 1
    setupLevel(s, rng)
    return 'level'
  }
  return 'ok'
}
