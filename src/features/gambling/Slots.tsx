import { useEffect, useRef, useState } from 'react'
import { Bell, Cherry, Citrus, Clover, Gem, Star, type LucideIcon } from 'lucide-react'
import Button from '../../components/ui/Button'
import CoinIcon from '../../components/ui/CoinIcon'
import { ErrorBox } from '../../components/ui/States'
import { useWallet } from '../koins/WalletProvider'
import { errorMessage } from '../../lib/errors'
import { gamblingPlay } from '../../services/play'
import BetBox from './BetBox'

interface Sym { icon?: LucideIcon; text?: string; from: string; to: string }
/** Symbole der Walzen (Index 6 = Sieben = Jackpot). */
const SYMBOLS: Sym[] = [
  { icon: Cherry, from: '#fb7185', to: '#be123c' },
  { icon: Citrus, from: '#fde047', to: '#ca8a04' },
  { icon: Bell, from: '#fbbf24', to: '#b45309' },
  { icon: Star, from: '#fcd34d', to: '#d97706' },
  { icon: Gem, from: '#67e8f9', to: '#0e7490' },
  { icon: Clover, from: '#4ade80', to: '#15803d' },
  { text: '7', from: '#f87171', to: '#7f1d1d' },
]

function Reel({ v, spinning, win }: { v: number; spinning: boolean; win: boolean }) {
  const s = SYMBOLS[v]
  const Icon = s.icon
  return (
    <div className={`flex h-24 w-20 items-center justify-center rounded-xl border bg-space-900 shadow-inner transition-transform sm:h-28 sm:w-24 ${spinning ? 'scale-95 blur-[1px]' : ''} ${win ? 'border-amber-300/70 shadow-[0_0_18px_rgb(252_211_77/0.5)]' : 'border-white/15'}`}>
      <span className="flex h-[78%] w-[78%] items-center justify-center rounded-2xl border border-white/25 shadow-md" style={{ background: `linear-gradient(145deg, ${s.from}, ${s.to})` }}>
        {Icon ? <Icon className="h-3/5 w-3/5 text-white drop-shadow" strokeWidth={2.2} /> : <span className="font-black text-5xl text-white drop-shadow [text-shadow:0_2px_0_rgb(0_0_0/0.4)]">{s.text}</span>}
      </span>
    </div>
  )
}

type Outcome = { mult: number; payout: number; bet: number }

/** Spielautomat. Der Ausgang wird auf dem Server gewürfelt; Chancen und Faktoren stellt der Admin ein. */
export default function Slots({ maxBet, onPlayed, info }: { maxBet: number; onPlayed: () => void; info: React.ReactNode }) {
  const wallet = useWallet()
  const [bet, setBet] = useState(10)
  const [reels, setReels] = useState<number[]>([0, 1, 2])
  const [spinning, setSpinning] = useState<boolean[]>([false, false, false])
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach((t) => { window.clearInterval(t); window.clearTimeout(t) }), [])
  const sleep = (ms: number) => new Promise<void>((r) => timers.current.push(window.setTimeout(r, ms)))

  async function play() {
    if (busy) return
    const stake = Math.min(Math.max(1, Math.floor(bet)), maxBet)
    setBusy(true)
    setError(null)
    setOutcome(null)
    setSpinning([true, true, true])
    const rolling = [0, 1, 2].map((i) =>
      window.setInterval(() => setReels((r) => r.map((v, k) => (k === i ? Math.floor(Math.random() * SYMBOLS.length) : v))), 70),
    )
    timers.current.push(...rolling)
    try {
      const [res] = await Promise.all([gamblingPlay(stake), sleep(900)])
      for (let i = 0; i < 3; i++) {
        window.clearInterval(rolling[i])
        setReels((r) => r.map((v, k) => (k === i ? res.reels[i] : v)))
        setSpinning((sp) => sp.map((v, k) => (k === i ? false : v)))
        await sleep(450)
      }
      wallet.setBalance(res.balance)
      setOutcome({ mult: res.mult, payout: res.payout, bet: res.bet })
    } catch (e) {
      rolling.forEach((t) => window.clearInterval(t))
      setSpinning([false, false, false])
      setError(errorMessage(e))
    } finally {
      setBusy(false)
      onPlayed()
    }
  }

  const jackpot = outcome && outcome.mult > 0 && reels[0] === 6
  const won = !!outcome && outcome.mult > 0
  return (
    <div className="space-y-5">
      <div className="flex justify-center gap-3 rounded-2xl border border-amber-300/30 bg-gradient-to-b from-amber-500/10 to-transparent p-5">
        {reels.map((v, i) => <Reel key={i} v={v} spinning={spinning[i]} win={won && !spinning[i]} />)}
      </div>
      <div className="min-h-[44px] text-center" aria-live="polite">
        {outcome && outcome.mult > 0 && <p className="text-lg font-semibold text-amber-300">{jackpot ? 'JACKPOT! ' : 'Gewonnen! '}+{outcome.payout} Coins (×{outcome.mult})</p>}
        {outcome && outcome.mult === 0 && <p className="text-slate-400">Leider nichts – −{outcome.bet} Coins.</p>}
      </div>
      <BetBox bet={bet} setBet={setBet} maxBet={maxBet} balance={wallet.balance} id="slot-bet" />
      <Button onClick={() => void play()} busy={busy} disabled={wallet.balance < bet || bet < 1 || bet > maxBet} className="w-full">
        <CoinIcon size={16} /> Drehen · {Math.min(Math.max(bet || 0, 0), maxBet)}
      </Button>
      {error && <ErrorBox message={error} />}
      {info}
    </div>
  )
}
