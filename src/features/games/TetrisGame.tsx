import { useCallback, useEffect, useRef } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ChevronsDown, RotateCw } from 'lucide-react'
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

  const btn = (label: string, icon: React.ReactNode, fn: () => void) => (
    <button
      type="button"
      aria-label={label}
      onPointerDown={(e) => {
        e.preventDefault()
        fn()
      }}
      className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/15 bg-white/5 active:bg-white/15"
    >
      {icon}
    </button>
  )

  return (
    <div className="flex flex-col items-center gap-4">
      <canvas ref={canvas} width={COLS * PX} height={ROWS * PX} className="max-h-[62vh] w-auto max-w-full touch-none rounded-2xl border border-white/10" />
      <div className="flex gap-2 md:hidden">
        {btn('Links', <ArrowLeft />, () => act((s) => move(s, -1)))}
        {btn('Drehen', <RotateCw />, () => act(rotate))}
        {btn('Rechts', <ArrowRight />, () => act((s) => move(s, 1)))}
        {btn('Runter', <ArrowDown />, () => act((s) => tick(s)))}
        {btn('Fallen lassen', <ChevronsDown />, () => act((s) => hardDrop(s)))}
      </div>
      <p className="hidden text-xs text-slate-500 md:block">← → bewegen · ↑ drehen · ↓ schneller · Leertaste fallen lassen</p>
    </div>
  )
}
