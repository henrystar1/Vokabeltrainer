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
})

describe('Deathrun-Bots', () => {
  it('schaffen die meisten Level (Können 3) bei Level 1 bis 14', () => {
    const rows: string[] = []
    let ok = 0
    for (let n = 0; n < 14; n++) { const r = run(n, 3); rows.push(`L${n + 1}:${r.exit ? 'ok' : 'x'}${r.hearts}/${Math.round(r.t)}s`); if (r.exit) ok++ }
    console.log(rows.join(' '))
    expect(ok).toBeGreaterThanOrEqual(9)
  }, 120000)
})
