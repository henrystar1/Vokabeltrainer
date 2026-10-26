import { useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { ArrowUp, Eye, Skull } from 'lucide-react'
import { Joystick } from '../games/joystick'
import { useFocusMode } from '../koins/focusMode'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../../lib/supabaseClient'
import { parkourLearnOffList, parkourShopGet, teamDeathrunFinish, teamParkourFinish, type TeamPerson, type TeamState } from '../../services/play'
import { HOLE_IN, HOLE_OUT, drawAdminBack, drawAdminBody, drawAdminName, drawHoleAnim, type HoleAnim } from './adminFx'
import { levelFor } from './generator'
import { PK_HATS, pkFill } from './cosmetics'
import { FxField } from './fx'
import { skillList } from './botmix'
import { BOT_NAMES, botStep, newBot, type BotCtx, type BotState } from './bots'
import { PICKUP_INFO, type PickupKind } from './pickups'
import LearnOverlay from './LearnOverlay'
import { LEARN_PER_LEVEL, LEARN_PER_OFFER, OFFER_EVERY, OFFER_LIFE, loadLearnPool } from './parkourLearn'
import { ROWS, TILE, VIEW_H, VIEW_W, type Level } from './levels'
import { PH, PW, checkpointAt, inExit, newBody, pressedMap, spawnAt, spotIsSafe, stepBody, type Body, type Pressed } from './engine'

const COLORS = ['#22d3ee', '#e879f9', '#facc15', '#4ade80', '#fb923c']
const BOT_COLOR = '#94a3b8'
/** Jede Bot-Stärke hat Farbe und Muster, damit man sie auf einen Blick unterscheidet */
const BOT_SKIN: Record<number, string> = { 1: '#a3b18a', 2: '#94a3b8', 3: '#a78bfa', 4: '#fbbf24', 5: '#34d399' }
function botTexture(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, skill: number) {
  c.save()
  c.beginPath(); c.roundRect(x, y, w, h, 7); c.clip()
  c.strokeStyle = 'rgba(255,255,255,0.55)'; c.fillStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = 1.6
  if (skill === 1) { for (let yy = y + 5; yy < y + h; yy += 8) for (let xx = x + 4 + ((yy - y) % 16 === 5 ? 0 : 4); xx < x + w; xx += 8) { c.beginPath(); c.arc(xx, yy, 1.6, 0, Math.PI * 2); c.fill() } } // Punkte
  else if (skill === 2) { for (let yy = y + 4; yy < y + h; yy += 6) { c.beginPath(); c.moveTo(x, yy); c.lineTo(x + w, yy); c.stroke() } } // Querstreifen
  else if (skill === 3) { for (let k = -h; k < w; k += 7) { c.beginPath(); c.moveTo(x + k, y + h); c.lineTo(x + k + h, y); c.stroke() } } // Schrägstreifen
  else if (skill === 4) { c.strokeStyle = 'rgba(120,53,15,0.6)'; for (let k = -h; k < w; k += 8) { c.beginPath(); c.moveTo(x + k, y + h); c.lineTo(x + k + h, y); c.moveTo(x + k + h, y + h); c.lineTo(x + k, y); c.stroke() } } // Gitter
  else { c.strokeStyle = 'rgba(6,78,59,0.7)'; for (let yy = y + 6; yy < y + h; yy += 8) { c.beginPath(); c.moveTo(x, yy + 4); c.lineTo(x + w / 2, yy); c.lineTo(x + w, yy + 4); c.stroke() } } // Pfeile
  c.restore()
}
const STALE_MS = 2500
const SNAP_PX = 140 // größere Sprünge der Position werden nicht weich nachgezogen (Neustart, Levelwechsel)

interface Remote { x: number; y: number; face: 1 | -1; lv: number; cp: number | null; dead: boolean; ex: boolean; dc: number; g: boolean; seen: number; lh: number; gh: boolean; dx: number; dy: number; hp: number; el: boolean; sid: string; n: number; bf: number; lk?: Partial<TeamPerson>; ad?: boolean }
interface BotView { i: number; x: number; y: number; face: 1 | -1; lv: number; hp: number; out: boolean; dead: boolean; dx: number; dy: number; seen: number }

const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}
const finite = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null)

/** Joystick-Parkour für bis zu 5: alle laufen durch dieselben Level, Positionen laufen über Supabase Realtime. */
export default function ParkourGame({ st, startLevel = 0 }: { st: TeamState; startLevel?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useFocusMode(true)
  const { isAdmin, displayName } = useAuth()
  const nameRef = useRef(displayName)
  nameRef.current = displayName
  const adminRef = useRef(isAdmin)
  adminRef.current = isAdmin // Admins springen vierfach (3 Luftsprünge)
  const peopleRef = useRef(st.people)
  peopleRef.current = st.people
  const spec = !!st.spectator
  const input = useRef({ stick: 0, left: false, right: false, jump: false, down: false, fly: spec, ghost: spec, kill: false })
  const follow = useRef<{ uid: string | null; to: string | null }>({ uid: null, to: null })
  const [flyUi, setFlyUi] = useState(spec)
  const [ghostUi, setGhostUi] = useState(spec)
  const [followUi, setFollowUi] = useState<string | null>(null)
  const [watchUi, setWatchUi] = useState(false)
  const [joined, setJoined] = useState(false) // Admin hat vom reinen Zuschauen aus ins Spiel gewechselt
  const specUi = (spec && !joined) || watchUi
  const watchApi = useRef<((on: boolean) => void) | null>(null)
  const specApi = useRef<((d: number) => void) | null>(null)
  const toggleFly = () => { if (!adminRef.current || specUi) return; input.current.fly = !input.current.fly; if (!input.current.fly) input.current.ghost = false; setFlyUi(input.current.fly); setGhostUi(input.current.ghost) }
  const toggleGhost = () => { if (!adminRef.current || specUi) return; input.current.ghost = !input.current.ghost; if (input.current.ghost) input.current.fly = true; setGhostUi(input.current.ghost); setFlyUi(input.current.fly) }
  const watch = (uid: string | null) => { follow.current = { uid, to: uid }; setFollowUi(uid) }
  // Lernen: Speedup-Angebote (Rand) und Vokabeln beim Levelwechsel
  const learnBusy = useRef(false)
  const learnOff = useRef(false)
  const [offer, setOffer] = useState<{ id: number; kind: PickupKind; life: number } | null>(null)
  const [quiz, setQuiz] = useState<{ title: string; need: number; retry: boolean; done: (ok: boolean) => void } | null>(null)
  const offerApi = useRef<{ take: (kind: PickupKind | null) => void } | null>(null)
  const askApi = useRef<(need: number, title: string, retry: boolean, done: (ok: boolean) => void) => void>((_n, _t, _r, done) => done(true))
  askApi.current = (need, title, retry, done) => {
    if (learnOff.current) { done(true); return }
    const i = input.current
    i.stick = 0; i.left = false; i.right = false; i.jump = false; i.down = false; i.kill = false
    learnBusy.current = true
    setQuiz({ title, need, retry, done })
  }
  const finishQuiz = (ok: boolean) => {
    const q = quiz
    setQuiz(null)
    learnBusy.current = false
    q?.done(ok)
  }
  const takeOffer = () => {
    const o = offer
    if (!o) return
    setOffer(null)
    askApi.current(LEARN_PER_OFFER, `${PICKUP_INFO[o.kind].name}: ${LEARN_PER_OFFER} Vokabel`, false, (ok) => offerApi.current?.take(ok ? o.kind : null))
  }
  useEffect(() => {
    let alive = true
    parkourLearnOffList([st.me]).then((l) => { if (alive) learnOff.current = l.includes(st.me) }).catch(() => undefined)
    void loadLearnPool() // vorladen, damit die erste Frage sofort da ist
    return () => { alive = false }
  }, [st.me])
  const [hud, setHud] = useState({ level: 0, deaths: 0, ms: 0, linked: false, done: false, jet: false })

  useEffect(() => {
    const cv = canvas.current
    const ctx = cv?.getContext('2d')
    if (!cv || !ctx) return
    let isSpec = spec // Zuschauer-Geist: von der Seite aus oder von einem Admin mitten im Spiel eingeschaltet
    let hideSend = false
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    cv.width = VIEW_W * dpr
    cv.height = VIEW_H * dpr
    ctx.scale(dpr, dpr)

    let lv = startLevel
    let cp: number | null = null
    // Level 1–8 sind handgebaut, danach zufällig (für alle gleich, aus der Lauf-ID) und immer schwerer.
    const cache = new Map<number, Level>()
    const levelOf = (n: number): Level => {
      let l = cache.get(n)
      if (!l) { l = levelFor(st.id, n); cache.set(n, l) }
      return l
    }
    // Mitspielende (Host zuerst); wer nur eingeladen ist oder ausgestiegen ist, zählt nicht
    const dr = st.kind === 'deathrun' // Deathrun: jeder für sich (eigene Herzen und Level), Tore nur mit Teamarbeit
    const members = () => peopleRef.current.filter((p) => p.is_host || p.state === undefined || p.state === 'joined')
    // Versus: 0 = ein Team zusammen, 1 = wir (blau) gegen ein Bot-Team (rot), 2 = zwei Teams (rot/blau) auf denselben Leveln
    const vs = dr ? 0 : Math.max(0, Math.min(2, st.versus ?? 0))
    const teamOfU = (uid: string) => ((st.team_map ?? {})[uid] === 1 ? 1 : 0)
    const myTeam = vs === 2 ? teamOfU(st.me) : 1
    const players = members().filter((p) => vs !== 2 || spec || teamOfU(p.user_id) === myTeam)
    const slot = isSpec ? 0 : Math.max(0, players.findIndex((p) => p.user_id === st.me))
    const idxOf = (uid: string) => Math.max(0, members().findIndex((p) => p.user_id === uid))
    // Aussehen: aus der Mitspielerliste; ein Admin, der nur zuschaut und dann mitspielt, steht dort nicht und schickt es selbst mit
    let guestLook: Partial<TeamPerson> | null = null
    const lookOf = (uid: string): Partial<TeamPerson> | undefined => peopleRef.current.find((p) => p.user_id === uid) ?? (uid === st.me ? guestLook ?? undefined : remotes.get(uid)?.lk)
    const myFxId = () => lookOf(st.me)?.pk_fx ?? null
    const isAdminUid = (uid: string): boolean => (uid === st.me ? adminRef.current : lookOf(uid)?.role === 'admin' || !!remotes.get(uid)?.ad || !!rivals.get(uid)?.ad)
    const holes: HoleAnim[] = [] // Schwarze-Loch-Animationen (Admin kommt herein oder geht ins Zuschauen)
    let animLock = 0 // Sekunden, die der Admin im Loch verschwindet (bis dahin ist er gesperrt)
    let quiet = false // während der Animation keine Positionen mehr senden
    let pendingEv: 'in' | 'out' | null = null
    let forceEl = false
    const botsN = (dr || vs === 1) && !isSpec ? Math.max(0, Math.min(8, st.bots ?? 0)) : 0
    const botSkills = skillList(st.bot_skill, st.bots ?? 0)
    // Gemeinsamer Herzvorrat: Grundwert, +1 je Person ab der dritten, plus die im Shop gekauften Extra-Herzen aller
    let maxHearts = dr
      ? Math.min(12, Math.max(1, st.lives || 3) + Math.max(0, Math.min(10, st.people.find((p) => p.user_id === st.me)?.pk_hearts ?? 0)))
      : Math.min(20, Math.max(1, st.lives || 3) + Math.max(0, players.length - 2) + players.reduce((a, p) => a + Math.max(0, Math.min(10, p.pk_hearts ?? 0)), 0))
    const SEND_MS = players.length <= 2 ? 50 : players.length === 3 ? 70 : players.length === 4 ? 85 : 100
    if (adminRef.current && spec) {
      // Gast-Admin: eigene Farbe, Hut, Effekt und Herzen aus dem Shop laden
      void parkourShopGet().then((sh) => {
        if (disposed) return
        guestLook = { name: nameRef.current ?? 'Admin', pk_color: sh.color, pk_hat: sh.hat, pk_fx: sh.fx ?? null, pk_hearts: sh.hearts, role: 'admin' }
      }).catch(() => undefined)
    }
    const sid = Math.random().toString(36).slice(2, 8)
    let seq = 0
    let hearts = maxHearts
    let cpTotal = 0
    const dcSeen = new Map<string, number>() // gezählte Tode je Mitspieler
    let myCp: number | null = null
    let ghostOn = false
    let killCool = 0
    let deaths = 0
    let deadT = 0
    let exitHold = 0
    let finished = false
    let cam = 0
    let t = 0
    let titleT = 3
    let graceT = 1.5 // kurz nach Start/Neustart kosten Stacheln und Absturz kein Herz
    const hashLevel = (l: Level) => { let h = 5381; for (const r of l.rows) for (let i = 0; i < r.length; i++) h = ((h << 5) + h + r.charCodeAt(i)) | 0; return h }
    let startPerf = performance.now()
    const me: Body = (() => { const s = spawnAt(levelOf(startLevel), slot, null); return newBody(s.x, s.y) })()
    const remotes = new Map<string, Remote>()
    const rivals = new Map<string, Remote>() // Versus: das andere Team (nur sichtbar, keine Wirkung auf mein Team)
    let verdict: 'win' | 'lose' | 'draw' | null = null
    const group = vs === 1 // Bot-Team: alle Bots im selben Level mit gemeinsamen Herzen
    let bgh = Math.min(20, Math.max(1, st.lives || 3) + Math.max(0, Math.min(8, st.bots ?? 0) - 2))
    let bgOut = false
    const mates = (now: number) => { const out: Remote[] = []; for (const r of remotes.values()) if (r.lv === lv && !r.el && now - r.seen < STALE_MS) out.push(r); return out }
    const fxField = new FxField()
    let seenAny = false
    let over = false
    let reported = false
    let disposed = false

    // ---- Speedups (kommen als Angebot am Bildschirmrand, Freischalten kostet eine Vokabel) ----
    const buff = { jump3: 0, jet: 0 }
    const buffCode = () => (buff.jet > 0 ? 2 : buff.jump3 > 0 ? 1 : 0)

    // ---- Wiedereinstieg: Stand nach einem Neuladen oder Verbindungsabbruch wiederherstellen ----
    const saveKey = `pkr:${st.id}:${st.me}`
    let restored = false
    // Admin kommt zu Beginn aus einem Schwarzen Loch über dem Start herausgefallen
    if (adminRef.current && !isSpec) { me.y -= 70; holes.push({ x: me.x, y: me.y, t: 0, kind: 'in', lv, face: 1 }); pendingEv = 'in' }
    if (!isSpec) {
      try {
        const raw = window.localStorage.getItem(saveKey)
        const d = raw ? (JSON.parse(raw) as { t: number; lv: number; hearts: number; deaths: number; cp: number; ms: number }) : null
        if (d && Date.now() - d.t < 15 * 60 * 1000 && Number.isFinite(d.lv) && d.lv >= 0 && d.lv < 500) {
          lv = d.lv
          hearts = Math.max(1, Math.min(maxHearts, d.hearts))
          deaths = d.deaths || 0
          cpTotal = d.cp || 0
          startPerf = performance.now() - Math.max(0, d.ms || 0)
          const s0 = spawnAt(levelOf(lv), slot, null)
          Object.assign(me, newBody(s0.x, s0.y))
          restored = true
          titleT = 0
        }
      } catch { /* kein Speicher: egal */ }
    }
    let lastSave = 0
    const saveState = (now: number) => {
      if (isSpec || finished || now - lastSave < 1000) return
      lastSave = now
      try { window.localStorage.setItem(saveKey, JSON.stringify({ t: Date.now(), lv, hearts, deaths, cp: cpTotal, ms: now - startPerf })) } catch { /* ignorieren */ }
    }

    // ---- Bots (Deathrun): der Rechner mit der kleinsten Nutzer-ID im Lauf steuert sie, alle anderen sehen sie wie Mitspielende ----
    let bots: BotState[] | null = null
    const botSnap = new Map<number, BotView>()
    const isMaster = (now: number): boolean => {
      if (botsN <= 0 || (finished && !group)) return false
      for (const [uid, r] of remotes) if (uid < st.me && (!r.el || group) && now - r.seen < STALE_MS * 2 && members().some((p) => p.user_id === uid)) return false
      return true
    }
    const initBots = (now: number) => {
      void now
      bots = []
      if (group) { const g0 = botSnap.get(0); if (g0) { bgh = g0.hp; bgOut = g0.out } }
      for (let i = 0; i < botsN; i++) {
        const sn = group ? botSnap.get(0) : botSnap.get(i)
        const l = sn?.lv ?? 0
        const b = newBot(i, levelOf(l), Math.max(1, st.lives || 3), botSkills[i] ?? 2, l)
        if (group) { b.hearts = 99; b.out = bgOut; b.deadT = 0.05 + i * 0.45 }
        else if (sn) { b.body.x = sn.x; b.body.y = sn.y; b.hearts = sn.hp; b.out = sn.out }
        bots.push(b)
      }
    }
    const botViews = (now: number): BotView[] => {
      if (bots) return bots.map((b) => ({ i: b.i, x: b.body.x, y: b.body.y, face: b.body.face, lv: b.lv, hp: group ? bgh : b.hearts, out: group ? bgOut : b.out, dead: b.deadT > 0, dx: b.body.x, dy: b.body.y, seen: now }))
      return [...botSnap.values()].filter((b) => now - b.seen < STALE_MS * 2)
    }

    // ---- Verbindung: bei Fehlern und Funkstille neu aufbauen ----
    let ch: RealtimeChannel | null = null
    let ready = false
    let lastSend = 0
    let lastSig = ''
    let lastRx = performance.now()
    let lastConnect = performance.now()
    let netNote = ''
    let retryT: number | undefined
    let attempt = 0
    let lastHud = 0
    let lastBotSend = 0

    function onState(payload: unknown) {
      const p = payload as Partial<Remote> & { u?: string; n?: number; sid?: string; bf?: number; lk?: { n?: string; c?: string | null; h?: string | null; f?: string | null }; ad?: number; ev?: string }
      const uid = p.u
      const x = finite(p.x, -100, 200000)
      const y = finite(p.y, -800, 1200)
      if (!uid || uid === st.me || x === null || y === null) return
      lastRx = performance.now()
      const rival = vs === 2 && !spec && !isSpec && teamOfU(uid) !== myTeam
      const store = rival ? rivals : remotes
      const prev = store.get(uid)
      const psid = typeof p.sid === 'string' ? p.sid : ''
      const pn = typeof p.n === 'number' ? p.n : 0
      // Veraltete oder doppelte Nachrichten (Wiederverbindung, Reihenfolge) verwerfen
      if (prev && prev.sid === psid && pn > 0 && pn <= prev.n) return
      const lvNew = Math.max(0, Math.min(999, Math.floor(p.lv ?? 0)))
      const dead = !!p.dead
      const jump = !prev || prev.lv !== lvNew || prev.dead !== dead || Math.hypot(x - prev.x, y - prev.y) > SNAP_PX
      const r: Remote = { x, y, face: p.face === -1 ? -1 : 1, lv: lvNew, cp: p.cp ?? null, dead, ex: !!p.ex, dc: p.dc ?? 0, g: !!p.g, seen: performance.now(), lh: p.lh ?? 0, gh: !!p.gh, dx: jump || !prev ? x : prev.dx, dy: jump || !prev ? y : prev.dy, hp: p.hp ?? 0, el: !!p.el, sid: psid, n: pn, bf: p.bf ?? 0, ad: !!p.ad || prev?.ad, lk: p.lk && typeof p.lk === 'object' ? { name: String(p.lk.n ?? '').slice(0, 24), pk_color: p.lk.c ?? null, pk_hat: p.lk.h ?? null, pk_fx: p.lk.f ?? null, role: 'admin' } : prev?.lk }
      if (p.ev === 'in' || p.ev === 'out') holes.push({ x, y, t: 0, kind: p.ev, lv: lvNew, face: r.face })
      store.set(uid, r)
      if (rival) return
      if (isSpec || dr) { seenAny = true; return } // Deathrun: jede Person hat ihr eigenes Level, ihre Herzen und ihre Checkpoints
      if (!seenAny) {
        // Späterer Einstieg: Level und Herzen der anderen übernehmen
        seenAny = true
        dcSeen.set(uid, r.dc)
        if (!restored && r.lv > lv) { goLevel(r.lv, true); if (r.hp > 0) hearts = Math.min(maxHearts, r.hp) } else if (r.hp > 0 && r.hp < hearts) hearts = r.hp
        if (r.lv === lv && r.cp !== null) { cp = r.cp }
        return
      }
      if (r.lv > lv && r.lv < lv + 3) goLevel(r.lv)
      if (r.lv === lv && r.cp !== null && (cp === null || r.cp > cp)) { cp = r.cp; cpTotal += 1 }
      // Tode der anderen kosten auch dir ein gemeinsames Herz
      const seenDc = dcSeen.get(uid) ?? 0
      if (r.dc > seenDc) { hearts -= r.dc - seenDc; dcSeen.set(uid, r.dc); checkOver() }
    }

    function onBots(payload: unknown) {
      const p = payload as { sid?: string; l?: number[][] }
      if (!p || !Array.isArray(p.l) || bots) return
      lastRx = performance.now()
      const now = performance.now()
      for (const a of p.l) {
        if (!Array.isArray(a) || a.length < 8) continue
        const i = a[0]
        const x = finite(a[1], -100, 200000), y = finite(a[2], -800, 1200)
        if (x === null || y === null || !Number.isInteger(i) || i < 0 || i > 8) continue
        const prev = botSnap.get(i)
        const lvN = Math.max(0, Math.min(999, Math.floor(a[4])))
        const jump = !prev || prev.lv !== lvN || Math.hypot(x - prev.x, y - prev.y) > SNAP_PX
        botSnap.set(i, { i, x, y, face: a[3] === -1 ? -1 : 1, lv: lvN, hp: a[5], out: a[6] === 1, dead: a[7] === 1, dx: jump || !prev ? x : prev.dx, dy: jump || !prev ? y : prev.dy, seen: now })
      }
    }

    function connect() {
      if (disposed) return
      lastConnect = performance.now()
      if (ch) void supabase.removeChannel(ch)
      ready = false
      const c = supabase.channel(`parkour-${st.id}`, { config: { broadcast: { self: false } } })
      ch = c
      c.on('broadcast', { event: 's' }, ({ payload }) => onState(payload))
        .on('broadcast', { event: 'b' }, ({ payload }) => onBots(payload))
        .subscribe((s) => {
          if (c !== ch || disposed) return
          if (s === 'SUBSCRIBED') { ready = true; attempt = 0; netNote = ''; lastSend = 0; lastSig = ''; lastRx = performance.now() }
          else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') { ready = false; scheduleReconnect() }
        })
    }
    function scheduleReconnect() {
      if (disposed || retryT !== undefined) return
      netNote = 'Verbindung wird neu aufgebaut …'
      const delay = Math.min(8000, 700 * 2 ** Math.min(attempt++, 4))
      retryT = window.setTimeout(() => { retryT = undefined; connect() }, delay)
    }
    connect()

    function report(levels: number) {
      if (isSpec) return
      if (finished && reported) return
      finished = true
      reported = true
      try { window.localStorage.removeItem(saveKey) } catch { /* ignorieren */ }
      const ms = Math.round(performance.now() - startPerf)
      if (dr) void teamDeathrunFinish(st.id, ms, deaths, levels, cpTotal).catch(() => undefined)
      else void teamParkourFinish(st.id, ms, deaths + [...dcSeen.values()].reduce((x, y) => x + y, 0), levels, cpTotal).catch(() => undefined)
    }

    function checkOver() {
      if (isSpec) return
      if (hearts <= 0 && !finished) { over = true; hearts = 0; if (vs === 0) window.setTimeout(() => report(lv), 1800); finished = true }
    }

    function goLevel(n: number, adopt = false) {
      if (n > lv && !adopt) hearts = Math.min(maxHearts, hearts + 1) // geschafftes Level: ein Herz zurück
      lv = n
      cp = null
      myCp = null
      exitHold = 0
      titleT = 3
      graceT = 1.5
      const s = spawnAt(levelOf(lv), slot, null)
      Object.assign(me, newBody(s.x, s.y))
      for (const r of remotes.values()) r.ex = false
      fxField.clear()
      cam = 0
    }

    /** Zurück ins Spiel: zu einem erreichten Checkpoint, der im Bild ist, sonst zum Mitspieler, sonst zum letzten Checkpoint. */
    function respawn(now: number) {
      const level = levelOf(lv)
      const reached = [2, ...level.checkpoints.filter((c) => cp !== null && c <= cp)]
      const visible = reached.filter((c) => c * TILE + TILE > cam && c * TILE < cam + VIEW_W)
      const near = mates(now).filter((r) => !r.dead && r.g)
      let pos: { x: number; y: number }
      if (visible.length > 0) {
        const nearest = visible.reduce((a, b) => (Math.abs(b * TILE - me.x) < Math.abs(a * TILE - me.x) ? b : a))
        pos = spawnAt(level, slot, nearest)
      } else if (near.length > 0) {
        const m = near.reduce((a, b) => (Math.abs(b.x - me.x) < Math.abs(a.x - me.x) ? b : a))
        pos = { x: m.x, y: m.y }
      } else {
        pos = spawnAt(level, slot, myCp)
      }
      // Nie an einer Stelle starten, an der man sofort stirbt oder feststeckt
      if (!spotIsSafe(level, pressedMap(level, mates(now).filter((r) => !r.dead)), pos.x, pos.y)) pos = spawnAt(level, slot, myCp)
      Object.assign(me, newBody(pos.x, pos.y))
      graceT = 1.5
      fxField.clear()
    }

    /** Zuschauer: in ein anderes Level wechseln (Ziel durchfliegen oder Knopf). */
    function specGo(n: number, atEnd: boolean) {
      if (n < 0) return
      lv = n
      cam = 0
      fxField.clear()
      follow.current = { uid: null, to: null }
      setFollowUi(null)
      const L = levelOf(n)
      const sp = spawnAt(L, 0, null)
      me.x = atEnd ? (L.cols - 4) * TILE : sp.x
      me.y = sp.y - 40
      me.vx = 0
      me.vy = 0
    }
    specApi.current = (d) => specGo(Math.max(0, lv + d), d < 0)
    /** Admin: mitten im Lauf zum unsichtbaren Zuschauer-Geist werden und wieder zurück ins Spiel. */
    /** Ende der Verschwinde-Animation: jetzt wird der Admin zum unsichtbaren Zuschauer-Geist. */
    const finishOut = () => {
      isSpec = true
      hideSend = true
      forceEl = false
      quiet = false
      input.current.fly = true
      input.current.ghost = true
      ghostOn = true
      deadT = 0
      follow.current = { uid: null, to: null }
      setFollowUi(null)
      setWatchUi(true)
      setFlyUi(true)
      setGhostUi(true)
    }
    watchApi.current = (on) => {
      if (!adminRef.current || finished || on === isSpec || animLock > 0) return
      if (on) {
        // Unter dem Admin öffnet sich ein Schwarzes Loch, er fällt hinein und verschwindet mit ihm
        holes.push({ x: me.x, y: me.y, t: 0, kind: 'out', lv, face: me.face })
        animLock = HOLE_OUT
        forceEl = true
        pendingEv = 'out'
        lastSend = 0; lastSig = ''
        send(performance.now())
        quiet = true
        return
      } else {
        isSpec = false
        quiet = false
        forceEl = false
        input.current.fly = false
        input.current.ghost = false
        ghostOn = false
        follow.current = { uid: null, to: null }
        setFollowUi(null)
        // Genau dort ins Spiel, wo der Geist gerade ist (steht er in einer Wand oder in Stacheln, dann an der nächsten freien Stelle)
        const level = levelOf(lv)
        const pr = pressedMap(level, mates(performance.now()).filter((r) => !r.dead).map((r) => ({ x: r.x, y: r.y })))
        let px = me.x, py = me.y
        if (!spotIsSafe(level, pr, px, py)) {
          let found = false
          for (const r of [8, 16, 24, 32, 48, 64, 96, 128]) {
            for (const [dx, dy] of [[0, -r], [0, r], [-r, 0], [r, 0], [-r, -r], [r, -r], [-r, r], [r, r]]) {
              if (!found && spotIsSafe(level, pr, me.x + dx, Math.max(0, me.y + dy))) { px = me.x + dx; py = Math.max(0, me.y + dy); found = true }
            }
            if (found) break
          }
          if (!found) { const sp = spawnAt(level, slot, myCp); px = sp.x; py = sp.y }
        }
        Object.assign(me, newBody(px, py))
        cp = cp ?? myCp
        titleT = 0
        exitHold = 0
        graceT = 1.5
        fxField.clear()
        setJoined(true)
        // Gast-Admin bekommt seine Herzen aus dem Shop
        if (spec && guestLook) { const extra = Math.max(0, Math.min(10, guestLook.pk_hearts ?? 0)); maxHearts += extra; hearts = maxHearts }
        // Schwarzes Loch an der Stelle, aus dem er herausfällt
        holes.push({ x: px, y: py, t: 0, kind: 'in', lv, face: me.face })
        pendingEv = 'in'
        lastSend = 0; lastSig = ''
      }
      setWatchUi(false)
      setFlyUi(input.current.fly)
      setGhostUi(input.current.ghost)
    }

    function send(now: number) {
      if (!ready || (isSpec && !hideSend) || quiet) return
      if (hideSend) { lastSend = 0; lastSig = '' } // einmal "ausgeblendet" melden, dann still
      const level = levelOf(lv)
      const x = Math.round(me.x * 10) / 10, y = Math.round(me.y * 10) / 10
      const sig = `${x}|${y}|${me.face}|${lv}|${cp}|${deadT > 0 ? 1 : 0}|${me.ground ? 1 : 0}|${ghostOn ? 1 : 0}|${hearts}|${deaths}|${finished && (dr || vs > 0) ? 1 : 0}|${buffCode()}`
      // Wer stillsteht, meldet sich nur ein paarmal pro Sekunde (spart Nachrichten bei vielen Spielenden)
      if (now - lastSend < SEND_MS || (sig === lastSig && now - lastSend < 350)) return
      lastSend = now
      lastSig = sig
      void ch?.send({ type: 'broadcast', event: 's', payload: { u: st.me, sid, n: ++seq, x, y, face: me.face, lv, cp, dead: deadT > 0, ex: inExit(level, me), dc: spec ? 0 : deaths, g: me.ground, lh: hashLevel(level), gh: ghostOn, hp: hearts, el: (finished && (dr || vs > 0)) || isSpec || forceEl, bf: buffCode(), ...(adminRef.current ? { ad: 1, ...(guestLook ? { lk: { n: guestLook.name, c: guestLook.pk_color, h: guestLook.pk_hat, f: guestLook.pk_fx } } : {}) } : {}), ...(pendingEv ? { ev: pendingEv } : {}) } })?.catch?.(() => undefined)
      pendingEv = null
      hideSend = false
    }

    // Stand der Bots für die Rangliste am Ende merken (jeder Rechner sieht sie)
    let lastBotSave = 0
    function saveBots(now: number) {
      if (botsN <= 0 || now - lastBotSave < 1500) return
      lastBotSave = now
      const v = botViews(now)
      if (v.length === 0) return
      try { window.localStorage.setItem(`pkbots:${st.id}`, JSON.stringify(v.map((b) => ({ i: b.i, lv: b.lv, out: b.out, sk: botSkills[b.i] ?? 2 })))) } catch { /* ignorieren */ }
    }

    function sendBots(now: number) {
      if (!bots || !ready || now - lastBotSend < 110) return
      lastBotSend = now
      const l = bots.map((b) => [b.i, Math.round(b.body.x * 10) / 10, Math.round(b.body.y * 10) / 10, b.body.face, b.lv, group ? bgh : b.hearts, (group ? bgOut : b.out) ? 1 : 0, b.deadT > 0 ? 1 : 0])
      void ch?.send({ type: 'broadcast', event: 'b', payload: { sid, l } })?.catch?.(() => undefined)
    }

    // Angebot am Bildschirmrand: kommt regelmäßig, läuft ab, Tippen = eine Vokabel beantworten
    let offerIn = OFFER_EVERY * 0.5
    let offerLeft = 0
    let offerSeq = 0
    const clearOffer = () => { offerLeft = 0; setOffer(null) }
    function tickOffer(dt: number) {
      if (adminRef.current) { if (offerLeft > 0) clearOffer(); return } // Admins fliegen und springen sowieso
      if (offerLeft > 0) { offerLeft -= dt; if (offerLeft <= 0) clearOffer(); return }
      offerIn -= dt
      if (offerIn <= 0) {
        offerSeq += 1
        offerLeft = OFFER_LIFE
        offerIn = OFFER_EVERY
        setOffer({ id: offerSeq, kind: hash(offerSeq * 7 + t) < 0.5 ? 'jump3' : 'jet', life: OFFER_LIFE })
      }
    }
    offerApi.current = {
      take: (kind) => {
        clearOffer()
        offerIn = OFFER_EVERY
        if (!kind) { toast = { text: 'Falsch – das Upgrade ist weg', t: 2.5 }; return }
        const info = PICKUP_INFO[kind]
        if (kind === 'jump3') buff.jump3 = info.seconds
        else buff.jet = info.seconds
        toast = { text: `${info.name}! ${info.seconds} s`, t: 2 }
      },
    }
    let toast: { text: string; t: number } | null = null

    // Bots im selben Level wie ich (zählen wie Mitspielende: sie halten Platten und tragen auf dem Kopf)
    const botPts = (now: number): Array<{ x: number; y: number }> => {
      const out: Array<{ x: number; y: number }> = []
      if (vs === 1) return out // Gegner-Bots stehen auf keiner Platte von uns
      for (const b of botViews(now)) if (b.lv === lv && !b.out && !b.dead) out.push({ x: b.x, y: b.y })
      return out
    }
    let openUntil = 0 // Notausgang: Bots konnten nicht helfen, Tore bleiben kurz offen
    let gateStuck = 0
    const gatePressed = (level: Level, mt: Remote[], bp: Array<{ x: number; y: number }>, others: Array<{ x: number; y: number }>): Pressed => {
      if ((dr || vs > 0) && ((mt.length === 0 && bp.length === 0) || t < openUntil)) return { a: true, b: true, c: true }
      return pressedMap(level, [deadT > 0 || isSpec ? null : me, ...others, ...bp])
    }

    const soloTeam = vs > 0 && players.length <= 1 // Wer im Wettlauf allein im Team ist, geht allein durchs Ziel
    /** Wettlauf: wer ist weiter gekommen? Ein Team scheidet aus, wenn es keine Herzen mehr hat. */
    function checkVerdict(now: number) {
      let rLv = -1
      let rOut = false
      if (vs === 1) {
        const v = botViews(now)
        if (v.length > 0) { rLv = Math.max(...v.map((b) => b.lv)); rOut = v.every((b) => b.out) }
      } else {
        const rs = [...rivals.values()]
        if (rs.length > 0) { rLv = Math.max(...rs.map((r) => r.lv)); rOut = rs.every((r) => r.el || now - r.seen > 15000) }
      }
      if (rLv < 0) return
      let v: 'win' | 'lose' | 'draw' | null = null
      if (over && rOut) v = lv > rLv ? 'win' : lv < rLv ? 'lose' : 'draw'
      else if (over && rLv > lv) v = 'lose'
      else if (!over && rOut && lv > rLv) v = 'win'
      if (!v) return
      verdict = v
      try { window.localStorage.setItem(`pkrvs:${st.id}:${st.me}`, JSON.stringify({ v, my: lv, rv: rLv, bots: vs === 1 })) } catch { /* ignorieren */ }
      report(lv)
    }

    function step(dt: number, now: number) {
      const level = levelOf(lv)
      const mt = mates(now)
      const bp = botPts(now)
      const others = [...mt.filter((r) => !r.dead).map((r) => ({ x: r.x, y: r.y })), ...bp]
      // Deathrun: wer allein im Level ist (auch ohne Bots), für den sind alle Tore offen (sonst käme der Letzte nie weiter)
      const pressed: Pressed = gatePressed(level, mt, bp, others.slice(0, others.length - bp.length))
      // Bots (nur auf dem Rechner, der sie steuert)
      if (botsN > 0) {
        const master = isMaster(now)
        if (master && !bots) initBots(now)
        else if (!master && bots) { for (const b of bots) botSnap.set(b.i, { i: b.i, x: b.body.x, y: b.body.y, face: b.body.face, lv: b.lv, hp: group ? bgh : b.hearts, out: group ? bgOut : b.out, dead: b.deadT > 0, dx: b.body.x, dy: b.body.y, seen: now }); bots = null }
        if (bots) {
          // Die Bots warten am Start des nächsten Levels, bis der erste Mensch dort angekommen ist (der lernt zwischen den Leveln noch)
          let humanMax = -1
          if (!isSpec && !finished) humanMax = lv
          for (const r of remotes.values()) if (!r.el && now - r.seen < STALE_MS * 4) humanMax = Math.max(humanMax, r.lv)
          for (const b of bots) {
            if (group && (b.parked || bgOut)) continue
            if (!group && humanMax >= 0 && b.lv > humanMax) continue
            // Menschen und andere Bots im Level des Bots: er hält Platten für Menschen und hat selbst feste Türen
            const humans: Array<{ x: number; y: number }> = []
            // Auch wer gerade tot ist und gleich wieder einsteigt, zählt weiter (die Bots vergessen niemanden)
            if (!group) {
              if (!isSpec && !finished && lv === b.lv) humans.push({ x: me.x, y: me.y })
              for (const r of remotes.values()) if (r.lv === b.lv && !r.el && now - r.seen < STALE_MS) humans.push({ x: r.x, y: r.y })
            }
            const others = [...humans]
            for (const o of bots) if (o !== b && o.lv === b.lv && !o.out && !o.parked && o.deadT <= 0) others.push({ x: o.body.x, y: o.body.y })
            // Die Bots sagen sich gegenseitig, wer eine Platte hält und wo sie stehen (dann hält nur einer, die anderen gehen weiter)
            const bl = levelOf(b.lv)
            const infos = bots.filter((o) => o !== b && o.lv === b.lv && !o.out && !o.parked).map((o) => {
              if (o.deadT > 0) { const sp = spawnAt(bl, o.i % 5, o.cp); return { i: o.i, x: sp.x, y: sp.y, mode: 'run' as const, ch: o.holdCh } } // wartet auf den Neustart: steht gleich wieder am Checkpoint
              return { i: o.i, x: o.body.x, y: o.body.y, mode: o.mode, ch: o.holdCh, take: o.take }
            })
            const ctx: BotCtx = { humans, others, bots: infos }
            const r = botStep(levelOf(b.lv), b, dt, ctx)
            if (group) {
              if (r === 'exit') b.parked = true
              else if (r === 'dead') { bgh -= 1; if (bgh <= 0) { bgOut = true; for (const o of bots) o.out = true } }
            } else if (r === 'exit') {
              b.lv += 1
              b.hearts = Math.min(Math.max(1, st.lives || 3), b.hearts + 1)
              const sp = spawnAt(levelOf(b.lv), b.i % 5, null)
              Object.assign(b.body, newBody(sp.x, sp.y))
              b.cp = null; b.grace = 1.5; b.script = null; b.stuckT = 0; b.lastX = sp.x; b.retries = 0; b.deadT = 0.05 + b.i * 0.45
            }
          }
          // Bot-Team: sind alle im Ausgang, geht es gemeinsam ins nächste Level (ein Herz zurück)
          if (group && !bgOut && bots.length > 0 && bots.every((o) => o.parked || o.out) && (humanMax < 0 || bots[0].lv + 1 <= humanMax)) {
            const nl = bots[0].lv + 1
            bgh = Math.min(20, bgh + 1)
            for (const o of bots) {
              const sp = spawnAt(levelOf(nl), o.i % 5, null)
              Object.assign(o.body, newBody(sp.x, sp.y))
              o.lv = nl; o.cp = null; o.grace = 1.5; o.script = null; o.stuckT = 0; o.lastX = sp.x; o.retries = 0; o.deadT = 0.05 + o.i * 0.45
              o.parked = false; o.mode = 'run'; o.blockT = 0; o.route = null
            }
          }
        }
      }
      if (vs > 0 && !isSpec && verdict === null) checkVerdict(now)
      if (animLock > 0) { animLock -= dt; if (animLock <= 0) finishOut(); return }
      if (isSpec) {
        // Zuschauer: unsichtbarer Geist, fliegt frei oder folgt einer Person
        const i = input.current
        const fl = follow.current
        if (fl.to) {
          const r = remotes.get(fl.to)
          if (r && now - r.seen < STALE_MS * 3) {
            if (r.lv !== lv) { lv = r.lv; cam = 0; fxField.clear() }
            me.x = r.dx; me.y = r.dy - 8
            if (fl.uid === null) fl.to = null // einmal hinfliegen, dann frei
          }
        }
        const move = i.stick !== 0 ? i.stick : (i.right ? 1 : 0) - (i.left ? 1 : 0)
        if (move !== 0 || i.jump || i.down) { if (fl.uid) { follow.current = { uid: null, to: null }; setFollowUi(null) } }
        if (!fl.uid || move !== 0) stepBody(me, { move, jump: false, fly: true, ghost: true, vert: (i.down ? 1 : 0) - (i.jump ? 1 : 0) }, level, pressed, null, dt)
        ghostOn = true
        // Durch das Ziel in das nächste Level, durch den linken Rand zurück in das vorige
        if (!fl.uid) {
          if (inExit(level, me)) specGo(lv + 1, false)
          else if (me.x < 2 && move < 0 && lv > 0) specGo(lv - 1, true)
        }
        return
      }
      if (finished) return
      if (learnBusy.current) return // Vokabel-Frage offen: die Figur steht still
      tickOffer(dt)
      if (killCool > 0) killCool -= dt
      if (graceT > 0) graceT -= dt
      if (buff.jump3 > 0) buff.jump3 -= dt
      if (buff.jet > 0) buff.jet -= dt
      if (toast) { toast.t -= dt; if (toast.t <= 0) toast = null }
      if (deadT > 0) {
        deadT -= dt
        if (deadT <= 0) respawn(now)
        return
      }
      if (input.current.kill) {
        input.current.kill = false
        if (killCool <= 0) { killCool = 1.5; deadT = 0.35; return } // Neustart ohne Herz-Verlust
      }
      const i = input.current
      const move = i.stick !== 0 ? i.stick : (i.right ? 1 : 0) - (i.left ? 1 : 0)
      const adm = adminRef.current
      const jetFly = !adm && buff.jet > 0 // Jetpack: Flugmodus wie beim Admin (Sprungknopf hoch, Runter-Knopf oder S runter), keine Stacheln, Wände bleiben fest
      const airJumps = adm ? 3 : buff.jump3 > 0 ? 2 : 1
      const r = stepBody(me, { move, jump: i.jump, airJumps, fly: (adm && i.fly) || jetFly, ghost: adm && i.fly && i.ghost, vert: (i.down ? 1 : 0) - (i.jump ? 1 : 0) }, level, pressed, others, dt)
      // Notausgang: steht ein Mensch lange allein vor einer Tür, die nur Bots hätten öffnen können, gehen die Tore auf
      if (dr && bp.length > 0 && mt.length === 0 && move !== 0 && Math.abs(me.vx) < 5 && me.ground) {
        const tx = Math.floor((me.x + PW + 3) / TILE), ty = Math.floor((me.y + PH - 2) / TILE)
        const ch = level.rows[ty]?.[tx]
        if (ch && ch >= 'A' && ch <= 'C' && !pressed[ch.toLowerCase()]) gateStuck += dt
        else gateStuck = 0
        if (gateStuck > 12) { openUntil = t + 40; gateStuck = 0; toast = { text: 'Tore offen: die Bots helfen nicht', t: 3 } }
      } else gateStuck = 0
      ghostOn = adm && i.fly && i.ghost
      if (r === 'dead' && graceT > 0) { deadT = 0.3; return } // Schonfrist: neu starten ohne Herz zu verlieren
      if (r === 'dead') { deaths += 1; hearts -= 1; deadT = 0.7; checkOver(); return }
      if (r === 'lost') { deadT = 0.5; return } // eingeklemmt / aus der Welt: neu starten, aber kein Herz verlieren
      const c = checkpointAt(level, me)
      if (c !== null && (myCp === null || c > myCp)) myCp = c
      if (c !== null && (cp === null || c > cp)) { cp = c; cpTotal += 1 }
      // Ausgang: im Deathrun sofort ins nächste Level, sonst müssen alle gleichzeitig drin sein
      if (dr ? inExit(level, me) : inExit(level, me) && (soloTeam || (mt.length > 0 && mt.every((r) => r.ex)))) {
        exitHold += dt
        if (exitHold > (dr ? 0.2 : 0.7) && !finished) {
          const target = lv + 1
          exitHold = 0
          askApi.current(LEARN_PER_LEVEL, `Level ${target + 1} wartet: ${LEARN_PER_LEVEL} Vokabeln`, true, () => goLevel(target))
        }
      } else exitHold = 0
    }

    function render(now: number) {
      const level = levelOf(lv)
      const mt = mates(now)
      const fresh = mt.length > 0
      const pressed = gatePressed(level, mt, botPts(now), mt.filter((r) => !r.dead))
      // Kamera
      const mid = me.x // die Kamera folgt nur dir: wer weit weg ist, verschwindet aus dem Bild
      const want = Math.max(0, Math.min(level.cols * TILE - VIEW_W, mid + PW / 2 - VIEW_W / 2))
      cam += (want - cam) * 0.12
      const cx = Math.round(cam)
      // Himmel
      const g = ctx!.createLinearGradient(0, 0, 0, VIEW_H)
      g.addColorStop(0, '#0b1030'); g.addColorStop(0.6, '#1d2a66'); g.addColorStop(1, '#3b2b7a')
      ctx!.fillStyle = g
      ctx!.fillRect(0, 0, VIEW_W, VIEW_H)
      for (let k = 0; k < 50; k++) {
        const sx = ((hash(k) * VIEW_W * 2 - cx * 0.12) % VIEW_W + VIEW_W) % VIEW_W
        ctx!.fillStyle = `rgba(255,255,255,${0.2 + 0.5 * Math.abs(Math.sin(t * 1.4 + k))})`
        ctx!.fillRect(sx, hash(k + 50) * VIEW_H * 0.6, 1.5, 1.5)
      }
      ctx!.fillStyle = 'rgba(120,100,220,0.18)'
      for (let k = 0; k < 7; k++) {
        const hx = k * 190 - ((cx * 0.3) % 190) - 40
        ctx!.beginPath(); ctx!.moveTo(hx, VIEW_H - 64); ctx!.lineTo(hx + 95, VIEW_H - 64 - 90 - hash(k + Math.floor(cx / 570)) * 70); ctx!.lineTo(hx + 190, VIEW_H - 64); ctx!.fill()
      }
      ctx!.save()
      ctx!.translate(-cx, 0)
      const x0 = Math.max(0, Math.floor(cx / TILE)), x1 = Math.min(level.cols - 1, Math.floor((cx + VIEW_W) / TILE))
      const chColor: Record<string, string> = { a: '#22d3ee', b: '#e879f9', c: '#fbbf24' }
      for (let ty = 0; ty < ROWS; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          const c = level.rows[ty][tx]
          const px = tx * TILE, py = ty * TILE
          if (c === '#') {
            ctx!.fillStyle = '#2a2f55'; ctx!.fillRect(px, py, TILE, TILE)
            ctx!.fillStyle = 'rgba(255,255,255,0.05)'; ctx!.fillRect(px, py, TILE, 2)
            ctx!.fillStyle = 'rgba(0,0,0,0.25)'; ctx!.fillRect(px + 1, py + TILE - 2, TILE - 2, 2)
            if (ty === 0 || level.rows[ty - 1][tx] !== '#') { ctx!.fillStyle = '#34d399'; ctx!.fillRect(px, py, TILE, 6); ctx!.fillStyle = '#6ee7b7'; ctx!.fillRect(px, py, TILE, 2) }
          } else if (c === '^') {
            ctx!.fillStyle = '#fb7185'
            for (let s = 0; s < 2; s++) { ctx!.beginPath(); ctx!.moveTo(px + s * 16 + 1, py + TILE); ctx!.lineTo(px + s * 16 + 8, py + 12); ctx!.lineTo(px + s * 16 + 15, py + TILE); ctx!.fill() }
          } else if (c === 'a' || c === 'b' || c === 'c') {
            const on = !!pressed[c]
            ctx!.fillStyle = chColor[c]; ctx!.globalAlpha = on ? 1 : 0.7
            ctx!.fillRect(px + 2, py + (on ? 29 : 26), TILE - 4, on ? 3 : 6)
            ctx!.globalAlpha = on ? 0.5 : 0.18
            ctx!.fillRect(px + 2, py + 8, TILE - 4, 18)
            ctx!.globalAlpha = 1
          } else if (c >= 'A' && c <= 'C') {
            const col = chColor[c.toLowerCase()]
            const open = !!pressed[c.toLowerCase()]
            ctx!.fillStyle = col
            if (open) { ctx!.globalAlpha = 0.12; ctx!.fillRect(px + 10, py, 12, TILE); ctx!.globalAlpha = 0.35; ctx!.fillRect(px + 14, py, 4, TILE) }
            else { ctx!.globalAlpha = 0.9; ctx!.fillRect(px + 6, py, 20, TILE); ctx!.globalAlpha = 0.35; ctx!.fillStyle = '#fff'; ctx!.fillRect(px + 9, py, 3, TILE) }
            ctx!.globalAlpha = 1
          } else if (c >= 'x' && c <= 'z') {
            const key = String.fromCharCode(c.charCodeAt(0) - 23)
            const on = !!pressed[key]
            ctx!.fillStyle = chColor[key]
            ctx!.globalAlpha = on ? 0.95 : 0.2
            ctx!.fillRect(px, py, TILE, on ? 10 : 4)
            ctx!.globalAlpha = 1
          } else if (c === 'k') {
            const on = cp === tx
            ctx!.fillStyle = '#94a3b8'; ctx!.fillRect(px + 14, py - 22, 3, 54)
            ctx!.fillStyle = on ? '#4ade80' : '#64748b'
            ctx!.beginPath(); ctx!.moveTo(px + 17, py - 22); ctx!.lineTo(px + 36, py - 14); ctx!.lineTo(px + 17, py - 6); ctx!.fill()
          }
        }
      }
      // Ausgang
      const e = level.exit
      const ex = e.x * TILE, ey = e.y * TILE, ew = e.w * TILE, eh = e.h * TILE
      const pg = ctx!.createRadialGradient(ex + ew / 2, ey + eh / 2, 6, ex + ew / 2, ey + eh / 2, ew)
      pg.addColorStop(0, 'rgba(255,255,255,0.9)'); pg.addColorStop(0.4, 'rgba(251,191,36,0.55)'); pg.addColorStop(1, 'rgba(168,85,247,0)')
      ctx!.fillStyle = pg
      ctx!.fillRect(ex - 10, ey - 10, ew + 20, eh + 20)
      ctx!.strokeStyle = `rgba(253,224,71,${0.6 + 0.4 * Math.sin(t * 4)})`; ctx!.lineWidth = 3
      ctx!.strokeRect(ex + 2, ey + 2, ew - 4, eh - 4)
      // Spieler
      const drawP = (x: number, y: number, face: 1 | -1, uid: string, name: string, dead: boolean, self: boolean, ghost = false, bf = 0, bot = false, team = -1, skill = 0, adm = false) => {
        const look = lookOf(uid)
        const idx = bot ? 0 : idxOf(uid)
        const color = bot ? (BOT_SKIN[skill] ?? BOT_COLOR) : pkFill(look?.pk_color, COLORS[idx % COLORS.length], t)
        const hat = bot ? { emoji: '🤖' } : look?.pk_hat ? PK_HATS[look.pk_hat] : undefined
        ctx!.save()
        ctx!.globalAlpha = dead ? 0.25 : ghost ? 0.5 : 1
        if (bf === 2 && !dead) {
          // Jetpack: Flamme unter den Füßen
          ctx!.fillStyle = '#fb923c'
          ctx!.beginPath(); ctx!.moveTo(x + 4, y + PH); ctx!.lineTo(x + PW / 2, y + PH + 10 + 6 * Math.abs(Math.sin(t * 30))); ctx!.lineTo(x + PW - 4, y + PH); ctx!.fill()
        }
        if (adm) {
          // Admin: Schwarzes Loch als Figur (Leuchten, Akkretionsscheibe, Galaxie im Körper, Sterne)
          drawAdminBack(ctx!, x, y, t)
          drawAdminBody(ctx!, x, y, face, t)
          if (team >= 0 && !dead) { ctx!.strokeStyle = team === 0 ? '#f87171' : '#60a5fa'; ctx!.lineWidth = 3; ctx!.beginPath(); ctx!.roundRect(x - 3, y - 3, PW + 6, PH + 6, 10); ctx!.stroke() }
        } else {
          ctx!.fillStyle = color
          ctx!.shadowColor = color; ctx!.shadowBlur = self ? 12 : 8
          ctx!.beginPath(); ctx!.roundRect(x, y, PW, PH, 7); ctx!.fill()
          ctx!.shadowBlur = 0
          if (bot && skill > 0) botTexture(ctx!, x, y, PW, PH, skill)
          if (team >= 0 && !dead) { ctx!.strokeStyle = team === 0 ? '#f87171' : '#60a5fa'; ctx!.lineWidth = 3; ctx!.beginPath(); ctx!.roundRect(x - 3, y - 3, PW + 6, PH + 6, 10); ctx!.stroke() }
          if (bf === 1 && !dead) { ctx!.strokeStyle = '#a78bfa'; ctx!.lineWidth = 2; ctx!.beginPath(); ctx!.roundRect(x - 2, y - 2, PW + 4, PH + 4, 9); ctx!.stroke() }
          ctx!.fillStyle = '#fff'
          ctx!.fillRect(x + (face > 0 ? 11 : 3), y + 7, 7, 7)
          ctx!.fillStyle = '#0f172a'
          ctx!.fillRect(x + (face > 0 ? 15 : 4), y + 9, 3, 4)
        }
        ctx!.textAlign = 'center'
        if (hat) { ctx!.font = '20px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif'; ctx!.fillStyle = '#fff'; ctx!.fillText(hat.emoji, x + PW / 2, y + 4) }
        ctx!.font = '600 11px system-ui, sans-serif'; ctx!.fillStyle = 'rgba(255,255,255,0.9)'
        if (adm && !isSpec) drawAdminName(ctx!, x + PW / 2, y - (hat ? 20 : 8), self ? (nameRef.current ?? 'Admin') : name, t)
        else ctx!.fillText(self ? (isSpec ? 'Zuschauer' : 'Du') : name.slice(0, 10), x + PW / 2, y - (hat ? 20 : 6))
        ctx!.restore()
      }
      const nameOf = (uid: string) => members().find((p) => p.user_id === uid)?.name ?? lookOf(uid)?.name ?? '?'
      const bviews = botViews(now).filter((b) => b.lv === lv && !b.out)
      // Effekte hinter den Figuren
      for (const [uid, r] of remotes) { if (r.lv === lv && now - r.seen < STALE_MS && !r.dead) fxField.drawBehind(ctx!, uid, lookOf(uid)?.pk_fx, t) }
      if (!isSpec && deadT <= 0 && animLock <= 0) fxField.drawBehind(ctx!, 'me', myFxId(), t)
      fxField.drawParticles(ctx!)
      for (const h of holes) if (h.lv === lv) drawHoleAnim(ctx!, h, t)
      for (const [uid, r] of remotes) {
        if (r.lv !== lv || now - r.seen >= STALE_MS || r.el) continue
        drawP(r.dx, r.dy, r.face, uid, nameOf(uid), r.dead, false, r.gh, r.bf, false, vs === 2 ? teamOfU(uid) : vs === 1 ? 1 : -1, 0, isAdminUid(uid))
      }
      for (const [uid, r] of rivals) {
        if (r.lv !== lv || now - r.seen >= STALE_MS || r.el) continue
        drawP(r.dx, r.dy, r.face, uid, nameOf(uid), r.dead, false, r.gh, r.bf, false, teamOfU(uid), 0, isAdminUid(uid))
      }
      for (const b of bviews) drawP(bots ? b.x : b.dx, bots ? b.y : b.dy, b.face, 'bot' + b.i, BOT_NAMES[b.i % BOT_NAMES.length], b.dead, false, false, 0, true, vs === 1 ? 0 : -1, botSkills[b.i] ?? 2)
      if (animLock <= 0) drawP(me.x, me.y, me.face, st.me, 'Du', deadT > 0, true, ghostOn || isSpec, buffCode(), false, isSpec ? -1 : vs > 0 ? myTeam : -1, 0, adminRef.current && !isSpec)
      ctx!.restore()
      // Pfeile am Bildrand für Mitspielende außerhalb des Bildes
      for (const [uid, r] of remotes) {
        if (r.lv !== lv || now - r.seen >= STALE_MS || r.el) continue
        const sx = r.dx + PW / 2 - cx
        if (sx >= -4 && sx <= VIEW_W + 4) continue
        const left = sx < 0
        const ay = Math.max(46, Math.min(VIEW_H - 40, r.dy + PH / 2))
        const ax = left ? 16 : VIEW_W - 16
        ctx!.save()
        ctx!.globalAlpha = 0.85
        ctx!.fillStyle = COLORS[idxOf(uid) % COLORS.length]
        ctx!.beginPath()
        ctx!.moveTo(ax + (left ? -9 : 9), ay); ctx!.lineTo(ax + (left ? 7 : -7), ay - 9); ctx!.lineTo(ax + (left ? 7 : -7), ay + 9)
        ctx!.fill()
        ctx!.font = '600 10px system-ui, sans-serif'; ctx!.textAlign = left ? 'left' : 'right'; ctx!.fillStyle = '#fff'
        ctx!.fillText(nameOf(uid).slice(0, 8) + ' ' + Math.round(Math.abs(sx) / TILE) + 'm', left ? 26 : VIEW_W - 26, ay + 3)
        ctx!.restore()
      }
      // Anzeige
      ctx!.fillStyle = 'rgba(2,6,23,0.55)'
      ctx!.fillRect(0, 0, VIEW_W, 26)
      ctx!.font = '600 12px system-ui, sans-serif'; ctx!.textAlign = 'left'; ctx!.fillStyle = '#e2e8f0'
      const secs = Math.floor((now - startPerf) / 1000)
      ctx!.fillText(`Level ${level.name}`, 10, 17)
      ctx!.textAlign = 'center'; ctx!.font = '700 17px system-ui, sans-serif'
      const hs = maxHearts > 12 ? 15 : 22
      if (!isSpec) for (let h = 0; h < maxHearts; h++) { ctx!.fillStyle = h < hearts ? '#fb7185' : '#475569'; ctx!.fillText('♥', VIEW_W / 2 + (h - (maxHearts - 1) / 2) * hs, 19) }
      if (isSpec) { ctx!.font = '600 12px system-ui, sans-serif'; ctx!.fillStyle = '#c4b5fd'; ctx!.fillText('👻 Zuschauer: niemand sieht dich', VIEW_W / 2, 17) }
      ctx!.font = '600 12px system-ui, sans-serif'; ctx!.fillStyle = '#e2e8f0'; ctx!.textAlign = 'left'
      ctx!.textAlign = 'right'
      ctx!.fillText(isSpec ? `Level ${lv + 1}` : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}  ·  Level ${lv + 1}`, VIEW_W - 10, 17)
      ctx!.textAlign = 'center'
      // Aktive Upgrades
      if (!isSpec && (buff.jump3 > 0 || buff.jet > 0)) {
        let by = (dr ? 48 : 32)
        ctx!.font = '600 11px system-ui, sans-serif'; ctx!.textAlign = 'left'
        if (buff.jump3 > 0) { ctx!.fillStyle = 'rgba(2,6,23,0.65)'; ctx!.fillRect(8, by - 11, 128, 16); ctx!.fillStyle = '#c4b5fd'; ctx!.fillText(`3er-Sprung ${Math.ceil(buff.jump3)} s`, 12, by); by += 18 }
        if (buff.jet > 0) { ctx!.fillStyle = 'rgba(2,6,23,0.65)'; ctx!.fillRect(8, by - 11, 150, 16); ctx!.fillStyle = '#fed7aa'; ctx!.fillText(`🚀 Flugmodus ${Math.ceil(buff.jet)} s`, 12, by) }
        ctx!.textAlign = 'center'
      }
      if (vs > 0) {
        // Wettlauf: unser Stand gegen den Stand der Gegner
        ctx!.fillStyle = 'rgba(2,6,23,0.45)'; ctx!.fillRect(0, 26, VIEW_W, 18)
        ctx!.font = '600 11px system-ui, sans-serif'; ctx!.textAlign = 'center'
        const rs = vs === 1 ? botViews(now).map((b) => ({ lv: b.lv, hp: b.hp, out: b.out })) : [...rivals.values()].map((r) => ({ lv: r.lv, hp: r.hp, out: r.el }))
        const mine = `Wir: ${finished ? 'raus bei ' : ''}Lv ${lv + 1}${finished ? '' : ' ♥' + hearts}`
        const rlv = rs.length ? Math.max(...rs.map((r) => r.lv)) : 0
        const rout = rs.length > 0 && rs.every((r) => r.out)
        const rhp = rs.length ? Math.max(...rs.map((r) => r.hp)) : 0
        ctx!.fillStyle = '#93c5fd'; ctx!.fillText(mine, VIEW_W * 0.25, 39)
        ctx!.fillStyle = '#fca5a5'; ctx!.fillText(`${vs === 1 ? 'Bots' : 'Gegner'}: ${rs.length === 0 ? 'noch nicht da' : `${rout ? 'raus bei ' : ''}Lv ${rlv + 1}${rout ? '' : ' ♥' + rhp}`}`, VIEW_W * 0.75, 39)
      }
      if (dr) {
        // Stand aller: Level und Herzen, ausgeschiedene Personen durchgestrichen
        ctx!.fillStyle = 'rgba(2,6,23,0.45)'; ctx!.fillRect(0, 26, VIEW_W, 18)
        ctx!.font = '600 11px system-ui, sans-serif'; ctx!.textAlign = 'center'
        const rows: Array<{ text: string; color: string; out: boolean }> = []
        members().forEach((pl, i) => {
          const isMe = pl.user_id === st.me && !isSpec
          const r = remotes.get(pl.user_id)
          const out = isMe ? finished : !!r?.el
          rows.push({ text: `${isMe ? 'Du' : pl.name.slice(0, 8)}: ${out ? 'raus bei ' : ''}Lv ${(isMe ? lv : r?.lv ?? 0) + 1}${out ? '' : ' ♥' + (isMe ? hearts : r?.hp ?? '?')}`, color: out ? '#64748b' : COLORS[i % COLORS.length], out })
        })
        for (const b of botViews(now)) rows.push({ text: `${BOT_NAMES[b.i % BOT_NAMES.length]}: ${b.out ? 'raus bei ' : ''}Lv ${b.lv + 1}${b.out ? '' : ' ♥' + b.hp}`, color: b.out ? '#64748b' : BOT_SKIN[botSkills[b.i] ?? 2] ?? BOT_COLOR, out: b.out })
        rows.forEach((row, i) => { ctx!.fillStyle = row.color; ctx!.fillText(row.text, ((i + 0.5) / rows.length) * VIEW_W, 39) })
        ctx!.font = '600 12px system-ui, sans-serif'
        if (!isSpec && !finished && mt.length === 0 && members().length > 1) {
          ctx!.fillStyle = 'rgba(2,6,23,0.7)'; ctx!.fillRect(VIEW_W / 2 - 170, 52, 340, 26)
          ctx!.fillStyle = '#86efac'; ctx!.fillText('Allein im Level: alle Tore sind für dich offen', VIEW_W / 2, 69)
        }
      } else if (!fresh && !isSpec && !soloTeam) {
        ctx!.fillStyle = 'rgba(2,6,23,0.7)'; ctx!.fillRect(VIEW_W / 2 - 150, 40, 300, 28)
        ctx!.fillStyle = '#fbbf24'; ctx!.fillText('Warte auf die Verbindung zu deinem Team …', VIEW_W / 2, 58)
      } else if (!isSpec && (exitHold > 0 || (inExit(level, me) && !mt.every((r) => r.ex)))) {
        ctx!.fillStyle = 'rgba(2,6,23,0.7)'; ctx!.fillRect(VIEW_W / 2 - 150, 40, 300, 28)
        ctx!.fillStyle = '#fde047'; ctx!.fillText(exitHold > 0 ? 'Geschafft!' : 'Warte, bis alle im Ausgang sind', VIEW_W / 2, 58)
      }
      if (toast) {
        ctx!.globalAlpha = Math.min(1, toast.t)
        ctx!.fillStyle = 'rgba(2,6,23,0.75)'; ctx!.fillRect(VIEW_W / 2 - 110, 92, 220, 26)
        ctx!.fillStyle = '#fde68a'; ctx!.font = '700 13px system-ui, sans-serif'; ctx!.fillText(toast.text, VIEW_W / 2, 110)
        ctx!.globalAlpha = 1
      }
      if (netNote) {
        ctx!.fillStyle = 'rgba(2,6,23,0.8)'; ctx!.fillRect(VIEW_W / 2 - 130, VIEW_H - 34, 260, 24)
        ctx!.fillStyle = '#fbbf24'; ctx!.font = '600 12px system-ui, sans-serif'; ctx!.fillText(netNote, VIEW_W / 2, VIEW_H - 18)
      }
      if (titleT > 0 && !isSpec) {
        ctx!.globalAlpha = Math.min(1, titleT)
        ctx!.fillStyle = 'rgba(2,6,23,0.7)'; ctx!.fillRect(40, 130, VIEW_W - 80, 110)
        ctx!.fillStyle = '#fff'; ctx!.font = '700 22px system-ui, sans-serif'; ctx!.fillText(`Level ${level.name}`, VIEW_W / 2, 168)
        ctx!.font = '500 13px system-ui, sans-serif'; ctx!.fillStyle = '#cbd5e1'
        const words = level.hint.split(' '); let line = ''; let yy = 192
        for (const w of words) { if ((line + w).length > 78) { ctx!.fillText(line, VIEW_W / 2, yy); line = ''; yy += 18 } line += w + ' ' }
        ctx!.fillText(line, VIEW_W / 2, yy)
        ctx!.globalAlpha = 1
      }
      if (mt.some((r) => r.lh !== 0 && r.lh !== hashLevel(level))) {
        ctx!.fillStyle = 'rgba(127,29,29,0.92)'; ctx!.fillRect(0, 150, VIEW_W, 84)
        ctx!.fillStyle = '#fff'; ctx!.textAlign = 'center'; ctx!.font = '700 15px system-ui, sans-serif'
        ctx!.fillText('Ihr habt unterschiedliche Spiel-Versionen.', VIEW_W / 2, 182)
        ctx!.font = '500 13px system-ui, sans-serif'
        ctx!.fillText('Alle: Seite neu laden (Strg+F5, am Handy Tab schließen und neu öffnen).', VIEW_W / 2, 206)
      }
      if (finished) {
        ctx!.fillStyle = 'rgba(2,6,23,0.75)'; ctx!.fillRect(0, 0, VIEW_W, VIEW_H)
        ctx!.fillStyle = over ? '#fb7185' : '#fde047'; ctx!.font = '700 28px system-ui, sans-serif'
        if (vs > 0) {
          const title = verdict === 'win' ? 'Gewonnen!' : verdict === 'lose' ? 'Verloren' : verdict === 'draw' ? 'Unentschieden' : `Ausgeschieden bei Level ${lv + 1}`
          ctx!.fillStyle = verdict === 'win' ? '#fde047' : verdict === 'lose' ? '#fb7185' : '#e2e8f0'
          ctx!.fillText(title, VIEW_W / 2, VIEW_H / 2)
          if (!verdict) { ctx!.font = '500 14px system-ui, sans-serif'; ctx!.fillStyle = '#cbd5e1'; ctx!.fillText(vs === 1 ? 'Warte, ob die Bots weiter kommen …' : 'Warte, ob das andere Team weiter kommt …', VIEW_W / 2, VIEW_H / 2 + 28) }
        } else ctx!.fillText(over ? (dr ? `Ausgeschieden bei Level ${lv + 1}` : 'Keine Herzen mehr') : 'Alle Level geschafft!', VIEW_W / 2, VIEW_H / 2)
      }
    }

    let raf = 0
    let last = performance.now()
    let acc = 0
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      acc += dt
      t += dt
      if (titleT > 0) titleT -= dt
      let guard = 0
      while (acc >= 1 / 60 && guard++ < 6) { step(1 / 60, now); acc -= 1 / 60 }
      { const k = Math.min(1, dt * 14); for (const r of [...remotes.values(), ...rivals.values()]) { r.dx += (r.x - r.dx) * k; r.dy += (r.y - r.dy) * k } }
      { const k = Math.min(1, dt * 12); for (const b of botSnap.values()) { b.dx += (b.x - b.dx) * k; b.dy += (b.y - b.dy) * k } }
      // Effekte nachführen
      if (!isSpec && deadT <= 0 && !finished) fxField.update('me', myFxId(), me.x, me.y, me.face, t, dt)
      for (const [uid, r] of remotes) {
        const fxId = lookOf(uid)?.pk_fx
        if (r.lv === lv && now - r.seen < STALE_MS && !r.dead && !r.el && fxId) fxField.update(uid, fxId, r.dx, r.dy, r.face, t, dt, 0.7)
        else fxField.forget(uid)
      }
      fxField.step(dt)
      for (let i = holes.length - 1; i >= 0; i--) { holes[i].t += dt; if (holes[i].t > (holes[i].kind === 'in' ? HOLE_IN : HOLE_OUT)) holes.splice(i, 1) }
      send(now)
      sendBots(now)
      saveBots(now)
      saveState(now)
      // Funkstille trotz Mitspielenden: Verbindung neu aufbauen
      {
        const someone = [...remotes.values()].some((r) => !r.el && now - r.seen < 60000)
        if (members().length > 1 && someone && now - lastRx > 6000 && now - lastConnect > 6000 && document.visibilityState === 'visible') { netNote = 'Verbindung wird neu aufgebaut …'; connect() }
        else if (netNote && ready && now - lastRx < 3000) netNote = ''
      }
      render(now)
      if (now - lastHud > 400) {
        lastHud = now
        setHud({ level: lv, deaths, ms: now - startPerf, linked: mates(now).length > 0, done: finished, jet: buff.jet > 0 })
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    // ---- Eingaben: Tasten und Berührungen, die nie hängen bleiben dürfen ----
    const releaseAll = () => {
      const i = input.current
      i.stick = 0; i.left = false; i.right = false; i.jump = false; i.down = false
    }
    const key = (e: KeyboardEvent, down: boolean) => {
      const k = e.key
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') { input.current.left = down; e.preventDefault() }
      if (k === 'ArrowRight' || k === 'd' || k === 'D') { input.current.right = down; e.preventDefault() }
      if (k === ' ' || k === 'ArrowUp' || k === 'w' || k === 'W') { input.current.jump = down; e.preventDefault() }
      if (k === 's' || k === 'S' || k === 'ArrowDown') { input.current.down = down; e.preventDefault() }
      if ((k === 'f' || k === 'F') && down && adminRef.current) toggleFly()
      if ((k === 'g' || k === 'G') && down && adminRef.current) toggleGhost()
      if ((k === 'r' || k === 'R') && down) input.current.kill = true
    }
    const kd = (e: KeyboardEvent) => key(e, true)
    const ku = (e: KeyboardEvent) => key(e, false)
    const touchEnd = (e: TouchEvent) => { if (e.touches.length === 0) releaseAll() }
    const hiddenFn = () => {
      if (document.hidden) releaseAll()
      else if (performance.now() - lastRx > 3000 && performance.now() - lastConnect > 2500) connect()
    }
    const online = () => { if (performance.now() - lastConnect > 1500) connect() }
    const offline = () => { netNote = 'Offline – Verbindung wird neu aufgebaut, sobald du wieder online bist.' }
    const noSelect = (e: Event) => e.preventDefault()
    window.addEventListener('keydown', kd)
    window.addEventListener('keyup', ku)
    window.addEventListener('blur', releaseAll)
    window.addEventListener('pagehide', releaseAll)
    window.addEventListener('touchend', touchEnd)
    window.addEventListener('touchcancel', touchEnd)
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    document.addEventListener('visibilitychange', hiddenFn)
    document.addEventListener('selectstart', noSelect)
    return () => {
      disposed = true
      // Deathrun: Wer die Seite verlässt, meldet seinen Stand (Coins und Bestenliste)
      if (dr && !isSpec && !reported && performance.now() - startPerf > 3000) report(lv)
      if (retryT !== undefined) window.clearTimeout(retryT)
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', kd)
      window.removeEventListener('keyup', ku)
      window.removeEventListener('blur', releaseAll)
      window.removeEventListener('pagehide', releaseAll)
      window.removeEventListener('touchend', touchEnd)
      window.removeEventListener('touchcancel', touchEnd)
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
      document.removeEventListener('visibilitychange', hiddenFn)
      document.removeEventListener('selectstart', noSelect)
      if (ch) void supabase.removeChannel(ch)
    }
  }, [st.id, st.is_host, st.me]) // eslint-disable-line react-hooks/exhaustive-deps

  const bg = (e: React.PointerEvent<HTMLButtonElement>) => { e.preventDefault(); try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* Zeiger schon weg */ } }
  const holdProps = (key: 'jump' | 'down') => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => { bg(e); input.current[key] = true },
    onPointerUp: () => { input.current[key] = false },
    onPointerCancel: () => { input.current[key] = false },
    onLostPointerCapture: () => { input.current[key] = false },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  })
  const noSel = { userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none', WebkitTapHighlightColor: 'transparent' } as const
  const humans = st.people.filter((p) => p.user_id !== st.me)

  return (
    <div className="mx-auto flex max-w-[720px] flex-col items-center gap-3" style={noSel} onContextMenu={(e) => e.preventDefault()}>
      <div className="relative w-full">
        <canvas ref={canvas} className="aspect-[704/384] w-full touch-none select-none rounded-2xl border border-white/10" aria-label="Parkour-Spielfeld" />
        {offer && !specUi && (
          <button
            key={offer.id}
            type="button"
            onClick={takeOffer}
            aria-label={`${PICKUP_INFO[offer.kind].name} freischalten`}
            className="absolute right-0 top-1/3 flex w-[88px] select-none flex-col items-center gap-1 rounded-l-2xl border border-r-0 px-2 pb-2 pt-2 text-center shadow-lg active:brightness-125"
            style={{ borderColor: PICKUP_INFO[offer.kind].color, background: 'rgba(15,23,42,0.88)' }}
          >
            <style>{'@keyframes pkbar{from{width:100%}to{width:0}}'}</style>
            <span className="text-2xl leading-none">{offer.kind === 'jet' ? '🚀' : '3️⃣'}</span>
            <span className="text-[11px] font-semibold leading-tight text-white">{PICKUP_INFO[offer.kind].name}</span>
            <span className="text-[10px] text-slate-300">Tippen: 1 Vokabel</span>
            <span className="block h-1.5 w-full overflow-hidden rounded-full bg-white/15">
              <span className="block h-full rounded-full" style={{ background: PICKUP_INFO[offer.kind].color, animation: `pkbar ${offer.life}s linear forwards` }} />
            </span>
          </button>
        )}
      </div>
      {quiz && <LearnOverlay title={quiz.title} need={quiz.need} retry={quiz.retry} onDone={finishQuiz} />}
      <div className="flex w-full items-center justify-between px-2">
        <Joystick onChange={(x) => { input.current.stick = x }} />
        {!specUi && (
          <button
            type="button"
            onClick={() => { input.current.kill = true }}
            className="flex min-h-[48px] max-w-[130px] select-none items-center justify-center gap-1.5 rounded-2xl border border-rose-400/40 bg-rose-500/10 px-3 text-center text-xs font-semibold text-rose-200 active:bg-rose-500/25"
          >
            <Skull size={16} /> Neustart am Checkpoint
          </button>
        )}
        {isAdmin && !specUi && (
          <div className="flex flex-col gap-2">
            <button type="button" onClick={toggleFly} aria-pressed={flyUi}
              className={`min-h-[44px] rounded-2xl border px-3 text-xs font-semibold ${flyUi ? 'border-cyan-300/70 bg-cyan-400/25 text-cyan-100' : 'border-white/20 bg-white/10 text-slate-200'}`}>
              {flyUi ? 'Flug an (F)' : 'Flug (F)'}
            </button>
            <button type="button" onClick={toggleGhost} aria-pressed={ghostUi}
              className={`min-h-[44px] rounded-2xl border px-3 text-xs font-semibold ${ghostUi ? 'border-violet-300/70 bg-violet-400/25 text-violet-100' : 'border-white/20 bg-white/10 text-slate-200'}`}>
              {ghostUi ? 'Geist an (G)' : 'Geist (G)'}
            </button>
            <button type="button" onClick={() => watchApi.current?.(true)}
              className="min-h-[44px] rounded-2xl border border-violet-300/50 bg-violet-400/10 px-3 text-xs font-semibold text-violet-100 active:bg-violet-400/25">👻 Zuschauen</button>
            {flyUi && (
              <button type="button" aria-label="Runter" {...holdProps('down')}
                className="min-h-[44px] touch-none select-none rounded-2xl border border-white/20 bg-white/10 px-3 text-xs font-semibold text-slate-200 active:bg-white/25">Runter (S)</button>
            )}
          </div>
        )}
        {hud.jet && !isAdmin && !specUi && (
          <button type="button" aria-label="Runter" {...holdProps('down')}
            className="min-h-[48px] touch-none select-none rounded-2xl border border-orange-300/50 bg-orange-400/15 px-3 text-xs font-semibold text-orange-100 active:bg-orange-400/30">Runter (S)</button>
        )}
        {specUi && (
          <div className="flex flex-col gap-2">
            <button type="button" aria-label="Runter" {...holdProps('down')}
              className="min-h-[44px] touch-none select-none rounded-2xl border border-white/20 bg-white/10 px-3 text-xs font-semibold text-slate-200 active:bg-white/25">Runter (S)</button>
          </div>
        )}
        <button
          type="button"
          aria-label={specUi ? 'Hoch' : 'Springen'}
          {...holdProps('jump')}
          className="flex h-28 w-28 touch-none select-none items-center justify-center rounded-full border border-white/25 bg-fuchsia-400/25 text-white shadow-lg active:scale-95 active:bg-fuchsia-400/45"
        >
          <ArrowUp size={40} />
        </button>
      </div>
      {specUi && (
        <div className="w-full rounded-2xl border border-violet-400/30 bg-violet-500/10 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-violet-200"><Eye size={14} /> Zuschauer-Geist: dich sieht niemand, Wände und Tore sind für dich offen. Joystick = fliegen, Knopf = hoch. Durch das Ziel (oder den linken Rand) wechselst du das Level. Tippe eine Person an, um ihr zu folgen.</p>
          <div className="flex flex-wrap gap-2">
            {humans.map((p) => (
              <button key={p.user_id} type="button" onClick={() => watch(followUi === p.user_id ? null : p.user_id)}
                className={`min-h-[40px] rounded-xl border px-3 text-xs font-semibold ${followUi === p.user_id ? 'border-violet-300 bg-violet-400/30 text-white' : 'border-white/20 bg-white/10 text-slate-200'}`}>
                {followUi === p.user_id ? '👁 ' : ''}{p.name}
              </button>
            ))}
            <button type="button" onClick={() => watch(null)} className="min-h-[40px] rounded-xl border border-white/20 bg-white/5 px-3 text-xs text-slate-300">Frei fliegen</button>
            <button type="button" onClick={() => specApi.current?.(-1)} className="min-h-[40px] rounded-xl border border-white/20 bg-white/5 px-3 text-xs text-slate-300">◀ Level</button>
            <button type="button" onClick={() => specApi.current?.(1)} className="min-h-[40px] rounded-xl border border-white/20 bg-white/5 px-3 text-xs text-slate-300">Level ▶</button>
            {(watchUi || (spec && isAdmin)) && (
              <button type="button" onClick={() => watchApi.current?.(false)} className="min-h-[40px] rounded-xl border border-emerald-300/50 bg-emerald-400/15 px-3 text-xs font-semibold text-emerald-100">Hier mitspielen</button>
            )}
          </div>
        </div>
      )}
      <p className="text-center text-xs text-slate-500">
        Joystick links = laufen, Knopf rechts = springen, in der Luft nochmal tippen = Doppelsprung (Tastatur: Pfeile/WASD und Leertaste). Am rechten Rand erscheint ab und zu ein Speedup (3er-Sprung oder Jetpack) mit ablaufendem Balken: tippen und eine Vokabel richtig beantworten, dann gehört er dir kurz (Jetpack = Flugmodus: Sprungknopf = hoch, Runter-Knopf = runter, Stacheln tun nichts). {st.kind === 'deathrun' ? 'DEATHRUN: Jeder läuft für sich mit eigenen Herzen. Wer im Ziel ist, ist sofort im nächsten Level. Tore öffnen sich nur, wenn jemand im selben Level auf der Platte steht; wer allein im Level ist, für den sind sie offen. ' : 'Ihr teilt euch die Herzen (jedes geschaffte Level bringt eins zurück), jeder Sturz in Stacheln oder Schluchten kostet eins. '} Die Kamera folgt nur dir: Pfeile am Rand zeigen, wo die anderen sind.{st.kind === 'deathrun' ? '' : ' Ins nächste Level kommt ihr, wenn alle im Ausgang stehen.'} Steckt ihr fest, hilft „Neustart“ (Taste R): ihr landet am Checkpoint im Bild oder bei einem Mitspieler. Die Level hören nie auf und werden immer schwerer. Vor jedem neuen Level müssen 2 Vokabeln beantwortet werden. Je weiter ihr kommt, desto mehr Coins.
        {hud.linked ? '' : ' Verbindung zum Partner wird aufgebaut …'}
      </p>
    </div>
  )
}
