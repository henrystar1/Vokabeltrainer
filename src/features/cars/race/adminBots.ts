import type { Pt } from './route'
import { layoutOf, interiorPush } from './interior'
import { furnDef, sanitizeFurn, WALL_COLORS, type Furn } from './house'
import type { Bld } from './city'

/** Admin-Bots: werden vom Admin-Client simuliert und senden wie echte Mitspieler ('r'-Funk mit Id bot-N). Sie fahren, überfallen die Bank, klauen Armeefahrzeuge, löschen Brände, retten Verletzte, kämpfen und richten ihr Haus ein. */
export interface SkillDef { id: number; name: string; /** Anteil der Höchstgeschwindigkeit */ speed: number; /** Trefferchance */ acc: number; dmg: number; /** Pause zwischen Schüssen (ms) */ fireMs: number; /** Lust zu kämpfen */ fight: number; hp: number }
export const SKILLS: ReadonlyArray<SkillDef> = [
  { id: 1, name: 'Okay', speed: 0.5, acc: 0.22, dmg: 3, fireMs: 1200, fight: 0.08, hp: 80 },
  { id: 2, name: 'Gut', speed: 0.65, acc: 0.32, dmg: 4, fireMs: 950, fight: 0.12, hp: 100 },
  { id: 3, name: 'Sehr gut', speed: 0.8, acc: 0.45, dmg: 5, fireMs: 750, fight: 0.16, hp: 120 },
  { id: 4, name: 'Profi', speed: 0.92, acc: 0.6, dmg: 6, fireMs: 560, fight: 0.2, hp: 150 },
  { id: 5, name: 'Master', speed: 1.0, acc: 0.78, dmg: 7, fireMs: 400, fight: 0.26, hp: 190 },
]
export const MAX_BOTS = 10
const NAMES = ['Max', 'Luca', 'Mia', 'Jonas', 'Lena', 'Felix', 'Emma', 'Noah', 'Sara', 'Tim', 'Anna', 'Ben']
const CIV = ['kleinwagen', 'limousine', 'kombi', 'suv', 'sportwagen', 'muscle', 'pickup', 'cabrio']
const CIV_TOP: Record<string, number> = { kleinwagen: 26, limousine: 30, kombi: 28, suv: 28, sportwagen: 42, muscle: 38, pickup: 27, cabrio: 34 }

export type Act = 'idle' | 'cruise' | 'bank' | 'army' | 'fire' | 'doctor' | 'fight' | 'home'
export interface Bot {
  id: string; name: string; skill: number; color: string; kind: string
  x: number; z: number; y: number; h: number; v: number; wk: boolean; hd: boolean; hp: number
  act: Act; ph: number; t: number; route: Pt[]; ri: number
  d: Record<string, number | string | boolean | undefined>
  home: number; furn: Furn[]; wall: string | null
  od: string; ex: number; deadUntil: number; lastShot: number; carX: number; carZ: number
}

export interface BotCtx {
  route(sx: number, sz: number, tx: number, tz: number): Pt[]
  poi(kind: 'bank' | 'army' | 'hospital' | 'fire'): { x: number; z: number } | null
  fire(): { slot: number; x: number; z: number; spot: { x: number; z: number } } | null
  victims(): Array<{ id: string; x: number; z: number; claimed: string }>
  humans(): Array<{ id: string; x: number; z: number; safe: boolean; foot: boolean }>
  pickHouse(taken: number[]): Bld | null
  houseId(b: Bld): number
  houseOut(id: number): { x: number; z: number } | null
  houseBld(id: number): Bld | null
  /** Funk senden (und an mich selbst weiterreichen, wenn der Empfänger der Admin ist) */
  emit(event: string, payload: Record<string, unknown>): void
  say(text: string): void
  armyVehicles(): Array<{ kind: 'tank' | 'heli'; x: number; z: number }>
  armyGate(): { x: number; z: number }
  rnd?: () => number
}

const P = 120, K = 6
const wrap = (a: number) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a }
export const skillOf = (id: number): SkillDef => SKILLS[Math.max(0, Math.min(SKILLS.length - 1, id - 1))]

/** Folgt der Wegeliste: dreht zum nächsten Punkt, bremst in Kurven. true, wenn das Ende erreicht ist. */
export function follow(b: Pick<Bot, 'x' | 'z' | 'h' | 'v' | 'route' | 'ri'>, dt: number, vmax: number, turn = 2.4): boolean {
  const p = b.route[b.ri]
  if (!p) { b.v *= Math.max(0, 1 - dt * 4); return true }
  const dx = p[0] - b.x, dz = p[1] - b.z, d = Math.hypot(dx, dz), reach = 2.5 + Math.abs(b.v) * 0.3
  if (d < reach) { b.ri++; return b.ri >= b.route.length }
  const dh = wrap(Math.atan2(dx, dz) - b.h)
  b.h = wrap(b.h + Math.max(-dt * turn, Math.min(dt * turn, dh)))
  const slow = 1 - Math.min(0.75, (Math.abs(dh) / Math.PI) * 1.6)
  b.v += (vmax * slow - b.v) * Math.min(1, dt * 1.6)
  b.x += Math.sin(b.h) * b.v * dt; b.z += Math.cos(b.h) * b.v * dt
  return false
}

/** Zufällige Kreuzung im Stadtraster. */
export function randomNode(rnd: () => number): Pt {
  const i = Math.floor(rnd() * (2 * K - 1)) - (K - 1), j = Math.floor(rnd() * (2 * K - 1)) - (K - 1)
  return [i * P, j * P]
}

/** Möbelstück für das Bot-Haus: freie Stelle im Erdgeschoss (nicht in Wänden, nicht an der Tür, nicht auf anderen Möbeln). */
export function botFurnPiece(b: Bld, have: Furn[], rnd: () => number): Furn | null {
  const lay = layoutOf(b)
  const kinds = ['bed', 'sofa', 'table', 'chair', 'shelf', 'tv', 'fridge', 'plant', 'rug', 'lamp']
  for (let tries = 0; tries < 40; tries++) {
    const k = kinds[Math.floor(rnd() * kinds.length)], d = furnDef(k)!
    const r: 0 | 1 = rnd() < 0.5 ? 0 : 1
    const x = (rnd() - 0.5) * (b.w - 6), z = (rnd() - 0.5) * (b.d - 6)
    const w = (r ? d.d : d.w) / 2 + 0.5, dd = (r ? d.w : d.d) / 2 + 0.5
    const pts: Array<[number, number]> = [[0, 0], [w, dd], [-w, dd], [w, -dd], [-w, -dd], [w, 0], [-w, 0], [0, dd], [0, -dd]]
    if (pts.some(([px, pz]) => interiorPush(b, b.x + x + px, b.z + z + pz, 0.5))) continue
    if (Math.hypot(b.x + x - lay.door.x, b.z + z - lay.door.z) < 3.2) continue
    if (have.some((o) => { const od = furnDef(o.k)!; return Math.abs(o.x - x) < (od.w + d.w) / 2 + 0.2 && Math.abs(o.z - z) < (od.d + d.d) / 2 + 0.2 })) continue
    const out = sanitizeFurn([{ k, x, z, r }], b)
    if (out.length) return out[0]
  }
  return null
}

export function makeBots(ctx: BotCtx) {
  const rnd = ctx.rnd ?? Math.random
  const bots: Bot[] = []
  const cd = { bank: 0, army: 0 }
  const taken = { fire: -1, doctor: '' }
  let seq = 0
  const COLORS = ['#38bdf8', '#f97316', '#e879f9', '#facc15', '#f472b6', '#a78bfa', '#fb7185', '#fbbf24', '#c084fc', '#60a5fa']

  const spawn = (skill: number): Bot => {
    const n = ++seq, [x, z] = randomNode(rnd)
    const b: Bot = {
      id: `bot-${n}`, name: `${NAMES[(n - 1) % NAMES.length]} 🤖`, skill, color: COLORS[(n - 1) % COLORS.length], kind: CIV[Math.floor(rnd() * CIV.length)],
      x, z, y: 0, h: 0, v: 0, wk: false, hd: false, hp: skillOf(skill).hp, act: 'idle', ph: 0, t: 0, route: [], ri: 0, d: {},
      home: -1, furn: [], wall: WALL_COLORS[Math.floor(rnd() * WALL_COLORS.length)]?.hex ?? null, od: '', ex: 0, deadUntil: 0, lastShot: 0, carX: x, carZ: z,
    }
    const hb = ctx.pickHouse(bots.map((o) => o.home))
    if (hb) { b.home = ctx.houseId(hb); for (let i = 0; i < 3; i++) { const f = botFurnPiece(hb, b.furn, rnd); if (f) b.furn.push(f) } }
    bots.push(b)
    return b
  }
  const release = (b: Bot) => { if (taken.doctor === b.id) taken.doctor = ''; if (b.act === 'fire') taken.fire = -1 }
  const remove = (b: Bot) => { release(b); const i = bots.indexOf(b); if (i >= 0) bots.splice(i, 1) }
  const to = (b: Bot, x: number, z: number) => { b.route = ctx.route(b.x, b.z, x, z); b.ri = 0 }
  const straight = (b: Bot, x: number, z: number) => { b.route = [[x, z]]; b.ri = 0 }
  const civil = (b: Bot) => { if (!CIV.includes(b.kind)) b.kind = CIV[Math.floor(rnd() * CIV.length)]; b.wk = false; b.y = 0; b.od = '' }
  const vmaxCar = (b: Bot) => (CIV_TOP[b.kind] ?? 28) * skillOf(b.skill).speed * 0.62
  const go = (b: Bot, a: Act, t: number) => { if (b.act !== a) release(b); b.act = a; b.ph = 0; b.t = t; b.d = {} }
  const targetOf = (b: Bot) => ctx.humans().filter((h) => !h.safe).sort((p, q) => Math.hypot(p.x - b.x, p.z - b.z) - Math.hypot(q.x - b.x, q.z - b.z))[0]

  const decide = (b: Bot, now: number) => {
    civil(b)
    const sk = skillOf(b.skill), f = ctx.fire(), vs = ctx.victims().filter((v) => !v.claimed)
    if (f && taken.fire !== f.slot && rnd() < 0.7) { taken.fire = f.slot; go(b, 'fire', now); b.d.slot = f.slot; return }
    if (vs.length && !taken.doctor && rnd() < 0.8) { go(b, 'doctor', now); taken.doctor = b.id; b.d.v = vs[0].id; return }
    const r = rnd()
    if (r < sk.fight && ctx.humans().some((h) => !h.safe)) { go(b, 'fight', now); b.d.until = now + 25000 + rnd() * 20000; ctx.emit('bn', { to: targetOf(b)?.id, t: `${b.name} greift dich an!` }); return }
    if (r < 0.2 && now > cd.bank && ctx.poi('bank')) { cd.bank = now + 150000; go(b, 'bank', now); return }
    if (r < 0.3 && now > cd.army && ctx.armyVehicles().length) { cd.army = now + 180000; go(b, 'army', now); return }
    if (r < 0.45 && b.home >= 0 && ctx.houseOut(b.home)) { go(b, 'home', now); return }
    go(b, 'cruise', now)
  }

  const shoot = (b: Bot, now: number, range: number, power = 1, gap = 1): boolean => {
    const tg = targetOf(b); if (!tg) return false
    const d = Math.hypot(tg.x - b.x, tg.z - b.z), sk = skillOf(b.skill)
    if (d > range) return false
    if (now - b.lastShot > sk.fireMs * gap) {
      b.lastShot = now
      if (rnd() < sk.acc * (1 - d / (range * 1.5))) ctx.emit('sd', { to: tg.id, d: Math.round((sk.dmg + Math.floor(rnd() * 3)) * power), k: tg.foot ? 'f' : 'c', a: 1 })
    }
    return true
  }

  /** Haus des Bots: ein Möbelstück ergänzen (beim Einrichten) – true, wenn etwas dazukam. */
  const furnish = (b: Bot, hb: Bld): boolean => {
    if (b.furn.length >= 16) return false
    const f = botFurnPiece(hb, b.furn, rnd)
    if (!f) return false
    b.furn.push(f); return true
  }

  const step = (b: Bot, dt: number, now: number) => {
    const sk = skillOf(b.skill), el = now - b.t
    switch (b.act) {
      case 'idle': b.v *= 0.9; if (el > 600) decide(b, now); break
      case 'cruise': {
        if (b.ph === 0) { const [x, z] = randomNode(rnd); to(b, x, z); b.ph = 1; b.d.legs = Number(b.d.legs ?? 0) + 1 }
        if (follow(b, dt, vmaxCar(b))) { if (Number(b.d.legs) >= 3) go(b, 'idle', now); else b.ph = 0 }
        break
      }
      case 'fight': {
        const tg = targetOf(b)
        if (!tg || now > Number(b.d.until ?? 0)) { go(b, 'idle', now); break }
        const d = Math.hypot(tg.x - b.x, tg.z - b.z)
        if (d > 22) { if (b.ph === 0 || b.ri >= b.route.length) { to(b, tg.x, tg.z); b.ph = 1 } follow(b, dt, vmaxCar(b) * 1.1) }
        else { b.h = wrap(b.h + wrap(Math.atan2(tg.x - b.x, tg.z - b.z) - b.h) * Math.min(1, dt * 3)); b.v *= 0.96 }
        shoot(b, now, 40)
        break
      }
      case 'bank': {
        const bank = ctx.poi('bank')!
        if (b.ph === 0) { to(b, bank.x, bank.z); b.ph = 1; ctx.say(`${b.name} fährt zur Bank …`) }
        else if (b.ph === 1) { if (follow(b, dt, vmaxCar(b))) { b.carX = b.x; b.carZ = b.z; b.v = 0; b.wk = true; straight(b, bank.x, bank.z); b.ph = 2 } }
        else if (b.ph === 2) { if (follow(b, dt, 3.6, 7)) { b.hd = true; b.t = now; b.ph = 3; b.d.dur = 12000 + (6 - skillOf(b.skill).id) * 3500; ctx.say(`${b.name} überfällt die Bank!`) } }
        else if (b.ph === 3) { if (now - b.t > Number(b.d.dur)) { b.hd = false; straight(b, b.carX, b.carZ); b.ph = 4; ctx.say(`${b.name} hat die Bank ausgeraubt und flüchtet!`) } }
        else if (b.ph === 4) { if (follow(b, dt, 3.8, 7)) { b.wk = false; const [x, z] = randomNode(rnd); to(b, x, z); b.ph = 5 } }
        else if (follow(b, dt, vmaxCar(b) * 1.15)) go(b, 'idle', now)
        break
      }
      case 'army': {
        const gate = ctx.armyGate()
        if (b.ph === 0) { to(b, gate.x, gate.z); b.ph = 1 }
        else if (b.ph === 1) { if (follow(b, dt, vmaxCar(b))) { const vs = ctx.armyVehicles(); const v = vs[Math.floor(rnd() * vs.length)]; if (!v) { go(b, 'idle', now); break } b.carX = v.x; b.carZ = v.z; b.d.kind = v.kind; b.wk = true; b.v = 0; straight(b, v.x, v.z); b.ph = 2 } }
        else if (b.ph === 2) {
          if (follow(b, dt, 3.8, 7)) {
            b.wk = false; b.kind = String(b.d.kind); b.x = b.carX; b.z = b.carZ; b.v = 0; b.t = now; b.d.legs = 0; b.ph = 3
            ctx.say(`${b.name} klaut ${b.kind === 'tank' ? 'einen Panzer' : 'einen Armeehubschrauber'}!`)
          }
        } else if (b.ph === 3) {
          const heli = b.kind === 'heli', long = el > 70000
          if (heli) b.y += (Math.min(45, el / 400) - b.y) * Math.min(1, dt * 1.5)
          if (b.route.length === 0 || b.ri >= b.route.length) {
            if (long) { if (heli) { straight(b, gate.x, gate.z - 10) } else to(b, gate.x, gate.z); b.ph = 4; break }
            if (heli) { straight(b, (rnd() - 0.5) * 1000, (rnd() - 0.5) * 1000) } else { const [x, z] = randomNode(rnd); to(b, x, z) }
          }
          follow(b, dt, heli ? 34 * sk.speed : 11 * sk.speed + 3, heli ? 0.9 : 1.3)
          shoot(b, now, heli ? 95 : 75, 1.5, 1.4)
        } else {
          if (b.kind === 'heli') b.y += (0 - b.y) * Math.min(1, dt * 0.8)
          if (follow(b, dt, b.kind === 'heli' ? 20 : 9, b.kind === 'heli' ? 0.9 : 1.3) && (b.kind !== 'heli' || b.y < 1)) { civil(b); go(b, 'idle', now) }
        }
        break
      }
      case 'fire': {
        const f = ctx.fire()
        if (!f || f.slot !== b.d.slot) { go(b, 'idle', now); break }
        b.od = 'f'; b.kind = 'firetruck'
        if (b.ph === 0) { to(b, f.spot.x, f.spot.z); b.ph = 1; ctx.say(`${b.name} rückt als Feuerwehrmann zum Brand aus!`) }
        else if (b.ph === 1) { if (follow(b, dt, 22 * sk.speed + 6, 2.2)) { b.t = now; b.ph = 2; b.v = 0 } }
        else if (now - b.t > 9000 + (6 - sk.id) * 3000) { ctx.emit('fo', { s: f.slot }); ctx.say(`${b.name} hat den Brand gelöscht.`); civil(b); go(b, 'idle', now) }
        else b.v *= 0.9
        break
      }
      case 'doctor': {
        const v = ctx.victims().find((x) => x.id === b.d.v), hosp = ctx.poi('hospital')
        if (!v || !hosp) { go(b, 'idle', now); civil(b); break }
        b.od = 'm'; b.kind = 'ambulance'
        if (b.ph === 0) { ctx.emit('mc', { to: v.id, by: b.id }); to(b, v.x, v.z); b.ph = 1; ctx.say(`${b.name} fährt als Arzt zu einem Verletzten.`) }
        else if (b.ph === 1) {
          if (follow(b, dt, 24 * sk.speed + 6, 2.2) || Math.hypot(v.x - b.x, v.z - b.z) < 9) { ctx.emit('mp', { to: v.id, by: b.id }); to(b, hosp.x, hosp.z); b.ph = 2; b.v *= 0.3 }
        } else if (follow(b, dt, 24 * sk.speed + 6, 2.2)) { ctx.emit('mh', { to: v.id }); ctx.say(`${b.name} hat einen Patienten gerettet.`); civil(b); go(b, 'idle', now) }
        break
      }
      case 'home': {
        const out = ctx.houseOut(b.home)
        if (!out) { go(b, 'idle', now); break }
        if (b.ph === 0) { to(b, out.x, out.z); b.ph = 1 }
        else if (b.ph === 1) { if (follow(b, dt, vmaxCar(b) * 0.8)) { b.v = 0; b.hd = true; b.t = now; b.ph = 2 } }
        else if (now - b.t > 12000) {
          b.hd = false
          const hb = ctx.houseBld(b.home)
          if (hb && furnish(b, hb)) { b.d.furn = true; ctx.emit('bh', {}) }
          go(b, 'idle', now)
        }
        break
      }
    }
  }

  const tick = (dt: number, now: number) => {
    for (const b of bots) {
      if (b.deadUntil) { if (now > b.deadUntil) { respawn(b, now) } continue }
      step(b, dt, now)
    }
  }
  const respawn = (b: Bot, now: number) => { const [x, z] = randomNode(rnd); Object.assign(b, { x, z, y: 0, v: 0, hd: false, wk: false, hp: skillOf(b.skill).hp, deadUntil: 0 }); civil(b); go(b, 'idle', now) }

  /** Treffer auf einen Bot; bei 0 Lebenspunkten Explosion und Neustart nach 8 s. */
  const hit = (id: string, dmg: number, now: number) => {
    const b = bots.find((o) => o.id === id); if (!b || b.deadUntil) return
    b.hp -= dmg
    if (b.hp <= 0) { b.ex++; b.hd = true; b.deadUntil = now + 8000; release(b); ctx.say(`${b.name} wurde ausgeschaltet.`) }
    else if (b.act !== 'fight' && skillOf(b.skill).fight > 0.1 && rnd() < 0.5 && ctx.humans().some((h) => !h.safe)) { go(b, 'fight', now); b.d.until = now + 20000 }
  }

  const payload = (b: Bot): Record<string, unknown> => ({
    u: b.id, x: b.x, z: b.z, h: b.h, v: b.v, wk: b.wk ? 1 : 0, t: 0, k: b.kind, c: b.color, ro: '', f: null, d: 0, sl: 0, fl: 0, lv: 0, y: Math.round(b.y * 10) / 10, pt: 0,
    n: b.name, hd: b.hd ? 1 : 0, ad: 0, od: b.od, ex: b.ex, dn: 0, gr: 0,
  })

  return { bots, spawn, remove, tick, hit, payload, furnish, decide, cd, taken, follow }
}
