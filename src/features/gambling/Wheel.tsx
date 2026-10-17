import { useMemo, useState } from 'react'
import Button from '../../components/ui/Button'
import CoinIcon from '../../components/ui/CoinIcon'
import { ErrorBox } from '../../components/ui/States'
import { useWallet } from '../koins/WalletProvider'
import { errorMessage } from '../../lib/errors'
import { gamblingWheel } from '../../services/play'
import BetBox from './BetBox'

const DEFAULT_SEGMENTS = [0, 5, 0, 20, 0, 10, 0, 30, 0, 5, 0, 40, 0, 20, 0, 40, 0, 5, 0, 20]

const FILL: Record<number, [string, string]> = {
  0: ['#334155', '#0f172a'], 5: ['#64748b', '#334155'], 10: ['#14b8a6', '#0f766e'], 20: ['#22c55e', '#15803d'], 30: ['#f59e0b', '#b45309'], 40: ['#e879f9', '#a21caf'],
}
const label = (t: number): string => (t === 0 ? '✕' : `×${t / 10}`)

function polar(r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180
  return [100 + r * Math.cos(a), 100 + r * Math.sin(a)]
}

/** Glücksrad: 20 Felder mit Faktoren (Rückzahlung im Schnitt 97,5 %). */
export default function Wheel({ maxBet }: { maxBet: number }) {
  const wallet = useWallet()
  const [bet, setBet] = useState(10)
  const [segments, setSegments] = useState(DEFAULT_SEGMENTS)
  const [angle, setAngle] = useState(0)
  const [spinning, setSpinning] = useState(false)
  const [res, setRes] = useState<{ tenths: number; payout: number; bet: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const n = segments.length
  const seg = 360 / n
  const stake = Math.min(Math.max(1, Math.floor(bet || 0)), maxBet)

  const paths = useMemo(
    () =>
      segments.map((t, i) => {
        const a0 = i * seg - seg / 2
        const a1 = a0 + seg
        const [x0, y0] = polar(97, a0)
        const [x1, y1] = polar(97, a1)
        const [tx, ty] = polar(76, i * seg)
        return { t, i, d: `M100 100 L${x0} ${y0} A97 97 0 0 1 ${x1} ${y1}Z`, tx, ty }
      }),
    [segments, seg],
  )

  async function spin() {
    if (spinning) return
    setSpinning(true)
    setError(null)
    setRes(null)
    try {
      const r = await gamblingWheel(stake)
      setSegments(r.segments)
      setAngle((a) => Math.ceil(a / 360) * 360 + 360 * 6 - r.index * (360 / r.segments.length))
      window.setTimeout(() => {
        setRes({ tenths: r.tenths, payout: r.payout, bet: r.bet })
        wallet.setBalance(r.balance)
        setSpinning(false)
      }, 4400)
    } catch (e) {
      setError(errorMessage(e))
      setSpinning(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="relative mx-auto h-60 w-60">
        <svg viewBox="0 0 200 200" className="h-full w-full drop-shadow-[0_0_18px_rgb(232_121_249/0.3)]" aria-hidden>
          <defs>
            {Object.entries(FILL).map(([k, [a, b]]) => (
              <radialGradient key={k} id={`gw-${k}`} cx="50%" cy="50%" r="60%"><stop offset="0.2" stopColor={b} /><stop offset="1" stopColor={a} /></radialGradient>
            ))}
          </defs>
          <circle cx="100" cy="100" r="99" fill="#1e1b4b" stroke="#e879f9" strokeWidth="2" />
          <g style={{ transformOrigin: '100px 100px', transform: `rotate(${angle}deg)`, transition: spinning ? 'transform 4.2s cubic-bezier(0.12, 0.6, 0.1, 1)' : 'none' }}>
            {paths.map((p) => (
              <g key={p.i}>
                <path d={p.d} fill={`url(#gw-${FILL[p.t] ? p.t : 0})`} stroke="#0f172a" strokeWidth="0.8" />
                <text x={p.tx} y={p.ty} fill="#fff" fontSize="10" fontWeight="800" textAnchor="middle" dominantBaseline="central" transform={`rotate(${p.i * seg} ${p.tx} ${p.ty})`}>{label(p.t)}</text>
              </g>
            ))}
            <circle cx="100" cy="100" r="16" fill="#0f172a" stroke="#e879f9" strokeWidth="2" />
          </g>
          <path d="M92 -1 h16 l-8 18z" fill="#fff" stroke="#e879f9" strokeWidth="1.5" />
        </svg>
      </div>
      <div className="min-h-[28px] text-center" aria-live="polite">
        {res && (res.payout > 0 ? (
          <p className="text-lg font-semibold text-amber-300">×{res.tenths / 10}: +{res.payout} Coins {res.payout < res.bet ? '(Teilbetrag zurück)' : ''}</p>
        ) : <p className="text-slate-400">Leider nichts – −{res.bet} Coins.</p>)}
      </div>
      <BetBox bet={bet} setBet={setBet} maxBet={maxBet} balance={wallet.balance} id="wheel-bet" />
      <Button onClick={() => void spin()} busy={spinning} disabled={wallet.balance < stake || stake < 1} className="w-full">
        <CoinIcon size={16} /> Drehen · {stake}
      </Button>
      {error && <ErrorBox message={error} />}
      <p className="text-center text-xs text-slate-500">Felder: ×0 (10×), ×0,5 (3×), ×1 (1×), ×2 (3×), ×3 (1×), ×4 (2×) – im Schnitt bekommst du 97,5 % zurück.</p>
    </div>
  )
}
