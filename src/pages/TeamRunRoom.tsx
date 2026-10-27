import { MAX_BOTS, SKILL_NAMES, SKILL_ORDER, decodeMix, encodeMix, lobbyBots, mixTotal, rebuildBots, type Mix } from '../features/parkour/botmix'
import { BOT_NAMES } from '../features/parkour/bots'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Bot, Check, Clock, Crown, Eye, Footprints, Minus, Plus, Trophy } from 'lucide-react'
import QuizRunner from '../components/quiz/QuizRunner'
import { accentsFor } from '../components/ui/AccentBar'
import { Avatar } from '../components/profile/PlayerTag'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import PageHeader from '../components/ui/PageHeader'
import { ErrorBox, Notice, Spinner } from '../components/ui/States'
import { useAuth } from '../features/auth/AuthProvider'
import { useWallet } from '../features/koins/WalletProvider'
import { buildDuelQuestions, type Question } from '../features/learning/questions'
import { useSettings } from '../features/settings/SettingsProvider'
import TeamTrack, { Hearts } from '../features/team/TeamTrack'
import ParkourGame from '../features/parkour/ParkourGame'
import { errorMessage } from '../lib/errors'
import { getWallet } from '../services/koins'
import { deathrunOpenJoin, teamGet, teamLeave, teamRejoin, teamReport, teamRespond, teamSetBots, parkourLearnOffList, parkourLearnSet, teamSetVersus, teamSpectate, teamStart, type DeathrunResult, type TeamPerson, type TeamState } from '../services/play'

const POLL_MS = 900
const COLORS = ['#22d3ee', '#e879f9', '#facc15', '#4ade80', '#fb923c']

/** Admin: Vokabel-Fragen im Parkour für sich oder bestimmte Leute ausschalten (zum Testen). */
function LearnToggles({ people }: { people: TeamPerson[] }) {
  const [off, setOff] = useState<string[]>([])
  const [err, setErr] = useState('')
  const key = people.map((p) => p.user_id).join(',')
  useEffect(() => {
    let alive = true
    parkourLearnOffList(key.split(',').filter(Boolean)).then((l) => { if (alive) setOff(l) }).catch((e) => { if (alive) setErr(errorMessage(e)) })
    return () => { alive = false }
  }, [key])
  const flip = (uid: string) => {
    const next = !off.includes(uid)
    setOff((o) => (next ? [...o, uid] : o.filter((x) => x !== uid)))
    parkourLearnSet(uid, next).then(() => setErr('')).catch((e) => { setErr(errorMessage(e)); setOff((o) => (next ? o.filter((x) => x !== uid) : [...o, uid])) })
  }
  return (
    <div className="space-y-1.5 rounded-xl border border-violet-300/25 bg-violet-500/5 p-3">
      <p className="label-mono">Admin: Lernfragen im Parkour</p>
      <p className="text-xs text-slate-400">Speedups und Levelwechsel verlangen Vokabeln. Hier für einzelne Personen ausschalten (gilt auch für spätere Läufe, bis du es wieder einschaltest).</p>
      {people.map((p) => (
        <div key={p.user_id} className="flex items-center justify-between gap-2">
          <span className="min-w-0 flex-1 truncate text-sm text-slate-200">{p.name}</span>
          <button type="button" onClick={() => flip(p.user_id)} aria-pressed={!off.includes(p.user_id)}
            className={`min-h-[36px] rounded-lg border px-3 text-xs font-semibold ${off.includes(p.user_id) ? 'border-rose-300/50 bg-rose-400/10 text-rose-200' : 'border-emerald-300/50 bg-emerald-400/10 text-emerald-100'}`}>
            {off.includes(p.user_id) ? 'Aus' : 'An'}
          </button>
        </div>
      ))}
      {err && <p className="text-xs text-rose-300">{err}</p>}
    </div>
  )
}

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

interface BotRow { i: number; lv: number; out: boolean; sk: number }
/** Stand der Bots, den das Spiel am Ende dieses Laufs auf diesem Gerät gemerkt hat. */
function savedBots(id: string): BotRow[] {
  try {
    const a = JSON.parse(window.localStorage.getItem(`pkbots:${id}`) ?? '[]')
    return Array.isArray(a) ? a.filter((b) => b && Number.isInteger(b.i) && typeof b.lv === 'number').slice(0, 8) : []
  } catch { return [] }
}

/** Bot-Können wählen und hinzufügen (Team gegen Team). */
function BotAdder({ onAdd, disabled }: { onAdd: (skill: number) => void; disabled: boolean }) {
  const [skill, setSkill] = useState(2)
  return (
    <div className="flex items-center gap-1 pt-1">
      <select value={skill} onChange={(e) => setSkill(Number(e.target.value))} aria-label="Bot-Können" className="min-h-[36px] min-w-0 flex-1 rounded-lg border border-white/15 bg-space-900 px-1 text-xs text-slate-200">
        {SKILL_ORDER.map((k) => <option key={k} value={k}>{SKILL_NAMES[k]}</option>)}
      </select>
      <button type="button" disabled={disabled} onClick={() => onAdd(skill)} className="min-h-[36px] rounded-lg border border-white/15 px-2 text-xs font-semibold text-slate-200 disabled:opacity-40">+ Bot</button>
    </div>
  )
}

function Results({ list, me, bots = [] }: { list: DeathrunResult[]; me: string; bots?: BotRow[] }) {
  if (list.length === 0 && bots.length === 0) return <p className="text-center text-sm text-slate-400">Noch niemand ist fertig.</p>
  // Menschen und Bots nach geschafften Leveln sortiert (bei Gleichstand zuerst die Menschen)
  type Row = { key: string; name: string; levels: number; me: boolean; bot: boolean; extra: string }
  const rows: Row[] = [
    ...list.map((r) => ({ key: r.user_id, name: r.name, levels: r.levels, me: r.user_id === me, bot: false, extra: `${Math.floor(r.millis / 60000)}:${String(Math.floor((r.millis % 60000) / 1000)).padStart(2, '0')} · +${r.paid}` })),
    ...bots.map((b) => ({ key: `bot${b.i}`, name: `🤖 ${BOT_NAMES[b.i % BOT_NAMES.length]} (${SKILL_NAMES[b.sk] ?? 'Bot'})`, levels: b.lv, me: false, bot: true, extra: b.out ? 'ausgeschieden' : 'noch dabei' })),
  ].sort((a, b) => b.levels - a.levels || Number(a.bot) - Number(b.bot))
  return (
    <ol className="space-y-1.5 text-left">
      {rows.map((r, i) => (
        <li key={r.key} className={`flex min-h-[44px] items-center gap-2 rounded-xl px-3 ${r.me ? 'bg-accent-cyan/10 ring-1 ring-accent-cyan/30' : 'bg-white/5'}`}>
          <span className="w-6 text-center font-mono text-sm text-slate-400">{i + 1}.</span>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{r.name}{r.me ? ' (du)' : ''}</span>
          <span className="shrink-0 text-right font-mono text-xs text-amber-200">Level {r.levels}<br /><span className="text-slate-400">{r.extra}</span></span>
        </li>
      ))}
    </ol>
  )
}

/** Lobby, Countdown, Parcours, Parkour, Deathrun und Ergebnis (Team-Parcours: 2 Personen, Parkour und Deathrun: bis 5). */
export default function TeamRunRoom() {
  const { id = '' } = useParams()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const watching = params.get('zuschauen') === '1'
  const { settings } = useSettings()
  const { isAdmin } = useAuth()
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
  const stRef = useRef<TeamState | null>(null)
  stRef.current = st
  // Offene Lobby verlassen, wenn man die Seite wechselt (sonst zählt man als „da“ und blockiert einen Platz)
  useEffect(() => () => {
    const cur = stRef.current
    if (cur && cur.status === 'lobby' && cur.is_open && !cur.spectator) void teamLeave(id).catch(() => undefined)
  }, [id])

  useEffect(() => {
    let alive = true
    const load = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const r = await (watching ? teamSpectate(id) : teamGet(id))
        if (!alive) return
        offset.current = Date.parse(r.now) - Date.now()
        const key = JSON.stringify([r.status, r.kind, r.starts_at, r.step, r.lives_left, r.host_ok, r.partner_ok, r.partner_state, r.my_question?.idx, r.paid, r.is_open, r.bots, r.bot_skill, r.can_start, r.can_manage, r.can_rejoin, r.member, r.staff_present, r.people.map((p) => `${p.user_id}:${p.state ?? ''}`)])
        if (key !== lastJson.current) { lastJson.current = key; setSt(r) }
      } catch (e) {
        if (alive) setError(errorMessage(e))
      }
    }
    void load()
    const t = window.setInterval(() => void load(), POLL_MS)
    return () => { alive = false; window.clearInterval(t) }
  }, [id, watching])

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
  const run = st.kind !== 'quiz'
  const dr = st.kind === 'deathrun'
  const label = dr ? 'Deathrun' : st.kind === 'parkour' ? 'Team-Parkour' : 'Vokabel-Parcours'

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
    const open = !!st.is_open
    const bots = st.bots ?? 0
    const humans = people.filter(isJoined).length
    const joined = open ? humans + bots >= 2 : rest.some(isJoined) || (dr && bots > 0)
    const invitedMe = !open && !st.is_host && !(me && isJoined(me))
    const mix = decodeMix(st.bot_skill, bots)
    const vs = dr ? 0 : st.versus ?? 0
    const joinedPeople = people.filter(isJoined)
    const teamOf = (uid: string) => ((st.team_map ?? {})[uid] === 1 ? 1 : 0)
    const setVs = (mode: number) => {
      // Beim Wechsel auf „Team gegen Team“ gleich abwechselnd verteilen (rot, blau, rot, blau …)
      const map: Record<string, number> = {}
      if (mode === 2) joinedPeople.forEach((p, i) => { map[p.user_id] = i % 2 })
      void act(() => teamSetVersus(id, mode, map))
    }
    // Team gegen Team: Menschen und Bots stehen einzeln in Blau (links) oder Rot (rechts)
    const lbots = lobbyBots(st.bot_skill, bots, st.team_map)
    const teamMapNow = (): Record<string, number> => {
      const m: Record<string, number> = {}
      for (const p of joinedPeople) m[p.user_id] = teamOf(p.user_id)
      lbots.forEach((b, i) => { m[`b${i}`] = b.team })
      return m
    }
    const moveEntry = (key: string) => {
      const m = teamMapNow()
      m[key] = m[key] === 1 ? 0 : 1
      void act(() => teamSetVersus(id, 2, m))
    }
    const changeBots = (list: Array<{ skill: number; team: number }>) => {
      const r = rebuildBots(list)
      const humansMap: Record<string, number> = {}
      for (const p of joinedPeople) humansMap[p.user_id] = teamOf(p.user_id)
      void act(() => teamSetBots(id, r.count, r.code, { ...humansMap, ...r.map }))
    }
    const addBot = (team: number, skill: number) => { if (lbots.length < MAX_BOTS) changeBots([...lbots, { skill, team }]) }
    const removeBot = (i: number) => changeBots(lbots.filter((_, k) => k !== i))
    const teamSize = (t: number) => joinedPeople.filter((p) => teamOf(p.user_id) === t).length + lbots.filter((b) => b.team === t).length
    const skillName = SKILL_ORDER.filter((k) => mix[k - 1] > 0).map((k) => `${mix[k - 1]}× ${SKILL_NAMES[k]}`).join(', ')
    const setMix = (k: number, d: number) => {
      const m: Mix = [...mix]
      m[k - 1] += d
      void act(() => teamSetBots(id, mixTotal(m), mixTotal(m) === 0 ? 2 : encodeMix(m)))
    }
    return (
      <div className="mx-auto max-w-xl space-y-5">
        <PageHeader eyebrow={label} title={open ? `Offene Lobby (${humans}/5)` : 'Lobby'} />
        <Card className="space-y-4">
          <div className={`grid gap-3 ${people.length > 2 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2'}`}>
            {people.map((p, i) => <Slot key={p.user_id} p={p} color={COLORS[i % COLORS.length]} joined={isJoined(p)} waitingText="wartet auf Antwort …" />)}
            {bots > 0 && vs !== 2 && (
              <div className="flex min-h-[150px] flex-col items-center justify-center gap-2 rounded-2xl border border-slate-400/40 bg-space-900/60 p-3 text-center">
                <Bot size={44} className="text-slate-300" />
                <p className="font-semibold">{bots} {bots === 1 ? 'Bot' : 'Bots'}</p>
                <span className="text-xs text-slate-400">{skillName}</span>
              </div>
            )}
          </div>
          {open && (
            <p className="text-center text-sm text-amber-200">
              Der Lauf startet von allein, sobald 5 Personen da sind. {st.staff_present ? 'Ein Mod oder Admin ist dabei und startet.' : 'Ist kein Mod oder Admin in der Lobby, kann jede Person starten.'}
            </p>
          )}
          <p className="text-center text-sm text-slate-400">{dr ? `Endlos viele Level, immer schwerer · jeder läuft für sich mit eigenen Herzen (${st.lives} plus Extra-Herzen aus dem Parkour-Shop) · Tore nur mit Teamarbeit` : run ? `Endlos viele Level, immer schwerer · Joystick, Sprung und Doppelsprung · ${st.lives} gemeinsame Herzen (+1 ab der dritten Person und Extra-Herzen aus dem Parkour-Shop)` : `${st.obstacles} Hindernisse · ${st.lives} gemeinsame Leben`}</p>
          {run
            ? <p className="text-center text-sm text-amber-200">Coins je nach Fortschritt: {st.coins[0]} pro Level (ab Level 9 mehr), {st.coins[1]} pro Checkpoint, {st.coins[2]} Bonus für Level 8 (für jeden). Bots bekommen keine Coins.</p>
            : st.reward > 0 && <p className="text-center text-sm text-amber-200">Bei Erfolg: {st.reward} Coins für jeden</p>}
          {isAdmin && !st.spectator && (run || dr) && <LearnToggles people={people.filter(isJoined)} />}
          {st.can_manage && (
            <div className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-3">
              {!dr && (
                <>
                  <p className="label-mono">Gegner</p>
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Gegner im Team-Parkour">
                    {([[0, 'Keiner'], [1, 'Bots'], [2, 'Anderes Team']] as const).map(([k, l]) => (
                      <button key={k} type="button" disabled={busy} onClick={() => setVs(k)} aria-pressed={vs === k}
                        className={`min-h-[40px] rounded-lg border px-3 text-xs font-semibold ${vs === k ? 'border-cyan-300/60 bg-cyan-400/15 text-cyan-100' : 'border-white/15 bg-white/5 text-slate-300'}`}>{l}</button>
                    ))}
                  </div>
                  {vs === 0 && <p className="text-xs text-slate-400">Alle spielen zusammen in einem Team.</p>}
                  {vs === 1 && <p className="text-xs text-slate-400">Ihr lauft als Team (blau) gegen ein Bot-Team (rot) dieselben Level. Wer keine Herzen mehr hat, scheidet aus; es gewinnt, wer weiter kommt.</p>}
                  {vs === 2 && (
                    <div className="space-y-2">
                      <p className="text-xs text-slate-400">Zwei Teams laufen gleichzeitig dieselben Level, jedes mit eigenen Herzen. Wer weiter kommt, gewinnt. Mit dem Pfeil schiebst du eine Person oder einen Bot ins andere Team. Bots gehören gern auch zu deinem eigenen Team.</p>
                      <div className="grid grid-cols-2 gap-2">
                        {([[1, 'Blau', '#60a5fa', '→'], [0, 'Rot', '#f87171', '←']] as const).map(([team, label, color, arrow]) => (
                          <div key={team} className="space-y-1.5 rounded-xl border p-2" style={{ borderColor: `${color}66`, background: `${color}14` }}>
                            <p className="text-center text-sm font-semibold" style={{ color }}>{label} ({teamSize(team)})</p>
                            {joinedPeople.filter((p) => teamOf(p.user_id) === team).map((p) => (
                              <div key={p.user_id} className="flex items-center gap-1.5">
                                {team === 0 && <button type="button" disabled={busy} onClick={() => moveEntry(p.user_id)} aria-label={`${p.name} zu Blau`} className="min-h-[36px] min-w-[36px] rounded-lg border border-white/15 text-sm font-bold text-slate-200">{arrow}</button>}
                                <span className="min-w-0 flex-1 truncate text-sm text-slate-100">{p.name}</span>
                                {team === 1 && <button type="button" disabled={busy} onClick={() => moveEntry(p.user_id)} aria-label={`${p.name} zu Rot`} className="min-h-[36px] min-w-[36px] rounded-lg border border-white/15 text-sm font-bold text-slate-200">{arrow}</button>}
                              </div>
                            ))}
                            {lbots.map((b, i) => b.team !== team ? null : (
                              <div key={`b${i}`} className="flex items-center gap-1.5">
                                {team === 0 && <button type="button" disabled={busy} onClick={() => moveEntry(`b${i}`)} aria-label={`${BOT_NAMES[i % BOT_NAMES.length]} zu Blau`} className="min-h-[36px] min-w-[36px] rounded-lg border border-white/15 text-sm font-bold text-slate-200">{arrow}</button>}
                                <span className="min-w-0 flex-1 text-sm text-slate-100"><Bot size={13} className="mr-1 inline" />{BOT_NAMES[i % BOT_NAMES.length]} <span className="text-xs text-slate-400">· {SKILL_NAMES[b.skill]} · Bot</span></span>
                                <button type="button" disabled={busy} onClick={() => removeBot(i)} aria-label={`${BOT_NAMES[i % BOT_NAMES.length]} entfernen`} className="min-h-[36px] min-w-[28px] text-xs text-slate-400 hover:text-white">✕</button>
                                {team === 1 && <button type="button" disabled={busy} onClick={() => moveEntry(`b${i}`)} aria-label={`${BOT_NAMES[i % BOT_NAMES.length]} zu Rot`} className="min-h-[36px] min-w-[36px] rounded-lg border border-white/15 text-sm font-bold text-slate-200">{arrow}</button>}
                              </div>
                            ))}
                            <BotAdder disabled={busy || lbots.length >= MAX_BOTS} onAdd={(skill) => addBot(team, skill)} />
                          </div>
                        ))}
                      </div>
                      {(teamSize(0) === 0 || teamSize(1) === 0) && <p className="text-xs text-amber-200">Es braucht in beiden Teams mindestens eine Person oder einen Bot.</p>}
                    </div>
                  )}
                </>
              )}
              {(dr || vs === 1) && (<>
              <p className="label-mono">{dr ? 'Bots einstellen' : 'Bot-Team einstellen'}</p>
              <p className="text-xs text-slate-400">Bis zu 8 Bots, gern gemischt: jede Stärke einzeln wählbar. „Effizient“ liegt zwischen Profi und Meister und rechnet viel weniger (schont schwache Geräte).</p>
              <div className="space-y-1.5">
                {SKILL_ORDER.map((k) => (
                  <div key={k} className="flex items-center justify-between gap-2">
                    <span className="w-24 text-sm text-slate-200">{SKILL_NAMES[k]}</span>
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" disabled={busy || mix[k - 1] <= 0} aria-label={`Weniger ${SKILL_NAMES[k]}`} onClick={() => setMix(k, -1)}><Minus size={16} /></Button>
                      <span className="w-8 text-center font-mono text-sm">{mix[k - 1]}</span>
                      <Button variant="ghost" disabled={busy || mixTotal(mix) >= MAX_BOTS} aria-label={`Mehr ${SKILL_NAMES[k]}`} onClick={() => setMix(k, 1)}><Plus size={16} /></Button>
                    </div>
                  </div>
                ))}
              </div>
              </>)}
            </div>
          )}
          {error && <ErrorBox message={error} />}
          {st.spectator ? (
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 text-sm text-violet-200"><Eye size={16} /> Du schaust unsichtbar zu. Sobald der Lauf startet, fliegst du als Geist mit.</p>
              <Link to="/laeufe" className="text-accent-cyan hover:underline">Zurück zur Übersicht</Link>
            </div>
          ) : st.can_start ? (
            <div className="flex flex-wrap gap-2">
              <Button className="min-h-[52px] flex-1" busy={busy} disabled={!joined} onClick={() => void act(() => teamStart(id))}><Footprints size={18} /> {joined ? (!open && people.length > 2 && !people.every(isJoined) ? 'Jetzt starten (ohne Wartende)' : 'Los geht’s') : open ? 'Warte auf Mitspielende oder Bots …' : 'Warte auf deine Mitspieler …'}</Button>
              <Button variant="ghost" disabled={busy} onClick={() => void act(() => teamLeave(id), () => nav(open ? '/parkour' : '/duell'))}>{open || !st.is_host ? 'Verlassen' : 'Lobby schließen'}</Button>
            </div>
          ) : invitedMe ? (
            <div className="flex gap-2">
              <Button className="min-h-[52px] flex-1" busy={busy} onClick={() => void act(() => teamRespond(id, true))}>Beitreten</Button>
              <Button variant="ghost" disabled={busy} onClick={() => void act(() => teamRespond(id, false), () => nav('/duell'))}>Ablehnen</Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <p className="flex-1 animate-pulse text-slate-300">{open ? 'Warte auf Mitspielende oder einen Mod …' : `Warte, bis ${host?.name ?? 'der Host'} startet …`}</p>
              <Button variant="ghost" disabled={busy} onClick={() => void act(() => teamLeave(id), () => nav(open ? '/parkour' : '/duell'))}>Verlassen</Button>
            </div>
          )}
        </Card>
      </div>
    )
  }

  if (st.status === 'running') {
    const meP = people.find((p) => p.user_id === st.me)
    if (st.spectator) {
      return (
        <div className="space-y-3">
          <ParkourGame st={st} />
          {dr && <Card className="space-y-2"><p className="label-mono">Schon fertig</p><Results list={st.results ?? []} me={st.me} bots={(st.bots ?? 0) > 0 ? savedBots(st.id) : []} /></Card>}
          <div className="flex justify-center"><Button variant="ghost" onClick={() => nav('/laeufe')}>Zuschauen beenden</Button></div>
        </div>
      )
    }
    if (run && st.can_rejoin) {
      return (
        <div className="mx-auto max-w-xl space-y-3">
          <PageHeader eyebrow={label} title="Du bist draußen" />
          <Notice tone="warn">Der Lauf läuft noch. Du kannst wieder einsteigen, dein Stand bleibt auf deinem Gerät gespeichert, wenn du kurz weg warst.</Notice>
          {error && <ErrorBox message={error} />}
          <div className="flex gap-2">
            <Button className="min-h-[48px] flex-1" busy={busy} onClick={() => void act(() => teamRejoin(id))}>Wieder einsteigen</Button>
            <Button variant="ghost" onClick={() => nav('/parkour')}>Zurück</Button>
          </div>
        </div>
      )
    }
    if (run && meP && !(meP.is_host || (meP.state ?? 'joined') === 'joined')) {
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
          <PageHeader eyebrow={label} title="Gleich geht’s los" />
          {st.kind === 'quiz' && <TeamTrack st={st} />}
          <p key={n} className="race-count text-center font-mono text-8xl font-black text-fuchsia-300 drop-shadow-[0_0_24px_rgb(232_121_249/0.7)]">{n}</p>
          <p className="text-center text-sm text-slate-400">{dr ? 'Jeder läuft für sich: Wer im Ziel ist, ist sofort im nächsten Level. Tore öffnen sich nur, wenn jemand im selben Level auf der Platte steht.' : run ? 'Nur gemeinsam kommt ihr durch: Platten halten, Räuberleiter, zusammen in den Ausgang.' : 'Nur gemeinsam kommt ihr durch: Beide müssen jedes Hindernis richtig beantworten.'}</p>
        </div>
      )
    }
    if (run) {
      return (
        <div className="space-y-3">
          <ParkourGame st={st} />
          {dr && <Card className="space-y-2"><p className="label-mono">Schon fertig</p><Results list={st.results ?? []} me={st.me} /></Card>}
          <div className="flex justify-center"><Button variant="ghost" onClick={() => { void teamLeave(id).catch(() => undefined); nav(st.is_open ? '/parkour' : '/duell') }}>Spiel beenden</Button></div>
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
  // Wettlauf (Team-Parkour mit Gegnern): Urteil kommt aus dem eigenen Spiel, Stand der Teams vom Server
  const versus = !dr && st.kind === 'parkour' ? st.versus ?? 0 : 0
  let vres: { v: 'win' | 'lose' | 'draw'; my: number; rv: number } | null = null
  if (versus > 0) {
    try { vres = JSON.parse(window.localStorage.getItem(`pkrvs:${st.id}:${st.me}`) ?? 'null') } catch { vres = null }
    if (vres && !['win', 'lose', 'draw'].includes(vres.v)) vres = null
    if (!vres && versus === 2 && st.team_results) {
      const mine = (st.team_map ?? {})[st.me] === 1 ? 1 : 0
      const a = st.team_results[String(mine)]?.levels, b = st.team_results[String(1 - mine)]?.levels
      if (typeof a === 'number' && typeof b === 'number') vres = { v: a > b ? 'win' : a < b ? 'lose' : 'draw', my: a, rv: b }
    }
  }
  return (
    <div className="mx-auto max-w-xl space-y-5">
      <PageHeader eyebrow={label} title={dr ? 'Deathrun beendet' : vres ? (vres.v === 'win' ? 'Gewonnen!' : vres.v === 'lose' ? 'Verloren' : 'Unentschieden') : versus > 0 ? 'Wettlauf beendet' : run ? 'Keine Herzen mehr' : won ? 'Geschafft – ihr seid im Ziel!' : 'Leider nicht geschafft'} />
      {st.kind === 'quiz' && <TeamTrack st={st} />}
      <Card className="space-y-4 text-center">
        <div className="flex justify-center">{won ? <Trophy size={44} className="text-amber-300" /> : <Hearts left={0} total={st.lives} />}</div>
        {dr ? <Results list={st.results ?? []} me={st.me} /> : versus > 0 ? (
          <p className="text-slate-300">
            {vres ? `Wir: ${vres.my} Level · ${versus === 1 ? 'Bots' : 'Anderes Team'}: ${vres.rv} Level` : `${st.levels ?? 0} Level geschafft`}
          </p>
        ) : run ? (
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
        {(won || run) && (st.paid > 0
          ? <p className="text-lg font-semibold text-amber-200">+{st.paid} Coins</p>
          : (st.reward > 0 || run) && (st.levels ?? 1) > 0 && <p className="text-sm text-slate-400">Für heute gibt es keine Coins mehr (Tageslimit).</p>)}
        {error && <ErrorBox message={error} />}
        <div className="flex flex-wrap justify-center gap-2">
          <Button busy={busy} onClick={() => (st.is_open ? void act(async () => { nav(`/team/${await deathrunOpenJoin()}`) }) : nav(dr ? '/live-duell?modus=team&art=deathrun' : run ? '/live-duell?modus=team' : '/live-duell'))}>{st.is_open ? 'Nochmal (offene Lobby)' : 'Neuer Lauf'}</Button>
          <Button variant="ghost" onClick={() => nav('/duell')}>Zurück zu den Duellen</Button>
        </div>
      </Card>
    </div>
  )
}
