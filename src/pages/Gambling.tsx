import { useEffect, useState } from 'react'
import { CircleDot, Dice5, Disc3, Cherry, Spade, Sparkles, TrendingDown, Trophy } from 'lucide-react'
import Card from '../components/ui/Card'
import PageHeader from '../components/ui/PageHeader'
import { Notice } from '../components/ui/States'
import { useAsync } from '../lib/useAsync'
import { useWallet } from '../features/koins/WalletProvider'
import { getAppSettings } from '../services/koins'
import { getGamblingFeed } from '../services/social'
import { lastSeenText } from './Presence'
import GamblingBoard from './GamblingBoard'
import PlusHint from '../features/plus/PlusHint'
import Slots from '../features/gambling/Slots'
import Roulette from '../features/gambling/Roulette'
import Dice from '../features/gambling/Dice'
import Wheel from '../features/gambling/Wheel'
import Blackjack from '../features/gambling/Blackjack'
import { setSkipAnim, useSkipAnim } from '../features/gambling/skipAnim'

const TABS = [
  { id: 'slots', label: 'Automat', icon: Cherry },
  { id: 'roulette', label: 'Roulette', icon: CircleDot },
  { id: 'dice', label: 'Würfeln', icon: Dice5 },
  { id: 'wheel', label: 'Glücksrad', icon: Disc3 },
  { id: 'blackjack', label: 'Black Jack', icon: Spade },
] as const
type Tab = (typeof TABS)[number]['id']

/** Gambling: Automat, Roulette, Würfeln, Glücksrad und Black Jack. Alle Ausgänge werden auf dem Server gewürfelt; der Admin legt Höchsteinsätze und Chancen fest. */
export default function Gambling() {
  const settings = useAsync(getAppSettings, [])
  const wallet = useWallet()
  const baseMax = settings.data?.gambling_max_bet ?? 200
  const allIn = (settings.data?.gambling_all_in ?? 1) !== 0
  const maxBet = allIn ? Math.max(baseMax, wallet.balance) : baseMax
  const rtp = Math.min(Math.max((settings.data?.gambling_rtp_dice ?? 850) / 10, 30), 99)
  const maxChance = Math.min(Math.max(settings.data?.gambling_dice_max_chance ?? 50, 5), 95)
  const skip = useSkipAnim()
  const wheelChances = (() => {
    const s = settings.data
    if (!s) return undefined
    const w: Array<[number, number]> = [[0, s.gambling_wheel_w0 ?? 500], [5, s.gambling_wheel_w05 ?? 150], [10, s.gambling_wheel_w1 ?? 50], [20, s.gambling_wheel_w2 ?? 200], [30, s.gambling_wheel_w3 ?? 50], [40, s.gambling_wheel_w4 ?? 50]]
    const sum = w.reduce((a, [, v]) => a + Math.max(v, 0), 0)
    if (sum <= 0) return undefined
    return w.map(([f, v]) => ({ f, pct: (Math.max(v, 0) / sum) * 100 }))
  })()
  const bjX = (settings.data?.gambling_bj_blackjack_x10 ?? 12) / 10
  const bjHit17 = (settings.data?.gambling_bj_dealer_hits_soft17 ?? 1) !== 0
  const feed = useAsync(getGamblingFeed, [])
  const [tab, setTab] = useState<Tab>('slots')
  useEffect(() => {
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') feed.reload() }, 15_000)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const win = settings.data ? (settings.data.gambling_win_permille ?? 0) / 10 : null
  const jack = settings.data ? (settings.data.gambling_jackpot_permille ?? 0) / 10 : null
  const info = win !== null && jack !== null && (
    <Notice tone="info">
      <span className="block">
        Chancen: drei gleiche Symbole <b>{win} %</b> (Einsatz ×{settings.data?.gambling_mult_win}), dreimal die 7 <b>{jack} %</b> (×{settings.data?.gambling_mult_jackpot}). {allIn ? 'Du kannst bis zu deinem ganzen Guthaben setzen.' : `Höchsteinsatz ${maxBet.toLocaleString('de-DE')} Coins.`}
      </span>
    </Notice>
  )
  return (
    <div className="mx-auto max-w-xl">
      <PageHeader eyebrow="Glück gehabt?" title="Gambling" />
      <div className="mb-4 grid grid-cols-5 gap-1.5" role="tablist" aria-label="Spiel wählen">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-xl border text-[11px] font-semibold transition ${tab === t.id ? 'border-amber-300/60 bg-amber-400/15 text-amber-200' : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'}`}
          >
            <t.icon size={18} />
            {t.label}
          </button>
        ))}
      </div>
      <label className="mb-3 flex cursor-pointer items-center justify-end gap-2 text-sm text-slate-300">
        <input type="checkbox" checked={skip} onChange={(e) => setSkipAnim(e.target.checked)} className="h-5 w-5 accent-amber-400" />
        Animationen überspringen
      </label>
      <Card className="space-y-5">
        {tab === 'slots' && <Slots maxBet={maxBet} onPlayed={feed.reload} info={info} />}
        {tab === 'roulette' && <Roulette maxBet={maxBet} />}
        {tab === 'dice' && <Dice maxBet={maxBet} rtp={rtp} maxChance={maxChance} />}
        {tab === 'wheel' && <Wheel maxBet={maxBet} chances={wheelChances} />}
        {tab === 'blackjack' && <Blackjack maxBet={maxBet} blackjackPays={bjX} dealerHitsSoft17={bjHit17} />}
      </Card>
      <p className="mt-3 text-center text-xs text-slate-500">Glücksspiel kostet im Schnitt Coins. Spiel nur, was du verschmerzen kannst.</p>

      <Card className="mt-5 space-y-2">
        <p className="label-mono">Letzte Runden</p>
        {feed.data?.length === 0 && <p className="text-sm text-slate-500">Noch hat niemand gespielt.</p>}
        <ul className="space-y-1">
          {feed.data?.map((w) => {
            const lost = w.payout <= 0
            return (
              <li key={w.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm ${lost ? 'bg-white/[0.03] text-slate-500' : w.jackpot ? 'bg-amber-400/15 text-amber-200 ring-1 ring-amber-300/40' : 'bg-white/5 text-slate-200'}`}>
                {lost ? (
                  <span className="inline-flex items-center gap-1.5"><TrendingDown size={14} /> <b>{w.display_name}</b> verliert <b>{w.bet.toLocaleString('de-DE')}</b> Coins</span>
                ) : (
                  <span className="inline-flex flex-wrap items-center gap-1.5">{w.jackpot ? <Sparkles size={14} /> : <Trophy size={14} />}{w.jackpot ? 'JACKPOT! ' : ''}<b>{w.display_name}</b> gewinnt <b>{w.payout.toLocaleString('de-DE')}</b> Coins <span className="text-xs opacity-70">(Einsatz {w.bet})</span></span>
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
      <PlusHint ctx="gambling" />
    </div>
  )
}
