import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from 'lucide-react'
import { PadButton } from './controls'
import { canMove, move, newBoard, addTile, type Board, type Dir2048 } from './game2048'
import type { GameProps } from './SnakeGame'

const KEYS: Record<string, Dir2048> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right' }

const COLORS: Record<number, string> = {
  0: 'bg-white/5 text-transparent',
  2: 'bg-slate-200 text-slate-800',
  4: 'bg-amber-100 text-slate-800',
  8: 'bg-orange-300 text-white',
  16: 'bg-orange-400 text-white',
  32: 'bg-orange-500 text-white',
  64: 'bg-red-500 text-white',
  128: 'bg-yellow-300 text-slate-900',
  256: 'bg-yellow-400 text-slate-900',
  512: 'bg-lime-400 text-slate-900',
  1024: 'bg-emerald-400 text-slate-900',
  2048: 'bg-cyan-400 text-slate-900',
}

export default function Game2048({ onScore, onOver, plus }: GameProps) {
  const [board, setBoard] = useState<Board>(() => newBoard())
  const state = useRef({ board, score: 0, over: false })
  const cb = useRef({ onScore, onOver })
  cb.current = { onScore, onOver }
  const touch = useRef<{ x: number; y: number } | null>(null)

  function play(dir: Dir2048) {
    const s = state.current
    if (s.over) return
    const r = move(s.board, dir)
    if (!r.moved) return
    const next = addTile(r.board)
    s.board = next
    s.score += r.gained
    setBoard(next)
    if (r.gained > 0) cb.current.onScore(s.score)
    if (!canMove(next)) {
      s.over = true
      cb.current.onOver(s.score)
    }
  }
  const playRef = useRef(play)
  playRef.current = play

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const d = KEYS[e.key]
      if (!d) return
      e.preventDefault()
      playRef.current(d)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        className={`grid w-full max-w-[360px] touch-none select-none grid-cols-4 gap-2 rounded-2xl border border-white/10 bg-space-900/80 p-2 ${plus ? 'shadow-glow' : ''}`}
        onPointerDown={(e) => (touch.current = { x: e.clientX, y: e.clientY })}
        onPointerUp={(e) => {
          const t = touch.current
          touch.current = null
          if (!t) return
          const dx = e.clientX - t.x
          const dy = e.clientY - t.y
          if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return
          play(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up')
        }}
      >
        {board.flat().map((v, i) => (
          <div
            key={i}
            className={`flex aspect-square items-center justify-center rounded-xl font-bold transition-colors ${COLORS[v] ?? 'bg-fuchsia-400 text-white'} ${v >= 1024 ? 'text-xl' : v >= 128 ? 'text-2xl' : 'text-3xl'}`}
          >
            {v || ''}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <span />
        <PadButton label="Hoch" onPress={() => play('up')}><ArrowUp size={28} /></PadButton>
        <span />
        <PadButton label="Links" onPress={() => play('left')}><ArrowLeft size={28} /></PadButton>
        <PadButton label="Runter" onPress={() => play('down')}><ArrowDown size={28} /></PadButton>
        <PadButton label="Rechts" onPress={() => play('right')}><ArrowRight size={28} /></PadButton>
      </div>
      <p className="text-xs text-slate-500">Wischen, Pfeiltasten oder die Tasten: gleiche Zahlen verschmelzen. Punkte = Summe der Verschmelzungen.</p>
    </div>
  )
}
