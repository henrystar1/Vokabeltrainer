import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import CoinIcon from '../ui/CoinIcon'
import Button from '../ui/Button'
import Card from '../ui/Card'
import { ErrorBox, Notice } from '../ui/States'
import ProgressRing from '../charts/ProgressRing'
import { useWallet } from '../../features/koins/WalletProvider'
import { errorMessage } from '../../lib/errors'
import { getWallet } from '../../services/koins'
import { submitChoice } from '../../services/play'
import type { ChoiceAnswer } from './ChoiceRunner'

/** Ergebnis einer Multiple-Choice-Runde. Meldet das Ergebnis genau einmal an den Server (weniger Coins/Punkte als beim Lernen). */
export default function ChoiceResult({ answers, onAgain, againLabel = 'Nochmal' }: { answers: ChoiceAnswer[]; onAgain: () => void; againLabel?: string }) {
  const wallet = useWallet()
  const correct = answers.filter((a) => a.correct).length
  const wrong = answers.filter((a) => !a.correct)
  const [reward, setReward] = useState<{ points: number; coins: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (answers.length === 0) return
    submitChoice(correct, answers.length)
      .then(async (r) => {
        if (cancelled) return
        setReward(r)
        if (r.coins > 0) {
          const b = await getWallet().catch(() => null)
          if (b !== null) wallet.setBalance(b)
        }
      })
      .catch((e) => !cancelled && setError(errorMessage(e)))
    return () => {
      cancelled = true
    }
    // genau einmal pro Ergebnis
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers])

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
        <ProgressRing value={answers.length ? (correct / answers.length) * 100 : 0} size={128} label="Trefferquote" />
        <div>
          <p className="label-mono">Ergebnis</p>
          <p className="mt-1 text-3xl font-semibold">{correct} von {answers.length} richtig</p>
          <p className="mt-1 text-sm text-slate-400">{wrong.length === 0 ? 'Fehlerfrei – stark!' : `${wrong.length} Fehler`}</p>
        </div>
      </Card>
      {reward && (reward.points > 0 || reward.coins > 0) && (
        <Notice tone="ok">
          <span className="inline-flex items-center gap-1.5">
            +{reward.points} Ranglistenpunkte{reward.coins > 0 && <> · +{reward.coins} <CoinIcon size={14} /> Coins</>}
          </span>
        </Notice>
      )}
      {reward && reward.points === 0 && <Notice tone="info">Für heute gibt es hierfür keine Punkte mehr – das Tageslimit ist erreicht.</Notice>}
      {error && <ErrorBox message={error} />}
      {wrong.length > 0 && (
        <Card>
          <p className="label-mono mb-3">Fehler</p>
          <ul className="divide-y divide-white/5">
            {wrong.map((w) => (
              <li key={w.question.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="font-medium">{w.question.prompt}</span>
                <span className="text-sm">
                  <span className="text-rose-300 line-through decoration-rose-400/60">{w.question.options[w.picked]}</span>
                  <span className="mx-2 text-slate-500">→</span>
                  <span className="text-emerald-300">{w.question.options[w.question.correct]}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="flex flex-wrap gap-3">
        <Button onClick={onAgain}>{againLabel}</Button>
        <Link to="/" className="inline-flex min-h-[48px] items-center rounded-xl px-4 text-sm text-slate-300 hover:bg-white/5">Zur Startseite</Link>
      </div>
    </div>
  )
}
