import { useEffect, useRef, useState } from 'react'
import { MEMORY_LIVES, makeDeck, pairsForLevel, type MemoryCard } from './memory'
import type { GameProps } from './SnakeGame'

export default function MemoryGame({ onScore, onOver, plus }: GameProps) {
  const [level, setLevel] = useState(1)
  const [deck, setDeck] = useState<MemoryCard[]>(() => makeDeck(pairsForLevel(1)))
  const [open, setOpen] = useState<number[]>([])
  const [matched, setMatched] = useState<ReadonlySet<number>>(new Set())
  const [lives, setLives] = useState(MEMORY_LIVES)
  const [locked, setLocked] = useState(false)
  const score = useRef(0)
  const over = useRef(false)
  const cb = useRef({ onScore, onOver })
  cb.current = { onScore, onOver }
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), [])

  function later(fn: () => void, ms: number) {
    timers.current.push(window.setTimeout(fn, ms))
  }

  function tap(i: number) {
    if (locked || over.current || open.includes(i) || matched.has(i)) return
    const nextOpen = [...open, i]
    setOpen(nextOpen)
    if (nextOpen.length < 2) return
    setLocked(true)
    const [a, b] = nextOpen
    if (deck[a].symbol === deck[b].symbol) {
      later(() => {
        const m = new Set(matched).add(a).add(b)
        setMatched(m)
        setOpen([])
        setLocked(false)
        score.current += 1
        cb.current.onScore(score.current)
        if (m.size === deck.length) {
          const nl = level + 1
          setLevel(nl)
          setDeck(makeDeck(pairsForLevel(nl)))
          setMatched(new Set())
        }
      }, 350)
    } else {
      later(() => {
        setOpen([])
        setLocked(false)
        setLives((l) => {
          const nl = l - 1
          if (nl <= 0 && !over.current) {
            over.current = true
            cb.current.onOver(score.current)
          }
          return nl
        })
      }, 800)
    }
  }

  const cols = deck.length <= 6 ? 3 : deck.length <= 12 ? 4 : 6
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex w-full max-w-[420px] items-center justify-between text-sm text-slate-300">
        <span>Runde {level}</span>
        <span aria-label={`${lives} Fehlversuche übrig`}>{'❤️'.repeat(Math.max(lives, 0))}{'🖤'.repeat(Math.max(MEMORY_LIVES - lives, 0))}</span>
      </div>
      <div className={`grid w-full max-w-[420px] gap-2 ${plus ? 'rounded-2xl p-2 shadow-glow' : ''}`} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {deck.map((c, i) => {
          const shown = open.includes(i) || matched.has(i)
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => tap(i)}
              aria-label={shown ? c.symbol : 'Verdeckte Karte'}
              className={`flex aspect-square select-none items-center justify-center rounded-xl border text-3xl transition ${
                matched.has(i) ? 'border-emerald-400/40 bg-emerald-400/15' : shown ? 'border-accent-cyan/50 bg-white/10' : 'border-white/10 bg-space-700 hover:bg-space-600'
              }`}
            >
              {shown ? c.symbol : '?'}
            </button>
          )
        })}
      </div>
      <p className="text-xs text-slate-500">Finde gleiche Paare. Jedes Paar = 1 Punkt. Falsche Paare kosten ein Herz.</p>
    </div>
  )
}
