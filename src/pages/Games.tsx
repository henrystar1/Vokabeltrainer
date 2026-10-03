import { useEffect, useRef, useState } from 'react'
import { Blocks, Gamepad2, Grid3x3, Trophy } from 'lucide-react'
import CoinIcon from '../components/ui/CoinIcon'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import PageHeader from '../components/ui/PageHeader'
import ProgressBar from '../components/ui/ProgressBar'
import { ErrorBox, Notice } from '../components/ui/States'
import { useWallet } from '../features/koins/WalletProvider'
import { useFocusMode } from '../features/koins/focusMode'
import BlastGame from '../features/games/BlastGame'
import SnakeGame from '../features/games/SnakeGame'
import TetrisGame from '../features/games/TetrisGame'
import { errorMessage } from '../lib/errors'
import { useAsync } from '../lib/useAsync'
import { getAppSettings } from '../services/koins'
import { finishGame, startGame, type GameId, type GameResult, type GameStart } from '../services/play'

const GAMES: Array<{ id: GameId; name: string; text: string; unit: string; icon: typeof Gamepad2 }> = [
  { id: 'snake', name: 'Snake', text: 'Friss Äpfel, werde länger, stoß nirgends an.', unit: 'Äpfel', icon: Gamepad2 },
  { id: 'tetris', name: 'Tetris', text: 'Stapel die Blöcke und lösche Reihen.', unit: 'Punkte', icon: Blocks },
  { id: 'blast', name: 'Block Blast', text: 'Zieh Teile aufs Feld und räum Reihen und Spalten ab.', unit: 'Punkte', icon: Grid3x3 },
]

type Phase = { name: 'menu' } | { name: 'play'; game: GameId; run: GameStart } | { name: 'result'; game: GameId; result: GameResult }

/** Spiele gegen einen Bot: Eintritt zahlen, den Bot-Wert übertreffen, Coins gewinnen. */
export default function Games() {
  const wallet = useWallet()
  const settings = useAsync(getAppSettings, [])
  const [phase, setPhase] = useState<Phase>({ name: 'menu' })
  const [busy, setBusy] = useState<GameId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fee = settings.data?.game_fee ?? 10
  const reward = settings.data?.game_reward ?? 20

  async function start(game: GameId) {
    setBusy(game)
    setError(null)
    try {
      const run = await startGame(game)
      wallet.setBalance(run.balance)
      setPhase({ name: 'play', game, run })
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  if (phase.name === 'play') {
    return <Playing game={phase.game} run={phase.run} onDone={(result) => { wallet.setBalance(result.balance); setPhase({ name: 'result', game: phase.game, result }) }} />
  }

  if (phase.name === 'result') {
    const g = GAMES.find((x) => x.id === phase.game)!
    const r = phase.result
    return (
      <div className="mx-auto max-w-md">
        <PageHeader eyebrow={g.name} title={r.won ? 'Bot geschlagen!' : 'Der Bot war besser'} />
        <Card className="space-y-3 text-center">
          <Trophy size={40} className={`mx-auto ${r.won ? 'text-amber-300' : 'text-slate-600'}`} />
          <p className="font-mono text-4xl text-accent-cyan">{r.score} <span className="text-base text-slate-400">{g.unit}</span></p>
          <p className="text-sm text-slate-400">Bot: {r.bot_score} {g.unit}</p>
          {r.won && r.reward > 0 && <Notice tone="ok">+{r.reward} Coins gewonnen!</Notice>}
          {r.won && r.reward === 0 && <Notice tone="info">Gewonnen – aber das Tageslimit für Gewinn-Coins ist erreicht.</Notice>}
        </Card>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button onClick={() => void start(phase.game)} busy={busy === phase.game} disabled={wallet.balance < fee}>
            <CoinIcon size={16} /> Nochmal ({fee} Coins)
          </Button>
          <Button variant="secondary" onClick={() => setPhase({ name: 'menu' })}>Zur Auswahl</Button>
        </div>
        {error && <div className="mt-4"><ErrorBox message={error} /></div>}
      </div>
    )
  }

  return (
    <div>
      <PageHeader eyebrow="Pause vom Lernen" title="Spiele" />
      <Notice tone="info">
        Jede Runde kostet <b>{fee} Coins</b>. Der Bot hat ein Ziel, das du vorher siehst. Schlägst du es, bekommst du <b>{reward} Coins</b> (begrenzt pro Tag).
      </Notice>
      {error && <div className="mt-4"><ErrorBox message={error} /></div>}
      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        {GAMES.map((g) => (
          <Card key={g.id} className="flex flex-col gap-3">
            <g.icon className="text-accent-violet" size={30} />
            <h2 className="text-xl font-semibold">{g.name}</h2>
            <p className="flex-1 text-sm text-slate-400">{g.text}</p>
            <Button busy={busy === g.id} disabled={wallet.balance < fee} onClick={() => void start(g.id)}>
              <CoinIcon size={16} /> Spielen · {fee}
            </Button>
          </Card>
        ))}
      </div>
      {wallet.balance < fee && <p className="mt-3 text-sm text-amber-200">Dir fehlen Coins – lerne ein paar Vokabeln oder mach einen Sprint.</p>}
    </div>
  )
}

function Playing({ game, run, onDone }: { game: GameId; run: GameStart; onDone: (r: GameResult) => void }) {
  useFocusMode(true)
  const g = GAMES.find((x) => x.id === game)!
  const [score, setScore] = useState(0)
  const scoreRef = useRef(0)
  const [finalScore, setFinalScore] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmQuit, setConfirmQuit] = useState(false)
  const sent = useRef(false)

  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [])

  async function send(s: number) {
    setError(null)
    try {
      onDone(await finishGame(run.id, s))
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  function over(s: number) {
    if (sent.current) return
    sent.current = true
    setFinalScore(s)
    void send(s)
  }

  const props = {
    onScore: (s: number) => {
      scoreRef.current = s
      setScore(s)
    },
    onOver: over,
  }

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-4 space-y-2">
        <div className="flex items-center justify-between">
          <span className="label-mono">{g.name}</span>
          <span className="font-mono text-sm text-slate-300">
            <span className="text-accent-cyan">{score}</span> / Bot {run.bot_score} {g.unit}
          </span>
          <Button variant="ghost" onClick={() => setConfirmQuit(true)} disabled={finalScore !== null}>Aufgeben</Button>
        </div>
        <ProgressBar value={(score / Math.max(run.bot_score, 1)) * 100} label="Fortschritt gegen den Bot" />
      </div>
      {finalScore !== null && !error && <p className="mb-3 text-center text-sm text-slate-400">Ergebnis wird gewertet …</p>}
      {error && <ErrorBox message={error} onRetry={() => void send(finalScore ?? scoreRef.current)} />}
      {game === 'snake' && <SnakeGame {...props} />}
      {game === 'tetris' && <TetrisGame {...props} />}
      {game === 'blast' && <BlastGame {...props} />}
      {confirmQuit && (
        <Modal title="Aufgeben?" onClose={() => setConfirmQuit(false)}>
          <p className="text-sm text-slate-300">Die Runde wird mit deinem aktuellen Stand gewertet. Der Eintritt ist weg.</p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setConfirmQuit(false)}>Weiterspielen</Button>
            <Button onClick={() => { setConfirmQuit(false); over(scoreRef.current) }}>Beenden</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
