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
    for (let t = 0; t < 60 * 12; t++) {
      for (const b of bots) {
        const infos = bots.filter((o) => o !== b).map((o) => ({ i: o.i, x: o.body.x, y: o.body.y, mode: o.mode, ch: o.holdCh }))
        botStep(lv, b, 1 / 60, { humans: [h], others: [h, ...infos.map((o) => ({ x: o.x, y: o.y }))], bots: infos })
      }
    }
    expect(bots.filter((b) => b.mode === 'hold').length).toBe(1)
    expect(bots.filter((b) => b.body.x / 32 > 39).length).toBeGreaterThanOrEqual(1)
  })
})
