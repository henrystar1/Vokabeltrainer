import { levelFor } from './generator'
import { botStep, newBot, type BotState } from './bots'
import { spawnAt } from './engine'

/** Zwei oder mehr Bots auf demselben Level, so wie ParkourGame sie füttert. */
export function duo(n: number, skills: number[], secs = 150, seed = 'seed') {
  const lv = levelFor(seed, n)
  const bots: BotState[] = skills.map((k, i) => newBot(i, lv, 20, k, n))
  const done = new Set<number>()
  let deaths = 0
  for (let f = 0; f < secs * 60; f++) {
    for (const b of bots) {
      if (done.has(b.i)) continue
      const others = bots.filter((o) => o !== b && !done.has(o.i) && o.deadT <= 0).map((o) => ({ x: o.body.x, y: o.body.y }))
      const infos = bots.filter((o) => o !== b && !done.has(o.i)).map((o) => {
        if (o.deadT > 0) { const sp = spawnAt(lv, o.i % 5, o.cp); return { i: o.i, x: sp.x, y: sp.y, mode: 'run' as const, ch: o.holdCh } }
        return { i: o.i, x: o.body.x, y: o.body.y, mode: o.mode, ch: o.holdCh, take: o.take }
      })
      const r = botStep(lv, b, 1 / 60, { humans: [], others, bots: infos })
      if (r === 'dead') deaths++
      if (r === 'exit') done.add(b.i)
    }
    if (done.size === bots.length) return { ok: true, deaths, t: f / 60 }
  }
  return { ok: false, deaths, t: secs }
}

