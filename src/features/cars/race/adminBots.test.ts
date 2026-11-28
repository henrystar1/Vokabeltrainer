import { describe, expect, it } from 'vitest'
import { follow, makeBots, botFurnPiece, randomNode, type BotCtx } from './adminBots'
import { furnRects, houseEligible, houseId } from './house'
import { city } from './city'
import { interiorPush } from './interior'
import { streetRoute } from './route'

const seeded = (seed = 1) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
const homes = () => city().buildings.filter(houseEligible)

const mkCtx = (events: Array<[string, Record<string, unknown>]>, over: Partial<BotCtx> = {}): BotCtx => ({
  route: (a, b, c, d) => streetRoute(a, b, c, d),
  poi: (k) => (k === 'bank' ? { x: 180, z: -150 } : k === 'hospital' ? { x: 300, z: 300 } : null),
  fire: () => null, victims: () => [], humans: () => [],
  pickHouse: (taken) => homes().find((b) => !taken.includes(houseId(b))) ?? null,
  houseId, houseOut: () => ({ x: 0, z: 0 }), houseBld: () => null,
  emit: (e, p) => { events.push([e, p]) }, say: (t) => { events.push(['say', { t }]) },
  armyVehicles: () => [{ kind: 'tank', x: 420, z: 660 }], armyGate: () => ({ x: 420, z: 610 }), rnd: seeded(7), ...over,
})

describe('adminBots', () => {
  it('follow fährt zum Ziel und endet', () => {
    const b = { x: 0, z: 0, h: 0, v: 0, route: [[0, 60], [60, 60]] as Array<[number, number]>, ri: 0 }
    let done = false
    for (let i = 0; i < 4000 && !done; i++) done = follow(b, 0.05, 20)
    expect(done).toBe(true)
    expect(Math.hypot(b.x - 60, b.z - 60)).toBeLessThan(8)
  })
  it('Bots bekommen verschiedene Häuser mit Möbeln ohne Wandkollision', () => {
    const ev: Array<[string, Record<string, unknown>]> = []
    const sys = makeBots(mkCtx(ev))
    const a = sys.spawn(3), b = sys.spawn(5)
    expect(a.home).not.toBe(b.home)
    expect(a.furn.length).toBeGreaterThan(0)
    const hb = city().buildings[a.home]
    for (const r of furnRects(hb, a.furn)) expect(interiorPush(hb, (r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, 0.4)).toBeNull()
    const more = botFurnPiece(hb, a.furn, seeded(3)); void more
  })
  it('Bots fahren herum und bleiben im Stadtraster', () => {
    const sys = makeBots(mkCtx([]))
    const b = sys.spawn(5)
    let t = 0
    for (let i = 0; i < 6000; i++) { t += 50; sys.tick(0.05, t) }
    expect(Math.abs(b.x)).toBeLessThan(900); expect(Math.abs(b.z)).toBeLessThan(900)
    expect(b.act).not.toBe('idle')
  })
  it('Feuer: Bot löscht und sendet fo', () => {
    const ev: Array<[string, Record<string, unknown>]> = []
    const sys = makeBots(mkCtx(ev, { fire: () => ({ slot: 5, x: 120, z: 120, spot: { x: 120, z: 100 } }) }))
    sys.spawn(5)
    let t = 0
    for (let i = 0; i < 20000 && !ev.some((e) => e[0] === 'fo'); i++) { t += 50; sys.tick(0.05, t) }
    expect(ev.some((e) => e[0] === 'fo' && e[1].s === 5)).toBe(true)
  })
  it('Arzt rettet: mc, mp, mh', () => {
    const ev: Array<[string, Record<string, unknown>]> = []
    const sys = makeBots(mkCtx(ev, { victims: () => [{ id: 'u1', x: 60, z: 0, claimed: '' }], rnd: seeded(11) }))
    sys.spawn(4)
    let t = 0
    for (let i = 0; i < 30000 && !ev.some((e) => e[0] === 'mh'); i++) { t += 50; sys.tick(0.05, t) }
    expect(ev.map((e) => e[0])).toEqual(expect.arrayContaining(['mc', 'mp', 'mh']))
  })
  it('Treffer töten den Bot, danach kehrt er zurück', () => {
    const sys = makeBots(mkCtx([]))
    const b = sys.spawn(1)
    sys.hit(b.id, 9999, 1000)
    expect(b.deadUntil).toBeGreaterThan(0); expect(b.ex).toBe(1)
    sys.tick(0.05, 20000)
    expect(b.deadUntil).toBe(0); expect(b.hp).toBeGreaterThan(0)
  })
  it('randomNode liegt auf einer Kreuzung', () => {
    const [x, z] = randomNode(seeded(2)); expect(Math.abs(x % 120)).toBe(0); expect(Math.abs(z % 120)).toBe(0)
  })
})
