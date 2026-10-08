import { useEffect, useRef, useState } from 'react'
import CoinIcon from '../components/ui/CoinIcon'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import PageHeader from '../components/ui/PageHeader'
import { ErrorBox, Notice } from '../components/ui/States'
import { useWallet } from '../features/koins/WalletProvider'
import { errorMessage } from '../lib/errors'
import { useAsync } from '../lib/useAsync'
import { getAppSettings } from '../services/koins'
import { gamblingPlay } from '../services/play'
import { getGamblingFeed } from '../services/social'
import { lastSeenText } from './Presence'
import GamblingBoard from './GamblingBoard'

const SYMBOLS = ['🍒', '🍋', '🔔', '⭐', '💎', '🍀', '7️⃣']
const QUICK = [1, 5, 10, 25, 50, 100]

type Outcome = { mult: number; payout: number; bet: number }

/** Spielautomat. Der Ausgang wird auf dem Server gewürfelt; Chancen und Faktoren stellt der Admin ein. */
export default function Gambling() {
  const wallet = useWallet()
  const settings = useAsync(getAppSettings, [])
  const maxBet = settings.data?.gambling_max_bet ?? 200
  const feed = useAsync(getGamblingFeed, [])
  useEffect(() => {
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') feed.reload() }, 15_000)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
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
      feed.reload()
    }
  }

  const win = settings.data ? (settings.data.gambling_win_permille ?? 0) / 10 : null
  const jack = settings.data ? (settings.data.gambling_jackpot_permille ?? 0) / 10 : null
  const jackpot = outcome && outcome.mult > 0 && reels[0] === 6
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader eyebrow="Glück gehabt?" title="Gambling" />
      <Card className="space-y-5">
        <div className="flex justify-center gap-3 rounded-2xl border border-amber-300/30 bg-gradient-to-b from-amber-500/10 to-transparent p-5">
          {reels.map((v, i) => (
            <div
              key={i}
              className={`flex h-24 w-20 items-center justify-center rounded-xl border border-white/15 bg-space-900 text-5xl shadow-inner transition-transform sm:h-28 sm:w-24 ${spinning[i] ? 'scale-95 blur-[1px]' : ''} ${outcome && outcome.mult > 0 && !spinning[i] ? 'border-amber-300/70 shadow-[0_0_18px_rgb(252_211_77/0.5)]' : ''}`}
              aria-label={`Walze ${i + 1}`}
            >
              {SYMBOLS[v]}
            </div>
          ))}
        </div>

        <div className="min-h-[44px] text-center" aria-live="polite">
          {outcome && outcome.mult > 0 && (
            <p className="text-lg font-semibold text-amber-300">{jackpot ? '🎰 JACKPOT! ' : 'Gewonnen! '}+{outcome.payout} Coins (×{outcome.mult})</p>
          )}
          {outcome && outcome.mult === 0 && <p className="text-slate-400">Leider nichts – −{outcome.bet} Coins.</p>}
        </div>

        <div>
          <label htmlFor="bet" className="label-mono">Einsatz (Coins)</label>
          <input
            id="bet"
            type="number"
            min={1}
            max={maxBet}
            inputMode="numeric"
            value={bet}
            onChange={(e) => setBet(Number(e.target.value))}
            className="mt-1 min-h-[48px] w-full rounded-xl border border-white/10 bg-space-900/70 px-3 font-mono text-lg"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {QUICK.filter((q) => q <= maxBet).map((q) => (
              <button key={q} type="button" onClick={() => setBet(q)} className={`min-h-[40px] rounded-lg px-3 font-mono text-sm ${bet === q ? 'bg-accent-cyan/20 text-accent-cyan' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}>
                {q}
              </button>
            ))}
            <button type="button" onClick={() => setBet(Math.min(maxBet, Math.max(1, wallet.balance)))} className="min-h-[40px] rounded-lg bg-white/5 px-3 text-sm text-slate-300 hover:bg-white/10">Max</button>
          </div>
        </div>

        <Button onClick={() => void play()} busy={busy} disabled={wallet.balance < bet || bet < 1 || bet > maxBet} className="w-full">
          <CoinIcon size={16} /> Drehen · {Math.min(Math.max(bet || 0, 0), maxBet)}
        </Button>
        {error && <ErrorBox message={error} />}
        {wallet.balance < 1 && <p className="text-sm text-amber-200">Du hast keine Coins.</p>}
      </Card>

      {win !== null && jack !== null && (
        <Notice tone="info">
          <span className="block">
            Chancen: drei gleiche Symbole <b>{win} %</b> (Einsatz ×{settings.data?.gambling_mult_win}), Dreimal 7️⃣ <b>{jack} %</b> (×{settings.data?.gambling_mult_jackpot}). Höchsteinsatz {maxBet} Coins.
          </span>
          <span className="mt-1 block text-xs opacity-80">Glücksspiel kostet im Schnitt Coins. Spiel nur, was du verschmerzen kannst.</span>
        </Notice>
      )}

      <Card className="mt-5 space-y-2">
        <p className="label-mono">Letzte Runden</p>
        {feed.data?.length === 0 && <p className="text-sm text-slate-500">Noch hat niemand gespielt.</p>}
        <ul className="space-y-1">
          {feed.data?.map((w) => {
            const lost = w.payout <= 0
            return (
              <li key={w.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm ${lost ? 'bg-white/[0.03] text-slate-500' : w.jackpot ? 'bg-amber-400/15 text-amber-200 ring-1 ring-amber-300/40' : 'bg-white/5 text-slate-200'}`}>
                {lost ? (
                  <span>😞 <b>{w.display_name}</b> verliert <b>{w.bet.toLocaleString('de-DE')}</b> Coins</span>
                ) : (
                  <span>{w.jackpot ? '🎰 JACKPOT! ' : '🎉 '}<b>{w.display_name}</b> gewinnt <b>{w.payout.toLocaleString('de-DE')}</b> Coins <span className="text-xs opacity-70">(Einsatz {w.bet})</span></span>
                )}
                <span className="text-xs opacity-70">{lastSeenText(w.created_at)}</span>
              </li>
            )
          })}
        </ul>
      </Card>

      <div className="mt-5">
        <p className="label-mono mb-2">Bilanz-Rangliste</p>
        <GamblingBoard limit={10} />
      </div>
    </div>
  )
}
