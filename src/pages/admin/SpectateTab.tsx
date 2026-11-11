import { useEffect, useState } from 'react'
import { ErrorBox, Spinner } from '../../components/ui/States'
import { useAsync } from '../../lib/useAsync'
import { startState } from '../../features/online/board/checkers'
import { ChessSquares, CheckersSquares } from '../../features/online/board/BoardGames'
import { SIZE, shipCells } from '../../features/online/ships'
import { SEAT_COLORS, SEAT_NAMES } from '../../features/online/ludoBoard'
import { ogSpectateList, ogSpectateView, type Ship, type ShipsShot, type SpectateView } from '../../services/online'
import { errorMessage } from '../../lib/errors'

const startBoard = () => startState().board
const KIND: Record<string, string> = { rps: 'Schnick Schnack Schnuck', ludo: 'Mensch ärgere dich nicht', ships: 'Schiffe versenken', shooter: '3D-Shooter', chess: 'Schach', checkers: 'Dame' }

function ShipGrid({ title, ships, shots }: { title: string; ships: Ship[]; shots: ShipsShot[] }) {
  const mine = new Set(ships.flatMap(shipCells))
  const shot = new Map(shots.map((s) => [s.r * SIZE + s.c, s]))
  return (
    <div>
      <p className="mb-1 text-center text-sm font-medium">{title}</p>
      <div className="mx-auto grid w-full max-w-[300px] grid-cols-10 gap-[2px]">
        {Array.from({ length: SIZE * SIZE }, (_, i) => {
          const s = shot.get(i)
          const ship = mine.has(i)
          const cls = s ? (s.res !== 'miss' ? 'bg-rose-500' : 'bg-slate-500/60') : ship ? 'bg-sky-400' : 'bg-white/10'
          return <div key={i} className={`aspect-square rounded-[3px] ${cls}`} title={s ? (s.res !== 'miss' ? 'Treffer' : 'Wasser') : ship ? 'Schiff' : ''} />
        })}
      </div>
    </div>
  )
}

function Viewer({ id }: { id: string }) {
  const [v, setV] = useState<SpectateView | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const tick = async () => {
      try { const x = await ogSpectateView(id); if (alive) { setV(x); setErr(null) } } catch (e) { if (alive) setErr(errorMessage(e)) }
    }
    void tick()
    const t = setInterval(() => void tick(), 3000)
    return () => { alive = false; clearInterval(t) }
  }, [id])
  if (err) return <ErrorBox message={err} />
  if (!v) return <Spinner />
  const seated = v.players.filter((p) => p.seat !== null)
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-300">{KIND[v.kind] ?? v.kind} · {v.status === 'running' ? 'läuft' : v.status === 'finished' ? 'beendet' : v.status} · {seated.map((p) => p.name).join(' gegen ') || v.players.map((p) => p.name).join(', ')}</p>
      {v.kind === 'ships' && v.state.phase && (
        <div className="grid gap-4 sm:grid-cols-2">
          {seated.map((p) => (
            <ShipGrid key={p.user_id} title={`Flotte von ${p.name}`} ships={p.secret.ships ?? []} shots={v.state.shots?.[String(1 - (p.seat ?? 0))] ?? []} />
          ))}
        </div>
      )}
      {v.kind === 'rps' && (
        <div className="text-sm text-slate-300">
          {seated.map((p) => <p key={p.user_id}>{p.name}: Stand {v.state.score?.[String(p.seat)] ?? 0} · gewählt: <b>{p.secret.pick ?? '–'}</b></p>)}
        </div>
      )}
      {v.kind === 'ludo' && (
        <div className="text-sm text-slate-300">
          {seated.map((p) => (
            <p key={p.user_id}><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full" style={{ background: SEAT_COLORS[p.seat ?? 0] }} />{p.name} ({SEAT_NAMES[p.seat ?? 0]}): Figuren {JSON.stringify(v.state.pieces?.[String(p.seat)] ?? [])}{v.turn_seat === p.seat ? ' ← am Zug' : ''}</p>
          ))}
        </div>
      )}
      {v.kind === 'chess' && <ChessSquares fen={(v.state as { fen?: string }).fen ?? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'} last={(v.state as { last?: number[] }).last} />}
      {v.kind === 'checkers' && <CheckersSquares board={(v.state as unknown as { board?: string[] }).board ?? startBoard()} last={(v.state as unknown as { last?: number[] }).last} />}
      {v.kind === 'shooter' && <pre className="overflow-x-auto rounded-lg bg-black/30 p-3 text-xs text-slate-300">{JSON.stringify(v.state, null, 1)}</pre>}
    </div>
  )
}

/** Admins und freigegebene Mods: laufende Online-Spiele ansehen, auch die Schiffe des Gegners. */
export default function SpectateTab() {
  const list = useAsync(ogSpectateList, [])
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => { const t = setInterval(() => void list.reload(), 8000); return () => clearInterval(t) }, [list])
  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-slate-400">Laufende Online-Spiele. Die Ansicht aktualisiert sich alle paar Sekunden. Du siehst alles, auch geheime Schiffe und Auswahlen – bitte nur für Moderation nutzen.</p>
      {list.loading && !list.data && <Spinner />}
      {list.error && <ErrorBox message={list.error} onRetry={list.reload} />}
      {list.data?.length === 0 && <p className="text-sm text-slate-500">Gerade läuft kein Spiel.</p>}
      <ul className="space-y-2">
        {list.data?.map((g) => (
          <li key={g.id} className="glass rounded-xl p-3">
            <button type="button" onClick={() => setOpen(open === g.id ? null : g.id)} className="flex min-h-[40px] w-full items-center gap-2 text-left">
              <span className="font-medium">{KIND[g.kind] ?? g.kind}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-slate-400">{(g.players ?? []).join(' · ')}</span>
              <span className="text-xs text-slate-500">{g.status === 'lobby' ? 'Lobby' : 'läuft'}</span>
            </button>
            {open === g.id && <div className="mt-3 border-t border-white/10 pt-3"><Viewer id={g.id} /></div>}
          </li>
        ))}
      </ul>
    </div>
  )
}
