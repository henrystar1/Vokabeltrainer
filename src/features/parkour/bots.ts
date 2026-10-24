import { newBody, spawnAt, stepBody, inExit, checkpointAt, type Body, type Input, type Pressed } from './engine'
import { TILE, ROWS, type Level } from './levels'

/**
 * Deathrun-Bots: einfache Läufer. Sie laufen nach rechts, springen vor Wänden, Kanten und Stacheln (Doppelsprung in
 * der Luft) und sehen alle Tore als offen (sie halten keine Platten, helfen also niemandem). Läuft ein Bot fest,
 * versucht er es zurückgesetzt noch einmal und verliert danach ein Herz. Gesteuert werden sie vom Rechner einer
 * Person im Lauf (siehe ParkourGame); die anderen sehen sie wie Mitspielende.
 */
export const BOT_NAMES = ['Robo', 'Bolt', 'Nano', 'Pixel', 'Turbo', 'Zap', 'Chip', 'Byte']
export const ALL_OPEN: Pressed = { a: true, b: true, c: true }

export interface BotState {
  i: number
  body: Body
  lv: number
  hearts: number
  cp: number | null
  /** Sekunden bis zum Neustart nach einem Sturz, 0 = läuft. */
  deadT: number
  out: boolean
  skill: number
  prevJump: boolean
  stuckT: number
  lastX: number
  retries: number
  backT: number
  grace: number
  plan: number
  script: Script | null
  mistakeT: number
  tick: number
  urgent: boolean
}

export function newBot(i: number, level: Level, hearts: number, skill: number, lv = 0): BotState {
  const s = spawnAt(level, i % 5, null)
  return { i, body: newBody(s.x + (i >= 5 ? 6 * (i - 4) : 0), s.y), lv, hearts, cp: null, deadT: 0.05 + i * 0.45, out: false, skill, prevJump: false, stuckT: 0, lastX: s.x, retries: 0, backT: 0, grace: 1, plan: Math.random(), script: null, mistakeT: 0, tick: 0, urgent: false }
}

const HORIZON = 96 // 1,6 s vorausrechnen
const HOLD = 16 // Sprungknopf so viele Bilder halten (voller Sprung)
const EVERY = 4 // nur jedes 4. Bild neu entscheiden (spart Rechenzeit am Handy)

type Wins = Array<[number, number]>
interface Script { k: number; wins: Wins }

const pressed = (wins: Wins, k: number): boolean => wins.some((w) => k >= w[0] && k < w[1])

interface Sim { ok: boolean; dx: number; b?: Body }

/** Läuft (mit Sprungfolge) bis zur Landung oder zum Ende des Zeitfensters. */
function simulate(lv: Level, b0: Body, wins: Wins, frames: number, untilLand: boolean): Sim {
  const b: Body = { ...b0 }
  const x0 = b.x
  let air = !b.ground
  for (let k = 0; k < frames; k++) {
    const r = stepBody(b, { move: 1, jump: pressed(wins, k), airJumps: 1 }, lv, ALL_OPEN, null, 1 / 60)
    if (r !== 'ok' || b.y > (ROWS - 1) * TILE) return { ok: false, dx: b.x - x0 }
    if (inExit(lv, b)) return { ok: true, dx: 1e9 }
    if (!b.ground) air = true
    else if (untilLand && air && k > 3) return { ok: true, dx: b.x - x0, b }
  }
  return { ok: true, dx: b.x - x0, b }
}

const NONE: Wins = []
const fine = (r: Sim, frames: number) => r.ok && r.dx > 0.45 * 210 * (frames / 60)
const shift = (w: Wins, d: number): Wins => w.map(([a, b]) => [a + d, b + d])

/** Mögliche Sprungfolgen: einfacher Sprung, oder Sprung mit Doppelsprung zu verschiedenen Zeitpunkten. */
function candidates(ground: boolean, air: number): Wins[] {
  const out: Wins[] = []
  if (ground) {
    out.push([[0, HOLD]])
    if (air > 0) for (const d of [HOLD + 2, HOLD + 10, HOLD + 20]) out.push([[0, HOLD], [d, d + HOLD]])
  } else if (air > 0) {
    for (const d of [1, 9, 17]) out.push([[d, d + HOLD]])
  }
  return out
}

/** Kommt man von hier aus weiter (laufen oder mit einem weiteren Sprung bis zur nächsten Landung)? */
function survivable(lv: Level, b: Body, depth: number): boolean {
  if (fine(simulate(lv, b, NONE, 48, false), 48)) return true
  if (depth <= 0) return false
  for (const w of candidates(b.ground, b.air)) {
    const L = simulate(lv, b, w, 110, true)
    if (L.ok && L.b && survivable(lv, L.b, depth - 1)) return true
  }
  return false
}

/** Eingabe für einen Schritt: rechnet voraus, ob Weiterlaufen sicher ist, und springt im letzten möglichen Moment. */
export function botInput(lv: Level, s: BotState): Input {
  const b = s.body
  if (s.backT > 0) return { move: -1, jump: s.backT > 0.3 && b.ground, airJumps: 1 }
  if (s.script) {
    const k = s.script.k++
    const inp: Input = { move: 1, jump: pressed(s.script.wins, k), airJumps: 1 }
    if (k > s.script.wins[s.script.wins.length - 1][1]) s.script = null
    return inp
  }
  const RUN_INPUT: Input = { move: 1, jump: false, airJumps: 1 }
  s.tick = (s.tick + 1) % EVERY
  if (s.tick !== 0 && !s.urgent) return RUN_INPUT
  const err = s.skill <= 1 ? 0.5 : s.skill === 2 ? 0.15 : 0
  if (fine(simulate(lv, b, NONE, HORIZON, false), HORIZON)) { s.urgent = false; return RUN_INPUT }
  s.urgent = true // Gefahr voraus: ab jetzt in jedem Bild prüfen, bis es wieder frei ist
  if (s.mistakeT > 0) return RUN_INPUT
  let first: Wins | null = null
  let fallback: Wins | null = null
  for (const w of candidates(b.ground, b.air)) {
    const now = simulate(lv, b, w, 110, true)
    if (!now.ok) continue
    if (!fallback) fallback = w
    if (!now.b || !survivable(lv, now.b, 1)) continue
    // Noch Zeit? Dann erst weiterlaufen (Sprung an der Kante), solange man auf dem Boden steht und sich bewegt
    if (b.ground && b.vx > 60) {
      const late = simulate(lv, b, shift(w, EVERY + 1), 110, true)
      if (late.ok && late.b && survivable(lv, late.b, 1)) return RUN_INPUT
    }
    first = w
    break
  }
  const pick = first ?? fallback
  if (pick) {
    if (first && Math.random() < err) { s.mistakeT = 0.25; return RUN_INPUT }
    s.script = { k: 1, wins: pick }
    return { move: 1, jump: pressed(pick, 0), airJumps: 1 }
  }
  if (b.ground && s.plan < 0.05) { s.script = { k: 1, wins: [[0, HOLD]] }; return { move: 1, jump: true, airJumps: 1 } }
  return RUN_INPUT
}

/** Ein Schritt (dt Sekunden). Gibt 'exit' zurück, wenn der Bot das Ziel erreicht hat, 'dead' bei Herzverlust. */
export function botStep(lv: Level, s: BotState, dt: number): 'ok' | 'exit' | 'dead' | 'out' {
  if (s.out) return 'out'
  if (s.grace > 0) s.grace -= dt
  if (s.deadT > 0) {
    s.deadT -= dt
    if (s.deadT <= 0) {
      const sp = spawnAt(lv, s.i % 5, s.cp)
      Object.assign(s.body, newBody(sp.x, sp.y))
      s.stuckT = 0; s.lastX = sp.x; s.grace = 1; s.retries = 0; s.script = null
    }
    return 'ok'
  }
  if (s.backT > 0) s.backT -= dt
  if (s.mistakeT > 0) s.mistakeT -= dt
  const inp = botInput(lv, s)
  const r = stepBody(s.body, inp, lv, ALL_OPEN, null, dt)
  s.prevJump = inp.jump
  void s.prevJump
  if (r === 'lost') { s.deadT = 0.5; return 'ok' }
  if (r === 'dead' && s.grace > 0) { s.deadT = 0.3; return 'ok' }
  if (r === 'dead') { s.hearts -= 1; s.deadT = 0.7; if (s.hearts <= 0) { s.out = true; return 'out' } return 'dead' }
  const c = checkpointAt(lv, s.body)
  if (c !== null && (s.cp === null || c > s.cp)) s.cp = c
  if (inExit(lv, s.body)) return 'exit'
  // Festgelaufen? Erst ein Stück zurück und neu anlauf nehmen, dann Herz weg und zum Checkpoint
  if (s.backT <= 0) {
    if (s.body.x > s.lastX + 8) { s.lastX = s.body.x; s.stuckT = 0 } else s.stuckT += dt
    if (s.stuckT > 1.6) {
      s.stuckT = 0
      s.retries += 1
      if (s.retries <= 2) s.backT = 0.7
      else { s.retries = 0; s.hearts -= 1; s.deadT = 0.5; if (s.hearts <= 0) { s.out = true; return 'out' } return 'dead' }
    }
  }
  s.plan = Math.random()
  return 'ok'
}
