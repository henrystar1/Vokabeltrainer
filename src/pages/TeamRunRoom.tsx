import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Check, Clock, Crown, Footprints, Trophy } from 'lucide-react'
import QuizRunner from '../components/quiz/QuizRunner'
import { accentsFor } from '../components/ui/AccentBar'
import { Avatar } from '../components/profile/PlayerTag'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import PageHeader from '../components/ui/PageHeader'
import { ErrorBox, Notice, Spinner } from '../components/ui/States'
import { useWallet } from '../features/koins/WalletProvider'
import { buildDuelQuestions, type Question } from '../features/learning/questions'
import { useSettings } from '../features/settings/SettingsProvider'
import TeamTrack, { Hearts } from '../features/team/TeamTrack'
import ParkourGame from '../features/parkour/ParkourGame'
import { errorMessage } from '../lib/errors'
import { getWallet } from '../services/koins'
import { teamGet, teamLeave, teamReport, teamRespond, teamStart, type TeamPerson, type TeamState } from '../services/play'

const POLL_MS = 900
const COLORS = ['#22d3ee', '#e879f9', '#facc15', '#4ade80', '#fb923c']

function Slot({ p, color, joined, waitingText }: { p?: TeamPerson; color: string; joined: boolean; waitingText: string }) {
  if (!p) return null
  return (
    <div className="relative flex min-h-[150px] flex-col items-center justify-center gap-2 rounded-2xl border bg-space-900/60 p-3 text-center" style={{ borderColor: joined ? color : 'rgb(255 255 255 / 0.12)', boxShadow: joined ? `0 0 18px ${color}55` : undefined }}>
      {p.is_host && <Crown size={16} className="absolute left-2 top-2 text-amber-300" aria-label="Host" />}
      <div className={joined ? '' : 'opacity-50 grayscale'}><Avatar name={p.name} avatarId={p.avatar_id} colorId={p.color_id} size={64} /></div>
      <p className="max-w-full truncate font-semibold">{p.name}</p>
      {joined ? (
        <span className="inline-flex items-center gap-1 text-xs text-emerald-300"><Check size={13} /> bereit</span>
      ) : (
        <span className="inline-flex animate-pulse items-center gap-1 text-xs text-slate-400"><Clock size={13} /> {waitingText}</span>
      )}
    </div>
  )
}

/** Lobby, Countdown, Parcours und Ergebnis des Team-Parcours (2 Personen, gemeinsam). */
export default function TeamRunRoom() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const { settings } = useSettings()
  const wallet = useWallet()
  const [st, setSt] = useState<TeamState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [, setTick] = useState(0)
  const [answeredKey, setAnsweredKey] = useState('')
  const [fb, setFb] = useState<{ ok: boolean; accepted: string[]; until: number } | null>(null)
  const offset = useRef(0)
  const lastJson = useRef('')
  const rewarded = useRef(false)

  useEffect(() => {
    let alive = true
    const load = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const r = await teamGet(id)
        if (!alive) return
        offset.current = Date.parse(r.now) - Date.now()
        const key = JSON.stringify([r.status, r.kind, r.starts_at, r.step, r.lives_left, r.host_ok, r.partner_ok, r.partner_state, r.my_question?.idx, r.paid, r.people.map((p) => `${p.user_id}:${p.state ?? ''}`)])
        if (key !== lastJson.current) { lastJson.current = key; setSt(r) }
      } catch (e) {
        if (alive) setError(errorMessage(e))
      }
    }
    void load()
    const t = window.setInterval(() => void load(), POLL_MS)
    return () => { alive = false; window.clearInterval(t) }
  }, [id])

  const startsMs = st?.starts_at ? Date.parse(st.starts_at) : 0
  const remaining = startsMs - (Date.now() + offset.current)
  useEffect(() => {
    if (st?.status !== 'running' || remaining <= 0) return
    const t = window.setInterval(() => setTick((n) => n + 1), 100)
    return () => window.clearInterval(t)
  }, [st?.status, remaining > 0]) // eslint-disable-line react-hooks/exhaustive-deps

  // Rückmeldung nach einer falschen Antwort nach ein paar Sekunden ausblenden
  useEffect(() => {
    if (!fb) return
    const t = window.setTimeout(() => setFb(null), Math.max(0, fb.until - Date.now()))
    return () => window.clearTimeout(t)
  }, [fb])

  // Nach dem Erfolg: Guthaben aktualisieren
  useEffect(() => {
    if ((st?.status === 'won' || st?.status === 'lost') && !rewarded.current) {
      rewarded.current = true
      void getWallet().then((b) => wallet.setBalance(b)).catch(() => undefined)
    }
  }, [st?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !st) return <div className="mx-auto max-w-xl space-y-3"><ErrorBox message={error} /><Link to="/duell" className="text-accent-cyan hover:underline">Zurück zu den Duellen</Link></div>
  if (!st) return <Spinner />

  const people = [...st.people].sort((a, b) => Number(b.is_host) - Number(a.is_host))
  const host = people.find((p) => p.is_host)
  const partner = people.find((p) => !p.is_host)
  const other = st.is_host ? partner : host
  const myOk = st.is_host ? st.host_ok : st.partner_ok

  async function act(fn: () => Promise<void>, then?: () => void) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      then?.()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  if (st.status === 'cancelled') {
    return (
      <div className="mx-auto max-w-xl space-y-3">
        <PageHeader eyebrow="Team-Parcours" title="Beendet" />
        <Notice tone="warn">Dieser Lauf wurde abgebrochen.</Notice>
        <Link to="/duell" className="text-accent-cyan hover:underline">Zurück zu den Duellen</Link>
      </div>
    )
  }

  if (st.status === 'lobby') {
    const me = people.find((p) => p.user_id === st.me)
    const rest = people.filter((p) => !p.is_host)
    const isJoined = (p: TeamPerson) => p.is_host || (p.state ?? 'joined') === 'joined'
    const joined = rest.some(isJoined)
    const invitedMe = !st.is_host && !(me && isJoined(me))
    return (
      <div className="mx-auto max-w-xl space-y-5">
        <PageHeader eyebrow={st.kind === 'parkour' ? 'Team-Parkour' : 'Vokabel-Parcours'} title="Lobby" />
        <Card className="space-y-4">
          <div className={`grid gap-3 ${people.length > 2 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2'}`}>
            {people.map((p, i) => <Slot key={p.user_id} p={p} color={COLORS[i % COLORS.length]} joined={isJoined(p)} waitingText="wartet auf Antwort …" />)}
          </div>
          <p className="text-center text-sm text-slate-400">{st.kind === 'parkour' ? `Endlos viele Level, immer schwerer · Joystick, Sprung und Doppelsprung · ${st.lives} gemeinsame Herzen (+1 ab der dritten Person und Extra-Herzen aus dem Parkour-Shop)` : `${st.obstacles} Hindernisse · ${st.lives} gemeinsame Leben`}</p>
          {st.kind === 'parkour'
            ? <p className="text-center text-sm text-amber-200">Coins je nach Fortschritt: {st.coins[0]} pro Level (ab Level 9 mehr), {st.coins[1]} pro Checkpoint, {st.coins[2]} Bonus für Level 8 (für jeden)</p>
            : st.reward > 0 && <p className="text-center text-sm text-amber-200">Bei Erfolg: {st.reward} Coins für jeden</p>}
          {error && <ErrorBox message={error} />}
          {st.is_host ? (
            <div className="flex flex-wrap gap-2">
              <Button className="min-h-[52px] flex-1" busy={busy} disabled={!joined} onClick={() => void act(() => teamStart(id))}><Footprints size={18} /> {joined ? (people.length > 2 && !people.every(isJoined) ? 'Jetzt starten (ohne Wartende)' : 'Los geht’s') : 'Warte auf deine Mitspieler …'}</Button>
              <Button variant="ghost" disabled={busy} onClick={() => void act(() => teamLeave(id), () => nav('/duell'))}>Lobby schließen</Button>
            </div>
          ) : invitedMe ? (
            <div className="flex gap-2">
              <Button className="min-h-[52px] flex-1" busy={busy} onClick={() => void act(() => teamRespond(id, true))}>Beitreten</Button>
              <Button variant="ghost" disabled={busy} onClick={() => void act(() => teamRespond(id, false), () => nav('/duell'))}>Ablehnen</Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <p className="flex-1 animate-pulse text-slate-300">Warte, bis {host?.name ?? 'der Host'} startet …</p>
              <Button variant="ghost" disabled={busy} onClick={() => void act(() => teamLeave(id), () => nav('/duell'))}>Verlassen</Button>
            </div>
          )}
        </Card>
      </div>
    )
  }

  if (st.status === 'running') {
    const meP = people.find((p) => p.user_id === st.me)
    if (st.kind === 'parkour' && meP && !(meP.is_host || (meP.state ?? 'joined') === 'joined')) {
      return (
        <div className="mx-auto max-w-xl space-y-3">
          <PageHeader eyebrow="Team-Parkour" title="Schon gestartet" />
          <Notice tone="warn">Der Lauf hat begonnen, bevor du beigetreten bist. Beim nächsten Mal klappt es.</Notice>
          <Button variant="ghost" onClick={() => { void teamRespond(id, false).catch(() => undefined); nav('/duell') }}>Zurück</Button>
        </div>
      )
    }
    if (remaining > 0) {
      const n = Math.ceil(remaining / 1000)
      return (
        <div className="mx-auto max-w-xl space-y-5">
          <PageHeader eyebrow={st.kind === 'parkour' ? 'Team-Parkour' : 'Vokabel-Parcours'} title="Gleich geht’s los" />
          {st.kind === 'quiz' && <TeamTrack st={st} />}
          <p key={n} className="race-count text-center font-mono text-8xl font-black text-fuchsia-300 drop-shadow-[0_0_24px_rgb(232_121_249/0.7)]">{n}</p>
          <p className="text-center text-sm text-slate-400">{st.kind === 'parkour' ? 'Nur gemeinsam kommt ihr durch: Platten halten, Räuberleiter, zusammen in den Ausgang.' : 'Nur gemeinsam kommt ihr durch: Beide müssen jedes Hindernis richtig beantworten.'}</p>
        </div>
      )
    }
    if (st.kind === 'parkour') {
      return (
        <div className="space-y-3">
          <ParkourGame st={st} />
          <div className="flex justify-center"><Button variant="ghost" onClick={() => { void teamLeave(id).catch(() => undefined); nav('/duell') }}>Spiel beenden</Button></div>
        </div>
      )
    }
    const mq = st.my_question
    const qKey = mq ? `${st.step}-${mq.idx}` : ''
    const question: Question | null = mq ? buildDuelQuestions([{ ...mq }])[0] : null
    const showQuiz = !!question && !myOk && answeredKey !== qKey && !(fb && !fb.ok)
    return (
      <div>
        <div className="sticky top-2 z-30 mx-auto mb-3 max-w-3xl"><TeamTrack st={st} /></div>
        {showQuiz && question ? (
          <QuizRunner
            key={qKey}
            questions={[question]}
            caseSensitive={settings.case_sensitive}
            accents={accentsFor(settings.learn_language)}
            title={`Hindernis ${st.step + 1} von ${st.obstacles}`}
            showFeedback={false}
            hideProgress
            onAnswer={(q, _given, ok) => {
              setAnsweredKey(qKey)
              setFb({ ok, accepted: q.accepted, until: Date.now() + (ok ? 1500 : 2800) })
              void teamReport(id, st.step, ok).catch((e) => setError(errorMessage(e)))
            }}
            onFinish={() => undefined}
            onCancel={() => { void teamLeave(id).catch(() => undefined); nav('/duell') }}
          />
        ) : (
          <div className="mx-auto max-w-2xl space-y-3">
            <Card className="space-y-3 text-center">
              {fb && !fb.ok ? (
                <>
                  <p className="text-xl font-bold text-rose-300">Leider falsch – ein Leben weniger</p>
                  <p className="text-sm text-slate-200">Richtig wäre: <b>{fb.accepted.join(' / ')}</b></p>
                  <div className="flex justify-center"><Hearts left={st.lives_left} total={st.lives} /></div>
                </>
              ) : myOk ? (
                <>
                  <p className="text-xl font-bold text-emerald-300">Geschafft! ✓</p>
                  <p className="animate-pulse text-slate-300">Warte auf {other?.name ?? 'deinen Partner'} …</p>
                </>
              ) : (
                <p className="animate-pulse text-slate-300">Nächste Frage …</p>
              )}
            </Card>
            {error && <ErrorBox message={error} />}
          </div>
        )}
      </div>
    )
  }

  // Ergebnis: gewonnen oder verloren
  const won = st.status === 'won'
  const right = st.host_right + st.partner_right
  const wrong = st.host_wrong + st.partner_wrong
  return (
    <div className="mx-auto max-w-xl space-y-5">
      <PageHeader eyebrow={st.kind === 'parkour' ? 'Team-Parkour' : 'Vokabel-Parcours'} title={st.kind === 'parkour' ? 'Keine Herzen mehr' : won ? 'Geschafft – ihr seid im Ziel!' : 'Leider nicht geschafft'} />
      {st.kind === 'quiz' && <TeamTrack st={st} />}
      <Card className="space-y-4 text-center">
        <div className="flex justify-center">{won ? <Trophy size={44} className="text-amber-300" /> : <Hearts left={0} total={st.lives} />}</div>
        {st.kind === 'parkour' ? (
          <p className="text-slate-300">
            {`${st.levels ?? 0} Level geschafft, ${st.cps ?? 0} Checkpoints erreicht`} · {Math.floor((st.millis ?? 0) / 60000)}:{String(Math.floor(((st.millis ?? 0) % 60000) / 1000)).padStart(2, '0')} Min. · {st.deaths ?? 0} Stürze
          </p>
        ) : (
        <p className="text-slate-300">{won ? `Alle ${st.obstacles} Hindernisse gemeinsam überwunden.` : `Bei Hindernis ${Math.min(st.step + 1, st.obstacles)} von ${st.obstacles} waren die Leben aufgebraucht.`}</p>
        )}
        {st.kind === 'quiz' && <div className="grid grid-cols-2 gap-3 text-sm">
          {[host, partner].map((p, i) => p && (
            <div key={p.user_id} className="rounded-xl border bg-space-900/60 p-3" style={{ borderColor: `${COLORS[i]}66` }}>
              <p className="truncate font-semibold" style={{ color: COLORS[i] }}>{p.name}</p>
              <p className="text-slate-300">{p.is_host ? st.host_right : st.partner_right} richtig · {p.is_host ? st.host_wrong : st.partner_wrong} falsch</p>
            </div>
          ))}
        </div>}
        {st.kind === 'quiz' && <p className="text-xs text-slate-500">{right} richtige und {wrong} falsche Antworten zusammen</p>}
        {(won || st.kind === 'parkour') && (st.paid > 0
          ? <p className="text-lg font-semibold text-amber-200">+{st.paid} Coins</p>
          : (st.reward > 0 || st.kind === 'parkour') && (st.levels ?? 1) > 0 && <p className="text-sm text-slate-400">Für heute gibt es keine Coins mehr (Tageslimit).</p>)}
        {error && <ErrorBox message={error} />}
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={() => nav(st.kind === 'parkour' ? '/live-duell?modus=team' : '/live-duell')}>Neuer Lauf</Button>
          <Button variant="ghost" onClick={() => nav('/duell')}>Zurück zu den Duellen</Button>
        </div>
      </Card>
    </div>
  )
}
