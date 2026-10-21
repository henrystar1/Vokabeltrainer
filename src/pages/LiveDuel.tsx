import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { School, Search, X, Zap } from 'lucide-react'
import PlayerTag from '../components/profile/PlayerTag'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import PageHeader from '../components/ui/PageHeader'
import { Notice, ErrorBox } from '../components/ui/States'
import { TextInput, Select } from '../components/ui/Field'
import { errorMessage } from '../lib/errors'
import { liveCreate, liveJoinCode, searchPlayers } from '../services/play'
import { listBooks } from '../services/books'
import { useAsync } from '../lib/useAsync'
import type { PlayerHit } from '../types'

/** Live-Duell anlegen: bis zu 3 Mitspieler einladen, Lobby öffnen, dann geht es gemeinsam los. */
export default function LiveDuel() {
  const nav = useNavigate()
  const [mode, setMode] = useState<'duel' | 'class'>('duel')
  const [bookId, setBookId] = useState('')
  const [code, setCode] = useState('')
  const books = useAsync(listBooks, [])
  const maxInvites = mode === 'class' ? 19 : 3
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
    setPicked((cur) => (cur.some((x) => x.user_id === p.user_id) ? cur.filter((x) => x.user_id !== p.user_id) : cur.length >= maxInvites ? cur : [...cur, p]))

  async function open() {
    setBusy(true)
    setError(null)
    try {
      nav(`/live-duell/${await liveCreate(picked.map((p) => p.user_id), count, mode === 'class' ? bookId : null)}`)
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  async function join() {
    setBusy(true)
    setError(null)
    try {
      nav(`/live-duell/${await liveJoinCode(code)}`)
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <PageHeader eyebrow="Zusammenlernen" title={mode === 'class' ? 'Klassen-Battle' : 'Live-Duell'} />
      <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Art">
        {([['duel', 'Live-Duell · bis 4', Zap], ['class', 'Klassen-Battle · bis 20', School]] as const).map(([k, label, Icon]) => (
          <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => { setMode(k); setPicked((c) => c.slice(0, k === 'class' ? 19 : 3)) }}
            className={`flex min-h-[48px] items-center justify-center gap-2 rounded-xl border text-sm font-semibold transition ${mode === k ? 'border-fuchsia-300/60 bg-fuchsia-400/15 text-fuchsia-200' : 'border-white/10 bg-white/5 text-slate-300'}`}>
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>
      <Card className="space-y-3">
        <p className="label-mono">Mit Code beitreten</p>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void join() }}>
          <TextInput value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={4} placeholder="CODE" aria-label="Raum-Code" className="font-mono uppercase tracking-[0.3em]" />
          <Button type="submit" busy={busy} disabled={code.trim().length < 4}>Beitreten</Button>
        </form>
      </Card>
      <Notice tone="info">
        {mode === 'class' ? (
          <>Für die ganze Klasse: Du wählst ein Buch, öffnest einen Raum und alle (bis 20) treten mit dem <b>Code</b> bei oder werden eingeladen. Gefragt werden Vokabeln aus dem Buch, egal ob aktiv. Oben siehst du live die Besten auf ihren Strahlen.</>
        ) : (<>Du lädst bis zu 3 Mitspieler ein, wartest in der Lobby, bis sie da sind, und dann geht es gleichzeitig los. Dabei siehst du live auf einem Strahl mit Profilbild, wie weit alle sind. Es gelten Vokabeln, die ihr <b>alle</b> aktiv habt. Wer die meisten richtig hat (bei Gleichstand der Schnellste), gewinnt.</>)}
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
                <Button variant={on ? 'primary' : 'secondary'} disabled={!on && picked.length >= maxInvites} onClick={() => toggle(p)}>{on ? 'Eingeladen' : 'Einladen'}</Button>
              </li>
            )
          })}
        </ul>
        {picked.length > 0 && (
          <div>
            <p className="label-mono mb-2">Eingeladen ({picked.length + 1} mit dir, höchstens {maxInvites + 1})</p>
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
        {mode === 'class' && (
          <div>
            <label htmlFor="live-book" className="label-mono">Buch für die Fragen</label>
            <Select id="live-book" value={bookId} onChange={(e) => setBookId(e.target.value)}>
              <option value="">Buch wählen …</option>
              {books.data?.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.vocab_count} Vokabeln)</option>)}
            </Select>
          </div>
        )}
        <div>
          <label htmlFor="live-count" className="label-mono">Anzahl Fragen</label>
          <Select id="live-count" value={String(count)} onChange={(e) => setCount(Number(e.target.value))}>
            {(mode === 'class' ? [10, 15, 20, 30] : [5, 10, 15, 20]).map((n) => <option key={n} value={n}>{n} Fragen</option>)}
          </Select>
        </div>
        {error && <ErrorBox message={error} />}
        <Button className="w-full min-h-[52px]" busy={busy} disabled={mode === 'class' ? bookId === '' : picked.length === 0} onClick={() => void open()}>
          <Zap size={18} /> {mode === 'class' ? 'Raum öffnen' : 'Lobby öffnen'}
        </Button>
      </Card>
      <Link to="/duell" className="inline-block text-sm text-accent-cyan hover:underline">Zurück zu den Duellen</Link>
    </div>
  )
}
