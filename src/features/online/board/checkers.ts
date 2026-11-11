/** Dame (deutsche Regeln, 8×8): Steine ziehen vorwärts, schlagen in alle vier Richtungen; Damen fliegen.
 *  Schlagzwang (freie Wahl unter den Schlagzügen), Mehrfachsprünge zählen als ein Zug.
 *  Weiß steht unten (Reihe 7) und beginnt. Brett: Index = Reihe * 8 + Spalte, dunkle Felder (r + c) ungerade. */

export type CColor = 'w' | 'b'
export interface CheckersState { board: string[]; turn: CColor }
export interface CheckersMove { path: number[]; captured: number[] }
export type CheckersStatus = 'ongoing' | 'win_w' | 'win_b'

export function startState(): CheckersState {
  const board = Array<string>(64).fill('')
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    if ((r + c) % 2 === 1) { if (r < 3) board[r * 8 + c] = 'b'; else if (r > 4) board[r * 8 + c] = 'w' }
  }
  return { board, turn: 'w' }
}

export const ownerOf = (p: string): CColor | null => (!p ? null : p.toLowerCase() === 'w' ? 'w' : 'b')
const isKing = (p: string) => p === 'W' || p === 'B'
const DIRS: Array<[number, number]> = [[-1, -1], [-1, 1], [1, -1], [1, 1]]
const inB = (r: number, c: number) => r >= 0 && r < 8 && c >= 0 && c < 8

function captureSeqs(board: string[], from: number, color: CColor): CheckersMove[] {
  const piece = board[from]
  const king = isKing(piece)
  const out: CheckersMove[] = []
  const walk = (pos: number, path: number[], captured: number[]) => {
    let extended = false
    const r = Math.floor(pos / 8); const c = pos % 8
    for (const [dr, dc] of DIRS) {
      let rr = r + dr; let cc = c + dc
      if (king) while (inB(rr, cc) && !board[rr * 8 + cc] && pos !== rr * 8 + cc) { rr += dr; cc += dc }
      if (!inB(rr, cc)) continue
      const mid = rr * 8 + cc
      const mp = board[mid]
      if (!mp || ownerOf(mp) === color || captured.includes(mid)) continue
      // Landefelder hinter dem geschlagenen Stein
      let lr = rr + dr; let lc = cc + dc
      while (inB(lr, lc)) {
        const li = lr * 8 + lc
        // eigenes Startfeld gilt als frei (Stein ist ja weg)
        const empty = !board[li] || li === from
        if (!empty) break
        extended = true
        walk(li, [...path, li], [...captured, mid])
        if (!king) break
        lr += dr; lc += dc
      }
    }
    if (!extended && captured.length > 0) out.push({ path, captured })
  }
  // Das Startfeld soll beim Weiterspringen als leer gelten: vorübergehend entfernen
  const saved = board[from]
  board[from] = ''
  const b2 = board
  const walkStart = () => {
    // walk liest board; from ist leer, daher ist „li === from" nicht mehr nötig, bleibt aber harmlos
    walk(from, [from], [])
  }
  walkStart()
  b2[from] = saved
  return out
}

function steps(board: string[], from: number): CheckersMove[] {
  const p = board[from]
  const color = ownerOf(p)!
  const out: CheckersMove[] = []
  const r = Math.floor(from / 8); const c = from % 8
  for (const [dr, dc] of DIRS) {
    if (!isKing(p) && dr !== (color === 'w' ? -1 : 1)) continue
    let rr = r + dr; let cc = c + dc
    while (inB(rr, cc) && !board[rr * 8 + cc]) {
      out.push({ path: [from, rr * 8 + cc], captured: [] })
      if (!isKing(p)) break
      rr += dr; cc += dc
    }
  }
  return out
}

export function legalMoves(s: CheckersState): CheckersMove[] {
  const mine: number[] = []
  s.board.forEach((p, i) => { if (ownerOf(p) === s.turn) mine.push(i) })
  const caps = mine.flatMap((i) => captureSeqs(s.board, i, s.turn))
  if (caps.length > 0) return caps
  return mine.flatMap((i) => steps(s.board, i))
}

export function applyMove(s: CheckersState, m: CheckersMove): CheckersState {
  const board = s.board.slice()
  const from = m.path[0]
  const to = m.path[m.path.length - 1]
  let piece = board[from]
  board[from] = ''
  for (const c of m.captured) board[c] = ''
  const lastRow = s.turn === 'w' ? 0 : 7
  if (!isKing(piece) && Math.floor(to / 8) === lastRow) piece = piece.toUpperCase()
  board[to] = piece
  return { board, turn: s.turn === 'w' ? 'b' : 'w' }
}

export function status(s: CheckersState): CheckersStatus {
  if (legalMoves(s).length === 0) return s.turn === 'w' ? 'win_b' : 'win_w'
  return 'ongoing'
}
