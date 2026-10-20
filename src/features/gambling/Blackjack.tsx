import { useEffect, useRef, useState } from 'react'
import Button from '../../components/ui/Button'
import CoinIcon from '../../components/ui/CoinIcon'
import { ErrorBox } from '../../components/ui/States'
import { useWallet } from '../koins/WalletProvider'
import { errorMessage } from '../../lib/errors'
import { blackjackAction, blackjackCurrent, blackjackStart, type BlackjackState } from '../../services/play'
import BetBox from './BetBox'
import { cardIsRed, cardRank, cardSuit } from './cards'
import { useSkipAnim } from './skipAnim'

function Card({ n, hidden = false, anim = '', delay = 0 }: { n?: number; hidden?: boolean; anim?: string; delay?: number }) {
  const style = delay ? { animationDelay: `${delay}s` } : undefined
  if (hidden || n === undefined) {
    return <div className={`bj-back -ml-5 h-[88px] w-[62px] rounded-lg border-2 border-white shadow-[0_4px_10px_rgb(0_0_0/0.45)] first:ml-0 sm:h-24 sm:w-[68px] ${anim}`} style={style} aria-label="Verdeckte Karte" />
  }
  const red = cardIsRed(n)
  return (
    <div className={`-ml-5 flex h-[88px] w-[62px] flex-col justify-between rounded-lg border-2 border-slate-200 bg-white p-1.5 font-mono font-black leading-none shadow-[0_4px_10px_rgb(0_0_0/0.45)] first:ml-0 sm:h-24 sm:w-[68px] ${red ? 'text-red-600' : 'text-slate-900'} ${anim}`} style={style} aria-label={`${cardSuit(n)} ${cardRank(n)}`}>
      <span className="text-lg">{cardRank(n)}<span className="block text-base">{cardSuit(n)}</span></span>
      <span className="self-end text-3xl">{cardSuit(n)}</span>
    </div>
  )
}

const RESULT: Record<NonNullable<BlackjackState['result']>, { text: string; tone: string }> = {
  blackjack: { text: 'BLACK JACK!', tone: 'text-amber-300' },
  win: { text: 'GEWONNEN!', tone: 'text-emerald-200' },
  push: { text: 'UNENTSCHIEDEN', tone: 'text-slate-100' },
  lose: { text: 'GEBER GEWINNT', tone: 'text-rose-200' },
  bust: { text: 'ÜBERKAUFT', tone: 'text-rose-200' },
}

function Total({ v, label }: { v: number; label?: string }) {
  return <span className="inline-flex min-w-[2.5rem] items-center justify-center rounded-full bg-emerald-950/80 px-3 py-0.5 font-mono text-lg font-black text-emerald-100 ring-1 ring-white/20" aria-label={label}>{v}</span>
}

/** Black Jack gegen den Geber. Karten, Mischen und Auszahlung laufen komplett auf dem Server. */
export default function Blackjack({ maxBet, blackjackPays = 1.2, dealerHitsSoft17 = true }: { maxBet: number; blackjackPays?: number; dealerHitsSoft17?: boolean }) {
  const wallet = useWallet()
  const skip = useSkipAnim()
  const [bet, setBet] = useState(10)
  const [st, setSt] = useState<BlackjackState | null>(null)
  const [round, setRound] = useState(0)
  const [shown, setShown] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef(0)
  const stake = Math.min(Math.max(1, Math.floor(bet || 0)), maxBet)
  const open = st !== null && !st.done
  useEffect(() => () => window.clearTimeout(timer.current), [])

  useEffect(() => {
    let alive = true
    blackjackCurrent().then((s) => { if (alive && s) { setSt(s); setShown(true) } }).catch(() => undefined)
    return () => { alive = false }
  }, [])

  async function run(fn: () => Promise<BlackjackState>, isStart = false) {
    if (busy) return
    setBusy(true)
    setError(null)
    wallet.hold()
    try {
      const s = await fn()
      if (isStart) setRound((r) => r + 1)
      setSt(s)
      if (s.done && !skip) {
        // Gewinn erst zeigen, wenn die Karten aufgedeckt sind
        setShown(false)
        const ms = 700 + Math.max(0, s.dealer.length - 2) * 450 + (isStart ? 900 : 0)
        timer.current = window.setTimeout(() => { setShown(true); wallet.release(s.balance) }, ms)
      } else {
        setShown(true)
        wallet.release(s.balance)
      }
    } catch (e) {
      wallet.release()
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const res = st?.done && st.result ? RESULT[st.result] : null
  const fx = skip ? '' : 'bj-deal'
  const net = st ? st.payout - st.bet : 0
  return (
    <div className="space-y-5">
      <div className="mx-auto max-w-lg">
        <div className="bj-hex bg-emerald-950 p-[5px]">
          <div className="bj-hex bj-felt relative flex min-h-[470px] flex-col items-center px-8 pb-6 pt-4 sm:min-h-[520px]">
            <p className="text-center font-mono text-lg font-black tracking-[0.18em] text-emerald-100 drop-shadow [text-shadow:0_2px_0_#064e3b]">BLACKJACK <span className="text-amber-300">ZAHLT {blackjackPays === 1.2 ? '6:5' : blackjackPays === 1.5 ? '3:2' : `${blackjackPays}:1`}</span></p>
            <p className="text-center text-[11px] tracking-wider text-emerald-900/80">{dealerHitsSoft17 ? 'Geber zieht bei weichem 17' : 'Geber bleibt bei weichem 17'}</p>

            <div className="mt-3 flex w-full items-start justify-center gap-5">
              <div className="mt-1 hidden h-[88px] w-[62px] shrink-0 rounded-lg border-2 border-white bg-red-700 shadow-[3px_5px_0_#7f1d1d] sm:block bj-back" aria-hidden />
              <div className="flex min-h-[96px] items-start" key={`d${round}`}>
                {st ? (
                  <>
                    {st.dealer.map((c, i) => (
                      <Card key={`${i}-${c}`} n={c} anim={skip ? '' : i === 1 && st.done && !res?.text.startsWith('BLACK') ? 'bj-flip' : fx} delay={skip ? 0 : i < 2 ? (st.done && i === 1 ? 0.15 : i * 0.3 + 0.15) : (i - 1) * 0.45 + 0.2} />
                    ))}
                    {open && <Card hidden anim={fx} delay={0.45} />}
                  </>
                ) : <p className="self-center text-sm font-semibold text-emerald-950/70">Setze und teile aus.</p>}
              </div>
            </div>
            {st && <div className="mt-2"><Total v={st.dealer_total} label="Summe Geber" />{open && <span className="ml-1 font-mono text-emerald-950/70">+ ?</span>}</div>}

            <div className="relative my-3 flex min-h-[110px] w-full flex-1 flex-col items-center justify-center gap-2">
              {open && (
                <div className="flex w-36 flex-col gap-2">
                  {([['hit', 'KARTE'], ['stand', 'HALTEN'], ['double', 'VERDOPPELN']] as const).map(([a, label]) => {
                    const dis = busy || (a === 'double' && (!st?.can_double || wallet.balance < (st?.bet ?? 0)))
                    return (
                      <button key={a} type="button" disabled={dis} onClick={() => void run(() => blackjackAction(a))}
                        className="min-h-[40px] rounded-lg bg-slate-100 font-mono text-sm font-black tracking-widest text-slate-800 shadow-[0_3px_0_#94a3b8] transition active:translate-y-[2px] active:shadow-none disabled:opacity-40">
                        {label}
                      </button>
                    )
                  })}
                </div>
              )}
              {res && st && shown && (
                <div key={`r${round}-${st.result}`} className={`bj-pop rounded-2xl bg-emerald-950/85 px-5 py-2 text-center ring-2 ring-white/20 ${res.tone}`} aria-live="polite">
                  <p className="font-mono text-xl font-black tracking-widest">{res.text}</p>
                  <p className="font-mono text-sm font-bold">{net > 0 ? `+${net.toLocaleString('de-DE')} Coins` : net === 0 ? 'Einsatz zurück' : `−${st.bet.toLocaleString('de-DE')} Coins`}</p>
                </div>
              )}
              {st && (
                <div className="flex items-center gap-1.5 rounded-full bg-emerald-950/70 px-3 py-1 font-mono text-sm font-bold text-amber-200 ring-1 ring-white/15">
                  <CoinIcon size={14} /> {st.bet.toLocaleString('de-DE')}
                </div>
              )}
            </div>

            {st && <div className="mb-2"><Total v={st.player_total} label="Deine Summe" /></div>}
            <div className="flex min-h-[96px] items-end" key={`p${round}`}>
              {st?.player.map((c, i) => <Card key={`${i}-${c}`} n={c} anim={fx} delay={skip ? 0 : i < 2 ? i * 0.3 : 0} />)}
            </div>
          </div>
        </div>
      </div>

      {!open && (
        <>
          <BetBox bet={bet} setBet={setBet} maxBet={maxBet} balance={wallet.balance} id="bj-bet" />
          <Button onClick={() => void run(() => blackjackStart(stake), true)} busy={busy} disabled={wallet.balance < stake || stake < 1} className="w-full">
            <CoinIcon size={16} /> {st ? 'Neue Runde' : 'Austeilen'} · {stake.toLocaleString('de-DE')}
          </Button>
        </>
      )}
      {error && <ErrorBox message={error} />}
      <p className="text-center text-xs text-slate-500">Verdoppeln nur mit den ersten zwei Karten, kein Teilen. Verlässt du eine offene Runde, ist der Einsatz weg.</p>
    </div>
  )
}
