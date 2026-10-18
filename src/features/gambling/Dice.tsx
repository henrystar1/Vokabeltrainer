import { useState } from 'react'
import Button from '../../components/ui/Button'
import CoinIcon from '../../components/ui/CoinIcon'
import { ErrorBox } from '../../components/ui/States'
import { useWallet } from '../koins/WalletProvider'
import { errorMessage } from '../../lib/errors'
import { gamblingDice } from '../../services/play'
import BetBox from './BetBox'

/** Würfeln: Zahl von 1 bis 100, du wählst über oder unter einer Grenze. Je kleiner die Chance, desto höher die Auszahlung. */
export default function Dice({ maxBet, rtp = 90 }: { maxBet: number; rtp?: number }) {
  const wallet = useWallet()
  const [bet, setBet] = useState(10)
  const [over, setOver] = useState(true)
  const [target, setTarget] = useState(50)
  const [roll, setRoll] = useState<number | null>(null)
  const [shown, setShown] = useState<number | null>(null)
  const [res, setRes] = useState<{ win: boolean; payout: number; bet: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const lo = over ? 25 : 6 // höchstens 75 % Gewinnchance
  const hi = over ? 95 : 76
  const t = Math.min(hi, Math.max(lo, target))
  const chance = over ? 100 - t : t - 1
  const mult = Math.floor((rtp / chance) * 100) / 100
  const stake = Math.min(Math.max(1, Math.floor(bet || 0)), maxBet)

  async function play() {
    if (busy) return
    setBusy(true)
    setError(null)
    setRes(null)
    setRoll(null)
    const tick = window.setInterval(() => setShown(1 + Math.floor(Math.random() * 100)), 60)
    try {
      const [r] = await Promise.all([gamblingDice(stake, over, t), new Promise((ok) => window.setTimeout(ok, 900))])
      window.clearInterval(tick)
      setShown(r.roll)
      setRoll(r.roll)
      setRes({ win: r.win, payout: r.payout, bet: r.bet })
      wallet.setBalance(r.balance)
    } catch (e) {
      window.clearInterval(tick)
      setShown(null)
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const winFrom = over ? t : 0
  const winTo = over ? 100 : t - 1
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-cyan-300/20 bg-gradient-to-b from-cyan-500/10 to-transparent p-5 text-center">
        <p className={`font-mono text-7xl font-bold tabular-nums ${res ? (res.win ? 'text-emerald-300 drop-shadow-[0_0_14px_rgb(52_211_153/0.7)]' : 'text-rose-300') : 'text-slate-200'}`}>{shown ?? '–'}</p>
        <div className="relative mt-5 h-4 overflow-hidden rounded-full bg-rose-500/30">
          <div className="absolute inset-y-0 bg-gradient-to-r from-emerald-500 to-emerald-300 transition-all" style={{ left: `${winFrom}%`, width: `${winTo - winFrom}%` }} />
          {roll !== null && <div className="absolute inset-y-[-3px] w-1 -translate-x-1/2 rounded bg-white shadow-[0_0_8px_#fff]" style={{ left: `${roll}%` }} />}
        </div>
        <div className="mt-1 flex justify-between font-mono text-[10px] text-slate-500"><span>1</span><span>50</span><span>100</span></div>
      </div>
      <div className="min-h-[28px] text-center" aria-live="polite">
        {res && (res.win ? <p className="text-lg font-semibold text-amber-300">Gewonnen! +{res.payout} Coins</p> : <p className="text-slate-400">Leider nichts – −{res.bet} Coins.</p>)}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {[true, false].map((o) => (
          <button key={String(o)} type="button" onClick={() => setOver(o)} className={`min-h-[44px] rounded-xl border text-sm font-semibold transition ${over === o ? 'border-cyan-300/60 bg-cyan-400/15 text-cyan-200' : 'border-white/10 bg-white/5 text-slate-300'}`}>
            {o ? `Über ${t}` : `Unter ${t}`}
          </button>
        ))}
      </div>
      <div>
        <label htmlFor="dice-t" className="label-mono">Grenze: {t}</label>
        <input id="dice-t" type="range" min={lo} max={hi} value={t} onChange={(e) => setTarget(Number(e.target.value))} className="mt-2 w-full accent-cyan-400" />
        <p className="mt-1 text-sm text-slate-300">Gewinnchance <b>{chance} %</b> · Auszahlung <b>×{mult.toFixed(2)}</b></p>
      </div>
      <BetBox bet={bet} setBet={setBet} maxBet={maxBet} balance={wallet.balance} id="dice-bet" />
      <Button onClick={() => void play()} busy={busy} disabled={wallet.balance < stake || stake < 1} className="w-full">
        <CoinIcon size={16} /> Würfeln · {stake}
      </Button>
      {error && <ErrorBox message={error} />}
    </div>
  )
}
