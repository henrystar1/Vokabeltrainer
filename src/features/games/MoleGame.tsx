import { useEffect, useRef, useState } from 'react'
import { Heart } from 'lucide-react'
import { MOLE_HOLES, MOLE_LIVES, MOLE_MAX_LIVES, MOLE_STREAK_HEAL, freeHole, moleGap, moleMaxUp, molePoints, moleUpTime, pickKind, type MoleKind } from './mole'
import type { GameProps } from './SnakeGame'

interface Up { id: number; kind: MoleKind }

function MoleSvg({ kind }: { kind: MoleKind }) {
  if (kind === 'bomb') {
    return (
      <svg viewBox="0 0 80 80" className="h-full w-full" aria-hidden>
        <defs><radialGradient id="mb" cx="35%" cy="30%"><stop offset="0" stopColor="#64748b" /><stop offset="1" stopColor="#0f172a" /></radialGradient></defs>
        <path d="M46 16 q8 -8 16 -2" stroke="#a16207" strokeWidth="4" fill="none" strokeLinecap="round" />
        <circle cx="64" cy="13" r="5" fill="#fbbf24"><animate attributeName="r" values="4;7;4" dur="0.5s" repeatCount="indefinite" /></circle>
        <circle cx="40" cy="46" r="26" fill="url(#mb)" stroke="#020617" strokeWidth="2" />
        <ellipse cx="31" cy="36" rx="7" ry="4" fill="#fff" opacity=".25" />
        <path d="M30 52 l6 -6 m0 6 l-6 -6 M44 52 l6 -6 m0 6 l-6 -6" stroke="#f43f5e" strokeWidth="3" strokeLinecap="round" />
      </svg>
    )
  }
  const gold = kind === 'golden'
  const body = gold ? ['#fde68a', '#d97706'] : ['#a8815a', '#5b4026']
  return (
    <svg viewBox="0 0 80 80" className="h-full w-full" aria-hidden>
      <defs>
        <linearGradient id={`mg${gold ? 'g' : 'n'}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={body[0]} /><stop offset="1" stopColor={body[1]} /></linearGradient>
      </defs>
      <ellipse cx="40" cy="52" rx="28" ry="30" fill={`url(#mg${gold ? 'g' : 'n'})`} stroke={gold ? '#92400e' : '#2e1f10'} strokeWidth="2.5" />
      <ellipse cx="40" cy="60" rx="16" ry="14" fill={gold ? '#fff7d6' : '#d9c3a0'} opacity=".85" />
      <circle cx="29" cy="42" r="6" fill="#fff" /><circle cx="51" cy="42" r="6" fill="#fff" />
      <circle cx="30" cy="43" r="3" fill="#0f172a" /><circle cx="50" cy="43" r="3" fill="#0f172a" />
      <ellipse cx="40" cy="54" rx="7" ry="5" fill="#f472b6" stroke="#9d174d" strokeWidth="1.5" />
      <path d="M33 62 q7 6 14 0" stroke="#3f2a14" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <path d="M33 56 l-8 -2 M33 58 l-9 3 M47 56 l8 -2 M47 58 l9 3" stroke="#3f2a14" strokeWidth="1.5" strokeLinecap="round" />
      {gold && <path d="M26 24 l5 8 l9 -12 l9 12 l5 -8 l-3 14 h-22z" fill="#fbbf24" stroke="#92400e" strokeWidth="2" strokeLinejoin="round" />}
    </svg>
  )
}

export default function MoleGame({ onScore, onOver, plus }: GameProps) {
  const [ups, setUps] = useState<Record<number, Up>>({})
  const [burst, setBurst] = useState<Record<number, 'hit' | 'bomb' | 'miss'>>({})
  const [lives, setLives] = useState(MOLE_LIVES)
  const [streak, setStreak] = useState(0)
  const [score, setScoreState] = useState(0)
  const st = useRef({ score: 0, lives: MOLE_LIVES, streak: 0, over: false, ups: {} as Record<number, Up>, id: 0 })
  const timers = useRef<number[]>([])
  const cb = useRef({ onScore, onOver })
  cb.current = { onScore, onOver }

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms))
  }
  const sync = () => setUps({ ...st.current.ups })
  const flash = (hole: number, kind: 'hit' | 'bomb' | 'miss') => {
    setBurst((b) => ({ ...b, [hole]: kind }))
    later(() => setBurst((b) => { const n = { ...b }; delete n[hole]; return n }), 380)
  }
  function loseLife() {
    const s = st.current
    s.lives -= 1
    s.streak = 0
    setLives(s.lives)
    setStreak(0)
    if (s.lives <= 0 && !s.over) {
      s.over = true
      setUps({})
      cb.current.onOver(s.score)
    }
  }

  useEffect(() => {
    const s = st.current
    const spawn = () => {
      if (s.over) return
      const taken = new Set(Object.keys(s.ups).map(Number))
      if (taken.size < moleMaxUp(s.score)) {
        const hole = freeHole(taken)
        if (hole !== null) {
          const kind = pickKind(s.score)
          const id = ++s.id
          s.ups[hole] = { id, kind }
          sync()
          later(() => {
            const cur = s.ups[hole]
            if (!cur || cur.id !== id || s.over) return
            delete s.ups[hole]
            sync()
            if (kind === 'normal') {
              flash(hole, 'miss')
              loseLife()
            }
          }, moleUpTime(s.score))
        }
      }
      later(spawn, moleGap(s.score) * (0.8 + Math.random() * 0.5))
    }
    later(spawn, 700)
    return () => {
      s.over = true
      timers.current.forEach((t) => window.clearTimeout(t))
    }
  }, [])

  function whack(hole: number) {
    const s = st.current
    const m = s.ups[hole]
    if (s.over || !m) return
    delete s.ups[hole]
    sync()
    if (m.kind === 'bomb') {
      flash(hole, 'bomb')
      loseLife()
      return
    }
    flash(hole, 'hit')
    s.score += molePoints(m.kind)
    setScoreState(s.score)
    cb.current.onScore(s.score)
    if (m.kind === 'normal') {
      s.streak += 1
      if (s.streak >= MOLE_STREAK_HEAL) {
        s.streak = 0
        if (s.lives < MOLE_MAX_LIVES) {
          s.lives += 1
          setLives(s.lives)
        }
      }
      setStreak(s.streak)
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex w-full max-w-[380px] items-center justify-between text-sm text-slate-300">
        <span className="flex items-center gap-1" aria-label={`${lives} Herzen`}>
          {Array.from({ length: MOLE_MAX_LIVES }, (_, k) => (
            <Heart key={k} size={20} className={k < lives ? 'fill-rose-500 text-rose-400 drop-shadow-[0_0_6px_rgb(244,63,94)]' : 'text-slate-700'} />
          ))}
        </span>
        <span className="font-mono text-accent-cyan">{score}</span>
      </div>
      <div className="h-1.5 w-full max-w-[380px] overflow-hidden rounded-full bg-white/10" title={`${MOLE_STREAK_HEAL} Treffer in Folge = ein Herz`}>
        <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${(streak / MOLE_STREAK_HEAL) * 100}%` }} />
      </div>
      <div className={`grid w-full max-w-[380px] grid-cols-3 gap-3 ${plus ? 'rounded-2xl p-2 shadow-glow' : ''}`}>
        {Array.from({ length: MOLE_HOLES }, (_, i) => {
          const m = ups[i]
          const b = burst[i]
          return (
            <button
              key={i}
              type="button"
              onPointerDown={(e) => { e.preventDefault(); whack(i) }}
              aria-label={m ? (m.kind === 'bomb' ? 'Bombe' : 'Maulwurf') : 'Loch'}
              className="relative aspect-square touch-none select-none overflow-hidden rounded-3xl bg-gradient-to-b from-emerald-900/50 to-emerald-950/70"
            >
              <span className="absolute inset-x-[10%] bottom-[8%] h-[34%] rounded-[50%] bg-gradient-to-b from-stone-950 to-stone-800 shadow-[inset_0_6px_10px_rgb(0_0_0/0.8)]" />
              <span className={`absolute inset-x-[16%] bottom-[22%] h-[66%] transition-transform duration-150 ease-out ${m ? 'translate-y-0' : 'translate-y-[85%]'}`}>
                {m && <MoleSvg kind={m.kind} />}
              </span>
              <span className="absolute inset-x-[6%] bottom-[2%] h-[26%] rounded-b-3xl bg-gradient-to-b from-amber-900 to-amber-950" />
              {b && (
                <span className={`pointer-events-none absolute inset-0 flex items-center justify-center text-3xl font-black ${b === 'hit' ? 'text-emerald-300' : 'text-rose-400'}`}>
                  {b === 'hit' ? '+' : b === 'bomb' ? 'BUMM' : '✕'}
                </span>
              )}
            </button>
          )
        })}
      </div>
      <p className="max-w-[380px] text-center text-xs text-slate-500">Tippe jeden Maulwurf an, bevor er abtaucht. Entkommt einer, kostet das ein Herz. Goldene geben 3 Punkte, Bomben nicht antippen! {MOLE_STREAK_HEAL} Treffer in Folge bringen ein Herz zurück. Das Tempo steigt nur bis zu einer festen Grenze.</p>
    </div>
  )
}
