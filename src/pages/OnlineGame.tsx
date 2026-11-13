import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Trophy } from 'lucide-react'
import { Avatar } from '../components/profile/PlayerTag'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import PageHeader from '../components/ui/PageHeader'
import { ErrorBox, Notice, Spinner } from '../components/ui/States'
import LudoBoard from '../features/online/LudoBoard'
import RpsBoard from '../features/online/RpsBoard'
import ShipsBoard from '../features/online/ShipsBoard'
import { ChessBoard, CheckersBoard } from '../features/online/board/BoardGames'
import ShooterGame from '../features/online/shooter/ShooterGame'
import { RaceLobbyOptions, RaceOnline } from '../features/cars/race/RaceOnline'
import { useGameSync } from '../features/online/useGameSync'
import { errorMessage } from '../lib/errors'
import { OG_NAMES, ogBoardDraw, ogBoardMove, ogBoardResign, ogGet, ogLeave, ogLudoMove, ogLudoRoll, ogRaceLeave, ogRaceReport, ogRaceSet, ogRespond, ogRpsPick, ogShipsPlace, ogShipsShoot, ogShooterLeave, ogShooterReport, ogStart, type OgView } from '../services/online'

/** Ein Online-Spiel: Einladung/Lobby, Spielfeld je Spiel, Ergebnis. Der Server prüft alle Regeln. */
export default function OnlineGame() {
  const { id } = useParams()
  const nav = useNavigate()
  const [view, setView] = useState<OgView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const version = useRef(-1)

  const apply = useCallback((v: OgView) => {
    if (v.version >= version.current) { version.current = v.version; setView(v) }
  }, [])
  const load = useCallback(async () => {
    if (!id) return
    try { apply(await ogGet(id)); setError(null) } catch (e) { setError(errorMessage(e)) }
  }, [id, apply])
  useEffect(() => { version.current = -1; void load() }, [load])

  const active = !!view && (view.status === 'lobby' || view.status === 'running')
  const myTurnNow = !!view && view.status === 'running' && (view.turn_seat === view.me.seat || view.kind === 'rps' || (view.kind === 'ships' && view.state.phase === 'placing'))
  const ping = useGameSync(id, () => void load(), active, myTurnNow ? 20_000 : 8_000)

  const firstAt = view?.kind === 'race' && view.status === 'running' ? view.state.first_at : undefined
  useEffect(() => {
    if (!id || !firstAt) return
    const t = window.setInterval(() => { void ogRaceReport(id, null).then(apply).catch(() => undefined) }, 15_000)
    return () => window.clearInterval(t)
  }, [id, firstAt, apply])

  async function act(fn: () => Promise<OgView>) {
    setBusy(true)
    setError(null)
    try { apply(await fn()); ping() } catch (e) { setError(errorMessage(e)); void load() } finally { setBusy(false) }
  }

  async function decline() {
    if (!id) return
    setBusy(true)
    setError(null)
    try { await ogRespond(id, false); ping(); nav('/mehrspieler') } catch (e) { setError(errorMessage(e)); setBusy(false) }
  }

  if (!id) return null
  if (!view) return error ? <ErrorBox message={error} onRetry={() => void load()} /> : <Spinner />
  const me = view.me
  const winner = view.winner_seat !== null ? view.players.find((p) => p.seat === view.winner_seat) : null
  const invited = me.join_state === 'invited' && view.status === 'lobby'
  const host = view.players.find((p) => p.user_id === view.host_id)

  return (
    <div className="space-y-4">
      <PageHeader eyebrow="Online-Spiel" title={OG_NAMES[view.kind]} />
      <p className="flex flex-wrap items-center gap-3 text-sm text-slate-300">
        {view.players.filter((p) => p.join_state !== 'declined' && p.join_state !== 'left').map((p) => (
          <span key={p.user_id} className="inline-flex items-center gap-1"><Avatar name={p.name} avatarId={p.avatar_id} colorId={p.color_id} size={24} /> {p.name}{p.user_id === me.user_id ? ' (du)' : ''}{p.join_state === 'invited' ? ' · eingeladen' : ''}</span>
        ))}
      </p>
      {error && <ErrorBox message={error} />}

      {view.status === 'cancelled' && <Notice tone="info">Dieses Spiel wurde abgebrochen.</Notice>}

      {invited && (
        <Card className="space-y-3">
          <p>{host?.name ?? 'Jemand'} lädt dich zu <b>{OG_NAMES[view.kind]}</b> ein.</p>
          <div className="flex gap-2">
            <Button busy={busy} onClick={() => void act(async () => (await ogRespond(id, true)) as OgView)}>Mitspielen</Button>
            <Button variant="secondary" busy={busy} onClick={() => void decline()}>Ablehnen</Button>
          </div>
        </Card>
      )}

      {view.status === 'lobby' && !invited && (
        <Card className="space-y-3">
          <p className="text-sm text-slate-300">
            {view.kind === 'ludo' || view.kind === 'shooter' || view.kind === 'race'
              ? `${view.players.filter((p) => p.join_state === 'joined').length} von ${view.players.filter((p) => p.join_state !== 'declined' && p.join_state !== 'left').length} haben zugesagt. ${me.user_id === view.host_id ? 'Starte, sobald alle da sind (mindestens 2).' : `Warte, bis ${host?.name ?? 'der Gastgeber'} startet.`}`
              : 'Warte, bis die Einladung angenommen wird …'}
          </p>
          {view.kind === 'race' && <RaceLobbyOptions view={view} isHost={me.user_id === view.host_id} busy={busy} onSet={(t, l, c) => void act(() => ogRaceSet(id, t, l, c ?? null))} />}
          {(view.kind === 'ludo' || view.kind === 'shooter' || view.kind === 'race') && me.user_id === view.host_id && (
            <Button busy={busy} disabled={view.players.filter((p) => p.join_state === 'joined').length < 2} onClick={() => void act(() => ogStart(id))}>Spiel starten{view.kind === 'shooter' ? ' (kostet dich 50 Coins)' : ''}</Button>
          )}
        </Card>
      )}

      {view.status === 'finished' && (
        <Card className="flex items-center gap-3 border-amber-300/40">
          <Trophy className="shrink-0 text-amber-300" size={32} aria-hidden />
          <div>
            <p className="text-lg font-semibold">{winner ? (winner.user_id === me.user_id ? 'Du hast gewonnen!' : `${winner.name} hat gewonnen.`) : 'Spiel beendet.'}</p>
            {view.kind === 'shooter' && (
              <p className="text-sm text-slate-300">{view.players.filter((p) => p.seat !== null).map((p) => `${p.name}: ${(view.state as unknown as { scores?: Record<string, number> }).scores?.[String(p.seat)] ?? 0}`).join(' · ')}</p>
            )}
            {view.kind === 'race' && view.state.results && <p className="text-sm text-slate-300">{view.players.filter((p) => p.seat !== null).sort((a, b) => (view.state.results?.[String(a.seat)] ?? 1e12) - (view.state.results?.[String(b.seat)] ?? 1e12)).map((p, i) => { const ms = view.state.results?.[String(p.seat)]; return `${i + 1}. ${p.name}${ms ? ` ${(ms / 1000).toFixed(2)} s` : ' (nicht im Ziel)'}` }).join(' · ')}</p>}
            <Link to="/mehrspieler" className="text-sm text-accent-cyan hover:underline">Zurück zu den Online-Spielen</Link>
          </div>
        </Card>
      )}

      {(view.status === 'running' || (view.status === 'finished' && view.kind !== 'shooter' && view.kind !== 'race')) && me.seat !== null && (
        <Card>
          {view.kind === 'rps' && <RpsBoard view={view} busy={busy} onPick={(p) => void act(() => ogRpsPick(id, p))} />}
          {view.kind === 'ludo' && <LudoBoard view={view} busy={busy} onRoll={() => void act(() => ogLudoRoll(id))} onMove={(i) => void act(() => ogLudoMove(id, i))} />}
          {view.kind === 'shooter' && <ShooterGame view={view} onReport={(scores, final) => void act(() => ogShooterReport(id, scores, final))} />}
          {view.kind === 'race' && view.status === 'running' && <RaceOnline view={view} onFinish={(ms) => void act(() => ogRaceReport(id, ms))} />}
          {view.kind === 'chess' && <ChessBoard view={view} busy={busy} onMove={(s, r) => void act(() => ogBoardMove(id, s, r))} onDraw={(a) => void act(() => ogBoardDraw(id, a))} />}
          {view.kind === 'checkers' && <CheckersBoard view={view} busy={busy} onMove={(s, r) => void act(() => ogBoardMove(id, s, r))} onDraw={(a) => void act(() => ogBoardDraw(id, a))} />}
          {view.kind === 'ships' && <ShipsBoard view={view} busy={busy} onPlace={(s) => void act(() => ogShipsPlace(id, s))} onShoot={(r, c) => void act(() => ogShipsShoot(id, r, c))} />}
        </Card>
      )}

      {(view.status === 'running' || (view.status === 'lobby' && !invited)) && (
        <Button variant="danger" className="!min-h-[40px] text-sm" busy={busy} onClick={() => { if (window.confirm(view.status === 'running' ? 'Wirklich aufgeben?' : 'Spiel verlassen?')) void act(() => (view.kind === 'race' && view.status === 'running' ? ogRaceLeave(id) : view.kind === 'shooter' && view.status === 'running' ? ogShooterLeave(id) : (view.kind === 'chess' || view.kind === 'checkers') && view.status === 'running' ? ogBoardResign(id) : ogLeave(id))) }}>
          {view.status === 'running' ? 'Aufgeben' : 'Verlassen'}
        </Button>
      )}
    </div>
  )
}
