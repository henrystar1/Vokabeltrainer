import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Search, X, Zap } from 'lucide-react'
import PlayerTag from '../components/profile/PlayerTag'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import PageHeader from '../components/ui/PageHeader'
import { Notice, ErrorBox } from '../components/ui/States'
import { TextInput, Select } from '../components/ui/Field'
import { errorMessage } from '../lib/errors'
import { liveCreate, searchPlayers } from '../services/play'
import type { PlayerHit } from '../types'

/** Live-Duell anlegen: bis zu 3 Mitspieler einladen, Lobby öffnen, dann geht es gemeinsam los. */
export default function LiveDuel() {
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<PlayerHit[] | null>(null)
  const [picked, setPicked] = useState<PlayerHit[]>([])
  const [count, setCount] = useState(10)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function search() {
    setError(null)
    try {
      setHits(await searchPlayers(q.trim()))
    } catch (e) {
      setError(errorMessage(e))
    }
  }
  const toggle = (p: PlayerHit) =>
    setPicked((cur) => (cur.some((x) => x.user_id === p.user_id) ? cur.filter((x) => x.user_id !== p.user_id) : cur.length >= 3 ? cur : [...cur, p]))

  async function open() {
    setBusy(true)
    setError(null)
    try {
      nav(`/live-duell/${await liveCreate(picked.map((p) => p.user_id), count)}`)
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <PageHeader eyebrow="Zusammenlernen" title="Live-Duell" />
      <Notice tone="info">
        Du lädst bis zu 3 Mitspieler ein, wartest in der Lobby, bis sie da sind, und dann geht es gleichzeitig los. Dabei siehst du live auf einem Strahl mit Profilbild, wie weit alle sind. Es gelten Vokabeln, die ihr <b>alle</b> aktiv habt. Wer die meisten richtig hat (bei Gleichstand der Schnellste), gewinnt.
      </Notice>
      <Card className="space-y-4">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void search() }}>
          <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name suchen (mind. 2 Zeichen)" aria-label="Spielername" />
          <Button type="submit" disabled={q.trim().length < 2} aria-label="Suchen"><Search size={18} /></Button>
        </form>
        {hits && hits.length === 0 && <p className="text-sm text-slate-400">Niemand gefunden.</p>}
        <ul className="space-y-1">
          {hits?.map((p) => {
            const on = picked.some((x) => x.user_id === p.user_id)
            return (
              <li key={p.user_id} className="flex min-h-[52px] items-center gap-3 rounded-xl px-2">
                <span className="min-w-0 flex-1"><PlayerTag name={p.display_name} cosmetics={p} size={34} /></span>
                <Button variant={on ? 'primary' : 'secondary'} disabled={!on && picked.length >= 3} onClick={() => toggle(p)}>{on ? 'Eingeladen' : 'Einladen'}</Button>
              </li>
            )
          })}
        </ul>
        {picked.length > 0 && (
          <div>
            <p className="label-mono mb-2">Mitspieler ({picked.length + 1} mit dir)</p>
            <ul className="flex flex-wrap gap-2">
              {picked.map((p) => (
                <li key={p.user_id} className="flex items-center gap-1 rounded-full bg-white/5 py-1 pl-3 pr-1 text-sm">
                  {p.display_name}
                  <button type="button" onClick={() => toggle(p)} aria-label={`${p.display_name} entfernen`} className="rounded-full p-1.5 hover:bg-white/10"><X size={14} /></button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div>
          <label htmlFor="live-count" className="label-mono">Anzahl Fragen</label>
          <Select id="live-count" value={String(count)} onChange={(e) => setCount(Number(e.target.value))}>
            {[5, 10, 15, 20].map((n) => <option key={n} value={n}>{n} Fragen</option>)}
          </Select>
        </div>
        {error && <ErrorBox message={error} />}
        <Button className="w-full min-h-[52px]" busy={busy} disabled={picked.length === 0} onClick={() => void open()}>
          <Zap size={18} /> Lobby öffnen
        </Button>
      </Card>
      <Link to="/duell" className="inline-block text-sm text-accent-cyan hover:underline">Zurück zu den Duellen</Link>
    </div>
  )
}
