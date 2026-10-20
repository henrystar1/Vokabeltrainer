import { useEffect, useState } from 'react'
import Button from '../../components/ui/Button'
import CoinIcon from '../../components/ui/CoinIcon'
import { ErrorBox } from '../../components/ui/States'
import { useWallet } from '../koins/WalletProvider'
import { errorMessage } from '../../lib/errors'
import { blackjackAction, blackjackCurrent, blackjackStart, type BlackjackState } from '../../services/play'
import BetBox from './BetBox'
import { cardIsRed, cardRank, cardSuit } from './cards'

function Card({ n, hidden = false }: { n?: number; hidden?: boolean }) {
  if (hidden || n === undefined) {
    return <div className="flex h-24 w-16 items-center justify-center rounded-lg border border-cyan-300/30 bg-gradient-to-br from-indigo-700 to-indigo-950 text-2xl text-cyan-200/60 shadow-lg" aria-label="Verdeckte Karte">?</div>
  }
  return (
    <div className={`flex h-24 w-16 flex-col justify-between rounded-lg border border-slate-300 bg-white p-1.5 font-bold leading-none shadow-lg ${cardIsRed(n) ? 'text-rose-600' : 'text-slate-900'}`} aria-label={`${cardSuit(n)} ${cardRank(n)}`}>
      <span className="text-base">{cardRank(n)}<br />{cardSuit(n)}</span>
      <span className="self-end text-2xl">{cardSuit(n)}</span>
    </div>
  )
}

const RESULT: Record<NonNullable<BlackjackState['result']>, { text: string; tone: string }> = {
  blackjack: { text: 'Black Jack!', tone: 'text-amber-300' },
  win: { text: 'Gewonnen!', tone: 'text-emerald-300' },
  push: { text: 'Unentschieden – Einsatz zurück.', tone: 'text-slate-200' },
  lose: { text: 'Der Geber gewinnt.', tone: 'text-slate-400' },
  bust: { text: 'Überkauft – verloren.', tone: 'text-rose-300' },
}

/** Black Jack gegen den Geber. Karten, Mischen und Auszahlung laufen komplett auf dem Server. */
export default function Blackjack({ maxBet }: { maxBet: number }) {
  const wallet = useWallet()
  const [bet, setBet] = useState(10)
  const [st, setSt] = useState<BlackjackState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stake = Math.min(Math.max(1, Math.floor(bet || 0)), maxBet)
  const open = st !== null && !st.done

  useEffect(() => {
    let alive = true
    blackjackCurrent().then((s) => { if (alive && s) setSt(s) }).catch(() => undefined)
    return () => { alive = false }
  }, [])

  async function run(fn: () => Promise<BlackjackState>) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const s = await fn()
      setSt(s)
      wallet.setBalance(s.balance)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const res = st?.done && st.result ? RESULT[st.result] : null
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-emerald-300/20 bg-gradient-to-b from-emerald-700/30 to-emerald-950/40 p-4">
        <p className="label-mono">Geber{st ? ` · ${st.dealer_total}${open ? ' + ?' : ''}` : ''}</p>
        <div className="mt-2 flex min-h-[96px] flex-wrap gap-2">
          {st ? (
            <>
              {st.dealer.map((c, i) => <Card key={`${i}-${c}`} n={c} />)}
              {open && <Card hidden />}
            </>
          ) : <p className="self-center text-sm text-slate-400">Setze und teile aus.</p>}
        </div>
        <p className="label-mono mt-4">Du{st ? ` · ${st.player_total}` : ''}</p>
        <div className="mt-2 flex min-h-[96px] flex-wrap gap-2">
          {st?.player.map((c, i) => <Card key={`${i}-${c}`} n={c} />)}
        </div>
      </div>

      <div className="min-h-[28px] text-center" aria-live="polite">
        {res && st && (
          <p className={`text-lg font-semibold ${res.tone}`}>
            {res.text} {st.payout > st.bet ? `+${st.payout - st.bet} Coins` : st.payout === st.bet ? '' : `−${st.bet} Coins`}
          </p>
        )}
        {open && st && <p className="text-sm text-slate-300">Einsatz {st.bet} Coins</p>}
      </div>

      {open ? (
        <div className="grid grid-cols-3 gap-2">
          <Button onClick={() => void run(() => blackjackAction('hit'))} busy={busy}>Karte</Button>
          <Button onClick={() => void run(() => blackjackAction('stand'))} busy={busy} variant="secondary">Halten</Button>
          <Button onClick={() => void run(() => blackjackAction('double'))} busy={busy} variant="secondary" disabled={!st?.can_double || wallet.balance < (st?.bet ?? 0)}>Verdoppeln</Button>
        </div>
      ) : (
        <>
          <BetBox bet={bet} setBet={setBet} maxBet={maxBet} balance={wallet.balance} id="bj-bet" />
          <Button onClick={() => void run(() => blackjackStart(stake))} busy={busy} disabled={wallet.balance < stake || stake < 1} className="w-full">
            <CoinIcon size={16} /> Austeilen · {stake}
          </Button>
        </>
      )}
      {error && <ErrorBox message={error} />}
      <p className="text-center text-xs text-slate-500">Black Jack zahlt 6:5, der Geber zieht bis 17 (auch bei weichem 17), Verdoppeln nur mit den ersten zwei Karten, kein Teilen. Verlässt du eine offene Runde, ist der Einsatz weg.</p>
    </div>
  )
}
