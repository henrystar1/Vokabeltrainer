import { useEffect, useMemo, useRef, useState } from 'react'
import type { GameProps } from './SnakeGame'
import { BLAST_SIZE, canPlace, newBlast, place, shapeSize, type BlastState } from './blast'

const LIFT = 1.6
const TRAY_COLORS = ['#22d3ee', '#a78bfa', '#fb923c']

export default function BlastGame({ onScore, onOver }: GameProps) {
  const [s, setS] = useState<BlastState>(() => newBlast())
  const [drag, setDrag] = useState<{ i: number; x: number; y: number } | null>(null)
  const board = useRef<HTMLDivElement>(null)
  const cb = useRef({ onScore, onOver })
  cb.current = { onScore, onOver }
  const sRef = useRef(s)
  sRef.current = s
  const over = useRef(false)

  useEffect(() => {
    cb.current.onScore(s.score)
    if (s.over && !over.current) {
      over.current = true
      cb.current.onOver(s.score)
    }
  }, [s])

  /** Misst das echte Raster (inkl. Rand und Abstände) und rechnet den Finger auf Zellen um. */
  const geometry = (d: { i: number; x: number; y: number }) => {
    const cells = board.current?.children
    const shape = sRef.current.tray[d.i]
    if (!cells || cells.length < BLAST_SIZE * BLAST_SIZE || !shape) return null
    const first = cells[0].getBoundingClientRect()
    const last = cells[BLAST_SIZE * BLAST_SIZE - 1].getBoundingClientRect()
    const step = (last.left - first.left) / (BLAST_SIZE - 1)
    const cell = first.width
    const { w, h } = shapeSize(shape)
    // Das Teil schwebt etwas über dem Finger, damit man es sieht.
    const col = Math.round((d.x - first.left) / step - w / 2 + (step - cell) / (2 * step))
    const row = Math.round((d.y - LIFT * step - first.top) / step - h / 2 + (step - cell) / (2 * step))
    const inside = col > -w && row > -h && col < BLAST_SIZE && row < BLAST_SIZE
    // Über dem Feld rastet das Teil auf dem Raster ein – genau dort, wo auch das Grün/Rot erscheint.
    const px = inside ? first.left + col * step + (w * step - (step - cell)) / 2 : d.x
    const py = inside ? first.top + row * step + (h * step - (step - cell)) / 2 : d.y - LIFT * step
    return { cell, step, col, row, shape, px, py, inside }
  }

  useEffect(() => {
    if (!drag) return
    const move = (e: PointerEvent) => setDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY } : d))
    const up = (e: PointerEvent) => {
      const g = geometry({ ...drag, x: e.clientX, y: e.clientY })
      if (g && canPlace(sRef.current.grid, g.shape, g.col, g.row)) setS((cur) => place(cur, drag.i, g.col, g.row))
      setDrag(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', () => setDrag(null))
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.i])

  const preview = useMemo(() => {
    if (!drag) return null
    const g = geometry(drag)
    if (!g) return null
    const ok = canPlace(s.grid, g.shape, g.col, g.row)
    const set = new Set(g.shape.map(([x, y]) => `${g.col + x},${g.row + y}`))
    return { ok, set, cell: g.cell, shape: g.shape, px: g.px, py: g.py, inside: g.inside }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, s.grid])

  return (
    <div className="flex select-none flex-col items-center gap-5">
      <div ref={board} className="grid w-full max-w-[360px] touch-none gap-[3px] rounded-2xl border border-white/10 bg-space-900/80 p-2" style={{ gridTemplateColumns: `repeat(${BLAST_SIZE}, 1fr)` }}>
        {s.grid.flatMap((row, r) =>
          row.map((on, c) => {
            const hint = preview?.set.has(`${c},${r}`)
            return (
              <div
                key={`${r}-${c}`}
                className={`aspect-square rounded-md ${on ? 'bg-accent-cyan shadow-[0_0_8px_rgb(34_211_238/0.5)]' : 'bg-white/5'} ${hint ? (preview?.ok ? '!bg-emerald-400/60' : '!bg-rose-500/40') : ''}`}
              />
            )
          }),
        )}
      </div>

      <div className="flex w-full max-w-[360px] items-center justify-around gap-2">
        {s.tray.map((shape, i) => {
          if (!shape) return <div key={i} className="h-20 w-20" />
          const { w, h } = shapeSize(shape)
          const on = new Set(shape.map(([x, y]) => `${x},${y}`))
          const hidden = drag?.i === i
          return (
            <div
              key={i}
              onPointerDown={(e) => {
                e.preventDefault()
                setDrag({ i, x: e.clientX, y: e.clientY })
              }}
              className="flex h-24 w-24 cursor-grab touch-none items-center justify-center"
              style={{ opacity: hidden ? 0.25 : 1 }}
            >
              <div className="grid gap-[2px]" style={{ gridTemplateColumns: `repeat(${w}, 16px)`, gridTemplateRows: `repeat(${h}, 16px)` }}>
                {Array.from({ length: w * h }, (_, k) => {
                  const x = k % w
                  const y = Math.floor(k / w)
                  return <div key={k} className="rounded-[3px]" style={{ background: on.has(`${x},${y}`) ? TRAY_COLORS[i % 3] : 'transparent' }} />
                })}
              </div>
            </div>
          )
        })}
      </div>

      {drag && preview && (
        <div className="pointer-events-none fixed z-50" style={{ left: preview.px, top: preview.py, transform: 'translate(-50%, -50%)', opacity: preview.inside ? 0.6 : 1 }}>
          {(() => {
            const { w, h } = shapeSize(preview.shape)
            const on = new Set(preview.shape.map(([x, y]) => `${x},${y}`))
            return (
              <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${w}, ${preview.cell}px)`, gridTemplateRows: `repeat(${h}, ${preview.cell}px)` }}>
                {Array.from({ length: w * h }, (_, k) => (
                  <div key={k} className="rounded-md" style={{ background: on.has(`${k % w},${Math.floor(k / w)}`) ? TRAY_COLORS[drag.i % 3] : 'transparent' }} />
                ))}
              </div>
            )
          })()}
        </div>
      )}
      <p className="text-xs text-slate-500">Zieh die Teile aufs Feld. Volle Reihen und Spalten verschwinden.</p>
    </div>
  )
}
