import { describe, expect, it } from 'vitest'
import { levelFor } from './generator'
import { BotState, botStep, newBot } from './bots'

function run(n: number, skill: number, seed = 'seed'): { exit: boolean; hearts: number; t: number } {
  const lv = levelFor(seed, n)
  const s: BotState = newBot(0, lv, 5, skill, n)
  let t = 0
  while (t < 240) {
    const r = botStep(lv, s, 1 / 60)
    t += 1 / 60
    if (r === 'exit') return { exit: true, hearts: s.hearts, t }
    if (r === 'out') return { exit: false, hearts: 0, t }
  }
  return { exit: false, hearts: s.hearts, t }
}

describe('Deathrun-Bots mit Menschen im Level', () => {
  const gy = 10 * 32 - 28 - 0.5
  const lv = levelFor('seed', 0) // Platte a bei 33, Tür a bei 38, Platte a bei 42
  const runFor = (s: BotState, secs: number, human: () => { x: number; y: number }) => {
    for (let t = 0; t < secs; t += 1 / 60) { const h = human(); botStep(lv, s, 1 / 60, { humans: [h], others: [h] }) }
  }
  it('steht auf der Platte, solange der Mensch noch vor dem Tor ist, und lässt ihn durch', () => {
    const s = newBot(0, lv, 5, 3, 0)
    runFor(s, 14, () => ({ x: 10 * 32, y: gy }))
    expect(s.mode).toBe('hold')
    expect(s.body.x / 32).toBeGreaterThan(32.5)
    expect(s.body.x / 32).toBeLessThan(35)
  })
  it('geht weiter, wenn der Mensch drüben die Platte hält', () => {
    const s = newBot(0, lv, 5, 3, 0)
    let human = { x: 10 * 32, y: gy }
    runFor(s, 14, () => human)
    human = { x: 42 * 32 + 4, y: gy } // Mensch ist durch (Tor ist offen durch den Bot) und steht auf der hinteren Platte
    runFor(s, 8, () => human)
    expect(s.body.x / 32).toBeGreaterThan(39)
  })
  it('kommt ohne Hilfe nach einer Wartezeit trotzdem durch', () => {
    const s = newBot(0, lv, 5, 3, 0)
    runFor(s, 4, () => ({ x: 60 * 32, y: gy })) // Mensch längst weiter vorn, hält nichts
    runFor(s, 30, () => ({ x: 60 * 32, y: gy }))
    expect(s.body.x / 32).toBeGreaterThan(39)
  })
  it('kommt zurück, wenn der Mensch noch hinter dem Tor steht', () => {
    const s = newBot(0, lv, 5, 3, 0)
    Object.assign(s.body, { x: 41 * 32, y: gy })
    s.grace = 0; s.deadT = 0
    runFor(s, 25, () => ({ x: 36 * 32, y: gy }))
    expect(s.mode).toBe('hold')
    expect(s.body.x / 32).toBeGreaterThan(41)
    expect(s.body.x / 32).toBeLessThan(44)
  })
})

describe('Deathrun-Bots', () => {
  it('schaffen die meisten Level (Können 3) bei Level 1 bis 14', () => {
    const rows: string[] = []
    let ok = 0
    for (let n = 0; n < 14; n++) { const r = run(n, 3); rows.push(`L${n + 1}:${r.exit ? 'ok' : 'x'}${r.hearts}/${Math.round(r.t)}s`); if (r.exit) ok++ }
    console.log(rows.join(' '))
    expect(ok).toBeGreaterThanOrEqual(9)
  }, 120000)
  it('Effiziente Bots (Können 5) schaffen fast alles und rechnen deutlich weniger als der Meister', () => {
    let ok = 0
    const rows: string[] = []
    const t0 = performance.now()
    for (let n = 0; n < 14; n++) { const r = run(n, 5); rows.push(`L${n + 1}:${r.exit ? 'ok' : 'x'}${r.hearts}/${Math.round(r.t)}s`); if (r.exit) ok++ }
    console.log(`EFFIZIENT ${rows.join(' ')} (${Math.round(performance.now() - t0)} ms)`)
    expect(ok).toBeGreaterThanOrEqual(12)
  }, 240000)
  it('Meister-Bots (Können 4) schaffen fast alles', () => {
    const rows: string[] = []
    let ok = 0
    for (let n = 0; n < 14; n++) { const r = run(n, 4); rows.push(`L${n + 1}:${r.exit ? 'ok' : 'x'}${r.hearts}/${Math.round(r.t)}s`); if (r.exit) ok++ }
    console.log('MEISTER ' + rows.join(' '))
    expect(ok).toBeGreaterThanOrEqual(12)
  }, 240000)
})

describe('Bots untereinander', () => {
  const gy = 10 * 32 - 28 - 0.5
  const lv = levelFor('seed', 0)
  it('nur einer hält die Platte, die anderen gehen weiter', () => {
    const bots = [0, 1, 2].map((i) => { const b = newBot(i, lv, 5, 3, 0); Object.assign(b.body, { x: 33 * 32 + 4 + i * 3, y: gy }); b.deadT = 0; b.grace = 0; return b })
    const h = { x: 10 * 32, y: gy }
    let maxNear = 0
    for (let t = 0; t < 60 * 12; t++) {
      for (const b of bots) {
        const infos = bots.filter((o) => o !== b).map((o) => ({ i: o.i, x: o.body.x, y: o.body.y, mode: o.mode, ch: o.holdCh }))
        botStep(lv, b, 1 / 60, { humans: [h], others: [h, ...infos.map((o) => ({ x: o.x, y: o.y }))], bots: infos })
      }
      maxNear = Math.max(maxNear, bots.filter((b) => b.mode === 'hold' && b.body.x / 32 < 36).length)
    }
    expect(maxNear).toBeLessThanOrEqual(1) // nie zwei Bots zugleich auf derselben Platte
    expect(bots.filter((b) => b.body.x / 32 > 39).length).toBeGreaterThanOrEqual(1)
  })
})

describe('Bots achten aufeinander', () => {
  const gy = 10 * 32 - 28 - 0.5
  const lv = levelFor('seed', 0) // Platte a bei 33, Tür a bei 38
  const mk = (i: number, x: number) => { const b = newBot(i, lv, 5, 3, 0); Object.assign(b.body, { x, y: gy }); b.deadT = 0; b.grace = 0; return b }
  const stepAll = (bots: BotState[], frames: number, fixed: Set<number> = new Set()) => {
    for (let t = 0; t < frames; t++) {
      for (const b of bots) {
        if (fixed.has(b.i)) continue
        const infos = bots.filter((o) => o !== b).map((o) => ({ i: o.i, x: o.body.x, y: o.body.y, mode: o.mode, ch: o.holdCh }))
        botStep(lv, b, 1 / 60, { humans: [], others: infos.map((o) => ({ x: o.x, y: o.y })), bots: infos })
      }
    }
  }
  it('der Bot auf der Platte wartet, bis der andere Bot durch das Tor ist', () => {
    const a = mk(0, 33 * 32 + 4)
    const c = mk(1, 20 * 32)
    stepAll([a, c], 60 * 2, new Set([1])) // c steht still weit vor dem Tor
    expect(a.mode).toBe('hold')
    expect(a.body.x / 32).toBeLessThan(35)
  })
  it('wenn der andere Bot durch ist, geht der Haltende weiter', () => {
    const a = mk(0, 33 * 32 + 4)
    const c = mk(1, 20 * 32)
    stepAll([a, c], 60 * 2, new Set([1]))
    Object.assign(c.body, { x: 41 * 32, y: gy })
    stepAll([a, c], 60 * 22, new Set([1])) // das Tor schließt sich hinter dem letzten Bot: nach der Wartezeit wird er hinter das Tor gesetzt
    expect(a.body.x / 32).toBeGreaterThan(36)
  })
})

describe('Bots auf beiden Seiten eines Tors', () => {
  const gy = 10 * 32 - 28 - 0.5
  const lv = levelFor('seed', 0) // Platte a bei 33, Tür a bei 38, Platte a bei 42
  it('der Bot hinter dem Tor geht durch, der vordere hält die Platte, bis er hinterher ist', () => {
    const behind = newBot(0, lv, 5, 3, 0); Object.assign(behind.body, { x: 33 * 32 + 4, y: gy }); behind.deadT = 0; behind.grace = 0
    const front = newBot(1, lv, 5, 3, 0); Object.assign(front.body, { x: 42 * 32 + 4, y: gy }); front.deadT = 0; front.grace = 0
    const bots = [behind, front]
    for (let t = 0; t < 60 * 20; t++) {
      for (const b of bots) {
        const infos = bots.filter((o) => o !== b).map((o) => ({ i: o.i, x: o.body.x, y: o.body.y, mode: o.mode, ch: o.holdCh }))
        botStep(lv, b, 1 / 60, { humans: [], others: infos.map((o) => ({ x: o.x, y: o.y })), bots: infos })
        if (t === 30) expect(front.mode).toBe('hold')
      }
    }
    expect(behind.body.x / 32).toBeGreaterThan(39)
  })
})
