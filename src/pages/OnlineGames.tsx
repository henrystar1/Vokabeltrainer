import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Anchor, Car, Castle, Circle, Crosshair, Dices, Hand, Search, X } from 'lucide-react'
import PlayerTag from '../components/profile/PlayerTag'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import { TextInput } from '../components/ui/Field'
import Modal from '../components/ui/Modal'
import PageHeader from '../components/ui/PageHeader'
import { EmptyState, ErrorBox, Spinner } from '../components/ui/States'
import { errorMessage } from '../lib/errors'
import { useAsync } from '../lib/useAsync'
import { OG_NAMES, ogCreate, ogList, type OgKind, type OgListItem } from '../services/online'
import { searchPlayers } from '../services/play'
import type { PlayerHit } from '../types'

const GAMES: Array<{ kind: OgKind; text: string; players: string; icon: typeof Hand }> = [
  { kind: 'rps', text: 'Stein, Papier, Schere: wer zuerst 2 Runden gewinnt.', players: '2 Personen', icon: Hand },
  { kind: 'ludo', text: 'Würfeln, ziehen, rauswerfen – wer bringt zuerst alle Figuren ins Ziel?', players: '2 bis 4 Personen', icon: Dices },
  { kind: 'ships', text: 'Setze deine Flotte und versenke die Schiffe des Gegners.', players: '2 Personen', icon: Anchor },
  { kind: 'chess', text: 'Klassisches Schach mit allen Regeln (Rochade, en passant, Umwandlung). Remis anbieten oder aufgeben jederzeit möglich.', players: '2 Personen', icon: Castle },
  { kind: 'checkers', text: 'Dame nach deutschen Regeln: Schlagzwang, fliegende Damen, Steine schlagen auch rückwärts.', players: '2 Personen', icon: Circle },
  { kind: 'race', text: '3D-Rennen mit deinen Autos: 6 Strecken, 2 bis 4 Personen. Der Ersteller lädt ein, wählt Strecke und Runden. Gas, Bremse und Lenken per Tasten oder Touch.', players: '2 bis 4 Personen', icon: Car },
  { kind: 'shooter', text: '3D-Arena (Maus und Tastatur oder Touch-Steuerung am iPad): wer zuerst 10 Treffer hat (oder die meisten nach 5 Minuten), gewinnt. Mit Panik-Knopf.', players: '2 bis 4 Personen · kostet den Ersteller beim Start 50 Coins', icon: Crosshair },
]

function statusText(g: OgListItem): string {
  if (g.my_state === 'invited') return `Einladung von ${g.host}`
  if (g.status === 'lobby') return 'Wartet auf Mitspieler'
  if (g.status === 'finished') return g.winner_me ? 'Gewonnen!' : 'Beendet'
  return g.my_turn ? 'Du bist dran!' : 'Wartet auf die anderen'
}

/** Online-Spiele gegeneinander: neues Spiel starten (Person suchen und einladen) und laufende Spiele ansehen. */
export default function OnlineGames() {
  const games = useAsync(ogList, [])
  const [pick, setPick] = useState<OgKind | null>(null)
  useEffect(() => {
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') games.reload() }, 30_000)
    return () => window.clearInterval(t)
  }, [games])
  const list = games.data ?? []
  const open = list.filter((g) => g.status === 'lobby' || g.status === 'running')
  const done = list.filter((g) => g.status === 'finished')

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Gegeneinander spielen" title="Online-Spiele" />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {GAMES.map((g) => (
          <Card key={g.kind} className="space-y-2">
            <g.icon size={28} className="text-accent-cyan" aria-hidden />
            <h2 className="font-semibold">{OG_NAMES[g.kind]}</h2>
            <p className="text-sm text-slate-300">{g.text}</p>
            <p className="text-xs text-slate-500">{g.players}</p>
            <Button className="w-full" onClick={() => setPick(g.kind)}>Spiel starten</Button>
          </Card>
        ))}
      </div>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Deine Spiele</h2>
        {games.loading && !games.data && <Spinner />}
        {games.error && <ErrorBox message={games.error} onRetry={games.reload} />}
        {games.data && open.length === 0 && <EmptyState title="Kein Spiel offen" text="Starte oben ein Spiel und lade jemanden ein." />}
        <ul className="space-y-2">
          {open.map((g) => (
            <li key={g.id}>
              <Link to={`/mehrspieler/${g.id}`} className={`glass flex min-h-[56px] items-center gap-3 rounded-2xl p-3 hover:bg-white/10 ${g.my_turn || g.my_state === 'invited' ? 'ring-1 ring-emerald-300/60' : ''}`}>
                <span className="min-w-0 flex-1">
                  <b className="block truncate">{OG_NAMES[g.kind]}</b>
                  <span className="block truncate text-xs text-slate-400">{g.names.join(' · ')}</span>
                </span>
                <span className={`shrink-0 text-sm ${g.my_turn || g.my_state === 'invited' ? 'font-semibold text-emerald-300' : 'text-slate-300'}`}>{statusText(g)}</span>
              </Link>
            </li>
          ))}
        </ul>
        {done.length > 0 && (
          <>
            <h3 className="mb-2 mt-4 text-sm font-semibold text-slate-400">Zuletzt beendet</h3>
            <ul className="space-y-1">
              {done.map((g) => (
                <li key={g.id}><Link to={`/mehrspieler/${g.id}`} className="flex items-center justify-between rounded-xl px-3 py-2 text-sm text-slate-300 hover:bg-white/5"><span>{OG_NAMES[g.kind]} · {g.names.join(', ')}</span><span>{statusText(g)}</span></Link></li>
              ))}
            </ul>
          </>
        )}
      </section>
      {pick && <NewGame kind={pick} onClose={() => setPick(null)} />}
    </div>
  )
}

function NewGame({ kind, onClose }: { kind: OgKind; onClose: () => void }) {
  const nav = useNavigate()
  const max = kind === 'ludo' || kind === 'shooter' || kind === 'race' ? 3 : 1
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<PlayerHit[] | null>(null)
  const [chosen, setChosen] = useState<PlayerHit[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function search() {
    setError(null)
    try { setHits(await searchPlayers(q.trim())) } catch (e) { setError(errorMessage(e)) }
  }
  function toggle(p: PlayerHit) {
    setChosen((c) => (c.some((x) => x.user_id === p.user_id) ? c.filter((x) => x.user_id !== p.user_id) : c.length < max ? [...c, p] : max === 1 ? [p] : c))
  }
  async function create() {
    setBusy(true)
    setError(null)
    try { nav(`/mehrspieler/${await ogCreate(kind, chosen.map((c) => c.user_id))}`) } catch (e) { setError(errorMessage(e)); setBusy(false) }
  }

  return (
    <Modal title={OG_NAMES[kind]} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-slate-300">{max === 1 ? 'Suche die Person, gegen die du spielen willst.' : 'Suche bis zu 3 Personen. Du kannst auch mit 2 starten.'}</p>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (q.trim().length >= 2) void search() }}>
          <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name suchen …" aria-label="Name suchen" />
          <Button type="submit" variant="secondary" aria-label="Suchen"><Search size={16} /></Button>
        </form>
        {chosen.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {chosen.map((p) => (
              <li key={p.user_id}><button type="button" onClick={() => toggle(p)} className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-3 py-1 text-sm">{p.display_name} <X size={13} /></button></li>
            ))}
          </ul>
        )}
        {hits && (hits.length === 0 ? <p className="text-sm text-slate-400">Niemand gefunden.</p> : (
          <ul className="max-h-56 space-y-1 overflow-auto">
            {hits.map((p) => (
              <li key={p.user_id}>
                <button type="button" onClick={() => toggle(p)} className={`flex min-h-[44px] w-full items-center rounded-xl px-2 text-left hover:bg-white/10 ${chosen.some((x) => x.user_id === p.user_id) ? 'bg-emerald-500/10' : ''}`}>
                  <PlayerTag name={p.display_name} cosmetics={p} />
                </button>
              </li>
            ))}
          </ul>
        ))}
        {error && <ErrorBox message={error} />}
        <Button className="w-full" busy={busy} disabled={chosen.length === 0} onClick={() => void create()}>Einladen und starten</Button>
      </div>
    </Modal>
  )
}
