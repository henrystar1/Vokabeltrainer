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

describe('Deathrun-Bots', () => {
  it('schaffen die meisten Level (Können 3) bei Level 1 bis 14', () => {
    const rows: string[] = []
    let ok = 0
    for (let n = 0; n < 14; n++) { const r = run(n, 3); rows.push(`L${n + 1}:${r.exit ? 'ok' : 'x'}${r.hearts}/${Math.round(r.t)}s`); if (r.exit) ok++ }
    console.log(rows.join(' '))
    expect(ok).toBeGreaterThanOrEqual(9)
  }, 120000)
})
