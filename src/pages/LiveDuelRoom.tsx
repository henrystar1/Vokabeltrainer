import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Check, Clock, Crown, Zap } from 'lucide-react'
import QuizRunner from '../components/quiz/QuizRunner'
import { accentsFor } from '../components/ui/AccentBar'
import { Avatar } from '../components/profile/PlayerTag'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import PageHeader from '../components/ui/PageHeader'
import { ErrorBox, Notice, Spinner } from '../components/ui/States'
import RaceTrack, { LANE_COLORS } from '../features/duel/RaceTrack'
import { useWallet } from '../features/koins/WalletProvider'
import { buildDuelQuestions, type Question } from '../features/learning/questions'
import { useSettings } from '../features/settings/SettingsProvider'
import { errorMessage } from '../lib/errors'
import { getWallet } from '../services/koins'
import { liveFinish, liveGet, liveLeave, liveProgress, liveRespond, liveStart, type LivePlayer, type LiveState } from '../services/play'

const POLL_MS = 900

function Confetti() {
  const pieces = useMemo(() => Array.from({ length: 36 }, (_, i) => ({ i, left: Math.random() * 100, delay: Math.random() * 0.8, color: LANE_COLORS[i % 4] })), [])
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {pieces.map((p) => <span key={p.i} className="race-confetti" style={{ left: `${p.left}%`, animationDelay: `${p.delay}s`, background: p.color }} />)}
    </div>
  )
}

function Slot({ p, color, host }: { p?: LivePlayer; color: string; host: boolean }) {
  if (!p) {
    return <div className="flex min-h-[150px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 text-sm text-slate-500">frei</div>
  }
  const ready = p.state === 'joined'
  return (
    <div className="relative flex min-h-[150px] flex-col items-center justify-center gap-2 rounded-2xl border bg-space-900/60 p-3 text-center" style={{ borderColor: ready ? color : 'rgb(255 255 255 / 0.12)', boxShadow: ready ? `0 0 18px ${color}55` : undefined }}>
      {host && <Crown size={16} className="absolute left-2 top-2 text-amber-300" aria-label="Host" />}
      <div className={ready ? '' : 'opacity-50 grayscale'}><Avatar name={p.name} avatarId={p.avatar_id} colorId={p.color_id} size={64} /></div>
      <p className="max-w-full truncate font-semibold">{p.name}</p>
      {ready ? (
        <span className="inline-flex items-center gap-1 text-xs text-emerald-300"><Check size={13} /> bereit</span>
      ) : p.state === 'invited' ? (
        <span className="inline-flex animate-pulse items-center gap-1 text-xs text-slate-400"><Clock size={13} /> wartet auf Antwort …</span>
      ) : (
        <span className="text-xs text-slate-500">hat verlassen</span>
      )}
    </div>
  )
}

/** Lobby, Countdown, Rennen mit Strahlen und Ergebnis eines Live-Duells. */
export default function LiveDuelRoom() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const { settings } = useSettings()
  const wallet = useWallet()
  const [st, setSt] = useState<LiveState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [questions, setQuestions] = useState<Question[] | null>(null)
  const [done, setDone] = useState(false)
  const [, setTick] = useState(0)
  const offset = useRef(0)
  const lastJson = useRef('')
  const startPerf = useRef<number | null>(null)
  const answered = useRef(0)
  const correct = useRef(0)
  const rewarded = useRef(false)

  // Zustand jede Sekunde holen; nur neu zeichnen, wenn sich etwas geändert hat
  useEffect(() => {
    let alive = true
    const load = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const r = await liveGet(id)
        if (!alive) return
        offset.current = Date.parse(r.now) - Date.now()
        const key = JSON.stringify([r.status, r.starts_at, r.players.map((p) => [p.user_id, p.state, p.answered, p.correct, p.finished, p.place])])
        if (key !== lastJson.current) { lastJson.current = key; setSt(r) }
        if (r.questions && r.questions.length > 0) setQuestions((cur) => cur ?? buildDuelQuestions(r.questions!.map((q) => ({ ...q }))))
      } catch (e) {
        if (alive) setError(errorMessage(e))
      }
    }
    void load()
    const t = window.setInterval(() => void load(), POLL_MS)
    return () => { alive = false; window.clearInterval(t) }
  }, [id])

  // Countdown flüssig anzeigen
  const startsMs = st?.starts_at ? Date.parse(st.starts_at) : 0
  const remaining = startsMs - (Date.now() + offset.current)
  useEffect(() => {
    if (st?.status !== 'running' || remaining <= 0) return
    const t = window.setInterval(() => setTick((n) => n + 1), 100)
    return () => window.clearInterval(t)
  }, [st?.status, remaining > 0]) // eslint-disable-line react-hooks/exhaustive-deps

  // Nach dem Ende: Guthaben aktualisieren (Siegprämie)
  useEffect(() => {
    if (st?.status === 'finished' && !rewarded.current) {
      rewarded.current = true
      void getWallet().then((b) => wallet.setBalance(b)).catch(() => undefined)
    }
  }, [st?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !st) return <div className="mx-auto max-w-xl space-y-3"><ErrorBox message={error} /><Link to="/duell" className="text-accent-cyan hover:underline">Zurück zu den Duellen</Link></div>
  if (!st) return <Spinner />

  const me = st.players.find((p) => p.user_id === st.me)
  const joined = st.players.filter((p) => p.state === 'joined')
  const colorOf = (uid: string) => LANE_COLORS[Math.max(0, st.players.filter((p) => p.state === 'joined' || p.state === 'left').findIndex((p) => p.user_id === uid)) % 4]

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
        <PageHeader eyebrow="Live-Duell" title="Lobby geschlossen" />
        <Notice tone="warn">Diese Lobby wurde geschlossen.</Notice>
        <Link to="/duell" className="text-accent-cyan hover:underline">Zurück zu den Duellen</Link>
      </div>
    )
  }

  if (st.status === 'lobby') {
    const slots = Array.from({ length: 4 }, (_, i) => st.players[i])
    const invitedMe = me?.state === 'invited'
    return (
      <div className="mx-auto max-w-xl space-y-5">
        <PageHeader eyebrow="Live-Duell" title="Lobby" />
        <Card className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {slots.map((p, i) => <Slot key={p?.user_id ?? `e${i}`} p={p} color={LANE_COLORS[i]} host={p?.user_id === st.host_id} />)}
          </div>
          <p className="text-center text-sm text-slate-400">{st.q_count} Fragen · {joined.length} von {st.players.length} Spielern sind da</p>
          {error && <ErrorBox message={error} />}
          {st.is_host ? (
            <div className="flex flex-wrap gap-2">
              <Button className="min-h-[52px] flex-1" busy={busy} disabled={joined.length < 2} onClick={() => void act(() => liveStart(id))}><Zap size={18} /> {joined.length < 2 ? 'Warte auf Mitspieler …' : 'Los geht’s'}</Button>
              <Button variant="ghost" disabled={busy} onClick={() => void act(() => liveLeave(id), () => nav('/duell'))}>Lobby schließen</Button>
            </div>
          ) : invitedMe ? (
            <div className="flex gap-2">
              <Button className="min-h-[52px] flex-1" busy={busy} onClick={() => void act(() => liveRespond(id, true))}>Beitreten</Button>
              <Button variant="ghost" disabled={busy} onClick={() => void act(() => liveRespond(id, false), () => nav('/duell'))}>Ablehnen</Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <p className="flex-1 animate-pulse text-slate-300">Warte, bis der Host startet …</p>
              <Button variant="ghost" disabled={busy} onClick={() => void act(() => liveLeave(id), () => nav('/duell'))}>Verlassen</Button>
            </div>
          )}
        </Card>
      </div>
    )
  }

  if (st.status === 'running') {
    if (remaining > 0) {
      const n = Math.ceil(remaining / 1000)
      return (
        <div className="mx-auto max-w-xl space-y-5">
          <PageHeader eyebrow="Live-Duell" title="Gleich geht’s los" />
          <RaceTrack players={st.players} total={st.q_count} meId={st.me} />
          <p key={n} className="race-count text-center font-mono text-8xl font-black text-fuchsia-300 drop-shadow-[0_0_24px_rgb(232_121_249/0.7)]">{n}</p>
        </div>
      )
    }
    if (startPerf.current === null) startPerf.current = performance.now() + Math.min(0, remaining)
    const iFinished = done || me?.finished
    if (!iFinished && questions) {
      return (
        <div>
          <div className="sticky top-2 z-30 mx-auto mb-3 max-w-3xl"><RaceTrack players={st.players} total={st.q_count} meId={st.me} /></div>
          <QuizRunner
            questions={questions}
            caseSensitive={settings.case_sensitive}
            accents={accentsFor(settings.learn_language)}
            title="Live-Duell"
            showFeedback={false}
            onAnswer={(_q, _given, ok) => {
              answered.current += 1
              if (ok) correct.current += 1
              void liveProgress(id, answered.current, correct.current).catch(() => undefined)
            }}
            onFinish={() => {
              const ms = Math.round(performance.now() - (startPerf.current ?? performance.now()))
              setDone(true)
              void liveFinish(id, correct.current, ms).catch((e) => setError(errorMessage(e)))
            }}
            onCancel={() => { void liveLeave(id).catch(() => undefined); nav('/duell') }}
          />
        </div>
      )
    }
    return (
      <div className="mx-auto max-w-xl space-y-5">
        <PageHeader eyebrow="Live-Duell" title={iFinished ? 'Fertig – warte auf die anderen' : 'Lädt …'} />
        <RaceTrack players={st.players} total={st.q_count} meId={st.me} />
        {iFinished && <p className="animate-pulse text-center text-slate-400">{correct.current} von {st.q_count} richtig</p>}
        {error && <ErrorBox message={error} />}
      </div>
    )
  }

  // finished
  const ranked = [...st.players].filter((p) => p.state === 'joined').sort((a, b) => (a.place ?? 99) - (b.place ?? 99))
  const iWon = ranked[0]?.user_id === st.me
  const heights = ['h-40', 'h-32', 'h-24', 'h-16']
  return (
    <div className="mx-auto max-w-xl space-y-5">
      <PageHeader eyebrow="Live-Duell" title={iWon ? 'Gewonnen!' : 'Ergebnis'} />
      <Card className="relative space-y-5 overflow-hidden">
        {iWon && <Confetti />}
        <div className="flex items-end justify-center gap-3">
          {ranked.map((p, i) => (
            <div key={p.user_id} className="flex w-1/4 min-w-0 flex-col items-center gap-1 text-center">
              {i === 0 && <Crown size={22} className="text-amber-300" aria-label="Sieger" />}
              <Avatar name={p.name} avatarId={p.avatar_id} colorId={p.color_id} size={i === 0 ? 60 : 48} />
              <p className="max-w-full truncate text-sm font-semibold">{p.name}{p.user_id === st.me ? ' (du)' : ''}</p>
              <div className={`race-podium flex w-full items-start justify-center rounded-t-xl pt-2 ${heights[i] ?? 'h-16'}`} style={{ background: `linear-gradient(180deg, ${colorOf(p.user_id)}, ${colorOf(p.user_id)}33)`, animationDelay: `${(ranked.length - i) * 0.15}s` }}>
                <span className="font-mono text-2xl font-black text-space-950">{i + 1}</span>
              </div>
              <p className="font-mono text-xs text-slate-300">{p.correct}/{st.q_count}{p.millis ? ` · ${(p.millis / 1000).toFixed(1)} s` : ''}</p>
            </div>
          ))}
        </div>
        {iWon && <Notice tone="ok">Du hast gewonnen! Die Siegprämie (falls das Tageslimit nicht erreicht ist) ist schon gutgeschrieben.</Notice>}
        {me?.state === 'left' && <Notice tone="info">Du hast die Runde verlassen.</Notice>}
      </Card>
      <div className="flex gap-3">
        <Link to="/live-duell" className="inline-flex min-h-[44px] items-center text-accent-cyan hover:underline">Noch eine Runde</Link>
        <Link to="/duell" className="inline-flex min-h-[44px] items-center text-slate-300 hover:underline">Zu den Duellen</Link>
      </div>
    </div>
  )
}
