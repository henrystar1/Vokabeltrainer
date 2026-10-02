import { useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Swords } from 'lucide-react'
import QuizRunner from '../components/quiz/QuizRunner'
import ResultSummary, { type WrongAnswer } from '../components/quiz/ResultSummary'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import PageHeader from '../components/ui/PageHeader'
import { ErrorBox, Notice, Spinner } from '../components/ui/States'
import { useWallet } from '../features/koins/WalletProvider'
import { buildDuelQuestions, type Question } from '../features/learning/questions'
import { useSettings } from '../features/settings/SettingsProvider'
import { errorMessage } from '../lib/errors'
import { useAsync } from '../lib/useAsync'
import { getWallet } from '../services/koins'
import { getDuel, submitDuel } from '../services/play'
import type { DuelSubmitResult } from '../types'

type Phase = 'intro' | 'run' | 'result'

/** Ein Duell spielen. Gewertet werden Treffer und Zeit; Lernstand und Koins fürs Lernen bleiben unberührt. */
export default function DuelPlay() {
  const { id = '' } = useParams()
  const { settings } = useSettings()
  const wallet = useWallet()
  const duel = useAsync(() => getDuel(id), [id])
  const [phase, setPhase] = useState<Phase>('intro')
  const [wrong, setWrong] = useState<WrongAnswer[]>([])
  const [correct, setCorrect] = useState(0)
  const [outcome, setOutcome] = useState<DuelSubmitResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const startedMs = useRef(0)
  const wrongRef = useRef<WrongAnswer[]>([])
  const correctRef = useRef(0)
  const millis = useRef(0)

  const questions = useMemo<Question[]>(() => (duel.data ? buildDuelQuestions(duel.data.questions.map((q) => ({ ...q }))) : []), [duel.data])

  async function send() {
    setError(null)
    try {
      setOutcome(await submitDuel(id, correct, questions.length, millis.current))
      const b = await getWallet().catch(() => null)
      if (b !== null) wallet.setBalance(b)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  function finish() {
    millis.current = Math.round(performance.now() - startedMs.current)
    setCorrect(correctRef.current)
    setWrong([...wrongRef.current])
    setPhase('result')
    void submitDuel(id, correctRef.current, questions.length, millis.current)
      .then(async (r) => {
        setOutcome(r)
        const b = await getWallet().catch(() => null)
        if (b !== null) wallet.setBalance(b)
      })
      .catch((e) => setError(errorMessage(e)))
  }

  if (duel.loading && !duel.data) return <Spinner />
  if (duel.error) return <ErrorBox message={duel.error} onRetry={duel.reload} />
  const d = duel.data
  if (!d) return null

  if (phase === 'run') {
    return (
      <QuizRunner
        questions={questions}
        caseSensitive={settings.case_sensitive}
        accents={settings.learn_language === 'fr'}
        title={`Duell gegen ${d.opponent_name}`}
        showFeedback={false}
        onAnswer={(_q, given, ok) => {
          if (ok) correctRef.current += 1
          else wrongRef.current.push({ question: _q, given })
        }}
        onFinish={finish}
      />
    )
  }

  if (phase === 'result') {
    return (
      <div>
        <PageHeader eyebrow={`Duell gegen ${d.opponent_name}`} title={`${correct} von ${questions.length} richtig`} />
        <ResultSummary total={questions.length} correct={correct} wrong={wrong} />
        <div className="mt-4 space-y-3">
          {!outcome && !error && <Spinner label="Wertung …" />}
          {error && <ErrorBox message={error} onRetry={() => void send()} />}
          {outcome?.status === 'open' && <Notice tone="info">Gespeichert. Sobald {d.opponent_name} gespielt hat, siehst du hier das Ergebnis.</Notice>}
          {outcome?.status === 'finished' && (
            <Notice tone={outcome.winner === 'opp' ? 'warn' : 'ok'}>
              {outcome.winner === 'me' ? 'Gewonnen! ' : outcome.winner === 'opp' ? 'Verloren. ' : 'Unentschieden. '}
              {d.opponent_name} hatte {outcome.opp_correct} richtig.
            </Notice>
          )}
        </div>
        <div className="mt-6">
          <Link to="/duell" className="inline-flex min-h-[44px] items-center text-accent-cyan hover:underline">Zu den Duellen</Link>
        </div>
      </div>
    )
  }

  const playable = d.status === 'open' && !d.my_done
  return (
    <div>
      <PageHeader eyebrow="Duell" title={`Du gegen ${d.opponent_name}`} />
      <Card className="mx-auto max-w-xl space-y-4">
        {playable ? (
          <>
            <p className="text-slate-300">{questions.length} Fragen, ohne Rückmeldung nach jeder Antwort. Die Zeit läuft mit – bei Gleichstand gewinnt der Schnellere. Du kannst das Duell nur einmal spielen.</p>
            <Button
              className="w-full min-h-[52px]"
              onClick={() => {
                startedMs.current = performance.now()
                wrongRef.current = []
                correctRef.current = 0
                setPhase('run')
              }}
            >
              <Swords size={18} /> Los geht’s
            </Button>
          </>
        ) : (
          <p className="text-slate-300">
            {d.status === 'cancelled' ? 'Dieses Duell wurde abgebrochen.' : d.my_done ? `Du hast schon gespielt (${d.my_correct}/${d.my_total}).${d.status === 'finished' ? ` ${d.opponent_name}: ${d.opp_correct}.` : ''}` : 'Dieses Duell ist nicht mehr offen.'}
          </p>
        )}
        <Link to="/duell" className="inline-block text-sm text-accent-cyan hover:underline">Zurück zu den Duellen</Link>
      </Card>
    </div>
  )
}
