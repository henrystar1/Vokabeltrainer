import { useEffect, useRef, useState } from 'react'
import { Anchor, Bell, Cat, Cherry, Citrus, Clover, Crown, Fish, Flame, Gem, Heart, Leaf, Moon, Rocket, Sparkles, Star, Zap, type LucideIcon } from 'lucide-react'
import { MEMORY_LIVES, heartsAfterRound, isAvoidableMiss, makeDeck, pairsForLevel, type MemoryCard } from './memory'
import type { GameProps } from './SnakeGame'

const FACE: Record<string, { icon: LucideIcon; from: string; to: string }> = {
  cherry: { icon: Cherry, from: '#fb7185', to: '#be123c' },
  citrus: { icon: Citrus, from: '#fde047', to: '#ca8a04' },
  clover: { icon: Clover, from: '#4ade80', to: '#15803d' },
  bell: { icon: Bell, from: '#fbbf24', to: '#b45309' },
  gem: { icon: Gem, from: '#67e8f9', to: '#0e7490' },
  star: { icon: Star, from: '#fcd34d', to: '#d97706' },
  rocket: { icon: Rocket, from: '#c4b5fd', to: '#6d28d9' },
  moon: { icon: Moon, from: '#a5b4fc', to: '#4338ca' },
  flame: { icon: Flame, from: '#fdba74', to: '#c2410c' },
  heart: { icon: Heart, from: '#f9a8d4', to: '#be185d' },
  anchor: { icon: Anchor, from: '#7dd3fc', to: '#0369a1' },
  leaf: { icon: Leaf, from: '#bef264', to: '#4d7c0f' },
  crown: { icon: Crown, from: '#fde68a', to: '#a16207' },
  zap: { icon: Zap, from: '#f0abfc', to: '#a21caf' },
  cat: { icon: Cat, from: '#5eead4', to: '#0f766e' },
  fish: { icon: Fish, from: '#93c5fd', to: '#1d4ed8' },
}

const NAMES: Record<string, string> = { cherry: 'Kirsche', citrus: 'Zitrone', clover: 'Kleeblatt', bell: 'Glocke', gem: 'Edelstein', star: 'Stern', rocket: 'Rakete', moon: 'Mond', flame: 'Flamme', heart: 'Herz', anchor: 'Anker', leaf: 'Blatt', crown: 'Krone', zap: 'Blitz', cat: 'Katze', fish: 'Fisch' }

export default function MemoryGame({ onScore, onOver, plus }: GameProps) {
  const [level, setLevel] = useState(1)
  const [deck, setDeck] = useState<MemoryCard[]>(() => makeDeck(pairsForLevel(1)))
  const [open, setOpen] = useState<number[]>([])
  const [matched, setMatched] = useState<ReadonlySet<number>>(new Set())
  const [lives, setLives] = useState(MEMORY_LIVES)
  const [locked, setLocked] = useState(false)
  const [shake, setShake] = useState(false)
  const [bonus, setBonus] = useState(false)
  const seen = useRef<Set<number>>(new Set())
  const lostInRound = useRef(false)
  const livesRef = useRef(MEMORY_LIVES)
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
    const wasSeen = seen.current
    const avoidable = isAvoidableMiss(wasSeen, a, b)
    wasSeen.add(a)
    wasSeen.add(b)
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
          const hearts = heartsAfterRound(livesRef.current, lostInRound.current)
          if (hearts > livesRef.current) {
            setBonus(true)
            later(() => setBonus(false), 1400)
          }
          livesRef.current = hearts
          setLives(hearts)
          lostInRound.current = false
          seen.current = new Set()
          setLevel(nl)
          setDeck(makeDeck(pairsForLevel(nl)))
          setMatched(new Set())
        }
      }, 350)
    } else {
      later(() => {
        setOpen([])
        setLocked(false)
        if (!avoidable) return
        lostInRound.current = true
        setShake(true)
        later(() => setShake(false), 400)
        const nl = livesRef.current - 1
        livesRef.current = nl
        setLives(nl)
        if (nl <= 0 && !over.current) {
          over.current = true
          cb.current.onOver(score.current)
        }
      }, 800)
    }
  }

  const cols = deck.length <= 6 ? 3 : deck.length <= 12 ? 4 : 6
  return (
    <div className="flex flex-col items-center gap-4">
      <style>{`.mm-card{perspective:600px}.mm-in{position:relative;width:100%;height:100%;transition:transform .35s;transform-style:preserve-3d}.mm-in.on{transform:rotateY(180deg)}.mm-f,.mm-b{position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden;border-radius:0.75rem;display:flex;align-items:center;justify-content:center}.mm-b{transform:rotateY(180deg)}@keyframes mm-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}`}</style>
      <div className="flex w-full max-w-[420px] items-center justify-between text-sm text-slate-300">
        <span>Runde {level}</span>
        <span className={`flex items-center gap-1 ${shake ? '[animation:mm-shake_.4s]' : ''}`} aria-label={`${lives} Herzen übrig`}>
          {Array.from({ length: MEMORY_LIVES }, (_, k) => (
            <Heart key={k} size={20} className={k < lives ? 'fill-rose-500 text-rose-400 drop-shadow-[0_0_6px_rgb(244,63,94)]' : 'text-slate-600'} />
          ))}
        </span>
      </div>
      <div className="h-5 text-xs text-emerald-300">{bonus && <span className="inline-flex items-center gap-1"><Sparkles size={13} /> Fehlerfrei – ein Herz zurück!</span>}</div>
      <div className={`grid w-full max-w-[420px] gap-2 ${plus ? 'rounded-2xl p-2 shadow-glow' : ''}`} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {deck.map((c, i) => {
          const shown = open.includes(i) || matched.has(i)
          const f = FACE[c.symbol]
          const Icon = f.icon
          return (
            <button
              key={`${level}-${c.id}`}
              type="button"
              onClick={() => tap(i)}
              aria-label={shown ? NAMES[c.symbol] : 'Verdeckte Karte'}
              className="mm-card aspect-square select-none"
            >
              <span className={`mm-in ${shown ? 'on' : ''}`}>
                <span className="mm-f border border-white/15 bg-gradient-to-br from-indigo-500/40 via-space-700 to-fuchsia-500/30 shadow-inner">
                  <Sparkles size={18} className="text-white/40" />
                </span>
                <span
                  className={`mm-b border ${matched.has(i) ? 'border-emerald-300/70 shadow-[0_0_14px_rgb(52_211_153/0.6)]' : 'border-white/30'}`}
                  style={{ background: `linear-gradient(135deg, ${f.from}, ${f.to})` }}
                >
                  <Icon className="h-[52%] w-[52%] text-white drop-shadow-md" strokeWidth={2.2} />
                </span>
              </span>
            </button>
          )
        })}
      </div>
      <p className="max-w-[420px] text-center text-xs text-slate-500">Finde gleiche Paare. Jedes Paar = 1 Punkt. Ein Herz kostet nur ein vermeidbarer Fehler: wenn du eine Karte aufdeckst, die du schon gesehen hast. Eine fehlerfreie Runde bringt ein Herz zurück – mit gutem Gedächtnis geht es endlos weiter.</p>
    </div>
  )
}
