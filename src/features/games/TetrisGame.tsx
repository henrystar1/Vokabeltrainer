import { useCallback, useEffect, useRef } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ChevronsDown, RotateCw } from 'lucide-react'
import { PadButton } from './controls'
import type { GameProps } from './SnakeGame'
import { COLS, ROWS, TYPES, cells, ghost, hardDrop, move, newTetris, rotate, tetrisDelay, tick, type TetrisState } from './tetris'

const PX = 24
const COLORS = ['', '#22d3ee', '#fbbf24', '#a78bfa', '#4ade80', '#f87171', '#60a5fa', '#fb923c']

export default function TetrisGame({ onScore, onOver }: GameProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const state = useRef<TetrisState>(newTetris())
  const cb = useRef({ onScore, onOver })
  cb.current = { onScore, onOver }
  const timer = useRef(0)
  const done = useRef(false)

  const draw = useCallback(() => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx) return
    const s = state.current
    ctx.fillStyle = '#080c1a'
    ctx.fillRect(0, 0, COLS * PX, ROWS * PX)
    ctx.strokeStyle = 'rgba(148,163,184,0.06)'
    for (let x = 1; x < COLS; x++) { ctx.beginPath(); ctx.moveTo(x * PX, 0); ctx.lineTo(x * PX, ROWS * PX); ctx.stroke() }
    for (let y = 1; y < ROWS; y++) { ctx.beginPath(); ctx.moveTo(0, y * PX); ctx.lineTo(COLS * PX, y * PX); ctx.stroke() }
    const block = (x: number, y: number, color: string, alpha = 1) => {
      ctx.globalAlpha = alpha
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.roundRect(x * PX + 1, y * PX + 1, PX - 2, PX - 2, 4)
      ctx.fill()
      ctx.globalAlpha = 1
    }
    s.board.forEach((row, y) => row.forEach((v, x) => v && block(x, y, COLORS[v])))
    if (!s.over) {
      const g = ghost(s)
      for (const [cx, cy] of cells(g.type, g.rot)) if (g.y + cy >= 0) block(g.x + cx, g.y + cy, COLORS[TYPES.indexOf(g.type) + 1], 0.22)
      for (const [cx, cy] of cells(s.piece.type, s.piece.rot)) if (s.piece.y + cy >= 0) block(s.piece.x + cx, s.piece.y + cy, COLORS[TYPES.indexOf(s.piece.type) + 1])
    }
  }, [])

  const after = useCallback(() => {
    draw()
    cb.current.onScore(state.current.score)
    if (state.current.over && !done.current) {
      done.current = true
      window.clearTimeout(timer.current)
      cb.current.onOver(state.current.score)
    }
  }, [draw])

  const act = useCallback((fn: (s: TetrisState) => TetrisState) => {
    if (done.current) return
    state.current = fn(state.current)
    after()
  }, [after])

  useEffect(() => {
    const loop = () => {
      if (done.current) return
      state.current = tick(state.current)
      after()
      if (!done.current) timer.current = window.setTimeout(loop, tetrisDelay(state.current.lines))
    }
    draw()
    timer.current = window.setTimeout(loop, 1200)
    return () => {
      done.current = true
      window.clearTimeout(timer.current)
    }
  }, [after, draw])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key
      if (k === 'ArrowLeft' || k === 'a') act((s) => move(s, -1))
      else if (k === 'ArrowRight' || k === 'd') act((s) => move(s, 1))
      else if (k === 'ArrowUp' || k === 'w' || k === 'x') act(rotate)
      else if (k === 'ArrowDown' || k === 's') act((s) => tick(s))
      else if (k === ' ') act((s) => hardDrop(s))
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [act])

  return (
    <div className="flex flex-col items-center gap-4">
      <canvas ref={canvas} width={COLS * PX} height={ROWS * PX} className="max-h-[52vh] w-auto max-w-full touch-none rounded-2xl border border-white/10" />
      <div className="flex w-full max-w-[420px] items-center justify-between gap-2">
        <PadButton label="Links" size="lg" repeat onPress={() => act((st) => move(st, -1))}><ArrowLeft size={36} /></PadButton>
        <div className="flex flex-col items-center gap-2">
          <div className="flex gap-2">
            <PadButton label="Drehen" onPress={() => act(rotate)}><RotateCw size={26} /></PadButton>
            <PadButton label="Fallen lassen" onPress={() => act((st) => hardDrop(st))}><ChevronsDown size={26} /></PadButton>
          </div>
          <PadButton label="Runter" repeat onPress={() => act((st) => tick(st))}><ArrowDown size={26} /></PadButton>
        </div>
        <PadButton label="Rechts" size="lg" repeat onPress={() => act((st) => move(st, 1))}><ArrowRight size={36} /></PadButton>
      </div>
      <p className="text-xs text-slate-500">← → bewegen · ↑ drehen · ↓ schneller · Leertaste fallen lassen</p>
    </div>
  )
}
