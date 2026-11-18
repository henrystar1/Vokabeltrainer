import { useEffect, useRef, useState } from 'react'
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import { gameClientFor, slotForKey, whenGameDbsReady } from '../../../lib/gameRealtime'
import { DMG_MAX, botInput, crash, packLimit, startCar, statsFor, stepCar, type Bot, type Car, type CarStats, type Input } from './physics'
import { TRACKS, buildTrack, curveAhead, isOpen, pointAt, project, trackKey, type TrackDef } from './track'
import { assistSteer, buildRaceLine } from './line'
import { createFx } from './fx'
import { canFly, flyHeight, flyRoll, isBike, kindDims } from '../stats'
import { BRIDGES, CITY, TUNNELS, bridgeH, city, inPark, tunnelD } from './city'
import { MOUNTAINS, WORLD, hillH, hillSlope, outRoads } from './mountains'
import { CHASE_MAX_MS, caught, chaseCar, copDrive, copSpawn, type BotMem, type Role } from './chase'
import ChasePanel, { type ChaseApi, type ChaseUi, type Peer } from './ChasePanel'
import type { Up } from '../tuning'
import { raceChaseReward, raceReward, raceSubmit } from '../../../services/cars'
import { useWalletOptional } from '../../koins/WalletProvider'

export interface RaceCarInfo { /** Auto-ID im Shop (für die Rangliste) */ id?: string; /** Tuning-Stufen */ up?: Up; name: string; kind: string; color: string; /** eigene Höchstgeschwindigkeit des Autos (km/h) */ top?: number | null }
const TOP_MIN = 20
type Key = 'gas' | 'brake' | 'left' | 'right' | 'fly'
export interface RaceStanding { name: string; ms: number | null; me?: boolean }
/** Höhe über dem Boden: Flug oder Brücke (der höhere Wert zählt). */
const carY = (c: { fly: number; lvl?: number; x: number; z: number; y?: number }): number => c.lvl === -1 ? -tunnelD(c.x, c.z) : Math.max(flyHeight(c.fly), c.lvl ? bridgeH(c.x, c.z) : 0, c.y ?? 0)
/** Neigung der Nase: im Looping eine volle Drehung, sonst nach Steigen/Fallen (Rampen, Sprünge) */
const pitchOf = (c: { loop?: number; vy?: number; v: number; x?: number; z?: number; h?: number; y?: number; lvl?: number }): number => {
  if ((c.loop ?? 0) > 0) return -(c.loop ?? 0)
  // am Berg: Nase folgt der Steigung
  if (c.x !== undefined && c.z !== undefined && c.h !== undefined && (c.lvl ?? 0) === 0 && (c.y ?? 0) <= hillH(c.x, c.z) + 0.35 && hillH(c.x, c.z) > 0.05) return -Math.atan(hillSlope(c.x, c.z, c.h))
  return -Math.max(-0.6, Math.min(0.6, Math.atan2(c.vy ?? 0, Math.max(Math.abs(c.v), 8))))
}

interface Props {
  trackId: number
  /** Eigene (gemalte) Strecke statt einer festen */
  custom?: TrackDef
  laps: number
  me: RaceCarInfo
  /** Fahrassistent (Ideallinie) darf eingeschaltet werden: Supercar */
  assistOk?: boolean
  bots?: Array<RaceCarInfo & { skill: number }>
  online?: { gameId: string; userId: string; players: Array<{ id: string; name: string }>; /** Offene Lobby: Mitspieler kommen und gehen jederzeit, sie werden aus den Funkdaten angelegt */ open?: boolean; /** eigener Anzeigename (offene Lobby) */ name?: string; /** gewählte Autos aller Spieler (vom Server) */ cars?: Record<string, { name?: string; kind: string; color: string; top?: number | null }> }
  /** Zielzeit melden (Millisekunden seit Start der Ampel) */
  onFinish?: (ms: number) => void
  onAgain?: () => void
  onExit?: () => void
}

interface Remote { id: string; name: string; kind: string; color: string; x: number; z: number; h: number; v: number; tx: number; tz: number; th: number; total: number; ft: number | null; seen: number; dmg: number; slip: number; fl: number; lv?: number; yy?: number; pt?: number; hd?: boolean; ro?: 'b' | 'c'; mesh?: import('three').Group }

const COUNT_MS = 4500
/** Offene Felder: Wartezeit zwischen zwei Reparaturen (ohne Totalschaden) */
const REPAIR_CD_MS = 12000
const fmt = (ms: number) => { const m = Math.floor(ms / 60000); const s = ms / 1000 - m * 60; return `${m}:${s.toFixed(2).padStart(5, '0')}` }
const lapKey = (key: string) => `race-best-${key}`

/** 3D-Rennen: Verfolgerkamera, Fahrphysik, Bots und Online-Mitspieler (Broadcast über die Spiel-Datenbanken). */
/** Karten-Reichweiten (Meter bis zum Rand des Kreises) und Größen (Pixel) der Stadt-Minimap */
export const MAP_RANGES = [120, 250, 500, 1000, 2200] as const
export const MAP_SIZES = [96, 132, 172] as const
interface MapCfg { on: boolean; r: number; s: number }
const loadMapCfg = (): MapCfg => {
  try { const j = JSON.parse(localStorage.getItem('vt-race-map') ?? '{}') as Partial<MapCfg>; return { on: j.on !== false, r: Math.min(MAP_RANGES.length - 1, Math.max(0, Number.isInteger(j.r) ? (j.r as number) : 1)), s: Math.min(MAP_SIZES.length - 1, Math.max(0, Number.isInteger(j.s) ? (j.s as number) : 1)) } } catch { return { on: true, r: 1, s: 1 } }
}

export default function RaceView({ trackId, custom, laps, me, assistOk = false, bots = [], online, onFinish, onAgain, onExit }: Props) {
  const mount = useRef<HTMLDivElement>(null)
  const mini = useRef<HTMLCanvasElement>(null)
  const cmini = useRef<HTMLCanvasElement>(null)
  const mapCfg = useRef<MapCfg>(loadMapCfg())
  const [mapUi, setMapUi] = useState<MapCfg>(mapCfg.current)
  const [mapPanel, setMapPanel] = useState(false)
  const setMap = (p: Partial<MapCfg>) => { mapCfg.current = { ...mapCfg.current, ...p }; setMapUi(mapCfg.current); try { localStorage.setItem('vt-race-map', JSON.stringify(mapCfg.current)) } catch { /* ignorieren */ } }
  const toggleHide = useRef<() => void>(() => undefined)
  const inp = useRef<Record<Key, boolean>>({ gas: false, brake: false, left: false, right: false, fly: false })
  const resetReq = useRef(false)
  const camRef = useRef<0 | 1 | 2>((() => { try { const c = localStorage.getItem('vt-race-cam'); return c === '1' ? 1 : c === '2' ? 2 : 0 } catch { return 0 } })())
  const [camMode, setCamMode] = useState<0 | 1 | 2>(camRef.current)
  const cockpit = camMode === 1
  const wheelEl = useRef<HTMLDivElement>(null)
  const toggleCam = () => { camRef.current = ((camRef.current + 1) % 3) as 0 | 1 | 2; setCamMode(camRef.current); try { localStorage.setItem('vt-race-cam', String(camRef.current)) } catch { /* ignorieren */ } }
  const toggleRef = useRef(toggleCam)
  toggleRef.current = toggleCam
  const finishCb = useRef(onFinish)
  finishCb.current = onFinish
  const def = custom ?? TRACKS[Math.max(0, Math.min(TRACKS.length - 1, trackId))]
  const isFreeUi = isOpen(def)
  const assistRef = useRef(false)
  const [assist, setAssist] = useState(false)
  const setTopRef = useRef<((k: number) => void) | undefined>(undefined)
  const accRef = useRef(1)
  const setAccRefresh = useRef<() => void>(() => undefined)
  const applyAcc = (m: number) => { accRef.current = m; setAccMul(m); setAccRefresh.current() }
  const [accMul, setAccMul] = useState(1)
  const [rep, setRep] = useState({ hold: 0, cd: 0 })
  const [hidden, setHiddenUi] = useState(false)
  const hiddenRef = useRef(false)
  const [inBush, setInBush] = useState(false)
  const [chaseUi, setChaseUi] = useState<ChaseUi>({})
  const [peers, setPeers] = useState<Peer[]>([])
  const [panel, setPanel] = useState(false)
  const [chaseKind, setChaseKind] = useState<string | null>(null)
  const chaseApi = useRef<ChaseApi>({ invite: () => undefined, start: () => undefined, cancel: () => undefined, answer: () => undefined })
  const cityOpen = def.mode === 'city' && !!online?.open
  const maxTop = me.top ?? 300
  const [topKmh, setTopKmh] = useState(maxTop)
  /** Höchstgeschwindigkeit des Supercars im Rennen ändern (zwischen 20 km/h und dem freigegebenen Wert) */
  const applyTop = (k: number) => { const v = Math.round(Math.min(Math.max(k, TOP_MIN), Math.max(maxTop, TOP_MIN))); setTopKmh(v); setTopRef.current?.(v) }
  const toggleAssist = () => { if (!assistOk) return; assistRef.current = !assistRef.current; setAssist(assistRef.current) }
  const assistToggleRef = useRef(toggleAssist)
  assistToggleRef.current = toggleAssist
  const [hud, setHud] = useState({ speed: 0, lap: 1, pos: 1, of: 1 + bots.length + (online ? online.players.length - 1 : 0), ms: 0, count: 4, wrong: false, curve: 0, curveDist: 0, offroad: false, best: 0, dmg: 0, drift: false, dp: 0, dc: 0, db: 0, fly: 0, cool: 0 })
  const wallet = useWalletOptional()
  const walletRef = useRef(wallet); walletRef.current = wallet
  const [reward, setReward] = useState<{ coins: number; capped: boolean } | null>(null)
  const [done, setDone] = useState<{ ms: number; best: number; standings: RaceStanding[] } | null>(null)
  const flyer = canFly(chaseKind ?? me.kind)
  const bikeUi = isBike(chaseKind ?? me.kind)
  const [loadErr, setLoadErr] = useState<string | null>(null)

  useEffect(() => {
    if (!mount.current) return
    const host = mount.current
    let dead = false
    let raf = 0
    let ch: RealtimeChannel | null = null
    let client: SupabaseClient | null = null
    const cleanups: Array<() => void> = []

    void (async () => {
      let THREE: typeof import('three')
      let build: typeof import('./scene').buildScene
      try {
        THREE = await import('three')
        build = (await import('./scene')).buildScene
      } catch { setLoadErr('Die 3D-Ansicht konnte nicht geladen werden. Prüfe die Verbindung und lade die Seite neu.'); return }
      if (dead) return
      const track = buildTrack(def)
      const rs = build(THREE, track)
      const scene = rs.scene
      const renderer = new THREE.WebGLRenderer({ antialias: true })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.outputColorSpace = THREE.SRGBColorSpace
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      host.appendChild(renderer.domElement)
      Object.assign(renderer.domElement.style, { width: '100%', height: '100%', display: 'block' })
      const camera = new THREE.PerspectiveCamera(64, 1, 0.3, 4000)
      const resize = () => { const w = host.clientWidth || 800; const h = host.clientHeight || 500; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix() }
      resize()
      const ro = new ResizeObserver(resize)
      ro.observe(host)
      cleanups.push(() => { ro.disconnect(); renderer.dispose(); renderer.domElement.remove() })

      // Effekte: Wolken beim Fliegen, Auspuff-Feuer (Supercar), Reifenspuren beim Driften
      const fx = createFx(THREE, rs.scene)
      cleanups.push(() => fx.dispose())
      let fxTick = 0
      const carFx = (kind: string, x: number, z: number, h: number, v: number, slip: number, fly: number, gas: boolean, dt2: number) => {
        const fxv = Math.sin(h), fzv = Math.cos(h), rx = Math.cos(h), rz = -Math.sin(h)
        const d = kindDims(kind), sp = Math.abs(v)
        const y0 = flyHeight(fly)
        if (fly > 0 && canFly(kind)) {
          // Düsenstrahl nach unten: Wolken schießen zum Boden und breiten sich dort aus
          fxTick++
          for (const sz of fxTick % 2 ? [-1, 1] : [1, -1]) {
            const nz = (fxTick % 4 < 2 ? -0.28 : 0.22) * d.len
            const px = x + rx * sz * d.wid * 0.3 + fxv * nz, pz = z + rz * sz * d.wid * 0.3 + fzv * nz
            fx.emit('cloud', px, y0 - 0.3, pz, fxv * v * 0.55 + (Math.random() - 0.5) * 3, -13 - Math.random() * 5, fzv * v * 0.55 + (Math.random() - 0.5) * 3, 1.5 + Math.random() * 0.8)
            fx.emit('fire', px, y0 - 0.5, pz, 0, -9, 0, 1.2)
          }
        }
        if (kind === 'supercar' && fly <= 0 && gas && sp > 2) {
          // Auspuff: Flammen und Rauch hinten, bei hohem Tempo stärker
          for (const sx of [-1, 1]) {
            const px = x + rx * sx * 0.5 - fxv * (d.len / 2 + 0.05), pz = z + rz * sx * 0.5 - fzv * (d.len / 2 + 0.05)
            const back = 5 + Math.random() * 4
            fx.emit('fire', px, 0.34, pz, fxv * (v * 0.5 - back) + (Math.random() - 0.5) * 0.8, (Math.random() - 0.3) * 0.8, fzv * (v * 0.5 - back) + (Math.random() - 0.5) * 0.8, 0.5 + Math.min(0.9, sp / 150) + Math.random() * 0.25)
            if (Math.random() < 0.5) fx.emit('smoke', px, 0.4, pz, fxv * v * 0.35 - fxv * 2, 0.8, fzv * v * 0.35 - fzv * 2, 0.7)
          }
        }
        if (Math.abs(slip) > 0.14 && sp > 8 && fly <= 0) {
          const mh = h - slip, len = Math.max(0.7, sp * dt2 * 1.2 + 0.25)
          const rear = -d.len * 0.32
          const wheels = isBike(kind) ? [0] : [-1, 1]
          for (const sx of wheels) fx.skid(x + fxv * rear + rx * sx * d.wid * 0.42, z + fzv * rear + rz * sx * d.wid * 0.42, mh, len)
        }
      }

      // Fahrzeuge
      let topNow = me.top
      let userTop = me.top
      let myRole: Role | null = null
      const eff: { kind: string; color: string; up: typeof me.up } = { kind: me.kind, color: me.color, up: me.up }
      const mkStats = (): CarStats => { const st0 = statsFor(eff.kind, topNow, eff.up); return accRef.current === 1 ? st0 : { ...st0, acc: st0.acc * accRef.current } }
      let myStats: CarStats = mkStats()
      setTopRef.current = (k: number) => { userTop = k; if (!myRole) { topNow = k; myStats = mkStats() } }
      setAccRefresh.current = () => { myStats = mkStats() }
      const line = buildRaceLine(track)
      let bike = isBike(me.kind)
      let slot = 0
      const mySlot = online ? Math.max(0, online.players.findIndex((p) => p.id === online.userId)) : bots.length
      let car: Car = startCar(track, mySlot)
      let myMesh = rs.makeCar(me.kind, me.color, me.name, true)
      scene.add(myMesh)
      const botList: Bot[] = bots.map((b, i) => {
        const c0 = startCar(track, slot++)
        const lat0 = (c0.x - line.x[c0.idx]) * -track.tz[c0.idx] + (c0.z - line.z[c0.idx]) * track.tx[c0.idx]
        const bt: Bot = { car: c0, kind: b.kind, color: b.color, name: b.name, skill: b.skill, lane: (i % 5 - 2) * Math.min(2.6, def.width * 0.09), wobble: i * 1.7, finished: null, top: b.top, st: statsFor(b.kind, b.top), lat0, total0: c0.total }
        return bt
      })
      const botMeshes = botList.map((b) => { const m = rs.makeCar(b.kind, b.color, b.name, false); scene.add(m); return m })
      const remotes = new Map<string, Remote>()
      if (online) online.players.forEach((p, i) => { if (p.id !== online.userId) { const c = startCar(track, i); const oc = online.cars?.[p.id]; const r: Remote = { id: p.id, name: p.name, kind: oc?.kind ?? 'kleinwagen', color: oc?.color ?? '#94a3b8', x: c.x, z: c.z, h: c.h, v: 0, tx: c.x, tz: c.z, th: c.h, total: c.total, ft: null, seen: 0, dmg: 0, slip: 0, fl: 0 }; if (oc) { r.mesh = rs.makeCar(r.kind, r.color, r.name, false); r.mesh.position.set(c.x, 0, c.z); r.mesh.rotation.y = c.h; scene.add(r.mesh) } remotes.set(p.id, r) } })

      // Tastatur
      const keyMap: Record<string, Key> = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ArrowUp: 'gas', w: 'gas', W: 'gas', ArrowDown: 'brake', s: 'brake', S: 'brake', ' ': 'brake', e: 'fly', E: 'fly' }
      const kd = (e: KeyboardEvent) => { const k = keyMap[e.key]; if (k) { inp.current[k] = true; e.preventDefault() } else if (e.key === 'r' || e.key === 'R') resetReq.current = true; else if (e.key === 'c' || e.key === 'C') toggleRef.current(); else if (e.key === 'f' || e.key === 'F') assistToggleRef.current(); else if (e.key === 'h' || e.key === 'H') toggleHide.current() }
      const ku = (e: KeyboardEvent) => { const k = keyMap[e.key]; if (k) { inp.current[k] = false; e.preventDefault() } }
      window.addEventListener('keydown', kd); window.addEventListener('keyup', ku)
      cleanups.push(() => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku) })

      // Netz
      let ready = false
      let onCh: (p: Record<string, unknown>) => void = () => undefined
      const sendCh = (payload: Record<string, unknown>) => { if (ready) void ch?.send({ type: 'broadcast', event: 'ch', payload }).catch(() => undefined) }
      const send = (payload: Record<string, unknown>) => { if (ready) void ch?.send({ type: 'broadcast', event: 'r', payload }).catch(() => undefined) }
      if (online) void whenGameDbsReady().then(() => {
        if (dead) return
        client = gameClientFor(slotForKey(online.gameId))
        ch = client.channel(`rc-${online.gameId}`, { config: { broadcast: { self: false } } })
        ch.on('broadcast', { event: 'r' }, ({ payload }) => {
          let r = remotes.get(payload.u as string)
          if (!r && online.open && typeof payload.u === 'string' && payload.u !== online.userId) {
            r = { id: payload.u, name: String(payload.n || 'Fahrer').slice(0, 24), kind: 'kleinwagen', color: '#94a3b8', x: Number(payload.x) || 0, z: Number(payload.z) || 0, h: 0, v: 0, tx: 0, tz: 0, th: 0, total: 0, ft: null, seen: performance.now(), dmg: 0, slip: 0, fl: 0 }
            remotes.set(payload.u, r)
          }
          if (!r) return
          r.ro = payload.ro === 'c' ? 'c' : payload.ro === 'b' ? 'b' : undefined
          if (typeof payload.ce === 'string' && chase && !chase.over && chase.id === payload.ce) finishChase(payload.cw === 'police' ? 'police' : 'bandit', false)
          r.hd = payload.hd === 1; r.lv = Number(payload.lv) || 0; r.yy = Number(payload.y) || 0; r.pt = Number(payload.pt) || 0
          r.tx = Number(payload.x) || 0; r.tz = Number(payload.z) || 0; r.th = Number(payload.h) || 0; r.v = Number(payload.v) || 0
          r.dmg = Number(payload.d) || 0; r.slip = Number(payload.sl) || 0; r.fl = Number(payload.fl) || 0
          r.total = Number(payload.t) || 0; r.ft = typeof payload.f === 'number' ? payload.f : null; r.seen = performance.now()
          if (typeof payload.k === 'string' && (payload.k !== r.kind || payload.c !== r.color || (r.mesh && r.mesh.userData.ro !== r.ro))) {
            r.kind = payload.k; r.color = String(payload.c || '#94a3b8')
            if (r.mesh) { scene.remove(r.mesh); r.mesh = undefined }
          }
          if (!r.mesh) { r.mesh = rs.makeCar(r.kind, r.color, r.name, false); r.mesh.userData.ro = r.ro; if (r.ro === 'c') rs.addSiren(r.mesh); r.x = r.tx; r.z = r.tz; r.h = r.th; scene.add(r.mesh) }
        })
        ch.on('broadcast', { event: 'ch' }, ({ payload }) => onCh(payload as Record<string, unknown>))
        ch.subscribe((s) => { if (s === 'SUBSCRIBED') ready = true })
      })

      // Ablauf
      const isFree = isOpen(def)
      const startAt = performance.now() + (isFree ? 0 : COUNT_MS)
      let finishedMs: number | null = null
      let lastLap = 0, lapStart = 0, bestLap = Number(localStorage.getItem(lapKey(trackKey(def)))) || 0
      let raceBest = 0, usedAssist = false
      let camH = car.h
      let lastSend = 0, lastHud = 0
      let lastRepair = -REPAIR_CD_MS
      let peersKey = ''
      const isCity = def.mode === 'city'
      let hiddenNow = false
      let lastCamEff: 0 | 1 | 2 = camRef.current
      toggleHide.current = () => { if (!isCity) return; hiddenRef.current = !hiddenRef.current; setHiddenUi(hiddenRef.current) }

      // Polizeijagd (nur offene Stadt-Lobby): Rollen, Bots (rechnet der Ersteller), Fang-Regel
      interface PBot { id: string; name: string; kind: string; color: string; car: Car; st: CarStats; mem: BotMem; mesh: import('three').Group }
      let pbots: PBot[] = []
      let endInfo: { id: string; win: 'police' | 'bandit'; until: number } | null = null
      let chase: { id: string; bandits: string[]; got: Set<string>; cops: string[]; bots: number; t0: number; from: string; over: boolean } | null = null
      let iCaught = false
      let lobbyCur: { id: string; bandits: string[]; invitees: string[]; invited: Record<string, 'wait' | 'yes' | 'no'>; bots: number } | null = null
      let incoming: { id: string; from: string; fn: string; role: 'bandit' | 'cop'; bots: number } | null = null
      const chaseOn = !!online?.open && isCity
      const syncLobby = () => { const l = lobbyCur; setChaseUi((o) => ({ ...o, lobby: l ? { id: l.id, bandits: l.bandits.map((b) => (b === online?.userId ? 'me' : b)), invited: { ...l.invited }, bots: l.bots } : undefined })) }
      const applyRole = (role: Role | null) => {
        myRole = role
        if (role) { const cc = chaseCar(role, me.kind === 'supercar'); eff.kind = cc.kind; eff.color = cc.color; eff.up = undefined; topNow = cc.top }
        else { eff.kind = me.kind; eff.color = me.color; eff.up = me.up; topNow = userTop }
        myStats = mkStats()
        scene.remove(myMesh)
        myMesh = rs.makeCar(eff.kind, eff.color, me.name, true)
        if (role === 'cop') rs.addSiren(myMesh)
        scene.add(myMesh)
        bike = isBike(eff.kind)
        car = { ...car, fly: 0, cool: 0 }
        setChaseKind(role ? eff.kind : null)
      }
      const startChase = (id: string, bandits: string[], cops: string[], bots: number, from: string, role: Role) => {
        if (!online || chase) return
        iCaught = false
        chase = { id, bandits, got: new Set<string>(), cops, bots, t0: performance.now(), from, over: false }
        applyRole(role)
        if (from === online.userId) {
          pbots = Array.from({ length: Math.min(6, bots) }, (_, i) => {
            const cc = chaseCar('cop', false, true), sp = copSpawn(i)
            const mesh = rs.makeCar(cc.kind, cc.color, `Polizei-Bot ${i + 1}`, false)
            rs.addSiren(mesh); scene.add(mesh)
            return { id: `pb-${online.userId.slice(0, 6)}-${i}`, name: `Polizei-Bot ${i + 1}`, kind: cc.kind, color: cc.color, car: { ...startCar(track, 0), x: sp.x, z: sp.z, h: sp.h, v: 0 }, st: statsFor(cc.kind, cc.top), mem: { stuck: 0 }, mesh }
          })
        }
        const bn = bandits.filter((b) => b !== online.userId).map((b) => remotes.get(b)?.name ?? 'Bandit').join(', ') || 'den Bandit'
        incoming = null; lobbyCur = null
        setChaseUi({ active: { role, t0: Date.now(), banditName: bn, bots, total: bandits.length, got: 0 } })
        setPanel(false)
      }
      const dropBotRemotes = () => { for (const r of [...remotes.values()]) if (r.id.startsWith('pb-')) { if (r.mesh) scene.remove(r.mesh); remotes.delete(r.id) } }
      const syncActive = () => { const c = chase; if (c) setChaseUi((o) => (o.active ? { ...o, active: { ...o.active, got: c.got.size, caught: iCaught } } : o)) }
      const markCaught = (u: string, announce: boolean) => {
        if (!chase || chase.over || chase.got.has(u)) return
        chase.got.add(u)
        if (u === online?.userId) iCaught = true
        if (announce) { const cid = chase.id; for (const dl of [0, 500, 1200]) window.setTimeout(() => { if (!dead) sendCh({ t: 'cau', id: cid, u }) }, dl) }
        syncActive()
        if (chase.got.size >= chase.bandits.length) finishChase('police', announce)
      }
      const finishChase = (win: 'police' | 'bandit', announce: boolean) => {
        if (!chase || chase.over) return
        chase.over = true
        endInfo = { id: chase.id, win, until: performance.now() + 20000 }
        if (announce) { const eid = chase.id; for (const dl of [0, 500, 1200, 2500]) window.setTimeout(() => { if (!dead) sendCh({ t: 'end', id: eid, win }) }, dl) }
        const mine = (myRole === 'cop') === (win === 'police')
        const humansOther = chase.cops.length, botsN = chase.bots, secs = Math.round((performance.now() - chase.t0) / 1000)
        for (const b of pbots) scene.remove(b.mesh)
        pbots = []
        dropBotRemotes()
        applyRole(null)
        chase = null
        setChaseUi({ over: { win, mine } })
        void raceChaseReward(humansOther, botsN, mine, secs).then((r) => { if (dead) return; setChaseUi((o) => (o.over ? { ...o, over: { ...o.over, coins: r.coins, capped: r.capped } } : o)); if (r.koins !== null) walletRef.current?.setBalance(r.koins) }).catch(() => undefined)
        window.setTimeout(() => { if (!dead) setChaseUi((o) => (o.over ? {} : o)) }, 6000)
      }
      onCh = (p) => {
        if (!chaseOn || !online) return
        const id = String(p.id ?? '')
        if (p.t === 'inv') {
          if (chase || p.from === online.userId) return
          const bl = Array.isArray(p.bandits) ? (p.bandits as string[]) : typeof p.bandit === 'string' ? [p.bandit] : []
          const role = bl.includes(online.userId) ? 'bandit' : Array.isArray(p.cops) && (p.cops as string[]).includes(online.userId) ? 'cop' : null
          if (!role) return
          incoming = { id, from: String(p.from), fn: String(p.fn ?? 'Jemand').slice(0, 24), role, bots: Number(p.bots) || 0 }
          const inc = incoming
          setChaseUi((o) => ({ ...o, incoming: { id: inc.id, fn: inc.fn, role: inc.role, bots: inc.bots } }))
          window.setTimeout(() => { if (!dead && incoming?.id === id) { incoming = null; setChaseUi((o) => (o.incoming?.id === id ? { ...o, incoming: undefined } : o)) } }, 60000)
        } else if (p.t === 'ans') {
          if (lobbyCur && lobbyCur.id === id && typeof p.u === 'string' && p.u in lobbyCur.invited) { lobbyCur.invited[p.u] = p.ok ? 'yes' : 'no'; syncLobby() }
        } else if (p.t === 'go') {
          const cops = Array.isArray(p.cops) ? (p.cops as string[]) : []
          const bl = Array.isArray(p.bandits) ? (p.bandits as string[]) : typeof p.bandit === 'string' ? [p.bandit] : []
          if (bl.includes(online.userId)) startChase(id, bl, cops, Number(p.bots) || 0, String(p.from), 'bandit')
          else if (cops.includes(online.userId)) startChase(id, bl, cops, Number(p.bots) || 0, String(p.from), 'cop')
        } else if (p.t === 'cau') {
          if (chase && chase.id === id && typeof p.u === 'string') markCaught(p.u, false)
        } else if (p.t === 'end') {
          dropBotRemotes()
          if (chase && chase.id === id) finishChase(p.win === 'police' ? 'police' : 'bandit', false)
        }
      }
      chaseApi.current = {
        invite: (ids, banditSel, bots) => {
          if (!online || chase) return
          const bandits = banditSel.map((b) => (b === 'me' ? online.userId : b))
          const id = `${online.userId}-${Date.now()}`
          lobbyCur = { id, bandits, invitees: ids, invited: Object.fromEntries(ids.map((i) => [i, 'wait' as const])), bots }
          if (ids.length === 0) { chaseApi.current.start(); return }
          sendCh({ t: 'inv', id, from: online.userId, fn: online.name ?? me.name, bandits, cops: ids.filter((i) => !bandits.includes(i)), bots })
          syncLobby()
        },
        start: () => {
          const l = lobbyCur
          if (!l || !online) return
          const yes = l.invitees.filter((i) => l.invited[i] === 'yes')
          const bandits = l.bandits.filter((b) => b === online.userId || yes.includes(b))
          if (bandits.length === 0) return
          const cops = yes.filter((i) => !bandits.includes(i))
          if (!bandits.includes(online.userId)) cops.push(online.userId)
          if (cops.length === 0 && l.bots === 0) return
          const goMsg = { t: 'go', id: l.id, bandits, cops, bots: l.bots, from: online.userId }
          for (const dl of [0, 600, 1500]) window.setTimeout(() => { if (!dead) sendCh(goMsg) }, dl)
          startChase(l.id, bandits, cops, l.bots, online.userId, bandits.includes(online.userId) ? 'bandit' : 'cop')
        },
        cancel: () => { lobbyCur = null; syncLobby() },
        answer: (ok) => {
          const inc = incoming
          if (!inc || !online) return
          sendCh({ t: 'ans', id: inc.id, u: online.userId, ok })
          incoming = ok ? inc : null
          setChaseUi((o) => ({ ...o, incoming: undefined, waiting: ok }))
        },
      }
      // Übungsfeld: Drift-Punkte (Serie zählt, solange man quer fährt; nach kurzer Pause wird sie gutgeschrieben)
      let dTotal = 0, dCombo = 0, dBest = (() => { try { return Number(localStorage.getItem('vt-race-driftbest')) || 0 } catch { return 0 } })(), dIdle = 0
      let prev = performance.now()
      const mmPts: Array<[number, number]> = []
      let mmMin = [Infinity, Infinity], mmMax = [-Infinity, -Infinity]
      for (let i = 0; i < track.n; i += 4) { mmPts.push([track.x[i], track.z[i]]); mmMin = [Math.min(mmMin[0], track.x[i]), Math.min(mmMin[1], track.z[i])]; mmMax = [Math.max(mmMax[0], track.x[i]), Math.max(mmMax[1], track.z[i])] }
      const drawMini = () => {
        const c = mini.current
        const g = c?.getContext('2d')
        if (!c || !g) return
        const W = c.width, H = c.height, pad = 10
        const sc = Math.min((W - pad * 2) / (mmMax[0] - mmMin[0]), (H - pad * 2) / (mmMax[1] - mmMin[1]))
        const ox = (W - (mmMax[0] - mmMin[0]) * sc) / 2, oy = (H - (mmMax[1] - mmMin[1]) * sc) / 2
        const P = (x: number, z: number): [number, number] => [ox + (x - mmMin[0]) * sc, oy + (z - mmMin[1]) * sc]
        g.clearRect(0, 0, W, H)
        g.lineJoin = 'round'; g.lineCap = 'round'
        g.strokeStyle = '#0008'; g.lineWidth = 9
        g.beginPath(); mmPts.forEach(([x, z], i) => { const [a, b] = P(x, z); if (i) g.lineTo(a, b); else g.moveTo(a, b) }); g.closePath(); g.stroke()
        g.strokeStyle = '#e2e8f0'; g.lineWidth = 5; g.stroke()
        const [sx, sz] = P(track.x[0], track.z[0]); g.fillStyle = '#fff'; g.fillRect(sx - 4, sz - 1.5, 8, 3)
        const dot = (x: number, z: number, col: string, r: number) => { const [a, b] = P(x, z); g.fillStyle = '#000'; g.beginPath(); g.arc(a, b, r + 1.5, 0, 7); g.fill(); g.fillStyle = col; g.beginPath(); g.arc(a, b, r, 0, 7); g.fill() }
        for (const b of botList) dot(b.car.x, b.car.z, b.color, 3.5)
        for (const r of remotes.values()) if (performance.now() - r.seen < 4000) dot(r.x, r.z, r.color, 3.5)
        dot(car.x, car.z, '#22d3ee', 5)
      }

      // Stadtkarte: runder Ausschnitt um das eigene Auto, dreht sich mit (Fahrtrichtung = oben); Leute außerhalb als Punkt am Rand
      let mapGeo: { bld: Path2D; park: Path2D; roads: Path2D; tun: Path2D; brg: Path2D } | null = null
      const drawCityMap = () => {
        const c = cmini.current
        const g = c?.getContext('2d')
        const cfg = mapCfg.current
        if (!isCity || !c || !g || !cfg.on) return
        const S = c.width, cx = S / 2, rad = S / 2 - 3, R = MAP_RANGES[cfg.r], k = rad / R
        if (!mapGeo) {
          const cd = city()
          const bld = new Path2D(), park = new Path2D(), roads = new Path2D(), tun = new Path2D(), brg = new Path2D()
          for (const bl of cd.buildings) bld.rect(bl.x - bl.w / 2, bl.z - bl.d / 2, bl.w, bl.d)
          for (const p of cd.parks) park.rect(p.x - p.size / 2, p.z - p.size / 2, p.size, p.size)
          for (const path of outRoads()) path.forEach(([x, z], i) => { if (i) roads.lineTo(x, z); else roads.moveTo(x, z) })
          for (const t of TUNNELS) { if (t.dir === 'x') { tun.moveTo(t.a0, t.c); tun.lineTo(t.a1, t.c) } else { tun.moveTo(t.c, t.a0); tun.lineTo(t.c, t.a1) } }
          for (const br of BRIDGES) { brg.moveTo(br.bx0, br.bz); brg.lineTo(br.bx1, br.bz) }
          mapGeo = { bld, park, roads, tun, brg }
        }
        const ch = Math.cos(car.h), sh = Math.sin(car.h)
        // Welt (x, z) -> Karte: rechts = (−cos h, sin h), oben = Fahrtrichtung (sin h, cos h)
        const sx = (x: number, z: number) => cx + k * (-ch * (x - car.x) + sh * (z - car.z))
        const sy = (x: number, z: number) => cx - k * (sh * (x - car.x) + ch * (z - car.z))
        g.setTransform(1, 0, 0, 1, 0, 0)
        g.clearRect(0, 0, S, S)
        g.save()
        g.beginPath(); g.arc(cx, cx, rad, 0, 7); g.clip()
        g.fillStyle = '#1f2937'; g.fillRect(0, 0, S, S)
        g.setTransform(-k * ch, -k * sh, k * sh, -k * ch, cx + k * (ch * car.x - sh * car.z), cx + k * (sh * car.x + ch * car.z))
        const H = CITY.half
        g.fillStyle = '#2f5a35'; g.fillRect(WORLD.x0, H, WORLD.x1 - WORLD.x0, WORLD.z1 - H)
        g.fillStyle = '#2b2f36'; g.fillRect(-H, -H, H * 2, H * 2)
        for (const m of MOUNTAINS) {
          g.fillStyle = '#5b6b45'; g.beginPath(); g.arc(m.x, m.z, m.R, 0, 7); g.fill()
          g.fillStyle = '#7b7468'; g.beginPath(); g.arc(m.x, m.z, m.R * 0.55, 0, 7); g.fill()
          g.fillStyle = '#e5e7eb'; g.beginPath(); g.arc(m.x, m.z, m.R * 0.15, 0, 7); g.fill()
        }
        g.strokeStyle = '#d6d3d1'; g.lineWidth = Math.max(4, 2 / k); g.lineJoin = 'round'; g.stroke(mapGeo.roads)
        g.fillStyle = '#2f6b3a'; g.fill(mapGeo.park)
        g.fillStyle = '#8b93a1'; g.fill(mapGeo.bld)
        g.strokeStyle = '#a78bfa'; g.lineWidth = Math.max(3, 2 / k); g.setLineDash([14 / k, 10 / k]); g.stroke(mapGeo.tun); g.setLineDash([])
        g.strokeStyle = '#facc15'; g.lineWidth = Math.max(4, 2.5 / k); g.stroke(mapGeo.brg)
        g.setTransform(1, 0, 0, 1, 0, 0)
        // Punkte: innerhalb des Kreises an der Stelle, sonst klein am Rand
        const dot = (x: number, z: number, col: string, r: number) => {
          let px = sx(x, z), py = sy(x, z)
          const dx = px - cx, dy = py - cx, dl = Math.hypot(dx, dy)
          let rr = r
          if (dl > rad - 4) { px = cx + (dx / dl) * (rad - 4); py = cx + (dy / dl) * (rad - 4); rr = Math.max(2, r * 0.6) }
          g.fillStyle = '#000'; g.beginPath(); g.arc(px, py, rr + 1.2, 0, 7); g.fill(); g.fillStyle = col; g.beginPath(); g.arc(px, py, rr, 0, 7); g.fill()
        }
        const nowT = performance.now()
        for (const b of botList) dot(b.car.x, b.car.z, b.color, 3)
        for (const b of pbots) dot(b.car.x, b.car.z, '#3b82f6', 3.5)
        for (const r of remotes.values()) if (nowT - r.seen < (r.ro === 'b' ? 9000 : 4000)) { if (r.ro === 'b') dot(r.x, r.z, chase?.got.has(r.id) ? '#6b7280' : '#ef4444', 5.5); else if (!r.hd) dot(r.x, r.z, r.color, 3.5) }
        g.restore()
        // Rand und Nordmarke
        g.strokeStyle = '#ffffffaa'; g.lineWidth = 2; g.beginPath(); g.arc(cx, cx, rad, 0, 7); g.stroke()
        // Norden (+z): rechts-Anteil sh, oben-Anteil ch
        const nrx = sh, nry = -ch
        g.fillStyle = '#fff'; g.font = 'bold 11px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'
        g.fillText('N', cx + nrx * (rad - 9), cx + nry * (rad - 9))
        // Ich: Pfeil nach oben
        const mine = myRole === 'bandit' ? (iCaught ? '#6b7280' : '#ef4444') : hiddenNow ? '#a78bfa' : '#22d3ee'
        g.fillStyle = '#000'; g.beginPath(); g.moveTo(cx, cx - 9); g.lineTo(cx + 6.5, cx + 6); g.lineTo(cx, cx + 2); g.lineTo(cx - 6.5, cx + 6); g.closePath(); g.fill()
        g.fillStyle = mine; g.beginPath(); g.moveTo(cx, cx - 7); g.lineTo(cx + 5, cx + 4.5); g.lineTo(cx, cx + 1.5); g.lineTo(cx - 5, cx + 4.5); g.closePath(); g.fill()
      }

      const total = laps * track.length
      const rankNow = () => {
        const all: Array<{ t: number; ft: number | null; me?: boolean }> = [{ t: car.total, ft: finishedMs, me: true }]
        for (const b of botList) all.push({ t: b.car.total, ft: b.finished })
        for (const r of remotes.values()) all.push({ t: r.total, ft: r.ft })
        all.sort((a, b) => (a.ft !== null && b.ft !== null ? a.ft - b.ft : a.ft !== null ? -1 : b.ft !== null ? 1 : b.t - a.t))
        return all.findIndex((a) => a.me) + 1
      }

      const hitAt = new WeakMap<object, number>()
      const loop = () => {
        raf = requestAnimationFrame(loop)
        const now = performance.now()
        const dt = Math.min(0.05, (now - prev) / 1000)
        prev = now
        const go = now >= startAt
        const raceMs = Math.max(0, now - startAt)

        if (resetReq.current) {
          resetReq.current = false
          if (isFree) {
            // Offene Spielfelder: Reparatur auf der Stelle (Auto bleibt stehen, wo es ist), danach Wartezeit bis zur nächsten
            if (car.dmg >= 100 || now - lastRepair >= REPAIR_CD_MS) {
              lastRepair = now
              car = { ...car, v: 0, steer: 0, slip: 0, dmg: 0, hold: 3, hit: 0 }
            }
          } else {
            const p = pointAt(track, track.s[car.idx], 0)
            // Zurücksetzen = Werkstatt: Auto wird repariert, steht aber 3 Sekunden
            car = { ...car, x: p.x, z: p.z, h: Math.atan2(p.hx, p.hz), v: 0, steer: 0, slip: 0, dmg: 0, hold: go ? 3 : 0, hit: 0 }
          }
        }
        hiddenNow = isCity && !myRole && (hiddenRef.current || inPark(car.x, car.z))
        if (chase && !chase.over && online) {
          const nowT = performance.now()
          // Positionen der noch freien Banditen
          const bands: Array<{ id: string; x: number; z: number; lvl: number; fly: number }> = []
          for (const bid of chase.bandits) {
            if (chase.got.has(bid)) continue
            if (bid === online.userId) { bands.push({ id: bid, x: car.x, z: car.z, lvl: car.lvl ?? 0, fly: car.fly }); continue }
            const br = remotes.get(bid)
            if (br && nowT - br.seen < 6000) bands.push({ id: bid, x: br.x, z: br.z, lvl: br.lv ?? 0, fly: br.fl })
          }
          for (const pb of pbots) {
            if (bands.length && go) {
              let tg = bands[0]
              for (const bd of bands) if (Math.hypot(bd.x - pb.car.x, bd.z - pb.car.z) < Math.hypot(tg.x - pb.car.x, tg.z - pb.car.z)) tg = bd
              const d = copDrive(pb.car, tg, pb.mem, dt)
              if (d.reset) pb.car = { ...pb.car, x: d.reset.x, z: d.reset.z, h: d.reset.h, v: 0, steer: 0, slip: 0, dmg: 0, hold: 0, lvl: 0, y: 0 }
              if (d.repair) pb.car = { ...pb.car, dmg: 0, hold: 0 }
              pb.car = stepCar(pb.car, d.inp, dt, track, pb.st, true)
              for (const bd of bands) if (chase && caught({ x: pb.car.x, z: pb.car.z, lvl: pb.car.lvl ?? 0, fly: 0 }, bd)) markCaught(bd.id, true)
            }
          }
          if (chase && myRole === 'cop') for (const bd of bands) if (chase && caught({ x: car.x, z: car.z, lvl: car.lvl ?? 0, fly: car.fly }, bd)) markCaught(bd.id, true)
          if (chase && myRole === 'bandit' && !iCaught) for (const r of remotes.values()) if (r.ro === 'c' && nowT - r.seen < 2500 && caught({ x: r.x, z: r.z, lvl: r.lv ?? 0, fly: r.fl }, { x: car.x, z: car.z, lvl: car.lvl ?? 0, fly: car.fly })) { markCaught(online.userId, true); break }
          if (chase && nowT - chase.t0 > CHASE_MAX_MS) finishChase('bandit', chase.from === online.userId)
        }
        const prevTotal = car.total
        const canDrive = go && finishedMs === null
        let input: Input = finishedMs === null ? inp.current : { gas: car.v < 25, brake: false, left: false, right: false }
        const assisting = assistRef.current && finishedMs === null && go
        if (assisting) {
          usedAssist = true
          const m = inp.current, ai = assistSteer(car, myStats, line), hand = m.left || m.right
          input = { left: hand ? m.left : ai.left, right: hand ? m.right : ai.right, gas: m.gas || m.brake ? m.gas : ai.gas, brake: m.gas || m.brake ? m.brake : ai.brake, fly: m.fly, drift: !hand, turn: ai.turn }
        }
        // Bei hohem Tempo in kleinen Teilschritten fahren (höchstens ~1,6 m pro Schritt) und nach jedem Schritt Zusammenstöße prüfen:
        // so rast man nicht durch andere Autos hindurch, und der Aufprall wird richtig erkannt.
        let bumped = false
        const nSub = Math.max(1, Math.min(240, Math.ceil(Math.abs(car.v) * dt / 1.6)))
        for (let k = 0; k < nSub; k++) {
          car = stepCar(car, input, dt / nSub, track, myStats, go, true)
          if (car.fly > 0) continue
          for (const b of botList) {
            const pre = car
            const sc = now - (hitAt.get(b) ?? -1e9) < 250 ? 0 : 1
            const c1 = crash(pre, myStats, { x: b.car.x, z: b.car.z, h: b.car.h, v: b.car.v }, b.st, 0.5, DMG_MAX, sc)
            if (!c1) continue
            car = c1; bumped = true
            // gleicher Aufprall für den Bot, aus dem Zustand VOR dem Wegschieben – so bekommen beide Schaden
            const c2 = crash(b.car, b.st, { x: pre.x, z: pre.z, h: pre.h, v: pre.v, slip: pre.slip }, myStats, 0.5, 85, sc)
            if (c2) b.car = c2
            if (sc) hitAt.set(b, now)
          }
          for (const r of remotes.values()) {
            if (now - r.seen > 3000 || r.fl > 0 || (r.lv ?? 0) !== (car.lvl ?? 0) || Math.abs((r.yy ?? 0) - (car.y ?? 0)) > 2) continue
            const age = Math.min(0.25, (now - r.seen) / 1000), rd = kindDims(r.kind)
            const sc = now - (hitAt.get(r) ?? -1e9) < 250 ? 0 : 1
            const c1 = crash(car, myStats, { x: r.x + Math.sin(r.h) * r.v * age, z: r.z + Math.cos(r.h) * r.v * age, h: r.h, v: r.v, slip: r.slip }, { len: rd.len + 0.5, wid: rd.wid + 0.4 }, 0.5, DMG_MAX, sc)
            if (c1) { car = c1; bumped = true; if (sc) hitAt.set(r, now) }
          }
        }
        if (!canDrive && go) car = { ...car, v: Math.min(car.v, 30) }

        // Bots
        for (const b of botList) {
          b.limit = packLimit(b.car, [car, ...botList.filter((o) => o !== b).map((o) => o.car)])
          const bi = go ? botInput(b, line, now / 1000) : { gas: false, brake: false, left: false, right: false }
          b.car = stepCar(b.car, bi, dt, track, b.st, go, false)
          if (b.finished === null && b.car.total >= total) b.finished = raceMs
        }
        // Zusammenstöße der Bots untereinander (Auto-gegen-Auto-Schaden gleich für beide)
        for (let i = 0; i < botList.length; i++) for (let j = i + 1; j < botList.length; j++) {
          const A = botList[i], B = botList[j]
          const sc = now - (hitAt.get(A) ?? -1e9) < 250 || now - (hitAt.get(B) ?? -1e9) < 250 ? 0 : 1
          const c1 = crash(A.car, A.st, { x: B.car.x, z: B.car.z, h: B.car.h, v: B.car.v }, B.st, 0.5, 85, sc)
          const c2 = crash(B.car, B.st, { x: A.car.x, z: A.car.z, h: A.car.h, v: A.car.v }, A.st, 0.5, 85, sc)
          if (c1) A.car = c1
          if (c2) B.car = c2
          if (sc && (c1 || c2)) { hitAt.set(A, now); hitAt.set(B, now) }
        }

        // Runden / Ziel
        const lapNow = Math.floor(car.total / track.length)
        if (go && lapNow > lastLap && finishedMs === null && lapNow >= 1) {
          const lt = raceMs - lapStart
          if (lt > 8000 && (raceBest === 0 || lt < raceBest)) raceBest = lt
          if (lt > 8000 && (bestLap === 0 || lt < bestLap)) { bestLap = lt; try { localStorage.setItem(lapKey(trackKey(def)), String(Math.round(lt))) } catch { /* ignorieren */ } }
          lapStart = raceMs; lastLap = lapNow
        }
        if (go && finishedMs === null && car.total >= total && prevTotal < total + 1) {
          finishedMs = Math.round(raceMs)
          finishCb.current?.(finishedMs + COUNT_MS)
          const st: RaceStanding[] = [{ name: me.name, ms: finishedMs, me: true }]
          for (const b of botList) st.push({ name: b.name, ms: b.finished })
          for (const r of remotes.values()) st.push({ name: r.name, ms: r.ft })
          setDone({ ms: finishedMs, best: bestLap, standings: st })
          if (me.id !== 'supercar' && !usedAssist) {
            const place = 1 + st.filter((x) => !x.me && x.ms !== null && x.ms < finishedMs!).length
            void raceReward(place, st.length, finishedMs, !!online).then((r) => { setReward({ coins: r.coins, capped: r.capped }); if (r.koins !== null) walletRef.current?.setBalance(r.koins) }).catch(() => undefined)
          }
          if (me.id && raceBest > 0 && !usedAssist) void raceSubmit(trackKey(def), me.id, Math.round(raceBest)).catch(() => undefined)
        }

        // Modelle
        const place = (m: import('three').Group, x: number, z: number, h: number, v: number, steer: number, dmg = 0, slip = 0, fly = 0, lv = 0, yy = 0, pitch = 0) => {
          rs.damageCar(m, dmg, slip, v, now / 1000)
          m.rotation.order = 'YXZ'; m.position.set(x, carY({ fly, lvl: lv, x, z, y: yy }), z); m.rotation.y = h; m.rotation.x = pitch
          const lean = m.userData.lean as import('three').Group | undefined
          if (lean) { m.rotation.z = 0; lean.rotation.z += ((-Math.max(-0.85, Math.min(0.85, steer * Math.min(1, Math.abs(v) / 20) * 0.9 + slip * 0.5))) - lean.rotation.z) * Math.min(1, dt * 9) }
          else m.rotation.z = -steer * Math.min(1, Math.abs(v) / 40) * 0.05 - flyRoll(fly)
          const jets = m.userData.jets as import('three').Group | undefined
          if (jets) jets.visible = fly > 0
          const wh = m.userData.wheels as import('three').Group[] | undefined
          if (wh) for (const w of wh) { w.children.forEach((c) => { c.rotation.x += (v * dt) / (m.userData.wheelR as number) }); if (w.name === 'front') w.rotation.y = steer * 0.45 }
        }
        place(myMesh, car.x, car.z, car.h, car.v, car.steer, car.dmg, car.slip, car.fly, car.lvl ?? 0, car.y ?? 0, pitchOf(car))
        carFx(eff.kind, car.x, car.z, car.h, car.v, car.slip, car.fly, input.gas, dt)
        if (myRole === 'cop') rs.tickSiren(myMesh, now)
        for (const pb of pbots) { place(pb.mesh, pb.car.x, pb.car.z, pb.car.h, pb.car.v, pb.car.steer, pb.car.dmg, pb.car.slip, 0, pb.car.lvl ?? 0, pb.car.y ?? 0, 0); rs.tickSiren(pb.mesh, now) }
        botList.forEach((b, i) => place(botMeshes[i], b.car.x, b.car.z, b.car.h, b.car.v, b.car.steer, b.car.dmg, b.car.slip))
        for (const b of botList) carFx(b.kind, b.car.x, b.car.z, b.car.h, b.car.v, b.car.slip, 0, b.car.v > 5, dt)
        for (const r of remotes.values()) {
          if (!r.mesh) continue
          const k = Math.min(1, dt * 10)
          r.x += (r.tx + Math.sin(r.th) * r.v * 0.05 - r.x) * k; r.z += (r.tz + Math.cos(r.th) * r.v * 0.05 - r.z) * k
          let dh = r.th - r.h; while (dh > Math.PI) dh -= Math.PI * 2; while (dh < -Math.PI) dh += Math.PI * 2
          r.h += dh * k
          r.mesh.visible = now - r.seen < (r.ro === 'b' ? 9000 : 5000)
          if (r.ro === 'c') rs.tickSiren(r.mesh, now)
          for (const ch of r.mesh.children) if ((ch as { isSprite?: boolean }).isSprite) ch.visible = !r.hd || r.ro === 'b'
          place(r.mesh, r.x, r.z, r.h, r.v, 0, r.dmg, r.slip, r.fl, r.lv ?? 0, r.yy ?? 0, r.pt ?? 0)
          if (online?.open && now - r.seen > 15000) { scene.remove(r.mesh); remotes.delete(r.id) }
          if (r.mesh.visible) carFx(r.kind, r.x, r.z, r.h, r.v, r.slip, r.fl, r.v > 5, dt)
        }

        // Kamera: Verfolger von hinten oder Cockpit (Blick aus dem Fenster)
        const sp = Math.max(0, car.v)
        const camRoll = flyRoll(car.fly)
        // im Tunnel automatisch Ego-Ansicht (Cockpit), danach wieder die gewählte Ansicht
        const camEff: 0 | 1 | 2 = isCity && car.lvl === -1 ? 1 : camRef.current
        if (camEff !== lastCamEff) { lastCamEff = camEff; setCamMode(camEff) }
        if (camEff === 1) {
          myMesh.visible = false
          camH = car.h
          const bx = Math.sin(car.h), bz = Math.cos(car.h)
          camera.position.set(car.x + bx * 0.25 - bz * 0.35, 1.18 + carY(car), car.z + bz * 0.25 + bx * 0.35)
          const look = car.h + car.steer * 0.05
          camera.lookAt(car.x + Math.sin(look) * 40, 1.0, car.z + Math.cos(look) * 40)
          if (bike) { camera.position.y = 1.55 + carY(car); camera.rotateZ(Math.max(-0.7, Math.min(0.7, car.steer * Math.min(1, sp / 20) * 0.8)) * 0.9) } else camera.rotateZ(-car.steer * 0.03 * Math.min(1, sp / 40))
          if (camRoll) camera.rotateZ(-camRoll)
          camera.fov += ((74 + Math.min(16, sp * 0.2)) - camera.fov) * Math.min(1, dt * 3)
          if (wheelEl.current) wheelEl.current.style.transform = `rotate(${(-car.steer * 95).toFixed(1)}deg)`
        } else if (camEff === 2) {
          // Von unten: tief hinter dem Auto, so sieht man bei einem Flug den Wagenboden und die Wolken der Düsen
          myMesh.visible = true
          let dh = car.h - camH; while (dh > Math.PI) dh -= Math.PI * 2; while (dh < -Math.PI) dh += Math.PI * 2
          camH += dh * Math.min(1, dt * 4.5)
          const back = Math.min(30, 11 + sp * 0.03)
          camera.position.set(car.x - Math.sin(camH) * back, 0.8, car.z - Math.cos(camH) * back)
          camera.lookAt(car.x, carY(car) + 1.3, car.z)
          if (camRoll) camera.rotateZ(-camRoll)
          camera.fov += ((68 + Math.min(14, sp * 0.15)) - camera.fov) * Math.min(1, dt * 3)
        } else {
          myMesh.visible = true
          let dh = car.h - camH; while (dh > Math.PI) dh -= Math.PI * 2; while (dh < -Math.PI) dh += Math.PI * 2
          camH += dh * Math.min(1, dt * 4.5)
          const back = Math.min(40, 9.5 + sp * 0.06), up = Math.min(12, 4.3 + sp * 0.018)
          camera.position.set(car.x - Math.sin(camH) * back, up + carY(car) * 0.8, car.z - Math.cos(camH) * back)
          camera.lookAt(car.x + Math.sin(camH) * 22, 1.4, car.z + Math.cos(camH) * 22)
          if (bike) camera.rotateZ(Math.max(-0.7, Math.min(0.7, car.steer * Math.min(1, sp / 20) * 0.8)) * 0.5)
          if (camRoll) camera.rotateZ(-camRoll)
          camera.fov += ((62 + Math.min(18, sp * 0.22)) - camera.fov) * Math.min(1, dt * 3)
        }
        camera.updateProjectionMatrix()
        if (car.bump > 0.2 || bumped) camera.position.y += (Math.random() - 0.5) * (0.25 + car.hit * 0.9)
        rs.follow.position.set(camera.position.x, 0, camera.position.z)
        rs.focus?.(camera.position.x, camera.position.z)
        if (isFree && go) {
          if (Math.abs(car.slip) > 0.15 && car.v > 8 && car.fly <= 0) { dCombo += car.v * Math.abs(car.slip) * dt * 2; dIdle = 0 } else if (dCombo > 0 && (dIdle += dt) > 0.9) {
            dTotal += Math.round(dCombo)
            if (dCombo > dBest) { dBest = dCombo; try { localStorage.setItem('vt-race-driftbest', String(Math.round(dBest))) } catch { /* ignorieren */ } }
            dCombo = 0; dIdle = 0
          }
        }
        rs.sun.position.set(car.x + 120, 220, car.z + 80); rs.sun.target.position.set(car.x, 0, car.z); rs.sun.target.updateMatrixWorld()
        fx.update(dt)
        renderer.render(scene, camera)

        if (online && now - lastSend > 55) {
          lastSend = now
          send({ u: online.userId, x: car.x, z: car.z, h: car.h, v: car.v, t: car.total, k: eff.kind, c: eff.color, ro: myRole === 'bandit' ? 'b' : myRole === 'cop' ? 'c' : '', f: finishedMs, d: Math.round(car.dmg), sl: Math.round(car.slip * 100) / 100, fl: Math.round(car.fly * 100) / 100, lv: car.lvl ?? 0, y: Math.round((car.y ?? 0) * 10) / 10, pt: Math.round(pitchOf(car) * 100) / 100, n: online.name ?? me.name, hd: hiddenNow ? 1 : 0, ce: endInfo && now < endInfo.until ? endInfo.id : '', cw: endInfo?.win ?? '' })
          for (const pb of pbots) send({ u: pb.id, x: pb.car.x, z: pb.car.z, h: pb.car.h, v: pb.car.v, t: 0, k: pb.kind, c: pb.color, ro: 'c', f: null, d: 0, sl: Math.round(pb.car.slip * 100) / 100, fl: 0, lv: pb.car.lvl ?? 0, y: Math.round((pb.car.y ?? 0) * 10) / 10, pt: 0, n: pb.name, hd: 0 })
        }
        if (now - lastHud > 110) {
          lastHud = now
          const pr = project(track, car.x, car.z, car.idx)
          const dot = Math.sin(car.h) * track.tx[pr.i] + Math.cos(car.h) * track.tz[pr.i]
          const ca = curveAhead(track, pr.i, 110)
          const count = go ? 0 : Math.ceil((startAt - now) / 1000)
          setHud({ speed: Math.round(Math.abs(car.v) * 3.6), lap: Math.min(laps, Math.max(1, lapNow + 1)), pos: rankNow(), of: 1 + botList.length + remotes.size, ms: finishedMs ?? raceMs, count, wrong: !isFree && dot < -0.3 && car.v > 4, curve: !isFree && Math.abs(ca.k) > 0.004 ? Math.sign(ca.k) : 0, curveDist: Math.round(ca.dist / 10) * 10, offroad: car.offroad, best: bestLap, dmg: Math.round(car.dmg), drift: Math.abs(car.slip) > 0.2 && car.v > 10, dp: dTotal, dc: Math.round(dCombo), db: Math.round(dBest), fly: Math.round(car.fly * 10) / 10, cool: Math.ceil(car.cool) })
          if (chaseOn) {
            const list = [...remotes.values()].filter((r) => !r.id.startsWith('pb-') && now - r.seen < 4000).map((r) => ({ id: r.id, name: r.name }))
            const key = list.map((x) => x.id + x.name).join('|')
            if (key !== peersKey) { peersKey = key; setPeers(list) }
          }
          setInBush((o) => { const v = isCity && inPark(car.x, car.z); return o === v ? o : v })
          setRep((o) => { const hold = Math.ceil(car.hold ?? 0), cd = Math.max(0, Math.ceil((lastRepair + REPAIR_CD_MS - now) / 1000)); return o.hold === hold && o.cd === cd ? o : { hold, cd } })
          drawMini()
          drawCityMap()
          if (finishedMs !== null) {
            const fin = finishedMs
            const st: RaceStanding[] = [{ name: me.name, ms: fin, me: true }, ...botList.map((b) => ({ name: b.name, ms: b.finished })), ...[...remotes.values()].map((r) => ({ name: r.name, ms: r.ft }))]
            setDone((d) => (d ? { ...d, standings: st } : d))
          }
        }
      }
      raf = requestAnimationFrame(loop)
    })()

    return () => {
      dead = true
      cancelAnimationFrame(raf)
      cleanups.forEach((f) => f())
      if (ch && client) void client.removeChannel(ch)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const hold = (k: Key) => ({
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); inp.current[k] = true },
    onPointerUp: () => { inp.current[k] = false },
    onPointerCancel: () => { inp.current[k] = false },
    onLostPointerCapture: () => { inp.current[k] = false },
    onContextMenu: (e: React.SyntheticEvent) => e.preventDefault(),
  })
  const btn = 'select-none touch-none rounded-2xl border border-white/30 bg-black/45 font-bold text-white backdrop-blur active:bg-white/30'

  return (
    <div className="relative select-none overflow-hidden rounded-2xl bg-slate-900" style={{ height: 'min(72vh, 640px)', touchAction: 'none' }}>
      <div ref={mount} className="absolute inset-0" />
      {loadErr && <p className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-rose-200">{loadErr}</p>}
      {cockpit && bikeUi && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[34%]" aria-hidden>
          <svg viewBox="0 0 400 120" preserveAspectRatio="none" className="absolute inset-0 h-full w-full"><path d="M120 120 L170 70 L230 70 L280 120 Z" fill="#111827" /><path d="M60 92 Q200 62 340 92" fill="none" stroke="#cbd5e1" strokeWidth="6" strokeLinecap="round" /><circle cx="58" cy="92" r="11" fill="#0f172a" /><circle cx="342" cy="92" r="11" fill="#0f172a" /><rect x="176" y="66" width="48" height="26" rx="6" fill="#0b1220" stroke="#475569" /></svg>
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-lg bg-black/70 px-3 py-0.5 font-mono text-lg font-bold text-cyan-300">{hud.speed} <span className="text-xs">km/h</span></div>
        </div>
      )}
      {cockpit && !bikeUi && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[46%]" aria-hidden>
          <svg viewBox="0 0 400 180" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
            <defs><linearGradient id="dash" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1f2937" /><stop offset="1" stopColor="#030712" /></linearGradient></defs>
            <path d="M0 180 L0 70 Q60 40 140 52 Q200 58 260 52 Q340 40 400 70 L400 180 Z" fill="url(#dash)" />
            <path d="M0 70 Q60 40 140 52 Q200 58 260 52 Q340 40 400 70" fill="none" stroke="#475569" strokeWidth="2" />
            <path d="M0 0 L26 0 L70 56 L0 66 Z" fill="#0b1220" /><path d="M400 0 L374 0 L330 56 L400 66 Z" fill="#0b1220" />
          </svg>
          <div className="absolute bottom-1 left-1/2 flex -translate-x-1/2 flex-col items-center">
            <div className="rounded-lg bg-black/70 px-3 py-0.5 font-mono text-lg font-bold text-cyan-300">{hud.speed} <span className="text-xs">km/h</span></div>
            <div ref={wheelEl} className="relative mt-1 h-24 w-24 rounded-full border-[7px] border-slate-900 shadow-[inset_0_0_0_2px_#334155]">
              <div className="absolute left-1/2 top-[34px] h-[7px] w-24 -translate-x-1/2 bg-slate-900" /><div className="absolute left-1/2 top-[34px] h-[40px] w-[7px] -translate-x-1/2 bg-slate-900" />
            </div>
          </div>
        </div>
      )}
      {/* Anzeigen */}
      <div className="pointer-events-none absolute left-3 top-3 space-y-1 text-white [text-shadow:0_1px_3px_#000]">
        {isFreeUi ? (
          <>
            <p className="text-sm font-semibold">Drift-Punkte</p>
            <p className="text-3xl font-black leading-none">{hud.dp.toLocaleString('de-DE')}</p>
            <p className="text-lg font-bold text-amber-200">{hud.dc > 0 ? `Serie +${hud.dc.toLocaleString('de-DE')}` : ' '}</p>
            <p className="text-xs text-amber-200">Beste Serie {hud.db.toLocaleString('de-DE')}</p>
          </>
        ) : (
          <>
            <p className="text-3xl font-black leading-none">{hud.pos}<span className="text-lg font-bold">/{hud.of}</span></p>
            <p className="text-sm font-semibold">Runde {hud.lap}/{laps}</p>
            <p className="font-mono text-sm">{fmt(hud.ms)}</p>
            {hud.best > 0 && <p className="text-xs text-amber-200">Beste Runde {fmt(hud.best)}</p>}
          </>
        )}
      </div>
      {def.mode === 'city' && mapUi.on && <canvas ref={cmini} width={220} height={220} aria-label="Karte" style={{ width: MAP_SIZES[mapUi.s], height: MAP_SIZES[mapUi.s] }} className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/40" />}
      {def.mode === 'city' && (
        <div className="absolute right-2 z-20 text-right" style={{ top: (mapUi.on ? MAP_SIZES[mapUi.s] : 0) + 12 }}>
          <button type="button" onClick={() => setMapPanel((o) => !o)} aria-expanded={mapPanel} className="rounded-lg bg-black/45 px-2.5 py-1 text-xs text-white">⚙ Karte</button>
          {mapPanel && (
            <div className="mt-1 w-52 space-y-2 rounded-xl bg-slate-900/95 p-3 text-left text-xs text-white" role="group" aria-label="Karten-Einstellungen">
              <label className="flex items-center justify-between"><span>Karte anzeigen</span><input type="checkbox" className="h-5 w-5" checked={mapUi.on} onChange={(e) => setMap({ on: e.target.checked })} /></label>
              <div>
                <p className="mb-1 flex justify-between"><span>Reichweite</span><b className="tabular-nums">{MAP_RANGES[mapUi.r].toLocaleString('de-DE')} m</b></p>
                <input type="range" min={0} max={MAP_RANGES.length - 1} step={1} value={mapUi.r} aria-label="Reichweite der Karte" onChange={(e) => setMap({ r: Number(e.target.value) })} className="w-full" />
                <p className="flex justify-between text-[10px] text-slate-400"><span>nah, groß</span><span>weit, klein</span></p>
              </div>
              <div>
                <p className="mb-1">Größe</p>
                <div className="flex gap-1" role="group" aria-label="Größe der Karte">{['Klein', 'Mittel', 'Groß'].map((n, k) => <button key={n} type="button" aria-pressed={mapUi.s === k} onClick={() => setMap({ s: k })} className={`flex-1 rounded py-1 ${mapUi.s === k ? 'bg-cyan-500 font-bold text-slate-950' : 'bg-white/15'}`}>{n}</button>)}</div>
              </div>
            </div>
          )}
        </div>
      )}
      {!isFreeUi && <canvas ref={mini} width={220} height={160} className="pointer-events-none absolute right-2 top-2 h-[84px] w-[116px] rounded-xl bg-black/35 sm:h-[120px] sm:w-[165px]" aria-label="Streckenkarte" />}
      <div className="pointer-events-none absolute right-3 top-[100px] text-right text-white [text-shadow:0_1px_3px_#000] sm:top-[135px]">
        <p className="text-3xl font-black leading-none">{hud.speed}</p><p className="text-xs">km/h</p>
        <div className="ml-auto mt-1 h-2 w-20 overflow-hidden rounded bg-black/50" role="img" aria-label={`Schaden ${hud.dmg} Prozent`}><div className={`h-full ${hud.dmg > 70 ? 'bg-rose-500' : hud.dmg > 35 ? 'bg-amber-400' : 'bg-emerald-400'}`} style={{ width: `${hud.dmg}%` }} /></div>
        <p className="text-[10px]">Schaden {hud.dmg}%</p>
        {hud.drift && <p className="text-xs font-bold text-amber-200">DRIFT!</p>}
        {flyer && <p className={`text-xs font-bold ${hud.fly > 0 ? 'text-cyan-300' : hud.cool > 0 ? 'text-slate-300' : 'text-emerald-300'}`}>{hud.fly > 0 ? `FLUG ${hud.fly.toFixed(1)} s` : hud.cool > 0 ? `Laden ${hud.cool} s` : 'Flug bereit (E)'}</p>}
      </div>
      {hud.dmg >= 100 && <p className="pointer-events-none absolute top-14 left-1/2 -translate-x-1/2 rounded-lg bg-rose-700 px-3 py-1 text-sm font-bold text-white">Totalschaden! R = Werkstatt (3 s Pause)</p>}
      {hud.curve !== 0 && hud.count === 0 && (
        <div className={`pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-amber-400/90 px-4 py-1 text-sm font-bold text-slate-900`} role="status">
          {hud.curve < 0 ? '◀◀ Linkskurve' : 'Rechtskurve ▶▶'} · {hud.curveDist} m
        </div>
      )}
      {hud.wrong && <p className="pointer-events-none absolute top-14 left-1/2 -translate-x-1/2 rounded-lg bg-rose-600 px-3 py-1 text-sm font-bold text-white">Falsche Richtung! (R = zurücksetzen)</p>}
      {hud.offroad && <p className="pointer-events-none absolute top-24 left-1/2 -translate-x-1/2 rounded bg-black/50 px-2 py-0.5 text-xs text-amber-200">Neben der Strecke – langsamer</p>}
      {hud.count > 0 && <p className="pointer-events-none absolute inset-0 grid place-items-center text-8xl font-black text-white [text-shadow:0_3px_12px_#000]">{hud.count > 3 ? '' : hud.count}</p>}
      {hud.count === 0 && hud.ms < 1200 && <p className="pointer-events-none absolute inset-0 grid place-items-center text-7xl font-black text-emerald-300 [text-shadow:0_3px_12px_#000]">LOS!</p>}
      <div className="absolute left-3 top-[118px] flex flex-col items-start gap-1.5">
        <button type="button" onClick={toggleCam} className="rounded-lg bg-black/45 px-3 py-1.5 text-xs text-white">{camMode === 0 ? 'Cockpit' : camMode === 1 ? 'Von unten' : 'Außenansicht'} (C)</button>
        <button type="button" onClick={() => { resetReq.current = true }} className="rounded-lg bg-black/45 px-3 py-1.5 text-xs text-white">{isFreeUi ? (rep.hold > 0 ? `Werkstatt: noch ${rep.hold} s` : rep.cd > 0 && hud.dmg < 100 ? `Reparieren (R) in ${rep.cd} s` : 'Reparieren (R)') : 'Zurücksetzen / Reparieren (R)'}</button>
        {me.kind === 'supercar' && !chaseKind && (
          <div className="w-52 rounded-lg bg-black/45 px-3 py-2 text-xs text-white" role="group" aria-label="Höchstgeschwindigkeit">
            <p className="mb-1 flex justify-between"><span>Höchstgeschw.</span><b className="tabular-nums">{topKmh.toLocaleString('de-DE')} km/h</b></p>
            <input type="range" min={0} max={1000} aria-label="Höchstgeschwindigkeit in km/h" value={Math.round((1000 * Math.log(topKmh / TOP_MIN)) / Math.log(Math.max(maxTop, TOP_MIN * 2) / TOP_MIN))}
              onChange={(e) => applyTop(Math.round(TOP_MIN * Math.pow(Math.max(maxTop, TOP_MIN * 2) / TOP_MIN, Number(e.target.value) / 1000)))} className="w-full" />
            <div className="mt-1 flex gap-1">
              <button type="button" onClick={() => applyTop(topKmh / 2)} className="flex-1 rounded bg-white/15 py-1">÷2</button>
              <button type="button" onClick={() => applyTop(topKmh * 2)} className="flex-1 rounded bg-white/15 py-1">×2</button>
              <button type="button" onClick={() => applyTop(maxTop)} className="flex-1 rounded bg-white/15 py-1">Max</button>
            </div>
            <p className="mb-1 mt-2 flex justify-between"><span>Beschleunigung</span><b className="tabular-nums">×{accMul.toLocaleString('de-DE')}</b></p>
            <div className="flex gap-1" role="group" aria-label="Beschleunigung">
              {[0.25, 0.5, 1, 2, 5, 20].map((m) => <button key={m} type="button" onClick={() => applyAcc(m)} aria-pressed={accMul === m} className={`flex-1 rounded py-1 ${accMul === m ? 'bg-cyan-500 font-bold text-slate-950' : 'bg-white/15'}`}>{m.toLocaleString('de-DE')}</button>)}
            </div>
          </div>
        )}
        {cityOpen && !chaseUi.active && <button type="button" onClick={() => setPanel((o) => !o)} aria-pressed={panel} className="rounded-lg bg-blue-600/80 px-3 py-1.5 text-xs font-bold text-white">🚓 Polizeijagd</button>}
        {def.mode === 'city' && (
          <button type="button" onClick={() => toggleHide.current()} aria-pressed={hidden || inBush} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${hidden || inBush ? 'bg-violet-500 text-white' : 'bg-black/45 text-white'}`}>{inBush ? 'Im Gebüsch: Name versteckt' : hidden ? 'Name versteckt – zeigen (H)' : 'Namen verstecken (H)'}</button>
        )}
        {assistOk && <button type="button" onClick={toggleAssist} aria-pressed={assist} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${assist ? 'bg-emerald-500 text-slate-950' : 'bg-black/45 text-white'}`}>Fahrassistent {assist ? 'AN' : 'aus'} (F)</button>}
      </div>
      {cityOpen && online && <ChasePanel ui={chaseUi} peers={peers} open={panel} onClose={() => setPanel(false)} api={{ invite: (a, b, c) => chaseApi.current.invite(a, b, c), start: () => chaseApi.current.start(), cancel: () => chaseApi.current.cancel(), answer: (ok) => chaseApi.current.answer(ok) }} meName={online.name ?? me.name} myId={online.userId} />}
      {/* Bedienung: links Lenken, rechts Gas und Bremse */}
      <div className="absolute bottom-3 left-3 flex gap-3">
        <button type="button" aria-label="Nach links" {...hold('left')} className={`${btn} h-24 w-24 text-4xl`}>◀</button>
        <button type="button" aria-label="Nach rechts" {...hold('right')} className={`${btn} h-24 w-24 text-4xl`}>▶</button>
      </div>
      <div className="absolute bottom-3 right-3 flex items-end gap-3">
        {flyer && <button type="button" aria-label="Fliegen" {...hold('fly')} className={`${btn} h-20 w-24 text-base !bg-cyan-600/60`}>FLIEGEN</button>}
        <button type="button" aria-label="Bremse" {...hold('brake')} className={`${btn} h-20 w-24 text-base !bg-rose-600/60`}>BREMSE</button>
        <button type="button" aria-label="Gas" {...hold('gas')} className={`${btn} h-28 w-28 text-xl !bg-emerald-600/65`}>GAS</button>
      </div>
      {done && (
        <div className="absolute inset-0 grid place-items-center bg-black/55 p-4" role="dialog" aria-label="Ergebnis">
          <div className="w-full max-w-sm space-y-3 rounded-2xl bg-slate-900/95 p-5 text-center text-white">
            <p className="text-sm text-slate-300">Im Ziel!</p>
            <p className="text-4xl font-black">{hud.pos}. Platz</p>
            <p className="font-mono text-xl">{fmt(done.ms)}</p>
            {done.best > 0 && <p className="text-sm text-amber-200">Beste Runde {fmt(done.best)}</p>}
            {reward && (reward.coins > 0 ? <p className="text-sm font-semibold text-emerald-300">+{reward.coins.toLocaleString('de-DE')} Coins fürs Rennen</p> : reward.capped ? <p className="text-xs text-slate-400">Tageslimit für Renn-Coins erreicht.</p> : null)}
            {done.standings.length > 1 && <ul className="space-y-0.5 text-left text-sm">{[...done.standings].sort((a, b) => (a.ms ?? 1e12) - (b.ms ?? 1e12)).map((s, i) => <li key={s.name + i} className={s.me ? 'font-bold text-accent-cyan' : ''}>{i + 1}. {s.name} {s.ms !== null ? `· ${fmt(s.ms)}` : '· fährt noch'}</li>)}</ul>}
            <div className="flex justify-center gap-2">
              {onAgain && <button type="button" onClick={onAgain} className="min-h-[44px] rounded-lg bg-accent-cyan px-4 font-semibold text-slate-950">Nochmal</button>}
              {onExit && <button type="button" onClick={onExit} className="min-h-[44px] rounded-lg bg-white/10 px-4">Zurück</button>}
            </div>
          </div>
        </div>
      )}
      <p className="pointer-events-none sr-only">Steuerung: Pfeiltasten oder WASD, R setzt das Auto zurück, C wechselt die Kamera, Bremse + Lenken driftet.{flyer ? ' E lässt den Roadster 2 Sekunden fliegen (danach 20 s laden).' : ''}{assistOk ? ' F schaltet den Fahrassistenten ein.' : ''}</p>
    </div>
  )
}
