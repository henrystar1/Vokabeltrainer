import { describe, expect, it } from 'vitest'
import { START_FEN, applyMove, legalMoves, parseFen, perft, status, toFen } from './chess'

describe('Schach-Engine', () => {
  it('FEN hin und zurück', () => {
    expect(toFen(parseFen(START_FEN))).toBe(START_FEN)
  })
  it('Perft Grundstellung (bekannte Werte)', () => {
    const s = parseFen(START_FEN)
    expect(perft(s, 1)).toBe(20)
    expect(perft(s, 2)).toBe(400)
    expect(perft(s, 3)).toBe(8902)
  })
  it('Perft „Kiwipete" (Rochade, en passant, Fesselungen)', () => {
    const s = parseFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1')
    expect(perft(s, 1)).toBe(48)
    expect(perft(s, 2)).toBe(2039)
    expect(perft(s, 3)).toBe(97862)
  })
  it('Perft Position 3 (en passant, Umwandlung)', () => {
    const s = parseFen('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1')
    expect(perft(s, 3)).toBe(2812)
    expect(perft(s, 4)).toBe(43238)
  })
  it('Schachmatt (Narrenmatt) und Patt', () => {
    let s = parseFen(START_FEN)
    for (const [a, b] of [[53, 45], [12, 28], [54, 38], [3, 39]]) {
      const m = legalMoves(s).find((x) => x.from === a && x.to === b)
      expect(m).toBeTruthy()
      s = applyMove(s, m!)
    }
    expect(status(s)).toBe('checkmate')
    expect(status(parseFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'))).toBe('stalemate')
    expect(status(parseFen('8/8/8/4k3/8/8/8/4K3 w - - 0 1'))).toBe('insufficient')
  })
})
