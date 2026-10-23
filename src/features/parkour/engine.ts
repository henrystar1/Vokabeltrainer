import { ROWS, TILE, type Level } from './levels'

export const PW = 22
export const PH = 28
const RUN = 210
const ACC_GROUND = 1700
const ACC_AIR = 1200
const GRAV = 1800
const MAX_FALL = 900
const FLY = 260
export const JUMP_V = -570
const COYOTE = 0.1
const BUFFER = 0.12

export interface Body {
  x: number
  y: number
  vx: number
  vy: number
  ground: boolean
  face: 1 | -1
  coyote: number
  buf: number
  jumpHeld: boolean
  /** Noch verfügbare Luftsprünge (Doppelsprung). */
  air: number
}
export interface Input { move: number; jump: boolean; /** Luftsprünge nach dem Bodensprung (Standard 1 = Doppelsprung; Admin 3 = Vierfachsprung). */ airJumps?: number
  /** Flugmodus (Admin): schweben, W/S = hoch/runter, keine Stacheln. `vert` −1 = hoch, 1 = runter. */
  fly?: boolean
  /** Geistmodus (Admin, nur mit fly): fliegt durch Wände und Türen. */
  ghost?: boolean
  vert?: number }
export type Pressed = Record<string, boolean>
export interface Point { x: number; y: number }

export const newBody = (x: number, y: number): Body => ({ x, y, vx: 0, vy: 0, ground: false, face: 1, coyote: 0, buf: 0, jumpHeld: false, air: 1 })

/** Ist die Kachel (Tür/Brücke/Block) gerade fest? Außerhalb links/rechts ist Wand, oben/unten offen. */
export function solidChar(ch: string, pressed: Pressed): boolean {
  if (ch === '#') return true
  if (ch >= 'A' && ch <= 'C') return !pressed[ch.toLowerCase()]
  if (ch >= 'x' && ch <= 'z') return !!pressed[String.fromCharCode(ch.charCodeAt(0) - 23)]
  return false
}

function solidAt(lv: Level, pressed: Pressed, tx: number, ty: number): boolean {
  if (tx < 0 || tx >= lv.cols) return true
  if (ty < 0 || ty >= ROWS) return false
  return solidChar(lv.rows[ty][tx], pressed)
}

function hitsSolid(lv: Level, pressed: Pressed, x: number, y: number): boolean {
  const x0 = Math.floor(x / TILE), x1 = Math.floor((x + PW - 0.001) / TILE)
  const y0 = Math.floor(y / TILE), y1 = Math.floor((y + PH - 0.001) / TILE)
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (solidAt(lv, pressed, tx, ty)) return true
  return false
}

/**
 * Welche Kanäle sind gedrückt? Eine Platte zählt, wenn jemand mit den Füßen darauf steht. Die Zone ist großzügig
 * (ganze Kachel plus 3 px Rand, Füße dürfen ein paar Pixel darüber schweben), damit man den Knopf nie knapp verfehlt.
 */
export function pressedMap(lv: Level, bodies: ReadonlyArray<Point | null>): Pressed {
  const out: Pressed = {}
  for (const p of lv.plates) {
    const px = p.x * TILE - 3, py = p.y * TILE + 20, pw = TILE + 6, ph = 14
    for (const b of bodies) {
      if (!b) continue
      const fx = b.x + 1, fy = b.y + PH - 6, fw = PW - 2, fh = 8
      if (fx < px + pw && fx + fw > px && fy < py + ph && fy + fh > py) out[p.ch] = true
    }
  }
  return out
}

function touchesSpike(lv: Level, b: Body): boolean {
  const x0 = Math.floor(b.x / TILE), x1 = Math.floor((b.x + PW) / TILE)
  const y0 = Math.floor(b.y / TILE), y1 = Math.floor((b.y + PH) / TILE)
  for (let ty = Math.max(0, y0); ty <= Math.min(ROWS - 1, y1); ty++) {
    for (let tx = Math.max(0, x0); tx <= Math.min(lv.cols - 1, x1); tx++) {
      if (lv.rows[ty][tx] !== '^') continue
      const sx = tx * TILE + 5, sy = ty * TILE + 16, sw = TILE - 10, sh = TILE - 16
      if (b.x < sx + sw && b.x + PW > sx && b.y < sy + sh && b.y + PH > sy) return true
    }
  }
  return false
}

/** Steht der Körper an dieser Stelle frei (weder in einem festen Block noch in Stacheln)? */
export function spotIsSafe(lv: Level, pressed: Pressed, x: number, y: number): boolean {
  return !hitsSolid(lv, pressed, x, y) && !touchesSpike(lv, { x, y } as Body)
}

/**
 * Ein Schritt (dt Sekunden). 'dead' = Stacheln berührt (das einzige, was ein Herz kostet).
 * 'lost' = eingeklemmt oder aus der Welt gefallen: Neustart ohne Herzverlust.
 */
export function stepBody(b: Body, inp: Input, lv: Level, pressed: Pressed, other: Point | ReadonlyArray<Point> | null, dt: number): 'ok' | 'dead' | 'lost' {
  const others: ReadonlyArray<Point> = other === null ? [] : Array.isArray(other) ? other : [other as Point]
  if (!inp.ghost && hitsSolid(lv, pressed, b.x, b.y)) return 'lost' // von einer Tür eingeklemmt
  if (inp.fly) {
    // Flugmodus: kein Fallen, keine Stacheln; Wände und feste Türen bleiben fest
    b.ground = false
    b.air = inp.airJumps ?? 1
    b.vx = Math.max(-1, Math.min(1, inp.move)) * FLY
    b.vy = Math.max(-1, Math.min(1, inp.vert ?? 0)) * FLY
    if (inp.move !== 0) b.face = inp.move > 0 ? 1 : -1
    let fx = b.x + b.vx * dt
    if (inp.ghost) fx = Math.max(0, Math.min(lv.cols * TILE - PW, fx))
    else if (hitsSolid(lv, pressed, fx, b.y)) { fx = b.x; b.vx = 0 }
    b.x = fx
    let fy = b.y + b.vy * dt
    if (!inp.ghost && hitsSolid(lv, pressed, b.x, fy)) { fy = b.y; b.vy = 0 }
    b.y = Math.max(-6 * TILE, Math.min(ROWS * TILE - PH - 1, fy))
    b.jumpHeld = inp.jump
    return 'ok'
  }
  const target = Math.max(-1, Math.min(1, inp.move)) * RUN
  const acc = (b.ground ? ACC_GROUND : ACC_AIR) * dt
  b.vx = b.vx < target ? Math.min(target, b.vx + acc) : Math.max(target, b.vx - acc)
  if (inp.move !== 0) b.face = inp.move > 0 ? 1 : -1

  // Sprung mit Puffer und Koyote-Zeit
  const fresh = inp.jump && !b.jumpHeld
  if (fresh) b.buf = BUFFER
  else b.buf = Math.max(0, b.buf - dt)
  b.coyote = b.ground ? COYOTE : Math.max(0, b.coyote - dt)
  if (b.ground) b.air = inp.airJumps ?? 1
  if (fresh && b.coyote <= 0 && b.air > 0) {
    // Doppelsprung in der Luft
    b.vy = JUMP_V
    b.air -= 1
    b.buf = 0
  } else if (b.buf > 0 && b.coyote > 0) {
    b.vy = JUMP_V
    b.buf = 0
    b.coyote = 0
    b.ground = false
  }
  if (!inp.jump && b.jumpHeld && b.vy < -230) b.vy = -230 // früh loslassen = kleiner Sprung
  b.jumpHeld = inp.jump

  b.vy = Math.min(MAX_FALL, b.vy + GRAV * dt)

  // waagerecht
  let nx = b.x + b.vx * dt
  if (hitsSolid(lv, pressed, nx, b.y)) {
    nx = b.vx > 0 ? Math.floor((nx + PW) / TILE) * TILE - PW - 0.01 : (Math.floor(nx / TILE) + 1) * TILE + 0.01
    b.vx = 0
  }
  b.x = nx
  // Leine: nicht zu weit vom Partner weg

  // senkrecht
  const prevBottom = b.y + PH
  let ny = b.y + b.vy * dt
  b.ground = false
  if (hitsSolid(lv, pressed, b.x, ny)) {
    if (b.vy > 0) {
      ny = Math.floor((ny + PH) / TILE) * TILE - PH - 0.01
      b.ground = true
    } else {
      ny = (Math.floor(ny / TILE) + 1) * TILE + 0.01
    }
    b.vy = 0
  }
  b.y = ny
  // Räuberleiter: auf dem Kopf des Partners landen
  for (const o of others) {
    if (b.vy >= 0 && prevBottom <= o.y + 3 && b.y + PH >= o.y && b.x < o.x + PW - 3 && b.x + PW > o.x + 3) {
      b.y = o.y - PH
      b.vy = 0
      b.ground = true
      break
    }
  }
  if (touchesSpike(lv, b)) return 'dead'
  if (b.y > ROWS * TILE + 60) return 'lost'
  return 'ok'
}

export function inExit(lv: Level, b: Point): boolean {
  const e = lv.exit
  const cx = b.x + PW / 2, cy = b.y + PH / 2
  return cx > e.x * TILE && cx < (e.x + e.w) * TILE && cy > e.y * TILE && cy < (e.y + e.h) * TILE
}

/** Checkpoint, den der Körper gerade berührt (Kachel-Spalte) oder null. */
export function checkpointAt(lv: Level, b: Point): number | null {
  const cx = Math.floor((b.x + PW / 2) / TILE)
  return lv.checkpoints.includes(cx) && b.y + PH > 8 * TILE && b.y < 10 * TILE ? cx : null
}

/** Startpunkt: nebeneinander (Platz 0 = Host, dann Partner usw.); nach Checkpoint an dessen Spalte. */
export function spawnAt(_lv: Level, slot: boolean | number, cp: number | null): Point {
  const col = cp ?? 2
  const off = typeof slot === 'boolean' ? (slot ? 2 : 26) : 2 + Math.max(0, Math.min(4, slot)) * 10
  return { x: col * TILE + off, y: 10 * TILE - PH - 0.5 }
}
