import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../learning/random'
import { addTile, canMove, move, newBoard, slideRow } from './game2048'
import { MEMORY_LIVES, heartsAfterRound, isAvoidableMiss, makeDeck, pairsForLevel } from './memory'
import { freeHole, moleGap, moleMaxUp, molePoints, moleUpTime, pickKind, MOLE_HOLES } from './mole'
import { BH, BW, PADDLE_Y, launch, newBricks, stepBricks } from './bricks'
import { JH, PH, jumpScore, newJump, stepJump, maxGap } from './jump'
import { parseSticker, stickerBody, STICKERS } from '../chat/stickers'

describe('2048', () => {
  it('verschmilzt gleiche Nachbarn genau einmal', () => {
    expect(slideRow([2, 2, 2, 2])).toEqual({ row: [4, 4, 0, 0], gained: 8 })
    expect(slideRow([2, 2, 4, 0])).toEqual({ row: [4, 4, 0, 0], gained: 4 })
    expect(slideRow([0, 2, 0, 2])).toEqual({ row: [4, 0, 0, 0], gained: 4 })
  })
  it('bewegt in alle vier Richtungen', () => {
    const b = [[2, 0, 0, 2], [0, 0, 0, 0], [0, 0, 0, 0], [4, 0, 0, 4]]
    expect(move(b, 'left').board[0]).toEqual([4, 0, 0, 0])
    expect(move(b, 'right').board[0]).toEqual([0, 0, 0, 4])
    expect(move(b, 'up').board[0]).toEqual([2, 0, 0, 2])
    expect(move(b, 'down').board[3]).toEqual([4, 0, 0, 4])
    expect(move(b, 'down').board[2]).toEqual([2, 0, 0, 2])
  })
  it('Startfeld hat zwei Kacheln; volles Feld ohne Paare ist Ende', () => {
    const b = newBoard(mulberry32(1))
    expect(b.flat().filter((v) => v > 0)).toHaveLength(2)
    expect(addTile(b, mulberry32(2)).flat().filter((v) => v > 0)).toHaveLength(3)
    const full = [[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]]
    expect(canMove(full)).toBe(false)
    expect(move(full, 'left').moved).toBe(false)
  })
})

describe('Memory', () => {
  it('Deck hat jedes Symbol genau zweimal', () => {
    const d = makeDeck(5, mulberry32(3))
    expect(d).toHaveLength(10)
    const counts = new Map<string, number>()
    for (const c of d) counts.set(c.symbol, (counts.get(c.symbol) ?? 0) + 1)
    expect([...counts.values()].every((n) => n === 2)).toBe(true)
  })
  it('Paare wachsen bis höchstens 12', () => {
    expect(pairsForLevel(1)).toBe(3)
    expect(pairsForLevel(4)).toBe(6)
    expect(pairsForLevel(99)).toBe(12)
  })
})

describe('Memory-Fairness', () => {
  it('nur vermeidbare Fehler kosten ein Herz', () => {
    const seen = new Set([3, 7])
    expect(isAvoidableMiss(seen, 0, 1)).toBe(false) // zwei unbekannte Karten = Zufall
    expect(isAvoidableMiss(seen, 3, 1)).toBe(true) // 3 war schon bekannt
    expect(isAvoidableMiss(seen, 4, 7)).toBe(true)
  })
  it('fehlerfreie Runde gibt ein Herz zurück (höchstens 5)', () => {
    expect(heartsAfterRound(3, false)).toBe(4)
    expect(heartsAfterRound(MEMORY_LIVES, false)).toBe(MEMORY_LIVES)
    expect(heartsAfterRound(3, true)).toBe(3)
  })
  it('ein Spieler mit perfektem Gedächtnis verliert nie ein Herz', () => {
    // Simulation: Karten systematisch aufdecken und sich alles merken.
    for (let level = 1; level <= 15; level++) {
      const deck = makeDeck(pairsForLevel(level), mulberry32(level))
      const seen = new Set<number>()
      const done = new Set<number>()
      let hearts = MEMORY_LIVES
      const know = new Map<string, number[]>()
      while (done.size < deck.length) {
        // erste Karte: eine unbekannte oder eine, deren Partner bekannt ist
        let a = deck.findIndex((c, i) => !done.has(i) && (know.get(c.symbol)?.length ?? 0) === 2 && know.get(c.symbol)![0] === i)
        let b: number
        if (a >= 0) b = know.get(deck[a].symbol)![1]
        else {
          a = deck.findIndex((_, i) => !done.has(i) && !seen.has(i))
          const sym = deck[a].symbol
          const partner = (know.get(sym) ?? [])[0]
          b = partner !== undefined ? partner : deck.findIndex((_, i) => !done.has(i) && !seen.has(i) && i !== a)
        }
        if (deck[a].symbol === deck[b].symbol) {
          done.add(a); done.add(b); seen.add(a); seen.add(b)
          continue
        }
        if (isAvoidableMiss(seen, a, b)) hearts -= 1
        for (const i of [a, b]) {
          seen.add(i)
          const arr = know.get(deck[i].symbol) ?? []
          if (!arr.includes(i)) arr.push(i)
          know.set(deck[i].symbol, arr)
        }
      }
      expect(hearts).toBe(MEMORY_LIVES)
    }
  })
})

describe('Maulwurf', () => {
  it('wird schneller, aber nur bis zu einer machbaren Grenze', () => {
    expect(moleUpTime(30)).toBeLessThan(moleUpTime(0))
    expect(moleGap(30)).toBeLessThan(moleGap(0))
    expect(moleUpTime(9999)).toBe(640)
    expect(moleUpTime(500)).toBe(moleUpTime(9999))
    expect(moleGap(9999)).toBe(300)
    expect(moleMaxUp(0)).toBe(1)
    expect(moleMaxUp(25)).toBe(2)
    expect(moleMaxUp(100)).toBe(3)
  })
  it('Bomben erst ab 8 Punkten, golden gibt 3', () => {
    const rng = mulberry32(9)
    for (let i = 0; i < 300; i++) expect(pickKind(2, rng)).not.toBe('bomb')
    let bombs = 0
    for (let i = 0; i < 1000; i++) if (pickKind(100, rng) === 'bomb') bombs++
    expect(bombs).toBeGreaterThan(120)
    expect(bombs).toBeLessThan(330)
    expect(molePoints('golden')).toBe(3)
    expect(molePoints('bomb')).toBe(0)
  })
  it('wählt nur freie Löcher', () => {
    const rng = mulberry32(5)
    const taken = new Set([0, 1, 2, 3, 4, 5, 6, 7])
    for (let i = 0; i < 20; i++) expect(freeHole(taken, rng)).toBe(8)
    expect(freeHole(new Set(Array.from({ length: MOLE_HOLES }, (_, i) => i)), rng)).toBeNull()
  })
})

describe('Bricks', () => {
  it('Ball verloren kostet ein Leben, nach drei ist Schluss', () => {
    let s = launch(newBricks())
    for (let life = 0; life < 3; life++) {
      s = { ...s, launched: true, x: 5, y: BH + 50, vx: 0, vy: 100 }
      s = stepBricks(s, 0.016, 5)
    }
    expect(s.over).toBe(true)
  })
  it('trifft einen Stein: Punkt und Stein weg', () => {
    let s = launch(newBricks())
    s = { ...s, x: 20, y: 80, vx: 0, vy: -200 }
    for (let i = 0; i < 20; i++) s = stepBricks(s, 0.016, BW / 2)
    expect(s.score).toBeGreaterThanOrEqual(1)
    expect(s.bricks.filter((b) => b === 0).length).toBe(s.score)
  })
  it('Schläger wirft den Ball nach oben zurück', () => {
    let s = launch(newBricks())
    s = { ...s, launched: true, x: BW / 2, y: PADDLE_Y - 6, vx: 0, vy: 300 }
    s = stepBricks(s, 0.016, BW / 2)
    expect(s.vy).toBeLessThan(0)
  })
})

describe('Bricks: feste Steine', () => {
  it('fester Stein knackst erst an (kein Punkt) und zerbricht beim zweiten Treffer', () => {
    // Stein 0 (Reihe 0, Spalte 0) ist fest
    let s = launch(newBricks())
    expect(s.bricks[0]).toBe(2)
    const hit = (st: typeof s) => ({ ...st, launched: true, x: 20, y: 80 - 20 + 0, vx: 0, vy: -200 })
    s = hit(s)
    for (let i = 0; i < 30 && s.bricks[0] === 2; i++) s = stepBricks(s, 0.016, BW / 2)
    expect(s.bricks[0]).toBe(1)
    expect(s.score).toBe(0)
    s = hit({ ...s, y: 80 })
    for (let i = 0; i < 30 && s.bricks[0] === 1; i++) s = stepBricks(s, 0.016, BW / 2)
    expect(s.bricks[0]).toBe(0)
    expect(s.score).toBe(1)
  })
})

describe('Hüpfer (Plattformer)', () => {
  it('steht auf der Startinsel, fällt ins Leere und verliert', () => {
    let s = newJump(mulberry32(1))
    for (let i = 0; i < 60; i++) s = stepJump(s, 0.016, { move: 0, jump: false }, mulberry32(i))
    expect(s.onGround).toBe(true)
    expect(s.over).toBe(false)
    s = { ...s, plats: [], y: 100, vy: 0 }
    for (let i = 0; i < 200 && !s.over; i++) s = stepJump(s, 0.016, { move: 0, jump: false }, mulberry32(i))
    expect(s.over).toBe(true)
    expect(s.y).toBeGreaterThan(JH)
  })
  it('springt nur vom Boden (und kurz nach der Kante)', () => {
    let s = newJump(mulberry32(2))
    s = stepJump(s, 0.016, { move: 0, jump: true }, mulberry32(3))
    expect(s.vy).toBeLessThan(0)
    const air = { ...s, onGround: false, coyote: 0, vy: -100 }
    const after = stepJump(air, 0.016, { move: 0, jump: true }, mulberry32(4))
    expect(after.vy).toBeGreaterThan(-100) // kein Doppelsprung
  })
  it('Münzen zählen 5 Punkte, Strecke 1 je 50 px', () => {
    expect(jumpScore({ maxX: 500, coinsGot: 2 })).toBe(20)
  })
  it('Lücken bleiben erreichbar: ein einfacher Bot kommt 3500 px weit', () => {
    // Bot wie ein vorsichtiger Spieler: läuft bis zur Kante, springt und steuert die Weite in der Luft.
    const rng = mulberry32(11)
    let s = newJump(rng)
    let mv = 1
    let t = 0
    for (let step = 0; step < 60 * 120 && !s.over && s.maxX < 3500; step++) {
      const cur = s.plats.find((p) => s.x + 9 >= p.x && s.x + 9 <= p.x + p.w && Math.abs(p.y - (s.y + PH)) < 4)
      let jump = false
      let move = s.onGround ? 1 : mv
      if (cur && s.onGround) {
        const nx = s.plats.filter((p) => p.x > cur.x + cur.w).sort((a, b) => a.x - b.x)[0]
        if (nx && s.x + 18 >= cur.x + cur.w - 4) {
          jump = true
          const target = nx.x + Math.min(nx.w * 0.5, 45)
          mv = Math.max(0.25, Math.min(1, (target - s.x) / (0.6 * 230)))
          move = mv
        }
      }
      s = stepJump(s, 1 / 60, { move, jump }, rng)
      t += 1 / 60
    }
    expect(s.maxX).toBeGreaterThanOrEqual(3500)
    expect(t).toBeGreaterThan(10)
  })
  it('maxGap wächst, bleibt aber begrenzt und ist beim Anstieg kleiner', () => {
    expect(maxGap(4000, 0)).toBeGreaterThan(maxGap(0, 0))
    expect(maxGap(99999, 0)).toBeLessThanOrEqual(130)
    expect(maxGap(2000, 50)).toBeLessThanOrEqual(95)
  })
})

describe('Sticker', () => {
  it('erkennt nur bekannte Sticker im richtigen Format', () => {
    expect(parseSticker(stickerBody(STICKERS[0].id))?.id).toBe(STICKERS[0].id)
    expect(parseSticker(':sticker:gibtsnicht:')).toBeNull()
    expect(parseSticker('hallo :sticker:gg:')).toBeNull()
    expect(new Set(STICKERS.map((s) => s.id)).size).toBe(STICKERS.length)
  })
})
