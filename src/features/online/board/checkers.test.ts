import { describe, expect, it } from 'vitest'
import { applyMove, legalMoves, startState, status, type CheckersState } from './checkers'

const empty = (): string[] => Array<string>(64).fill('')
const at = (r: number, c: number) => r * 8 + c

describe('Dame-Engine', () => {
  it('Grundstellung: 12 Steine je Seite und 7 Züge für Weiß', () => {
    const s = startState()
    expect(s.board.filter((p) => p === 'w')).toHaveLength(12)
    expect(s.board.filter((p) => p === 'b')).toHaveLength(12)
    expect(legalMoves(s)).toHaveLength(7)
  })
  it('Schlagzwang: ein Schlagzug verbietet normale Züge', () => {
    const b = empty()
    b[at(5, 2)] = 'w'; b[at(4, 3)] = 'b'; b[at(6, 5)] = 'w'
    const moves = legalMoves({ board: b, turn: 'w' })
    expect(moves).toHaveLength(1)
    expect(moves[0].captured).toEqual([at(4, 3)])
    expect(moves[0].path).toEqual([at(5, 2), at(3, 4)])
  })
  it('Mehrfachsprung und Rückwärtsschlag der Steine', () => {
    const b = empty()
    b[at(7, 0)] = 'w'; b[at(6, 1)] = 'b'; b[at(4, 3)] = 'b'; b[at(2, 3)] = 'b'
    const m = legalMoves({ board: b, turn: 'w' })
    expect(m).toHaveLength(1)
    expect(m[0].captured).toHaveLength(3)
    expect(m[0].path).toEqual([at(7, 0), at(5, 2), at(3, 4), at(1, 2)])
    // Rückwärtsschlag: weißer Stein schlägt nach unten
    const c = empty()
    c[at(4, 3)] = 'w'; c[at(5, 4)] = 'b'
    expect(legalMoves({ board: c, turn: 'w' }).some((x) => x.captured.length === 1 && x.path[1] === at(6, 5))).toBe(true)
  })
  it('Umwandlung in Dame und fliegende Dame', () => {
    const b = empty()
    b[at(1, 2)] = 'w'
    const s: CheckersState = { board: b, turn: 'w' }
    const mv = legalMoves(s).find((x) => x.path[1] === at(0, 1))!
    expect(applyMove(s, mv).board[at(0, 1)]).toBe('W')
    const k = empty()
    k[at(7, 0)] = 'W'
    expect(legalMoves({ board: k, turn: 'w' })).toHaveLength(7)
  })
  it('Ohne Zug verliert man', () => {
    const b = empty()
    b[at(7, 0)] = 'w'; b[at(6, 1)] = 'b'; b[at(5, 2)] = 'b'
    expect(status({ board: b, turn: 'w' })).toBe('win_b')
  })
})
