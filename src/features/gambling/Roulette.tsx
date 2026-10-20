import { useMemo, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import Button from '../../components/ui/Button'
import CoinIcon from '../../components/ui/CoinIcon'
import { ErrorBox } from '../../components/ui/States'
import { useWallet } from '../koins/WalletProvider'
import { errorMessage } from '../../lib/errors'
import { gamblingRoulette, type RouletteBet, type RouletteResult } from '../../services/play'
import { useSkipAnim } from './skipAnim'
import { TABLE_ROWS, WHEEL_ORDER, addChip, betKey, colorOf, totalOf } from './roulette'

const CHIPS = [1, 5, 10, 25, 50, 100, 500, 1000, 5000]
const SEG = 360 / 37
const COLORS = { red: '#dc2626', black: '#111827', green: '#16a34a' }

function polar(r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180
  return [100 + r * Math.cos(a), 100 + r * Math.sin(a)]
}

function Wheel({ angle, spinning }: { angle: number; spinning: boolean }) {
  const paths = useMemo(
    () =>
      WHEEL_ORDER.map((n, i) => {
        const a0 = i * SEG - SEG / 2
        const a1 = a0 + SEG
        const [x0, y0] = polar(96, a0)
        const [x1, y1] = polar(96, a1)
        const [x2, y2] = polar(62, a1)
        const [x3, y3] = polar(62, a0)
        const [tx, ty] = polar(80, i * SEG)
        return { n, d: `M${x0} ${y0} A96 96 0 0 1 ${x1} ${y1} L${x2} ${y2} A62 62 0 0 0 ${x3} ${y3}Z`, tx, ty, rot: i * SEG }
      }),
    [],
  )
  return (
    <div className="relative mx-auto h-52 w-52">
      <svg viewBox="0 0 200 200" className="h-full w-full drop-shadow-[0_0_18px_rgb(250_204_21/0.25)]" aria-hidden>
        <defs>
          <radialGradient id="rw-hub" cx="40%" cy="35%"><stop offset="0" stopColor="#fde68a" /><stop offset="1" stopColor="#92400e" /></radialGradient>
        </defs>
        <circle cx="100" cy="100" r="99" fill="#3b2a12" stroke="#facc15" strokeWidth="2" />
        <g
          style={{ transformOrigin: '100px 100px', transform: `rotate(${angle}deg)`, transition: spinning ? 'transform 4.2s cubic-bezier(0.12, 0.6, 0.1, 1)' : 'none' }}
        >
          {paths.map((p) => (
            <g key={p.n}>
              <path d={p.d} fill={COLORS[colorOf(p.n)]} stroke="#facc15" strokeWidth="0.5" />
              <text x={p.tx} y={p.ty} fill="#fff" fontSize="8" fontWeight="700" textAnchor="middle" dominantBaseline="central" transform={`rotate(${p.rot} ${p.tx} ${p.ty})`}>{p.n}</text>
            </g>
          ))}
          <circle cx="100" cy="100" r="58" fill="#1c1408" stroke="#facc15" strokeWidth="1.5" />
          <circle cx="100" cy="100" r="22" fill="url(#rw-hub)" />
          <path d="M100 78 V122 M78 100 H122" stroke="#fde68a" strokeWidth="3" strokeLinecap="round" />
        </g>
        <path d="M100 2 l7 -2 l-7 18 l-7 -18z" fill="#fff" stroke="#facc15" strokeWidth="1" transform="translate(0 2)" />
      </svg>
    </div>
  )
}

/** Roulette (europäisch): Chips auf Felder legen, drehen. Alles wird auf dem Server gewürfelt. */
export default function Roulette({ maxBet }: { maxBet: number }) {
  const wallet = useWallet()
  const skip = useSkipAnim()
  const [chip, setChip] = useState(5)
  const [bets, setBets] = useState<RouletteBet[]>([])
  const [result, setResult] = useState<RouletteResult | null>(null)
  const [angle, setAngle] = useState(0)
  const [spinning, setSpinning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [last, setLast] = useState<number[]>([])
  const spins = useRef(0)
  const total = totalOf(bets)
  const limit = maxBet * 5
  const usedChip = Math.min(chip, maxBet)

  function place(b: Pick<RouletteBet, 't' | 'v'>) {
    if (spinning) return
    setResult(null)
    setBets((cur) => (totalOf(cur) + usedChip > limit ? cur : addChip(cur, b, usedChip, maxBet)))
  }
  const amountOn = (b: Pick<RouletteBet, 't' | 'v'>) => bets.find((x) => betKey(x) === betKey(b))?.a

  async function spin() {
    if (spinning || bets.length === 0) return
    setSpinning(true)
    setError(null)
    setResult(null)
    wallet.hold()
    try {
      const res = await gamblingRoulette(bets)
      const idx = WHEEL_ORDER.indexOf(res.number)
      spins.current += 1
      // Das gewählte Feld soll oben unter dem Pfeil landen.
      setAngle((a) => {
        const base = Math.ceil(a / 360) * 360
        return base + 360 * 5 - idx * SEG
      })
      const done = () => {
        setResult(res)
        wallet.release(res.balance)
        setLast((l) => [res.number, ...l].slice(0, 12))
        setSpinning(false)
      }
      if (skip) done()
      else window.setTimeout(done, 4400)
    } catch (e) {
      wallet.release()
      setError(errorMessage(e))
      setSpinning(false)
    }
  }

  const cell = (b: Pick<RouletteBet, 't' | 'v'>, label: string, cls: string) => {
    const a = amountOn(b)
    return (
      <button
        key={betKey(b)}
        type="button"
        onClick={() => place(b)}
        disabled={spinning}
        className={`relative flex min-h-[40px] items-center justify-center rounded-md border border-white/20 px-1 text-xs font-bold text-white transition hover:brightness-125 active:scale-95 disabled:opacity-70 ${cls} ${result?.number !== undefined && b.t === 'straight' && b.v === result.number ? 'ring-2 ring-amber-300' : ''}`}
      >
        {label}
        {a !== undefined && <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-300 px-1 text-[10px] font-black text-amber-950 shadow">{a}</span>}
      </button>
    )
  }
  const numCls = (n: number) => (colorOf(n) === 'red' ? 'bg-red-700' : 'bg-gray-900')

  return (
    <div className="space-y-4">
      <Wheel angle={angle} spinning={spinning && !skip} />
      <div className="min-h-[52px] text-center" aria-live="polite">
        {result && (
          <>
            <p className="text-lg font-semibold">
              <span className="mr-2 inline-flex h-9 w-9 items-center justify-center rounded-full text-white" style={{ background: COLORS[result.color] }}>{result.number}</span>
              {result.payout > 0 ? <span className="text-amber-300">+{result.payout} Coins {result.payout > result.bet ? '' : '(zurück)'}</span> : <span className="text-slate-400">Leider nichts (−{result.bet})</span>}
            </p>
            {result.payout > 0 && <p className="text-xs text-slate-400">Einsatz {result.bet} · Gewinn netto {result.payout - result.bet >= 0 ? '+' : ''}{result.payout - result.bet}</p>}
          </>
        )}
        {!result && spinning && <p className="text-slate-400">Rien ne va plus …</p>}
      </div>
      {last.length > 0 && (
        <div className="flex flex-wrap justify-center gap-1.5" aria-label="Letzte Zahlen">
          {last.map((n, i) => <span key={i} className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: COLORS[colorOf(n)] }}>{n}</span>)}
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-emerald-300/20 bg-gradient-to-b from-emerald-800/50 to-emerald-950/70 p-2">
        <div className="min-w-[560px] space-y-1">
          <div className="grid grid-cols-[44px_1fr_44px] gap-1">
            {cell({ t: 'straight', v: 0 }, '0', 'row-span-3 h-full bg-green-700')}
            <div className="space-y-1">
              {TABLE_ROWS.map((row, r) => (
                <div key={r} className="grid grid-cols-12 gap-1">{row.map((n) => cell({ t: 'straight', v: n }, String(n), numCls(n)))}</div>
              ))}
            </div>
            <div className="grid grid-rows-3 gap-1">
              {[3, 2, 1].map((c) => cell({ t: 'column', v: c }, '2:1', 'bg-emerald-900/80'))}
            </div>
          </div>
          <div className="grid grid-cols-[44px_1fr_44px] gap-1">
            <span />
            <div className="space-y-1">
              <div className="grid grid-cols-3 gap-1">
                {[1, 2, 3].map((d) => cell({ t: 'dozen', v: d }, d === 1 ? '1. Dutzend' : d === 2 ? '2. Dutzend' : '3. Dutzend', 'bg-emerald-900/80'))}
              </div>
              <div className="grid grid-cols-6 gap-1">
                {cell({ t: 'low' }, '1–18', 'bg-emerald-900/80')}
                {cell({ t: 'even' }, 'Gerade', 'bg-emerald-900/80')}
                {cell({ t: 'red' }, 'Rot', 'bg-red-700')}
                {cell({ t: 'black' }, 'Schwarz', 'bg-gray-900')}
                {cell({ t: 'odd' }, 'Ungerade', 'bg-emerald-900/80')}
                {cell({ t: 'high' }, '19–36', 'bg-emerald-900/80')}
              </div>
            </div>
            <span />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Chip-Wert">
          {CHIPS.filter((c) => c <= maxBet).map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={chip === c}
              onClick={() => setChip(c)}
              className={`flex h-11 w-11 items-center justify-center rounded-full border-4 border-dashed font-mono text-sm font-bold transition ${chip === c ? 'scale-110 border-amber-200 bg-amber-500 text-amber-950 shadow-[0_0_14px_rgb(251_191_36/0.7)]' : 'border-white/40 bg-slate-700 text-white'}`}
            >
              {c}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => { setBets([]); setResult(null) }} disabled={spinning || bets.length === 0} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-white/5 px-3 text-sm text-slate-300 hover:bg-white/10 disabled:opacity-40">
          <RotateCcw size={14} /> Löschen
        </button>
      </div>
      <p className="text-center text-xs text-slate-500">Tippe auf Felder, um Chips zu setzen (mehrfach = mehr Einsatz). Höchstens {maxBet} Coins pro Feld, {limit} Coins insgesamt, 10 Felder.</p>
      <Button onClick={() => void spin()} busy={spinning} disabled={bets.length === 0 || wallet.balance < total || spinning} className="w-full">
        <CoinIcon size={16} /> Drehen · {total}
      </Button>
      {error && <ErrorBox message={error} />}
      {wallet.balance < total && total > 0 && <p className="text-sm text-amber-200">Dafür fehlen dir Coins.</p>}
    </div>
  )
}
