import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, Swords } from 'lucide-react'
import PlayerTag from '../components/profile/PlayerTag'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import PageHeader from '../components/ui/PageHeader'
import { Notice, EmptyState, ErrorBox, Spinner } from '../components/ui/States'
import { TextInput } from '../components/ui/Field'
import { errorMessage } from '../lib/errors'
import { useAsync } from '../lib/useAsync'
import { cancelDuel, createDuel, listDuels, searchPlayers } from '../services/play'
import type { Duel, PlayerHit } from '../types'

function resultText(d: Duel): string {
  if (d.status === 'cancelled') return 'Abgebrochen'
  if (d.status === 'finished') {
    const score = `${d.my_correct}/${d.my_total} gegen ${d.opp_correct}`
    return d.winner === 'me' ? `Gewonnen · ${score}` : d.winner === 'opp' ? `Verloren · ${score}` : `Unentschieden · ${score}`
  }
  return d.my_done ? `Du: ${d.my_correct}/${d.my_total} – wartet auf ${d.opponent_name}` : 'Du bist dran'
}

/** Zusammenlernen: Duelle mit Freunden. Beide spielen dieselben Fragen, wann sie wollen. */
export default function Duels() {
  const nav = useNavigate()
  const duels = useAsync(listDuels, [])
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function cancel(id: string) {
    setError(null)
    try {
      await cancelDuel(id)
      duels.reload()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  const all = duels.data ?? []
  const mine = all.filter((d) => d.status === 'open' && !d.my_done)
  const waiting = all.filter((d) => d.status === 'open' && d.my_done)
  const done = all.filter((d) => d.status !== 'open')

  const section = (title: string, list: Duel[]) =>
    list.length > 0 && (
      <section>
        <h2 className="label-mono mb-2">{title}</h2>
        <Card className="p-2">
          <ul>
            {list.map((d) => (
              <li key={d.id} className="flex min-h-[56px] flex-wrap items-center gap-3 rounded-xl px-3 py-2">
                <span className="min-w-0 flex-1">
                  <PlayerTag name={d.opponent_name} cosmetics={d.opponent} size={34} />
                  <span className="mt-0.5 block text-xs text-slate-400">{resultText(d)}</span>
                </span>
                {d.status === 'open' && !d.my_done && <Button onClick={() => nav(`/duell/${d.id}`)}><Swords size={16} /> Spielen</Button>}
                {d.status === 'open' && d.i_am_challenger && (
                  <Button variant="ghost" onClick={() => void cancel(d.id)}>Abbrechen</Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </section>
    )

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Zusammenlernen" title="Duelle" actions={<Button onClick={() => setCreating(true)}><Plus size={18} /> Neues Duell</Button>} />
      <Notice tone="info">
        Du forderst einen Freund heraus: ihr bekommt dieselben 10 Fragen aus Vokabeln, die ihr beide aktiv habt (Online-Bücher). Jeder spielt, wann er will – wer mehr richtig hat (bei Gleichstand: wer schneller war), gewinnt Koins.
      </Notice>
      {error && <ErrorBox message={error} />}
      {duels.loading && !duels.data && <Spinner />}
      {duels.error && <ErrorBox message={duels.error} onRetry={duels.reload} />}
      {duels.data && all.length === 0 && <EmptyState title="Noch keine Duelle" text="Such dir einen Mitschüler und fordere ihn heraus." />}
      {section('Du bist dran', mine)}
      {section('Wartet auf den Gegner', waiting)}
      {section('Beendet', done)}
      {creating && (
        <NewDuel
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            duels.reload()
          }}
        />
      )}
    </div>
  )
}

function NewDuel({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<PlayerHit[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function search() {
    setError(null)
    try {
      setHits(await searchPlayers(q.trim()))
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  async function challenge(p: PlayerHit) {
    setBusy(p.user_id)
    setError(null)
    try {
      await createDuel(p.user_id, 10)
      onCreated()
    } catch (e) {
      setError(errorMessage(e))
      setBusy(null)
    }
  }

  return (
    <Modal title="Freund herausfordern" onClose={onClose}>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void search()
        }}
      >
        <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name suchen (mind. 2 Zeichen)" aria-label="Spielername" />
        <Button type="submit" disabled={q.trim().length < 2} aria-label="Suchen"><Search size={18} /></Button>
      </form>
      {error && <div className="mt-3"><ErrorBox message={error} /></div>}
      {hits && hits.length === 0 && <p className="mt-4 text-sm text-slate-400">Niemand gefunden.</p>}
      <ul className="mt-4 space-y-1">
        {hits?.map((p) => (
          <li key={p.user_id} className="flex min-h-[52px] items-center gap-3 rounded-xl px-2">
            <span className="min-w-0 flex-1"><PlayerTag name={p.display_name} cosmetics={p} size={34} /></span>
            <Button variant="secondary" busy={busy === p.user_id} onClick={() => void challenge(p)}>Herausfordern</Button>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
