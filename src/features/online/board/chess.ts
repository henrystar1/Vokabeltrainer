/** Schach: reine Regel-Logik (Zuggenerator, Schach/Matt/Patt, Rochade, en passant, Umwandlung). Brett: Index 0 = a8, 63 = h1. */

export type Color = 'w' | 'b'
export interface ChessState {
  board: string[] // 64 Felder, '' leer; Großbuchstaben = Weiß, Kleinbuchstaben = Schwarz
  turn: Color
  castle: { K: boolean; Q: boolean; k: boolean; q: boolean }
  ep: number | null // Zielfeld für en passant
  half: number // Halbzüge seit Bauernzug/Schlag
  full: number
}
export interface ChessMove { from: number; to: number; promo?: 'Q' | 'R' | 'B' | 'N'; ep?: boolean; castle?: 'K' | 'Q' }
export type ChessStatus = 'ongoing' | 'check' | 'checkmate' | 'stalemate' | 'draw50' | 'insufficient'

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

export function parseFen(fen: string): ChessState {
  const [pos, turn, cas, ep, half, full] = fen.split(' ')
  const board: string[] = []
  for (const row of pos.split('/')) for (const ch of row) { if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) board.push(''); else board.push(ch) }
  return {
    board, turn: turn === 'b' ? 'b' : 'w',
    castle: { K: cas.includes('K'), Q: cas.includes('Q'), k: cas.includes('k'), q: cas.includes('q') },
    ep: ep && ep !== '-' ? (8 - Number(ep[1])) * 8 + (ep.charCodeAt(0) - 97) : null,
    half: Number(half ?? 0), full: Number(full ?? 1),
  }
}

export function toFen(s: ChessState): string {
  const rows: string[] = []
  for (let r = 0; r < 8; r++) {
    let row = ''; let n = 0
    for (let c = 0; c < 8; c++) { const p = s.board[r * 8 + c]; if (!p) n++; else { if (n) row += n; n = 0; row += p } }
    rows.push(row + (n ? n : ''))
  }
  const cas = (s.castle.K ? 'K' : '') + (s.castle.Q ? 'Q' : '') + (s.castle.k ? 'k' : '') + (s.castle.q ? 'q' : '') || '-'
  const ep = s.ep === null ? '-' : String.fromCharCode(97 + (s.ep % 8)) + (8 - Math.floor(s.ep / 8))
  return `${rows.join('/')} ${s.turn} ${cas} ${ep} ${s.half} ${s.full}`
}

export const colorOf = (p: string): Color | null => (!p ? null : p === p.toUpperCase() ? 'w' : 'b')
const sq = (r: number, c: number) => r * 8 + c
const KN: Array<[number, number]> = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]
const DIAG: Array<[number, number]> = [[-1, -1], [-1, 1], [1, -1], [1, 1]]
const ORTH: Array<[number, number]> = [[-1, 0], [1, 0], [0, -1], [0, 1]]

/** Wird das Feld `idx` von Farbe `by` angegriffen? */
export function attacked(board: string[], idx: number, by: Color): boolean {
  const r = Math.floor(idx / 8); const c = idx % 8
  const own = (p: string, t: string) => p === (by === 'w' ? t.toUpperCase() : t.toLowerCase())
  const pr = by === 'w' ? r + 1 : r - 1
  for (const dc of [-1, 1]) { const cc = c + dc; if (pr >= 0 && pr < 8 && cc >= 0 && cc < 8 && own(board[sq(pr, cc)], 'p')) return true }
  for (const [dr, dc] of KN) { const rr = r + dr; const cc = c + dc; if (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && own(board[sq(rr, cc)], 'n')) return true }
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue
    const rr = r + dr; const cc = c + dc
    if (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && own(board[sq(rr, cc)], 'k')) return true
  }
  const ray = (dirs: Array<[number, number]>, kinds: string[]) => {
    for (const [dr, dc] of dirs) {
      let rr = r + dr; let cc = c + dc
      while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
        const p = board[sq(rr, cc)]
        if (p) { if (kinds.some((k) => own(p, k))) return true; break }
        rr += dr; cc += dc
      }
    }
    return false
  }
  return ray(DIAG, ['b', 'q']) || ray(ORTH, ['r', 'q'])
}

const kingIdx = (board: string[], color: Color) => board.indexOf(color === 'w' ? 'K' : 'k')
export const inCheck = (s: ChessState, color: Color = s.turn) => { const k = kingIdx(s.board, color); return k >= 0 && attacked(s.board, k, color === 'w' ? 'b' : 'w') }

function pseudoMoves(s: ChessState): ChessMove[] {
  const out: ChessMove[] = []
  const me = s.turn
  const enemy: Color = me === 'w' ? 'b' : 'w'
  for (let i = 0; i < 64; i++) {
    const p = s.board[i]
    if (!p || colorOf(p) !== me) continue
    const r = Math.floor(i / 8); const c = i % 8
    const t = p.toLowerCase()
    const push = (to: number, extra: Partial<ChessMove> = {}) => out.push({ from: i, to, ...extra })
    if (t === 'p') {
      const dir = me === 'w' ? -1 : 1
      const start = me === 'w' ? 6 : 1
      const last = me === 'w' ? 0 : 7
      const addPawn = (to: number, extra: Partial<ChessMove> = {}) => {
        if (Math.floor(to / 8) === last) for (const promo of ['Q', 'R', 'B', 'N'] as const) push(to, { ...extra, promo }); else push(to, extra)
      }
      const f = sq(r + dir, c)
      if (r + dir >= 0 && r + dir < 8 && !s.board[f]) {
        addPawn(f)
        if (r === start && !s.board[sq(r + 2 * dir, c)]) push(sq(r + 2 * dir, c))
      }
      for (const dc of [-1, 1]) {
        const cc = c + dc
        if (cc < 0 || cc > 7 || r + dir < 0 || r + dir > 7) continue
        const to = sq(r + dir, cc)
        if (s.board[to] && colorOf(s.board[to]) === enemy) addPawn(to)
        else if (s.ep === to) push(to, { ep: true })
      }
    } else if (t === 'n' || t === 'k') {
      const steps: Array<[number, number]> = t === 'n' ? KN : [...DIAG, ...ORTH]
      for (const [dr, dc] of steps) {
        const rr = r + dr; const cc = c + dc
        if (rr < 0 || rr > 7 || cc < 0 || cc > 7) continue
        const to = sq(rr, cc)
        if (colorOf(s.board[to]) !== me) push(to)
      }
      if (t === 'k') {
        const home = me === 'w' ? 60 : 4
        if (i === home && !inCheck(s, me)) {
          const rook = me === 'w' ? 'R' : 'r'
          const ks = me === 'w' ? s.castle.K : s.castle.k
          const qs = me === 'w' ? s.castle.Q : s.castle.q
          if (ks && s.board[home + 3] === rook && !s.board[home + 1] && !s.board[home + 2] && !attacked(s.board, home + 1, enemy) && !attacked(s.board, home + 2, enemy)) push(home + 2, { castle: 'K' })
          if (qs && s.board[home - 4] === rook && !s.board[home - 1] && !s.board[home - 2] && !s.board[home - 3] && !attacked(s.board, home - 1, enemy) && !attacked(s.board, home - 2, enemy)) push(home - 2, { castle: 'Q' })
        }
      }
    } else {
      const dirs = t === 'b' ? DIAG : t === 'r' ? ORTH : [...DIAG, ...ORTH]
      for (const [dr, dc] of dirs) {
        let rr = r + dr; let cc = c + dc
        while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
          const to = sq(rr, cc)
          const q = s.board[to]
          if (!q) push(to)
          else { if (colorOf(q) !== me) push(to); break }
          rr += dr; cc += dc
        }
      }
    }
  }
  return out
}

/** Zug ausführen (ohne Prüfung der Legalität). */
export function applyMove(s: ChessState, m: ChessMove): ChessState {
  const board = s.board.slice()
  const piece = board[m.from]
  const target = board[m.to]
  const me = s.turn
  board[m.to] = m.promo ? (me === 'w' ? m.promo : m.promo.toLowerCase()) : piece
  board[m.from] = ''
  if (m.ep) board[m.to + (me === 'w' ? 8 : -8)] = ''
  if (m.castle === 'K') { board[m.to - 1] = board[m.to + 1]; board[m.to + 1] = '' }
  if (m.castle === 'Q') { board[m.to + 1] = board[m.to - 2]; board[m.to - 2] = '' }
  const castle = { ...s.castle }
  const touch = (i: number) => {
    if (i === 60) { castle.K = false; castle.Q = false }
    if (i === 4) { castle.k = false; castle.q = false }
    if (i === 63) castle.K = false
    if (i === 56) castle.Q = false
    if (i === 7) castle.k = false
    if (i === 0) castle.q = false
  }
  touch(m.from); touch(m.to)
  const isPawn = piece.toLowerCase() === 'p'
  const ep = isPawn && Math.abs(m.to - m.from) === 16 ? (m.from + m.to) / 2 : null
  return { board, turn: me === 'w' ? 'b' : 'w', castle, ep, half: isPawn || target || m.ep ? 0 : s.half + 1, full: s.full + (me === 'b' ? 1 : 0) }
}

export function legalMoves(s: ChessState): ChessMove[] {
  return pseudoMoves(s).filter((m) => !inCheck(applyMove(s, m), s.turn))
}

function insufficient(board: string[]): boolean {
  const rest = board.filter((p) => p && p.toLowerCase() !== 'k')
  if (rest.length === 0) return true
  if (rest.length === 1 && ['b', 'n'].includes(rest[0].toLowerCase())) return true
  return false
}

export function status(s: ChessState): ChessStatus {
  const moves = legalMoves(s)
  const chk = inCheck(s)
  if (moves.length === 0) return chk ? 'checkmate' : 'stalemate'
  if (insufficient(s.board)) return 'insufficient'
  if (s.half >= 100) return 'draw50'
  return chk ? 'check' : 'ongoing'
}

export function perft(s: ChessState, depth: number): number {
  if (depth === 0) return 1
  const moves = legalMoves(s)
  if (depth === 1) return moves.length
  let n = 0
  for (const m of moves) n += perft(applyMove(s, m), depth - 1)
  return n
}

export const sqName = (i: number) => String.fromCharCode(97 + (i % 8)) + (8 - Math.floor(i / 8))
