import { useMemo, useState } from 'react'
import type { OgView } from '../../../services/online'
import * as chess from './chess'
import * as dame from './checkers'

export interface BoardState { fen?: string; board?: string[]; turn?: string; last?: number[]; moves?: number; draw_offer?: number | null }
const st = (v: OgView) => v.state as unknown as BoardState

const GLYPH: Record<string, string> = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' }

interface Common { view: OgView; busy: boolean; onMove: (state: Record<string, unknown>, result: 'ongoing' | 'win' | 'draw') => void; onDraw: (a: 'offer' | 'accept' | 'decline' | 'withdraw') => void; readOnly?: boolean }

function DrawBar({ view, busy, onDraw, text }: { view: OgView; busy: boolean; onDraw: Common['onDraw']; text: string }) {
  const offer = st(view).draw_offer
  const mine = view.me.seat
  if (view.status !== 'running' || mine === null) return <p className="text-center text-sm text-slate-300" aria-live="polite">{text}</p>
  return (
    <div className="space-y-2 text-center">
      <p className="text-sm text-slate-300" aria-live="polite">{text}</p>
      {offer === null || offer === undefined ? (
        <button type="button" disabled={busy} onClick={() => onDraw('offer')} className="min-h-[40px] rounded-lg border border-white/15 px-3 text-sm text-slate-200 hover:bg-white/10">Remis anbieten</button>
      ) : offer === mine ? (
        <button type="button" disabled={busy} onClick={() => onDraw('withdraw')} className="min-h-[40px] rounded-lg border border-white/15 px-3 text-sm text-slate-300 hover:bg-white/10">Remis-Angebot zurückziehen</button>
      ) : (
        <div className="inline-flex flex-wrap items-center justify-center gap-2 rounded-xl border border-amber-300/40 bg-amber-300/10 p-2 text-sm">
          Remis-Angebot vom Gegner
          <button type="button" disabled={busy} onClick={() => onDraw('accept')} className="min-h-[36px] rounded-lg bg-emerald-500 px-3 font-semibold text-slate-950">Annehmen</button>
          <button type="button" disabled={busy} onClick={() => onDraw('decline')} className="min-h-[36px] rounded-lg border border-white/20 px-3">Ablehnen</button>
        </div>
      )}
    </div>
  )
}

/** Nur-Lese-Brett (für Zuschauer): Schach. */
export function ChessSquares({ fen, last, flip, selected, targets, onPick, check }: { fen: string; last?: number[]; flip?: boolean; selected?: number | null; targets?: Set<number>; onPick?: (i: number) => void; check?: number | null }) {
  const s = useMemo(() => chess.parseFen(fen), [fen])
  const order = Array.from({ length: 64 }, (_, k) => (flip ? 63 - k : k))
  return (
    <div className="mx-auto grid w-full max-w-[480px] grid-cols-8 overflow-hidden rounded-xl border border-white/15" role="grid" aria-label="Schachbrett">
      {order.map((i) => {
        const r = Math.floor(i / 8); const c = i % 8
        const p = s.board[i]
        const dark = (r + c) % 2 === 1
        const isLast = last?.includes(i)
        return (
          <button key={i} type="button" role="gridcell" disabled={!onPick} onClick={() => onPick?.(i)} aria-label={`${chess.sqName(i)}${p ? ' ' + p : ''}`}
            className={`relative flex aspect-square items-center justify-center text-[clamp(1.4rem,6.5vw,2.6rem)] leading-none ${dark ? 'bg-emerald-800/80' : 'bg-amber-100/80'} ${isLast ? 'ring-2 ring-inset ring-yellow-300' : ''} ${selected === i ? 'ring-4 ring-inset ring-sky-400' : ''} ${check === i ? 'bg-rose-500/80' : ''}`}>
            {p && <span style={{ color: p === p.toUpperCase() ? '#fff' : '#0f172a', textShadow: p === p.toUpperCase() ? '0 0 2px #000, 0 0 3px #000' : '0 0 2px #fff' }}>{GLYPH[p.toLowerCase()]}</span>}
            {targets?.has(i) && <span className="absolute h-1/3 w-1/3 rounded-full bg-sky-400/70" />}
          </button>
        )
      })}
    </div>
  )
}

export function ChessBoard({ view, busy, onMove, onDraw, readOnly }: Common) {
  const fen = st(view).fen ?? chess.START_FEN
  const s = useMemo(() => chess.parseFen(fen), [fen])
  const seat = view.me.seat
  const myColor = seat === 0 ? 'w' : 'b'
  const myTurn = !readOnly && view.status === 'running' && seat !== null && view.turn_seat === seat
  const [sel, setSel] = useState<number | null>(null)
  const [promo, setPromo] = useState<chess.ChessMove[] | null>(null)
  const legal = useMemo(() => chess.legalMoves(s), [s])
  const targets = useMemo(() => new Set(legal.filter((m) => m.from === sel).map((m) => m.to)), [legal, sel])
  const stat = chess.status(s)
  const kingIdx = stat === 'check' || stat === 'checkmate' ? s.board.indexOf(s.turn === 'w' ? 'K' : 'k') : null

  function submit(m: chess.ChessMove) {
    const next = chess.applyMove(s, m)
    const res = chess.status(next)
    const result = res === 'checkmate' ? 'win' : res === 'stalemate' || res === 'insufficient' || res === 'draw50' ? 'draw' : 'ongoing'
    setSel(null); setPromo(null)
    onMove({ fen: chess.toFen(next), last: [m.from, m.to] }, result)
  }
  function pick(i: number) {
    if (!myTurn || busy) return
    if (sel !== null && targets.has(i)) {
      const ms = legal.filter((m) => m.from === sel && m.to === i)
      if (ms.length > 1) { setPromo(ms); return }
      submit(ms[0]); return
    }
    setSel(s.board[i] && chess.colorOf(s.board[i]) === myColor && legal.some((m) => m.from === i) ? i : null)
  }
  const name = (c: 'w' | 'b') => view.players.find((p) => p.seat === (c === 'w' ? 0 : 1))?.name ?? (c === 'w' ? 'Weiß' : 'Schwarz')
  const text = view.status === 'finished'
    ? (stat === 'checkmate' ? `Schachmatt – ${name(s.turn === 'w' ? 'b' : 'w')} gewinnt.` : stat === 'stalemate' ? 'Patt – Unentschieden.' : 'Das Spiel ist beendet.')
    : `${name(s.turn)} (${s.turn === 'w' ? 'Weiß' : 'Schwarz'}) ist am Zug${stat === 'check' ? ' – Schach!' : ''}${myTurn ? ' – das bist du.' : '.'}`
  return (
    <div className="space-y-3">
      <ChessSquares fen={fen} last={st(view).last} flip={myColor === 'b' && !readOnly} selected={sel} targets={targets} onPick={myTurn ? pick : undefined} check={kingIdx} />
      {promo && (
        <div className="flex flex-wrap items-center justify-center gap-2 text-sm">Umwandeln in:
          {promo.map((m) => <button key={m.promo} type="button" onClick={() => submit(m)} className="min-h-[44px] min-w-[44px] rounded-lg border border-white/20 text-2xl hover:bg-white/10" aria-label={`Umwandeln in ${m.promo}`}>{GLYPH[m.promo!.toLowerCase()]}</button>)}
        </div>
      )}
      <DrawBar view={view} busy={busy} onDraw={onDraw} text={text} />
    </div>
  )
}

export function CheckersSquares({ board, last, flip, selected, targets, onPick }: { board: string[]; last?: number[]; flip?: boolean; selected?: number | null; targets?: Set<number>; onPick?: (i: number) => void }) {
  const order = Array.from({ length: 64 }, (_, k) => (flip ? 63 - k : k))
  return (
    <div className="mx-auto grid w-full max-w-[480px] grid-cols-8 overflow-hidden rounded-xl border border-white/15" role="grid" aria-label="Damebrett">
      {order.map((i) => {
        const r = Math.floor(i / 8); const c = i % 8
        const p = board[i]
        const dark = (r + c) % 2 === 1
        return (
          <button key={i} type="button" role="gridcell" disabled={!onPick || !dark} onClick={() => onPick?.(i)}
            className={`relative flex aspect-square items-center justify-center ${dark ? 'bg-stone-700' : 'bg-amber-100/80'} ${last?.includes(i) ? 'ring-2 ring-inset ring-yellow-300' : ''} ${selected === i ? 'ring-4 ring-inset ring-sky-400' : ''}`}
            aria-label={p ? `${p === p.toLowerCase() ? 'Stein' : 'Dame'} ${p.toLowerCase() === 'w' ? 'weiß' : 'schwarz'}` : undefined}>
            {p && (
              <span className={`flex h-[78%] w-[78%] items-center justify-center rounded-full border-2 text-[clamp(.8rem,3.5vw,1.4rem)] shadow ${p.toLowerCase() === 'w' ? 'border-slate-300 bg-slate-100 text-amber-600' : 'border-slate-950 bg-slate-900 text-amber-300'}`}>{p === p.toUpperCase() ? '♛' : ''}</span>
            )}
            {targets?.has(i) && <span className="absolute h-1/3 w-1/3 rounded-full bg-sky-400/70" />}
          </button>
        )
      })}
    </div>
  )
}

export function CheckersBoard({ view, busy, onMove, onDraw, readOnly }: Common) {
  const board = st(view).board ?? dame.startState().board
  const turn: dame.CColor = (st(view).turn as dame.CColor | undefined) ?? 'w'
  const s: dame.CheckersState = useMemo(() => ({ board, turn }), [board, turn])
  const seat = view.me.seat
  const myTurn = !readOnly && view.status === 'running' && seat !== null && view.turn_seat === seat
  const [sel, setSel] = useState<number | null>(null)
  const legal = useMemo(() => dame.legalMoves(s), [s])
  const mustCapture = legal.some((m) => m.captured.length > 0)
  const targets = useMemo(() => new Set(legal.filter((m) => m.path[0] === sel).map((m) => m.path[m.path.length - 1])), [legal, sel])
  const movable = useMemo(() => new Set(legal.map((m) => m.path[0])), [legal])
  function pick(i: number) {
    if (!myTurn || busy) return
    if (sel !== null && targets.has(i)) {
      const m = legal.filter((x) => x.path[0] === sel && x.path[x.path.length - 1] === i).sort((a, b) => b.captured.length - a.captured.length)[0]
      const next = dame.applyMove(s, m)
      const res = dame.status(next)
      setSel(null)
      onMove({ board: next.board, turn: next.turn, last: m.path }, res === 'ongoing' ? 'ongoing' : 'win')
      return
    }
    setSel(movable.has(i) ? i : null)
  }
  const name = (c: dame.CColor) => view.players.find((p) => p.seat === (c === 'w' ? 0 : 1))?.name ?? (c === 'w' ? 'Weiß' : 'Schwarz')
  const text = view.status === 'finished' ? 'Das Spiel ist beendet.'
    : `${name(turn)} (${turn === 'w' ? 'Weiß' : 'Schwarz'}) ist am Zug${myTurn ? ' – das bist du' : ''}.${myTurn && mustCapture ? ' Schlagzwang!' : ''}`
  return (
    <div className="space-y-3">
      <CheckersSquares board={board} last={st(view).last} flip={seat === 1 && !readOnly} selected={sel} targets={targets} onPick={myTurn ? pick : undefined} />
      <DrawBar view={view} busy={busy} onDraw={onDraw} text={text} />
    </div>
  )
}
