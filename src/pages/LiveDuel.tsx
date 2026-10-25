import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { Footprints, Minus, Plus, School, Search, Users, X, Zap } from 'lucide-react'
import PlayerTag, { Avatar } from '../components/profile/PlayerTag'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import PageHeader from '../components/ui/PageHeader'
import { Notice, ErrorBox } from '../components/ui/States'
import { TextInput, Select } from '../components/ui/Field'
import { errorMessage } from '../lib/errors'
import { liveCreate, liveJoinCode, liveJoinOpen, liveOpenClasses, searchPlayers, teamCreate, teamSetBots, type OpenClass } from '../services/play'
import { listBooks } from '../services/books'
import { MAX_BOTS, SKILL_NAMES, SKILL_ORDER, encodeMix, mixTotal, type Mix } from '../features/parkour/botmix'
import { useAsync } from '../lib/useAsync'
import type { PlayerHit } from '../types'

/** Live-Duell anlegen: bis zu 3 Mitspieler einladen, Lobby öffnen, dann geht es gemeinsam los. */
export default function LiveDuel() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const [mode, setMode] = useState<'duel' | 'class' | 'team'>(params.get('modus') === 'team' ? 'team' : 'duel')
  const [open, setOpen] = useState<OpenClass[]>([])
  const [obstacles, setObstacles] = useState(10)
  const [teamKind, setTeamKind] = useState<'parkour' | 'deathrun' | 'quiz'>(params.get('art') === 'deathrun' ? 'deathrun' : 'parkour')
  const [bookId, setBookId] = useState('')
  const [mix, setMix] = useState<Mix>([0, 0, 0, 0, 0])
  const bumpMix = (k: number, d: number) => setMix((m) => { const n: Mix = [...m]; n[k - 1] = Math.max(0, n[k - 1] + d); return mixTotal(n) > MAX_BOTS ? m : n })
  const [code, setCode] = useState('')
  const books = useAsync(listBooks, [])
  const maxInvites = mode === 'class' ? 19 : mode === 'team' ? (teamKind !== 'quiz' ? 4 : 1) : 3
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<PlayerHit[] | null>(null)
  const [picked, setPicked] = useState<PlayerHit[]>([])
  const [count, setCount] = useState(10)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Offene Klassen-Battles alle paar Sekunden neu laden
  useEffect(() => {
    if (mode !== 'class') return
    let alive = true
    const load = async () => {
      if (document.visibilityState !== 'visible') return
      const r = await liveOpenClasses().catch(() => null)
      if (alive && r) setOpen(r)
    }
    void load()
    const t = window.setInterval(() => void load(), 4000)
    return () => { alive = false; window.clearInterval(t) }
  }, [mode])


  async function joinOpen(id: string) {
    setBusy(true)
    setError(null)
    try {
      nav(`/live-duell/${await liveJoinOpen(id)}`)
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

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

  async function create() {
    setBusy(true)
    setError(null)
    try {
      if (mode === 'team') {
        const id = await teamCreate(picked[0].user_id, obstacles, teamKind, picked.slice(1, 4).map((p) => p.user_id))
        // Deathrun: gewählte Bots gleich mit anlegen (in der Lobby jederzeit änderbar)
        if (teamKind === 'deathrun' && mixTotal(mix) > 0) await teamSetBots(id, mixTotal(mix), encodeMix(mix)).catch(() => undefined)
        nav(`/team/${id}`)
      }
      else nav(`/live-duell/${await liveCreate(picked.map((p) => p.user_id), count, mode === 'class' ? bookId : null)}`)
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
      <PageHeader eyebrow="Zusammenlernen" title={mode === 'class' ? 'Klassen-Battle' : mode === 'team' ? (teamKind === 'deathrun' ? 'Deathrun' : 'Team-Parkour') : 'Live-Duell'} />
      <div className="grid grid-cols-3 gap-2" role="tablist" aria-label="Art">
        {([['duel', 'Live-Duell · bis 4', Zap], ['class', 'Klassen-Battle · bis 20', School], ['team', 'Team-Parkour · bis 5', Footprints]] as const).map(([k, label, Icon]) => (
          <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => { setMode(k); setPicked((c) => c.slice(0, k === 'class' ? 19 : k === 'team' ? (teamKind !== 'quiz' ? 4 : 1) : 3)) }}
            className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 rounded-xl border px-1 text-center text-xs font-semibold sm:flex-row sm:gap-2 sm:text-sm transition ${mode === k ? 'border-fuchsia-300/60 bg-fuchsia-400/15 text-fuchsia-200' : 'border-white/10 bg-white/5 text-slate-300'}`}>
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>
      {mode === 'class' && (
        <Card className="space-y-3">
          <p className="label-mono">Offene Klassen-Battles</p>
          {open.length === 0 ? (
            <p className="text-sm text-slate-400">Gerade ist kein Raum offen. Öffne unten selbst einen.</p>
          ) : (
            <ul className="space-y-2">
              {open.map((c) => (
                <li key={c.duel_id}>
                  <button type="button" disabled={busy} onClick={() => void joinOpen(c.duel_id)}
                    className="flex min-h-[60px] w-full items-center gap-3 rounded-2xl border border-fuchsia-400/30 bg-fuchsia-500/5 px-3 text-left transition hover:border-fuchsia-300/70 hover:bg-fuchsia-500/10 disabled:opacity-60">
                    <Avatar name={c.host_name} avatarId={c.host_avatar_id} colorId={c.host_color_id} size={40} />
                    <span className="min-w-0 flex-1">
                      <b className="block truncate">{c.book_name ?? 'Klassen-Battle'}</b>
                      <span className="block truncate text-sm text-slate-400">von {c.host_name}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1 font-mono text-sm text-fuchsia-200"><Users size={14} /> {c.players}/{c.max_players}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {mode === 'team' && <Link to="/rangliste" className="block text-sm text-accent-cyan hover:underline">Bestenlisten für Parkour und Deathrun: unter „Rangliste“</Link>}
      {mode !== 'team' && (
      <Card className="space-y-3">
        <p className="label-mono">Mit Code beitreten</p>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void join() }}>
          <TextInput value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={4} placeholder="CODE" aria-label="Raum-Code" className="font-mono uppercase tracking-[0.3em]" />
          <Button type="submit" busy={busy} disabled={code.trim().length < 4}>Beitreten</Button>
        </form>
      </Card>
      )}
      <Notice tone="info">
        {mode === 'team' ? (
          teamKind === 'deathrun'
            ? <><b>Deathrun</b> für 2 bis 5 Personen: Jeder läuft für sich, mit eigenen Herzen und eigenem Level. Wer im Ziel ist, ist sofort im nächsten Level (die Level hören nie auf und werden immer schwerer). Wer keine Herzen mehr hat, scheidet aus. Tore und Brücken öffnen sich nur, wenn jemand im selben Level auf der Platte steht, also helft euch gegenseitig! Wer allein im Level ist, für den sind alle Tore offen. Alle sollen so weit kommen wie möglich, jeder bekommt Coins für sein Level.</>
            : teamKind === 'parkour'
            ? <>Ein Jump-and-Run für <b>2 bis 5 Personen</b> mit Joystick und Sprungknopf (Doppelsprung: Knopf zweimal tippen): Level ohne Ende (die ersten 8 sind handgebaut, danach kommen zufällige), die immer schwerer werden und nur gemeinsam gehen. Steht auf Platten, damit Türen und Brücken offen bleiben. Ihr habt 3 gemeinsame Herzen (ab der dritten Person eins mehr, dazu Extra-Herzen aus dem Parkour-Shop), ein Sturz kostet eins, ein geschafftes Level bringt eins zurück. Je weiter ihr kommt, desto mehr Coins.</>
            : <>Ihr zwei lauft gemeinsam einen Vokabel-Parcours. An jedem Hindernis bekommt <b>jeder</b> eine eigene Vokabel, und ihr kommt nur weiter, wenn <b>beide</b> richtig antworten. Jede falsche Antwort kostet ein gemeinsames Leben.</>
        ) : mode === 'class' ? (
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
        {mode === 'team' && (
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Art des Team-Spiels">
            {([['parkour', 'Team-Parkour'], ['deathrun', 'Deathrun'], ['quiz', 'Vokabel-Parcours']] as const).map(([k, label]) => (
              <button key={k} type="button" role="radio" aria-checked={teamKind === k} onClick={() => { setTeamKind(k); if (k === 'quiz') setPicked((c) => c.slice(0, 1)) }}
                className={`min-h-[48px] rounded-xl border text-sm font-semibold transition ${teamKind === k ? 'border-cyan-300/60 bg-cyan-400/15 text-cyan-200' : 'border-white/10 bg-white/5 text-slate-300'}`}>{label}</button>
            ))}
          </div>
        )}
        {mode === 'team' && teamKind === 'deathrun' && (
          <div className="space-y-1.5">
            <p className="label-mono">Bots dazunehmen (optional)</p>
            {SKILL_ORDER.map((k) => (
              <div key={k} className="flex items-center justify-between gap-2">
                <span className="w-24 text-sm text-slate-200">{SKILL_NAMES[k]}</span>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" disabled={mix[k - 1] <= 0} aria-label={`Weniger ${SKILL_NAMES[k]}`} onClick={() => bumpMix(k, -1)}><Minus size={16} /></Button>
                  <span className="w-8 text-center font-mono text-sm">{mix[k - 1]}</span>
                  <Button variant="ghost" disabled={mixTotal(mix) >= MAX_BOTS} aria-label={`Mehr ${SKILL_NAMES[k]}`} onClick={() => bumpMix(k, 1)}><Plus size={16} /></Button>
                </div>
              </div>
            ))}
          </div>
        )}
        {mode === 'team' ? (teamKind === 'quiz' &&
          <div>
            <label htmlFor="team-obst" className="label-mono">Länge des Parcours</label>
            <Select id="team-obst" value={String(obstacles)} onChange={(e) => setObstacles(Number(e.target.value))}>
              {[6, 8, 10, 12, 16].map((n) => <option key={n} value={n}>{n} Hindernisse</option>)}
            </Select>
          </div>
        ) : (
          <div>
            <label htmlFor="live-count" className="label-mono">Anzahl Fragen</label>
            <Select id="live-count" value={String(count)} onChange={(e) => setCount(Number(e.target.value))}>
              {(mode === 'class' ? [10, 15, 20, 30] : [5, 10, 15, 20]).map((n) => <option key={n} value={n}>{n} Fragen</option>)}
            </Select>
          </div>
        )}
        {error && <ErrorBox message={error} />}
        <Button className="w-full min-h-[52px]" busy={busy} disabled={mode === 'class' ? bookId === '' : picked.length === 0} onClick={() => void create()}>
          <Zap size={18} /> {mode === 'class' ? 'Raum öffnen' : mode === 'team' ? 'Team-Lobby öffnen' : 'Lobby öffnen'}
        </Button>
      </Card>
      {mode === 'team' && <Link to="/parkour" className="block text-sm text-accent-cyan hover:underline">Parkour-Shop: Herzen, Farben und Hüte kaufen</Link>}
      <Link to="/duell" className="inline-block text-sm text-accent-cyan hover:underline">Zurück zu den Duellen</Link>
    </div>
  )
}
