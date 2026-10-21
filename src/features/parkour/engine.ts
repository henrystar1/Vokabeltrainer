import { ROWS, TILE, type Level } from './levels'

export const PW = 22
export const PH = 28
const RUN = 210
const ACC_GROUND = 1700
const ACC_AIR = 1200
const GRAV = 1800
const MAX_FALL = 900
export const JUMP_V = -570
const COYOTE = 0.1
const BUFFER = 0.12
/** Wie weit sich die beiden höchstens voneinander entfernen dürfen (Kamera zeigt beide). */
export const LEASH = 17 * TILE

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
export interface Input { move: number; jump: boolean }
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

/** Welche Kanäle sind gedrückt? Eine Platte zählt, wenn jemand mit den Füßen darauf steht. */
export function pressedMap(lv: Level, bodies: ReadonlyArray<Point | null>): Pressed {
  const out: Pressed = {}
  for (const p of lv.plates) {
    const px = p.x * TILE + 2, py = p.y * TILE + 26, pw = TILE - 4, ph = 6
    for (const b of bodies) {
      if (!b) continue
      const fx = b.x + 2, fy = b.y + PH - 3, fw = PW - 4, fh = 4
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

/** Ein Schritt (dt Sekunden). Gibt 'dead' zurück bei Stacheln, Absturz oder Einklemmen. */
export function stepBody(b: Body, inp: Input, lv: Level, pressed: Pressed, other: Point | null, dt: number): 'ok' | 'dead' {
  if (hitsSolid(lv, pressed, b.x, b.y)) return 'dead' // von einer Tür eingeklemmt
  const target = Math.max(-1, Math.min(1, inp.move)) * RUN
  const acc = (b.ground ? ACC_GROUND : ACC_AIR) * dt
  b.vx = b.vx < target ? Math.min(target, b.vx + acc) : Math.max(target, b.vx - acc)
  if (inp.move !== 0) b.face = inp.move > 0 ? 1 : -1

  // Sprung mit Puffer und Koyote-Zeit
  const fresh = inp.jump && !b.jumpHeld
  if (fresh) b.buf = BUFFER
  else b.buf = Math.max(0, b.buf - dt)
  b.coyote = b.ground ? COYOTE : Math.max(0, b.coyote - dt)
  if (b.ground) b.air = 1
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
  if (other) b.x = Math.max(other.x - LEASH, Math.min(other.x + LEASH, b.x))

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
  if (other && b.vy >= 0 && prevBottom <= other.y + 3 && b.y + PH >= other.y && b.x < other.x + PW - 3 && b.x + PW > other.x + 3) {
    b.y = other.y - PH
    b.vy = 0
    b.ground = true
  }
  if (touchesSpike(lv, b) || b.y > ROWS * TILE + 60) return 'dead'
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

/** Startpunkt: Host links, Partner rechts daneben; nach Checkpoint an dessen Spalte. */
export function spawnAt(_lv: Level, host: boolean, cp: number | null): Point {
  const col = cp ?? 2
  return { x: col * TILE + (host ? 2 : 26), y: 10 * TILE - PH - 0.5 }
}
