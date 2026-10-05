import { useEffect, useRef, useState } from 'react'
import { Blocks, Bird, Crown, Footprints, Gamepad2, Grid3x3, Trophy } from 'lucide-react'
import PlayerTag from '../components/profile/PlayerTag'
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
import CrossyGame from '../features/games/CrossyGame'
import FlappyGame from '../features/games/FlappyGame'
import SnakeGame from '../features/games/SnakeGame'
import TetrisGame from '../features/games/TetrisGame'
import { errorMessage } from '../lib/errors'
import { useAsync } from '../lib/useAsync'
import { getAppSettings } from '../services/koins'
import { finishGame, getGameBoard, startGame, type GameBoardRow, type GameId, type GameResult, type GameStart } from '../services/play'

const GAMES: Array<{ id: GameId; name: string; text: string; unit: string; icon: typeof Gamepad2 }> = [
  { id: 'snake', name: 'Snake', text: 'Friss Äpfel, werde länger, stoß nirgends an.', unit: 'Äpfel', icon: Gamepad2 },
  { id: 'tetris', name: 'Tetris', text: 'Stapel die Blöcke und lösche Reihen.', unit: 'Punkte', icon: Blocks },
  { id: 'blast', name: 'Block Blast', text: 'Zieh Teile aufs Feld und räum Reihen und Spalten ab.', unit: 'Punkte', icon: Grid3x3 },
  { id: 'crossy', name: 'Crossy Road', text: 'Bring das Huhn über Straßen und Wiesen – ohne überfahren zu werden.', unit: 'Reihen', icon: Footprints },
  { id: 'flappy', name: 'Flappy Bird', text: 'Flatter durch die Lücken der Röhren.', unit: 'Röhren', icon: Bird },
]

type Phase = { name: 'menu' } | { name: 'play'; game: GameId; run: GameStart } | { name: 'result'; game: GameId; result: GameResult }

/** Spiele mit Bestenliste aller Nutzer: Eintritt zahlen, den Rekord brechen, Coins bekommen. */
export default function Games() {
  const wallet = useWallet()
  const settings = useAsync(getAppSettings, [])
  const [phase, setPhase] = useState<Phase>({ name: 'menu' })
  const [busy, setBusy] = useState<GameId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fee = settings.data?.game_fee ?? 10
  const reward = settings.data?.game_record_reward ?? 10
  const [boardOf, setBoardOf] = useState<GameId | null>(null)
  const boards = useAsync(async () => Object.fromEntries(await Promise.all(GAMES.map(async (g) => [g.id, await getGameBoard(g.id).catch(() => [] as GameBoardRow[])]))) as Record<GameId, GameBoardRow[]>, [phase.name === 'menu'])

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
        <PageHeader eyebrow={g.name} title={r.record ? 'Neuer Rekord!' : 'Geschafft'} />
        <Card className="space-y-3 text-center">
          <Trophy size={40} className={`mx-auto ${r.record ? 'text-amber-300' : 'text-slate-600'}`} />
          <p className="font-mono text-4xl text-accent-cyan">{r.score} <span className="text-base text-slate-400">{g.unit}</span></p>
          <p className="text-sm text-slate-400">Bisheriger Rekord: {r.prev_record} {g.unit}</p>
          {r.record && r.reward > 0 && <Notice tone="ok">+{r.reward} Coins für den neuen Rekord!</Notice>}
          {!r.record && <Notice tone="info">Um den Rekord zu brechen, brauchst du mehr als {r.prev_record} {g.unit}.</Notice>}
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
        Jede Runde kostet <b>{fee} Coins</b>. Es zählen die Bestwerte aller Spieler. Wer einen Rekord bricht, bekommt <b>{reward} Coins</b>.
      </Notice>
      {error && <div className="mt-4"><ErrorBox message={error} /></div>}
      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {GAMES.map((g) => (
          <Card key={g.id} className="flex flex-col gap-3">
            <g.icon className="text-accent-violet" size={30} />
            <h2 className="text-xl font-semibold">{g.name}</h2>
            <p className="flex-1 text-sm text-slate-400">{g.text}</p>
            <button type="button" onClick={() => setBoardOf(g.id)} className="flex min-h-[44px] items-center gap-2 rounded-xl bg-white/5 px-3 text-left text-sm hover:bg-white/10">
              <Crown size={16} className="shrink-0 text-amber-300" />
              {boards.data?.[g.id]?.[0] ? (
                <span className="min-w-0 truncate"><b className="font-mono text-accent-cyan">{boards.data[g.id][0].score}</b> {g.unit} · {boards.data[g.id][0].display_name}</span>
              ) : (
                <span className="text-slate-500">Noch kein Rekord – du kannst der Erste sein</span>
              )}
            </button>
            <Button busy={busy === g.id} disabled={wallet.balance < fee} onClick={() => void start(g.id)}>
              <CoinIcon size={16} /> Spielen · {fee}
            </Button>
          </Card>
        ))}
      </div>
      {boardOf && (
        <Modal title={`Bestenliste · ${GAMES.find((x) => x.id === boardOf)?.name}`} onClose={() => setBoardOf(null)}>
          {(boards.data?.[boardOf] ?? []).length === 0 ? (
            <p className="text-sm text-slate-400">Noch niemand hat gespielt.</p>
          ) : (
            <ol className="space-y-2">
              {boards.data![boardOf].map((r) => (
                <li key={`${r.rank}-${r.display_name}`} className={`flex items-center gap-3 rounded-xl px-2 py-1.5 ${r.is_me ? 'bg-accent-cyan/10' : ''}`}>
                  <span className="w-7 text-right font-mono text-sm text-slate-400">{r.rank}.</span>
                  <span className="min-w-0 flex-1"><PlayerTag name={r.display_name} cosmetics={r} size={32} /></span>
                  <span className="font-mono text-accent-cyan">{r.score}</span>
                </li>
              ))}
            </ol>
          )}
        </Modal>
      )}
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
            <span className="text-accent-cyan">{score}</span> {g.unit} · Rekord {Math.max(run.record, score)}
          </span>
          <Button variant="ghost" onClick={() => setConfirmQuit(true)} disabled={finalScore !== null}>Aufgeben</Button>
        </div>
        <ProgressBar value={(score / Math.max(run.record, 1)) * 100} label="Fortschritt zum Rekord" />
      </div>
      {finalScore !== null && !error && <p className="mb-3 text-center text-sm text-slate-400">Ergebnis wird gewertet …</p>}
      {error && <ErrorBox message={error} onRetry={() => void send(finalScore ?? scoreRef.current)} />}
      {game === 'snake' && <SnakeGame {...props} />}
      {game === 'tetris' && <TetrisGame {...props} />}
      {game === 'blast' && <BlastGame {...props} />}
      {game === 'crossy' && <CrossyGame {...props} />}
      {game === 'flappy' && <FlappyGame {...props} />}
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
