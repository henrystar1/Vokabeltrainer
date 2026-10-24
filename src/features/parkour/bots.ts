import { ROUTES } from './routes.generated'
import { PH, PW, newBody, pressedMap, spawnAt, stepBody, inExit, checkpointAt, type Body, type Input, type Point, type Pressed } from './engine'
import { TILE, ROWS, type Level } from './levels'

/**
 * Deathrun-Bots: Läufer, die wie echte Mitspielende handeln. Sie laufen nach rechts, springen vor Wänden, Kanten und
 * Stacheln (Doppelsprung in der Luft), stehen auf Platten, solange jemand hinter ihnen noch durch das Tor muss, und
 * haben selbst feste Türen und Brücken. Ist kein Mensch im selben Level, sind für sie alle Tore offen. Hilft ihnen
 * niemand von der anderen Seite, kommen sie nach einer Wartezeit trotzdem durch (kurzer Sprung hinter das Tor).
 * Gesteuert werden sie vom Rechner einer Person im Lauf (siehe ParkourGame); die anderen sehen sie wie Mitspielende.
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
  /** run = laufen, goto = zur Platte zurück, hold = auf der Platte stehen und andere durchlassen. */
  mode: 'run' | 'goto' | 'hold'
  holdCh: string
  holdT: number
  holdMin: number
  gotoT: number
  blockT: number
  noPick: boolean
  gateX1: number
  /** Bot hat einen Menschen hinter einem Tor zurückgelassen: Zeit, die das schon so ist / Pause nach einem Rückweg */
  retT: number
  retCd: number
  /** Abstand halten: wartet kurz, wenn ein Bot mit kleinerer Nummer genau auf derselben Stelle steht */
  spaceT: number
  spaceCd: number
  fineT: number
  /** Einprogrammierter Weg für diesen Abschnitt (ab Wiedereinstieg am Checkpoint) */
  route: { acts: string; k: number; gated: boolean } | null
  /** Im letzten Schritt waren alle Tore offen (kein Mensch im Level) */
  open: boolean
}

/** Lage im Level für die Entscheidungen: Menschen im selben Level und alle anderen Körper (Menschen und Bots). */
/** Was die Bots untereinander voneinander wissen: wer gerade eine Platte hält oder dorthin geht, und wo die anderen stehen. */
export interface BotInfo { i: number; x: number; y: number; mode: 'run' | 'goto' | 'hold'; ch: string }
export interface BotCtx { humans: Point[]; others: Point[]; bots?: BotInfo[] }

export function newBot(i: number, level: Level, hearts: number, skill: number, lv = 0): BotState {
  const s = spawnAt(level, i % 5, null)
  return { i, body: newBody(s.x + (i >= 5 ? 6 * (i - 4) : 0), s.y), lv, hearts, cp: null, deadT: 0.05 + i * 0.45, out: false, skill, prevJump: false, stuckT: 0, lastX: s.x, retries: 0, backT: 0, grace: 1, plan: Math.random(), script: null, mistakeT: 0, tick: 0, urgent: false, mode: 'run', holdCh: 'a', holdT: 0, holdMin: 0, gotoT: 0, blockT: 0, noPick: false, gateX1: -1, retT: 0, retCd: 0, spaceT: 0, spaceCd: 0, fineT: 0, route: null, open: false }
}

const HORIZON = 96 // 1,6 s vorausrechnen
const HOLD = 16 // Sprungknopf so viele Bilder halten (voller Sprung)
const EVERY = 4 // (Meister-Bots, Stufe 4, entscheiden in jedem Bild)
// nur jedes 4. Bild neu entscheiden (spart Rechenzeit am Handy)

/** [von, bis] = Sprungknopf gedrückt; [von, bis, 1] = in der Luft nicht laufen (bremsen, um auf kleinen Inseln zu landen). */
type Wins = Array<[number, number] | [number, number, number]>
interface Script { k: number; wins: Wins }

const pressed = (wins: Wins, k: number): boolean => wins.some((w) => w.length === 2 && k >= w[0] && k < w[1])
/** 0 = normal laufen, 1 = in der Luft nicht laufen, 2 = in der Luft zurücklaufen (stark bremsen) */
const brakes = (wins: Wins, k: number): number => { for (const w of wins) if (w.length === 3 && k >= w[0] && k < w[1]) return w[2]; return 0 }
const airMove = (wins: Wins, k: number, dir: number, ground: boolean): number => { const m = ground ? 0 : brakes(wins, k); return m === 1 ? 0 : m === 2 ? -dir : dir }
const lastEnd = (wins: Wins): number => wins.reduce((m, w) => Math.max(m, w[1]), 0)

interface Sim { ok: boolean; dx: number; b?: Body }

const worldPressed = (lv: Level, b: Point, ctx: BotCtx): Pressed => (ctx.humans.length === 0 ? ALL_OPEN : pressedMap(lv, [b, ...ctx.others]))

/** Läuft (mit Sprungfolge) bis zur Landung oder zum Ende des Zeitfensters. dx zählt in Laufrichtung. */
function simulate(lv: Level, b0: Body, wins: Wins, frames: number, untilLand: boolean, ctx: BotCtx, dir: number): Sim {
  const b: Body = { ...b0 }
  const x0 = b.x
  let air = !b.ground
  for (let k = 0; k < frames; k++) {
    const r = stepBody(b, { move: airMove(wins, k, dir, b.ground), jump: pressed(wins, k), airJumps: 1 }, lv, worldPressed(lv, b, ctx), null, 1 / 60)
    if (r !== 'ok' || b.y > (ROWS - 1) * TILE) return { ok: false, dx: (b.x - x0) * dir }
    if (dir > 0 && inExit(lv, b)) return { ok: true, dx: 1e9 }
    if (!b.ground) air = true
    else if (untilLand && air && k > 3) return { ok: true, dx: (b.x - x0) * dir, b }
  }
  return { ok: true, dx: (b.x - x0) * dir, b }
}

const NONE: Wins = []
const fine = (r: Sim, frames: number) => r.ok && r.dx > 0.45 * 210 * (frames / 60)
const shift = (w: Wins, d: number): Wins => w.map((x) => (x.length === 3 ? [x[0] + d, x[1] + d, x[2]] : [x[0] + d, x[1] + d]))

/** Mögliche Sprungfolgen: einfacher Sprung, oder Sprung mit Doppelsprung zu verschiedenen Zeitpunkten. */
function candidates(ground: boolean, air: number, mode = 0): Wins[] {
  const master = mode >= 1
  const out: Wins[] = []
  if (ground) {
    out.push([[0, HOLD]])
    if (air > 0) for (const d of [HOLD + 2, HOLD + 10, HOLD + 20]) out.push([[0, HOLD], [d, d + HOLD]])
    if (master) {
      // Meister: auch kurze Hüpfer (unter Decken, über einzelne Stacheln) und fein abgestufte Doppelsprünge
      for (const h of [5, 8, 11]) out.push([[0, h]])
      if (air > 0) for (const h of [8, HOLD]) for (const d of [h + 1, h + 5, h + 14, h + 26, h + 36]) out.push([[0, h], [d, d + HOLD]])
    }
  } else if (air > 0) {
    for (const d of [1, 9, 17]) out.push([[d, d + HOLD]])
    if (master) for (const d of [3, 5, 13, 22, 28]) out.push([[d, d + HOLD]])
  }
  if (mode >= 2) {
    const tsList = mode >= 3 ? [4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34, 38] : [8, 16, 24, 34]
    // Meister, zweiter Versuch: dazu in der Luft bremsen (landet kürzer, zum Beispiel auf einer schmalen Insel zwischen Stacheln)
    const base = out.slice()
    out.length = 0
    for (const w of base) for (const ts of tsList) { out.push([...w, [ts, ts + 70, 1]]) }
  }
  return out
}

/** Kommt man von hier aus weiter (laufen oder mit einem weiteren Sprung bis zur nächsten Landung)? */
function survivable(lv: Level, b: Body, depth: number, ctx: BotCtx, dir: number, mode = 0): boolean {
  if (fine(simulate(lv, b, NONE, 48, false, ctx, dir), 48)) return true
  if (depth <= 0) return false
  for (const w of candidates(b.ground, b.air, mode >= 2 ? 1 : mode).concat(mode >= 2 ? candidates(b.ground, b.air, 2) : [])) {
    const L = simulate(lv, b, w, 110, true, ctx, dir)
    if (L.ok && L.b && survivable(lv, L.b, depth - 1, ctx, dir, mode)) return true
  }
  return false
}

// ---- Tore (Türen und Brücken) und Platten ----
interface Gate { ch: string; x0: number; x1: number }
const gateCache = new WeakMap<Level, Gate[]>()
function gatesOf(lv: Level): Gate[] {
  let g = gateCache.get(lv)
  if (g) return g
  g = []
  const seen = new Set<string>()
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < lv.cols; x++) {
      const c = lv.rows[y][x]
      const door = c >= 'A' && c <= 'C'
      const bridge = c >= 'x' && c <= 'z'
      if (!door && !bridge) continue
      const ch = door ? c.toLowerCase() : String.fromCharCode(c.charCodeAt(0) - 23)
      let x1 = x
      while (x1 + 1 < lv.cols && lv.rows[y][x1 + 1] === c) x1++
      const key = `${ch}:${x}:${x1}`
      if (!seen.has(key)) { seen.add(key); g.push({ ch, x0: x, x1 }) }
      x = x1
    }
  }
  gateCache.set(lv, g)
  return g
}

/** Auf welchem Kanal soll der Bot jetzt stehen bleiben? Wenn er auf einer Platte steht und ein Mensch noch vor dem Tor ist. */
function holdWanted(lv: Level, b: Body, own: Pressed, ctx: BotCtx, me: BotState, entering: boolean): string | null {
  for (const ch of ['a', 'b', 'c']) {
    if (!own[ch]) continue
    // Ein anderer Bot hält diese Platte schon (oder ist auf dem Weg): dann geht dieser Bot weiter, statt sich dazuzustellen
    if (ctx.bots?.some((o) => o.ch === ch && o.mode !== 'run' && Math.abs(o.x - b.x) < 26 * TILE && (entering || o.i < me.i))) continue
    for (const g of gatesOf(lv)) {
      if (g.ch !== ch || Math.abs(g.x0 * TILE - b.x) > 24 * TILE) continue
      // bis der Mensch ganz hinter dem Tor ist (nicht nur an der Tür), sonst schließt es sich über ihm
      if (ctx.humans.some((h) => h.x < (g.x1 + 1) * TILE + 8)) return ch
    }
  }
  return null
}

/** Tor, das der Bot schon passiert hat, während ein Mensch noch kurz davor steht und niemand die Platte hält. */
function forgottenGate(lv: Level, b: Body, ctx: BotCtx, without: Pressed): Gate | null {
  let best: Gate | null = null
  for (const g of gatesOf(lv)) {
    if (without[g.ch]) continue
    const gx = (g.x1 + 1) * TILE
    if (b.x < gx + 2 * TILE || b.x - gx > 45 * TILE) continue
    if (!lv.plates.some((p) => p.ch === g.ch && Math.abs(g.x0 * TILE - p.x * TILE) < 18 * TILE)) continue
    if (!ctx.humans.some((h) => h.x < g.x0 * TILE - 20 && h.x > g.x0 * TILE - 10 * TILE)) continue
    if (!best || g.x0 > best.x0) best = g
  }
  return best
}

/** Nächstes zu ist (noch nicht offenes) Tor vor dem Bot. */
function closedGateAhead(lv: Level, b: Body, pressedNow: Pressed): Gate | null {
  let best: Gate | null = null
  for (const g of gatesOf(lv)) {
    if (pressedNow[g.ch]) continue
    const gx = g.x1 * TILE + TILE
    if (gx < b.x - 4 || g.x0 * TILE - b.x > 7 * TILE) continue
    if (!best || g.x0 < best.x0) best = g
  }
  return best
}

const ROUTE_ACTS: Array<[number, boolean]> = [[1, false], [1, true], [0, false], [0, true], [-1, false]]

/** Einprogrammierter Weg ab diesem Wiedereinstieg (nur Profi und Meister, nur handgebaute Stachelstellen). */
function routeFor(lv: Level, s: BotState): BotState['route'] {
  if (s.skill < 3) return null
  const acts = ROUTES[`${lv.name}|${s.cp ?? 'x'}|${s.i % 5}`]
  if (!acts) return null
  // Enthält der Abschnitt Türen oder Brücken, gilt der Weg nur, wenn alle Tore offen sind (kein Mensch im Level)
  const col0 = s.cp ?? 2
  const next = lv.checkpoints.find((c) => c > col0)
  const end = next ?? lv.exit.x
  let gated = false
  for (let y = 0; y < ROWS; y++) for (let x = col0; x <= Math.min(lv.cols - 1, end); x++) { const c = lv.rows[y][x]; if ((c >= 'A' && c <= 'C') || (c >= 'x' && c <= 'z')) gated = true }
  return { acts, k: 0, gated }
}

/** Eingabe für einen Schritt: rechnet voraus, ob Weiterlaufen sicher ist, und springt im letzten möglichen Moment. */
export function botInput(lv: Level, s: BotState, ctx: BotCtx, dir = 1): Input {
  const b = s.body
  const RUN_INPUT: Input = { move: dir, jump: false, airJumps: 1 }
  if (s.backT > 0) return { move: -dir, jump: s.backT > 0.3 && b.ground, airJumps: 1 }
  // Pläne mit Bremsen enden bei der Landung (danach wird neu geplant)
  if (s.script && b.ground && s.script.k > 4) s.script = null
  if (s.script) {
    const k = s.script.k++
    const inp: Input = { move: airMove(s.script.wins, k, dir, b.ground), jump: pressed(s.script.wins, k), airJumps: 1 }
    if (k > lastEnd(s.script.wins)) s.script = null
    return inp
  }
  const master = s.skill >= 4
  const every = EVERY
  s.tick = (s.tick + 1) % every
  if (s.tick !== 0 && !s.urgent) return RUN_INPUT
  const err = s.skill <= 1 ? 0.5 : s.skill === 2 ? 0.15 : 0 // Stufe 3 und 4 machen keine Fehler
  s.noPick = false
  if (fine(simulate(lv, b, NONE, HORIZON, false, ctx, dir), HORIZON)) { s.urgent = false; return RUN_INPUT }
  s.urgent = true // Gefahr voraus: ab jetzt in jedem Bild prüfen, bis es wieder frei ist
  if (s.mistakeT > 0) return RUN_INPUT
  let first: Wins | null = null
  let fallback: Wins | null = null
  // Meister: erst normale Sprungfolgen, wenn keine sicher ist, zusätzlich mit Bremsen in der Luft
  for (const mode of master ? [0, 2, 3] : [0]) {
    if (first) break
    if (mode === 3 && (s.fineT = (s.fineT + 1) % 3) !== 0) continue // die feine Suche ist teuer: nur jedes 3. Bild
    for (const w of candidates(b.ground, b.air, mode)) {
      const now = simulate(lv, b, w, 110, true, ctx, dir)
      if (!now.ok) continue
      if (!fallback && mode < 2) fallback = w
      const depth = 1
      if (!now.b || !survivable(lv, now.b, depth, ctx, dir, Math.min(mode, 2))) continue
      // Noch Zeit? Dann erst weiterlaufen (Sprung an der Kante), solange man auf dem Boden steht und sich bewegt
      if (b.ground && Math.abs(b.vx) > 60) {
        const late = simulate(lv, b, shift(w, every + 1), 110, true, ctx, dir)
        if (late.ok && late.b && survivable(lv, late.b, depth, ctx, dir, Math.min(mode, 2))) return RUN_INPUT
      }
      first = w
      break
    }
  }
  const pick = first ?? fallback
  s.noPick = !first
  if (pick) {
    if (first && Math.random() < err) { s.mistakeT = 0.25; return RUN_INPUT }
    s.script = { k: 1, wins: pick }
    return { move: dir, jump: pressed(pick, 0), airJumps: 1 }
  }
  if (b.ground && s.plan < 0.05) { s.script = { k: 1, wins: [[0, HOLD]] }; return { move: dir, jump: true, airJumps: 1 } }
  return RUN_INPUT
}

/** Ein Schritt (dt Sekunden). Gibt 'exit' zurück, wenn der Bot das Ziel erreicht hat, 'dead' bei Herzverlust. */
export function botStep(lv: Level, s: BotState, dt: number, ctx: BotCtx = { humans: [], others: [] }): 'ok' | 'exit' | 'dead' | 'out' {
  if (s.out) return 'out'
  if (s.grace > 0) s.grace -= dt
  if (s.deadT > 0) {
    s.deadT -= dt
    if (s.deadT <= 0) {
      const sp = spawnAt(lv, s.i % 5, s.cp)
      Object.assign(s.body, newBody(sp.x, sp.y))
      s.stuckT = 0; s.lastX = sp.x; s.grace = 1; s.retries = 0; s.script = null; s.mode = 'run'; s.blockT = 0; s.route = routeFor(lv, s)
    }
    return 'ok'
  }
  if (s.backT > 0) s.backT -= dt
  if (s.mistakeT > 0) s.mistakeT -= dt
  if (s.retCd > 0) s.retCd -= dt
  const b = s.body
  const open = ctx.humans.length === 0
  s.open = open
  const pNow = open ? ALL_OPEN : pressedMap(lv, [b, ...ctx.others])
  const own = open ? {} : pressedMap(lv, [b])
  const without = open ? ALL_OPEN : pressedMap(lv, ctx.others)
  if (open) s.mode = 'run'
  // Einprogrammierter Weg durch eine schwere Stachelstelle (bildgenau, startet direkt nach dem Wiedereinstieg)
  if (s.route && s.mode === 'run') {
    const rt = s.route
    if ((rt.gated && !open) || rt.k >= rt.acts.length) s.route = null
    else {
      const [mv, jp] = ROUTE_ACTS[rt.acts.charCodeAt(rt.k++) - 48]
      return finishStep(lv, s, stepBody(b, { move: mv, jump: jp, airJumps: 1 }, lv, pNow, null, dt), dt)
    }
  }
  // Auf einer Platte stehen bleiben, solange jemand hinter dem Bot noch durch das Tor muss
  if (s.mode === 'run' && b.ground && !open) {
    const ch = holdWanted(lv, b, own, ctx, s, true)
    if (ch) { s.mode = 'hold'; s.holdCh = ch; s.holdT = 0; s.holdMin = 0 }
  }
  // Mensch steht noch hinter einem Tor, das der Bot schon hinter sich hat: zurück zur Platte
  if (s.mode === 'run' && !open) {
    const g = s.retCd <= 0 ? forgottenGate(lv, b, ctx, without) : null
    if (g && ctx.bots?.some((o) => o.ch === g.ch && o.mode !== 'run')) { s.retT = 0 } else
    if (g) {
      s.retT += dt
      if (s.retT > 0.8 && b.ground) { s.mode = 'goto'; s.holdCh = g.ch; s.gotoT = 0; s.gateX1 = -1; s.retT = 0; s.retCd = 30 }
    } else s.retT = 0
  } else s.retT = 0
  let inp: Input
  // Wartet der Bot schon lange vor demselben Tor, ohne dass jemand hilft: kurz hinter das Tor setzen
  if (s.gateX1 >= 0) {
    if (b.x > s.gateX1 * TILE + TILE) { s.gateX1 = -1; s.blockT = 0 }
    else if (s.mode !== 'run' && s.holdMin > 0 || s.mode === 'goto') s.blockT += dt
    if (s.gateX1 >= 0 && s.blockT > 14) {
      const tx = (s.gateX1 + 2) * TILE
      Object.assign(b, newBody(tx, 10 * TILE - PH - 0.5))
      s.blockT = 0; s.script = null; s.lastX = tx; s.stuckT = 0; s.mode = 'run'; s.gateX1 = -1
      return 'ok'
    }
  }
  if (s.mode === 'hold') {
    s.holdT += dt
    const still = holdWanted(lv, b, own, ctx, s, false) === s.holdCh
    const slipped = !own[s.holdCh]
    if (slipped) {
      if (still || s.holdMin > 0) { s.mode = 'goto'; s.gotoT = 0 } else s.mode = 'run'
    } else if ((!still && s.holdT >= s.holdMin) || (s.holdMin > 0 && without[s.holdCh]) || s.holdT > 40) {
      s.mode = 'run'
    }
  }
  if (s.mode === 'goto') {
    s.gotoT += dt
    const plates = lv.plates.filter((p) => p.ch === s.holdCh)
    let tx: number | null = null
    for (const p of plates) { const px = p.x * TILE + 5; if (tx === null || Math.abs(px - b.x) < Math.abs(tx - b.x)) tx = px }
    if (own[s.holdCh]) { s.mode = 'hold'; s.holdT = 0; s.holdMin = 10 }
    else if (tx === null || s.gotoT > 20) s.mode = 'run'
    else {
      s.script = null
      inp = botInput(lv, s, ctx, tx < b.x ? -1 : 1)
      return finishStep(lv, s, stepBody(b, inp, lv, pNow, null, dt), dt)
    }
  }
  if (s.mode === 'hold') {
    inp = { move: 0, jump: false, airJumps: 1 }
    return finishStep(lv, s, stepBody(b, inp, lv, pNow, null, dt), dt)
  }
  // Abstand halten: nicht genau auf derselben Stelle wie ein Bot mit kleinerer Nummer stehen
  if (s.spaceT > 0) s.spaceT -= dt
  else if (s.spaceCd > 0) s.spaceCd -= dt
  else if (b.ground && ctx.bots?.some((o) => o.mode === 'run' && o.i < s.i && Math.abs(o.x - b.x) < 14 && Math.abs(o.y - b.y) < 12)) { s.spaceT = 0.45; s.spaceCd = 1.5 }
  if (s.spaceT > 0 && b.ground && !s.script) {
    inp = { move: 0, jump: false, airJumps: 1 }
    return finishStep(lv, s, stepBody(b, inp, lv, pNow, null, dt), dt)
  }
  inp = botInput(lv, s, ctx, 1)
  // Vor einem geschlossenen Tor: zurück zur Platte, und wenn keiner hilft, nach einer Weile trotzdem weiter
  const g = !open ? closedGateAhead(lv, b, pNow) : null
  if (g && g.x0 * TILE - b.x < 3 * TILE && (s.noPick || Math.abs(b.vx) < 30)) {
    s.blockT += dt
    if (s.blockT > 1.2 && lv.plates.some((p) => p.ch === g.ch && p.x * TILE < b.x && b.x - p.x * TILE < 16 * TILE)) {
      s.mode = 'goto'; s.holdCh = g.ch; s.gotoT = 0; s.gateX1 = g.x1
    } else if (s.blockT > 14) {
      const tx = (g.x1 + 2) * TILE
      Object.assign(b, newBody(tx, 10 * TILE - PH - 0.5))
      s.blockT = 0; s.script = null; s.lastX = tx; s.stuckT = 0; s.gateX1 = -1
      return 'ok'
    }
  } else if (s.gateX1 < 0) s.blockT = 0
  return finishStep(lv, s, stepBody(b, inp, lv, pNow, null, dt), dt)
}

function finishStep(lv: Level, s: BotState, r: 'ok' | 'dead' | 'lost', dt: number): 'ok' | 'exit' | 'dead' | 'out' {
  if (r === 'lost') { s.deadT = 0.5; return 'ok' }
  if (r === 'dead' && s.grace > 0) { s.deadT = 0.3; return 'ok' }
  if (r === 'dead') { s.hearts -= 1; s.deadT = 0.7; if (s.hearts <= 0) { s.out = true; return 'out' } return 'dead' }
  // Bots merken sich einen Checkpoint auch, wenn sie gerade darüber springen
  const cxx = Math.floor((s.body.x + PW / 2) / TILE)
  const c = checkpointAt(lv, s.body) ?? (lv.checkpoints.includes(cxx) && s.body.y > 5 * TILE ? cxx : null)
  if (c !== null && (s.cp === null || c > s.cp)) {
    s.cp = c
    // Profi/Meister: am Checkpoint genau an die Stelle, für die der einprogrammierte Weg berechnet wurde (ein paar Pixel)
    if (s.mode === 'run' && !s.route) {
      const rt = routeFor(lv, s)
      if (rt && (!rt.gated || s.open)) {
        const sp = spawnAt(lv, s.i % 5, c)
        Object.assign(s.body, newBody(sp.x, sp.y))
        s.route = rt; s.script = null; s.lastX = sp.x; s.stuckT = 0
      }
    }
  }
  if (inExit(lv, s.body)) return 'exit'
  // Festgelaufen (ohne Tor als Grund)? Erst ein Stück zurück und neuer Anlauf, dann Herz weg und zum Checkpoint
  if (s.backT <= 0 && s.mode === 'run' && s.blockT === 0) {
    if (s.body.x > s.lastX + 8) { s.lastX = s.body.x; s.stuckT = 0 } else s.stuckT += dt
    if (s.stuckT > 1.6) {
      s.stuckT = 0
      s.retries += 1
      if (s.retries <= 2) s.backT = 0.7
      else { s.retries = 0; s.hearts -= 1; s.deadT = 0.5; if (s.hearts <= 0) { s.out = true; return 'out' } return 'dead' }
    }
  } else if (s.mode !== 'run') { s.stuckT = 0; s.lastX = s.body.x }
  s.plan = Math.random()
  return 'ok'
}
