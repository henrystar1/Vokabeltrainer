import { useEffect, useRef, useState } from 'react'
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import { gameClientFor, gameDbsLoaded, onGameDbsChange, slotForKey, whenGameDbsReady } from '../../../lib/gameRealtime'
import { DMG_MAX, botInput, crash, packLimit, startCar, statsFor, stepCar, type Bot, type Car, type CarStats, type Input } from './physics'
import { TRACKS, buildTrack, curveAhead, isOpen, pointAt, project, trackKey, type TrackDef } from './track'
import { assistSteer, buildRaceLine } from './line'
import { createFx } from './fx'
import { canFly, carKmh, flyHeight, flyRoll, isBike, kindDims, seatConfig } from '../stats'
import { useRaceCars, type RaceCarOption } from './useRaceCars'
import { PARK, PARK_TOP, parkSurfaces, inParkXZ } from './parkhaus'
import { BRIDGES, CITY, GARAGES, TUNNELS, bridgeH, city, inPark, roofH, tunnelClamp, tunnelD } from './city'
import { MOUNTAINS, WORLD, hillH, hillSlope, outRoads } from './mountains'
import { CHASE_MAX_MS, caught, chaseCar, copDrive, copSpawn, type BotMem, type Role } from './chase'
import ChasePanel, { type ChaseApi, type ChaseUi, type Peer } from './ChasePanel'
import type { Up } from '../tuning'
import { carList, raceChaseReward, raceReward, raceSubmit } from '../../../services/cars'
import { useWalletOptional } from '../../koins/WalletProvider'

export interface RaceCarInfo { /** Auto-ID im Shop (für die Rangliste) */ id?: string; /** Tuning-Stufen */ up?: Up; name: string; kind: string; color: string; /** eigene Höchstgeschwindigkeit des Autos (km/h) */ top?: number | null }
const TOP_MIN = 20
type Key = 'gas' | 'brake' | 'left' | 'right' | 'fly' | 'jump'
export interface RaceStanding { name: string; ms: number | null; me?: boolean }
/** Höhe über dem Boden: Flug oder Brücke (der höhere Wert zählt). */
let levelAir = false  // Stadt: Auto bleibt in der Luft gerade
// Gelände/Dächer gibt es nur in der Stadt (Rennstrecken nutzen dieselben Koordinaten ohne Berge und Häuser)
const camGround = (x: number, z: number): number => (levelAir ? Math.max(hillH(x, z), roofH(x, z)) : 0)
const carY = (c: { fly: number; lvl?: number; x: number; z: number; y?: number }): number => {
  if (c.lvl === -1) return -tunnelD(c.x, c.z)
  // y kann negativ sein (Parkhaus unter der Erde): dann nicht auf 0 hochziehen
  const base = c.lvl ? Math.max(bridgeH(c.x, c.z), c.y ?? 0) : c.y ?? 0
  return c.fly > 0 ? Math.max(flyHeight(c.fly), base) : base
}
/** Neigung der Nase: im Looping eine volle Drehung, sonst nach Steigen/Fallen (Rampen, Sprünge) */
const pitchOf = (c: { loop?: number; vy?: number; v: number; x?: number; z?: number; h?: number; y?: number; lvl?: number }): number => {
  if ((c.loop ?? 0) > 0) return -(c.loop ?? 0)
  // am Berg: Nase folgt der Steigung
  if (c.x !== undefined && c.z !== undefined && c.h !== undefined && (c.lvl ?? 0) === 0 && levelAir && (c.y ?? 0) <= hillH(c.x, c.z) + 0.35 && hillH(c.x, c.z) > 0.05) return -Math.atan(hillSlope(c.x, c.z, c.h))
  // Stadt: in der Luft bleibt das Auto gerade (nicht nach oben/unten kippen)
  if (c.x !== undefined && c.z !== undefined && (c.y ?? 0) > camGround(c.x, c.z) + 0.6 && levelAir) return 0
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

interface Remote { id: string; name: string; kind: string; color: string; x: number; z: number; h: number; v: number; tx: number; tz: number; th: number; total: number; ft: number | null; seen: number; dmg: number; slip: number; fl: number; lv?: number; yy?: number; pt?: number; hd?: boolean; wk?: boolean; wc?: string; ex?: number; rd?: string; ro?: 'b' | 'c'; mesh?: import('three').Group }

import { buildingAt, walkNav, FLOOR_H } from './interior'
import { HP_MAX, hpCfg, carHit, exitFromCar, nearestCar, newWalker, stepWalker, type Walker } from './foot'
import { poseWalker } from './walkerMesh'
import { POI_COLOR, POI_LETTER, poiNear, pois, type PoiKind } from './poi'
import VocabShop from './VocabShop'
import { racePerkInfo, raceBankClaim, raceBankPay, raceBankStatus, type RacePerks } from '../../../services/cars'
import { cityPush } from './city'
import { errorMessage } from '../../../lib/errors'
import { hillH as hillHeight } from './mountains'

const COUNT_MS = 4500
/** Offene Felder: Wartezeit zwischen zwei Reparaturen (ohne Totalschaden) */
const REPAIR_CD_MS = 12000
/** Joystick-Auslenkung → Drehung (Totzone, flache Kurve für feines Zielen) */
const joyTurnCurve = (x: number) => { const a = Math.abs(x); return a < 0.12 ? 0 : Math.sign(x) * Math.pow((a - 0.12) / 0.88, 1.6) }
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

/** Eigene Autos nach Höchsttempo, schnellstes zuerst (für N + 1…9). */
const bestFirst = (l: RaceCarOption[]): RaceCarOption[] => [...l].sort((a, b) => carKmh(b.kind, b.top) - carKmh(a.kind, a.top))

export default function RaceView({ trackId, custom, laps, me, assistOk = false, bots = [], online, onFinish, onAgain, onExit }: Props) {
  const mount = useRef<HTMLDivElement>(null)
  const mini = useRef<HTMLCanvasElement>(null)
  const cmini = useRef<HTMLCanvasElement>(null)
  const mapCfg = useRef<MapCfg>(loadMapCfg())
  const [mapUi, setMapUi] = useState<MapCfg>(mapCfg.current)
  const [mapPanel, setMapPanel] = useState(false)
  const setMap = (p: Partial<MapCfg>) => { mapCfg.current = { ...mapCfg.current, ...p }; setMapUi(mapCfg.current); try { localStorage.setItem('vt-race-map', JSON.stringify(mapCfg.current)) } catch { /* ignorieren */ } }
  const toggleHide = useRef<() => void>(() => undefined)
  const inp = useRef<Record<Key, boolean>>({ gas: false, brake: false, left: false, right: false, fly: false, jump: false })
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
  // Admin-Supercar: Fliegen in der Stadt ist frei schaltbar (Schalter im Supercar-Feld, wird im Browser gemerkt)
  const [supFly, setSupFly] = useState<boolean>(() => { try { return localStorage.getItem('vt-race-supfly') === '1' } catch { return false } })
  const supFlyRef = useRef(supFly); supFlyRef.current = supFly
  const applySupFly = (on: boolean) => { supFlyRef.current = on; setSupFly(on); try { localStorage.setItem('vt-race-supfly', on ? '1' : '0') } catch { /* ignorieren */ } setAccRefresh.current() }
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
  const [footUi, setFootUi] = useState({ on: false, hp: HP_MAX, near: false, ko: false, n: 0, msg: '', seat: '', ride: false })
  const rcars = useRaceCars()
  const garageRef = useRef<RaceCarOption[]>(rcars.cars)
  garageRef.current = rcars.cars
  const [pick, setPick] = useState(false)
  const joyBase = useRef<HTMLDivElement>(null)
  const [knob, setKnob] = useState({ x: 0, y: 0 })
  const joyMove = (e: React.PointerEvent) => {
    const el = joyBase.current
    if (!el) return
    const b = el.getBoundingClientRect()
    let dx = (e.clientX - (b.left + b.width / 2)) / (b.width / 2), dy = (b.top + b.height / 2 - e.clientY) / (b.height / 2)
    const l = Math.hypot(dx, dy)
    if (l > 1) { dx /= l; dy /= l }
    joyRef.current = { x: dx, y: dy }; setKnob({ x: dx, y: dy })
  }
  useEffect(() => { if (!footUi.on) { joyRef.current = { x: 0, y: 0 }; setKnob({ x: 0, y: 0 }) } }, [footUi.on])
  const joyEnd = () => { joyRef.current = { x: 0, y: 0 }; setKnob({ x: 0, y: 0 }) }
  const exitRef = useRef<() => void>(() => undefined)
  const spawnRef = useRef<(o?: RaceCarOption, nth?: number) => void>(() => undefined)
  const spawnArm = useRef(0)
  const punchReq = useRef(false)
  const [perksUi, setPerksUi] = useState<RacePerks>({ spawn_max: 2, spawn_sec: 0, hearts: 100, shop: 0, gym: 0 })
  /** Spawn-Limit (2, oder 5 nach Lernen im Shop) und Ablaufzeit */
  const perkRef = useRef({ until: 0, hearts: 100 })
  const applyPerks = (p: RacePerks) => { perkRef.current = { until: p.spawn_sec > 0 ? Date.now() + p.spawn_sec * 1000 : 0, hearts: p.hearts }; hpCfg.max = p.hearts; setPerksUi(p) }
  const [shopUi, setShopUi] = useState<'shop' | 'gym' | null>(null)
  const [poiUi, setPoiUi] = useState<{ kind: PoiKind; name: string } | null>(null)
  const [bankWait, setBankWait] = useState(0)
  const heistRef = useRef<() => void>(() => undefined)
  const poiKey = useRef<() => void>(() => undefined)
  useEffect(() => {
    if (def.mode !== 'city' || !online) return
    racePerkInfo().then(applyPerks).catch(() => undefined)
    return () => { hpCfg.max = 100 }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const joyRef = useRef({ x: 0, y: 0 })
  const lsGet = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d } catch { return d } }
  const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* ignorieren */ } }
  /** Joystick-Drehempfindlichkeit (Faktor), eigene Figurenfarbe ('' = Autofarbe), Render-Umkreis in m (0 = aus) */
  const joyTurnRef = useRef(Number(lsGet('vt-race-joyturn', '0.5')) || 0.5)
  const [joyTurn, setJoyTurn] = useState(joyTurnRef.current)
  const applyJoyTurn = (v: number) => { joyTurnRef.current = v; setJoyTurn(v); lsSet('vt-race-joyturn', String(v)) }
  const wcRef = useRef(/^#[0-9a-f]{6}$/i.test(lsGet('vt-race-wcolor', '')) ? lsGet('vt-race-wcolor', '') : '')
  const [wcUi, setWcUi] = useState(wcRef.current)
  const applyWc = (c: string) => { wcRef.current = c; setWcUi(c); lsSet('vt-race-wcolor', c); remakeFoot.current() }
  const remakeFoot = useRef<() => void>(() => undefined)
  const rrRef = useRef(Number(lsGet('vt-race-radius', '0')) || 0)
  const [rrUi, setRrUi] = useState(rrRef.current)
  const applyRr = (m: number) => { rrRef.current = m; setRrUi(m); lsSet('vt-race-radius', String(m)) }
  const runRef = useRef(false)
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
  const [hud, setHud] = useState({ alt: 0, speed: 0, lap: 1, pos: 1, of: 1 + bots.length + (online ? online.players.length - 1 : 0), ms: 0, count: 4, wrong: false, curve: 0, curveDist: 0, offroad: false, best: 0, dmg: 0, drift: false, dp: 0, dc: 0, db: 0, fly: 0, cool: 0 })
  const wallet = useWalletOptional()
  const walletRef = useRef(wallet); walletRef.current = wallet
  const [reward, setReward] = useState<{ coins: number; capped: boolean } | null>(null)
  const [done, setDone] = useState<{ ms: number; best: number; standings: RaceStanding[] } | null>(null)
  // Admin-Supercar fliegt in der Stadt nicht (in der Jagd fährt es als Roadster)
  const flyer = canFly(chaseKind ?? me.kind) && !(def.mode === 'city' && !chaseKind && me.kind === 'supercar' && !supFly)
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
      // eigene Autos des Admins bekannt machen (auch die der Mitfahrer)
      await carList().catch(() => [])
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
      levelAir = def.mode === 'city'
      const fx = createFx(THREE, rs.scene)
      cleanups.push(() => fx.dispose())
      // Explosionen: Feuerball, Druckwelle, Lichtblitz und fliegende Trümmer
      interface Blast { t: number; ball: import('three').Mesh; ring: import('three').Mesh; light: import('three').PointLight; debris: Array<{ m: import('three').Mesh; vx: number; vy: number; vz: number; rx: number; rz: number }> }
      const blasts: Blast[] = []
      const blastAt = (x: number, y: number, z: number, color = '#ff7a1a') => {
        const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.95, depthWrite: false }))
        ball.position.set(x, y, z)
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 32), new THREE.MeshBasicMaterial({ color: '#fff3d6', transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }))
        ring.rotation.x = -Math.PI / 2; ring.position.set(x, y - 0.6, z)
        const light = new THREE.PointLight(color, 60, 90); light.position.set(x, y + 1, z)
        const debris: Blast['debris'] = []
        const dm = new THREE.MeshStandardMaterial({ color: '#2b2b2b', roughness: 0.8 })
        for (let i = 0; i < 14; i++) {
          const m = new THREE.Mesh(new THREE.BoxGeometry(0.3 + Math.random() * 0.7, 0.15 + Math.random() * 0.3, 0.3 + Math.random() * 0.6), dm)
          m.position.set(x, y, z)
          const a = Math.random() * Math.PI * 2, sp = 5 + Math.random() * 12
          debris.push({ m, vx: Math.cos(a) * sp, vy: 6 + Math.random() * 12, vz: Math.sin(a) * sp, rx: (Math.random() - 0.5) * 14, rz: (Math.random() - 0.5) * 14 })
          rs.scene.add(m)
        }
        rs.scene.add(ball, ring, light)
        blasts.push({ t: 0, ball, ring, light, debris })
      }
      const tickBlasts = (dt: number) => {
        for (let i = blasts.length - 1; i >= 0; i--) {
          const b = blasts[i]; b.t += dt
          const k = b.t / 1.6
          const bs = 1 + Math.min(1, b.t / 0.45) * 6.5
          b.ball.scale.setScalar(bs); (b.ball.material as import('three').MeshBasicMaterial).opacity = Math.max(0, 0.95 - b.t / 0.8)
          b.ring.scale.setScalar(1 + b.t * 34); (b.ring.material as import('three').MeshBasicMaterial).opacity = Math.max(0, 0.8 - b.t / 0.7)
          b.light.intensity = Math.max(0, 60 * (1 - b.t / 0.9))
          for (const d of b.debris) { d.vy -= 22 * dt; d.m.position.x += d.vx * dt; d.m.position.y = Math.max(0.1, d.m.position.y + d.vy * dt); d.m.position.z += d.vz * dt; d.m.rotation.x += d.rx * dt; d.m.rotation.z += d.rz * dt }
          if (k >= 1) {
            rs.scene.remove(b.ball, b.ring, b.light); for (const d of b.debris) rs.scene.remove(d.m)
            b.ball.geometry.dispose(); b.ring.geometry.dispose(); blasts.splice(i, 1)
          }
        }
      }
      cleanups.push(() => { for (const b of blasts) { rs.scene.remove(b.ball, b.ring, b.light); for (const d of b.debris) rs.scene.remove(d.m) } blasts.length = 0 })
      let exN = 0
      let fxTick = 0
      const carFx = (kind: string, x: number, z: number, h: number, v: number, slip: number, fly: number, gas: boolean, dt2: number, alt = 0) => {
        const fxv = Math.sin(h), fzv = Math.cos(h), rx = Math.cos(h), rz = -Math.sin(h)
        const d = kindDims(kind), sp = Math.abs(v)
        // Stadt: echte Flughöhe `alt`; der Strahl reicht nur etwa 5 m unter das Auto und bleibt mit ihm in der Höhe
        const y0 = alt > 0 ? alt : flyHeight(fly), short = alt > 0
        if ((fly > 0 || alt > 0) && canFly(kind)) {
          // Düsenstrahl nach unten: Wolken schießen zum Boden und breiten sich dort aus
          fxTick++
          for (const sz of fxTick % 2 ? [-1, 1] : [1, -1]) {
            const nz = (fxTick % 4 < 2 ? -0.28 : 0.22) * d.len
            const px = x + rx * sz * d.wid * 0.3 + fxv * nz, pz = z + rz * sz * d.wid * 0.3 + fzv * nz
            if (short) {
              fx.emit('cloud', px, y0 - 0.3, pz, fxv * v * 0.9 + (Math.random() - 0.5) * 2, -6 - Math.random() * 2, fzv * v * 0.9 + (Math.random() - 0.5) * 2, 0.6 + Math.random() * 0.2)
              fx.emit('fire', px, y0 - 0.5, pz, fxv * v * 0.9, -5, fzv * v * 0.9, 0.7)
            } else {
            fx.emit('cloud', px, y0 - 0.3, pz, fxv * v * 0.55 + (Math.random() - 0.5) * 3, -13 - Math.random() * 5, fzv * v * 0.55 + (Math.random() - 0.5) * 3, 1.5 + Math.random() * 0.8)
            fx.emit('fire', px, y0 - 0.5, pz, 0, -9, 0, 1.2)
            }
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
      const mkStats = (): CarStats => { const st1 = statsFor(eff.kind, topNow, eff.up); const st0 = def.mode === 'city' && eff.kind === 'supercar' && !supFlyRef.current ? { ...st1, fly: false } : st1; return accRef.current === 1 ? st0 : { ...st0, acc: st0.acc * accRef.current } }
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
      const kd = (e: KeyboardEvent) => { if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return; if (e.key === 'g' || e.key === 'G') { poiKey.current(); return } const k = keyMap[e.key]; if (k) { inp.current[k] = true; e.preventDefault() } else if (e.key === 'r' || e.key === 'R') resetReq.current = true; else if (e.key === 'c' || e.key === 'C') toggleRef.current(); else if (e.key === 'f' || e.key === 'F') assistToggleRef.current(); else if (e.key === 'h' || e.key === 'H') toggleHide.current(); else if (e.key === 'x' || e.key === 'X') exitRef.current(); else if (e.key === 'q' || e.key === 'Q') punchReq.current = true; else if (e.key === 'n' || e.key === 'N') { spawnArm.current = performance.now() + 2500; spawnRef.current() } else if (e.key >= '1' && e.key <= '9' && performance.now() < spawnArm.current) { spawnArm.current = 0; spawnRef.current(undefined, Number(e.key)) } else if (e.key === 'Shift') runRef.current = true; if (e.key === ' ') inp.current.jump = true }
      const ku = (e: KeyboardEvent) => { const k = keyMap[e.key]; if (k) { inp.current[k] = false; e.preventDefault() } else if (e.key === 'Shift') runRef.current = false; if (e.key === ' ') inp.current.jump = false }
      window.addEventListener('keydown', kd); window.addEventListener('keyup', ku)
      cleanups.push(() => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku) })

      // Netz
      let ready = false
      let onCh: (p: Record<string, unknown>) => void = () => undefined
      const sendCh = (payload: Record<string, unknown>) => { if (ready) void ch?.send({ type: 'broadcast', event: 'ch', payload }).catch(() => undefined) }
      let onClaim: (id: string) => void = () => undefined
      const sendCl = (id: string) => { if (ready) void ch?.send({ type: 'broadcast', event: 'cl', payload: { id } }).catch(() => undefined) }
      const send = (payload: Record<string, unknown>) => { if (ready) void ch?.send({ type: 'broadcast', event: 'r', payload }).catch(() => undefined) }
      const connectNet = () => {
        if (dead || !online) return
        if (ch && client) { void client.removeChannel(ch); ch = null; ready = false }
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
          r.wk = payload.wk === 1
          r.rd = typeof payload.rd === 'string' ? payload.rd : ''
          { const ex = Number(payload.ex) || 0; if (r.ex !== undefined && ex > r.ex) blastAt(Number(payload.x) || 0, (Number(payload.y) || 0) + 0.8, Number(payload.z) || 0); r.ex = ex }
          const wcNew = typeof payload.wc === 'string' && /^#[0-9a-f]{6}$/i.test(payload.wc) ? payload.wc : ''
          if (wcNew !== (r.wc ?? '')) { r.wc = wcNew; if (r.mesh && r.wk) { scene.remove(r.mesh); r.mesh = undefined } }
          if (r.mesh && !!r.mesh.userData.wk !== r.wk) { scene.remove(r.mesh); r.mesh = undefined }
          if (typeof payload.ce === 'string' && chase && !chase.over && chase.id === payload.ce) finishChase(payload.cw === 'police' ? 'police' : 'bandit', false)
          r.hd = payload.hd === 1; r.lv = Number(payload.lv) || 0; r.yy = Number(payload.y) || 0; r.pt = Number(payload.pt) || 0
          r.tx = Number(payload.x) || 0; r.tz = Number(payload.z) || 0; r.th = Number(payload.h) || 0; r.v = Number(payload.v) || 0
          r.dmg = Number(payload.d) || 0; r.slip = Number(payload.sl) || 0; r.fl = Number(payload.fl) || 0
          r.total = Number(payload.t) || 0; r.ft = typeof payload.f === 'number' ? payload.f : null; r.seen = performance.now()
          if (typeof payload.k === 'string' && (payload.k !== r.kind || payload.c !== r.color || (r.mesh && r.mesh.userData.ro !== r.ro))) {
            r.kind = payload.k; r.color = String(payload.c || '#94a3b8')
            if (r.mesh) { scene.remove(r.mesh); r.mesh = undefined }
          }
          if (!r.mesh) { if (r.wk) { r.mesh = rs.makeWalker(r.ro === 'c' ? '#1d4ed8' : r.ro === 'b' ? '#111827' : (r.wc || r.color), undefined, r.name); r.mesh.userData.wk = true } else { r.mesh = rs.makeCar(r.kind, r.color, r.name, false); if (r.ro === 'c') rs.addSiren(r.mesh) } r.mesh.userData.ro = r.ro; r.x = r.tx; r.z = r.tz; r.h = r.th; scene.add(r.mesh) }
        })
        ch.on('broadcast', { event: 'ch' }, ({ payload }) => onCh(payload as Record<string, unknown>))
        ch.on('broadcast', { event: 'pn' }, ({ payload }) => {
          const p = payload as { to?: unknown; dx?: unknown; dz?: unknown }
          if (!foot || p.to !== online.userId || ride) return
          const dx = Math.max(-1, Math.min(1, Number(p.dx) || 0)), dz = Math.max(-1, Math.min(1, Number(p.dz) || 0))
          foot = { ...foot, vx: foot.vx + dx * 8, vz: foot.vz + dz * 8, hp: Math.max(0, foot.hp - 8), stun: Math.max(foot.stun, 0.45) }
          lastRegenHit = performance.now(); say('Du wurdest geschlagen!')
        })
        ch.on('broadcast', { event: 'cl' }, ({ payload }) => onClaim(String((payload as { id?: unknown }).id ?? '')))
        const mine = ch
        mine.subscribe((st) => {
          if (ch !== mine) return
          if (st === 'SUBSCRIBED') { ready = true; return }
          // Verbindung weg: nicht weiter „blind“ senden (sonst sieht nur einer den anderen), sondern neu verbinden
          if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT' || st === 'CLOSED') { ready = false; window.setTimeout(() => { if (!dead && ch === mine) connectNet() }, 2000) }
        })
      }
      // Wächter: ist der Kanal nicht mehr „joined“, neu verbinden (z. B. nach WLAN-Wechsel oder iPad-Standby)
      if (online) { const wd = window.setInterval(() => { if (!dead && ch && ch.state !== 'joined' && ch.state !== 'joining') { ready = false; connectNet() } }, 4000); cleanups.push(() => window.clearInterval(wd)) }
      // Erst verbinden, wenn die Datenbank-Liste vom Server da ist (sonst landen Geräte mit verschiedener Liste auf verschiedenen Servern); ändert sie sich später, neu verbinden
      const bootNet = (tries: number) => void whenGameDbsReady().then(() => {
        if (dead) return
        if (!gameDbsLoaded() && tries < 4) { window.setTimeout(() => bootNet(tries + 1), 2500); return }
        connectNet()
      })
      if (online) { bootNet(0); cleanups.push(onGameDbsChange(() => connectNet())) }

      // Ablauf
      const isFree = isOpen(def)
      const startAt = performance.now() + (isFree ? 0 : COUNT_MS)
      let finishedMs: number | null = null
      let lastLap = 0, lapStart = 0, bestLap = Number(localStorage.getItem(lapKey(trackKey(def)))) || 0
      let raceBest = 0, usedAssist = false
      let camH = car.h
      let camY = 0
      let lastSend = 0, lastHud = 0
      let lastRepair = -REPAIR_CD_MS
      let peersKey = ''
      const isCity = def.mode === 'city'
      let hiddenNow = false
      let lastCamEff: 0 | 1 | 2 = camRef.current
      toggleHide.current = () => { if (!isCity) return; hiddenRef.current = !hiddenRef.current; setHiddenUi(hiddenRef.current) }

      // Polizeijagd (nur offene Stadt-Lobby): Rollen, Bots (rechnet der Ersteller), Fang-Regel
      interface PBot { id: string; name: string; kind: string; color: string; car: Car; st: CarStats; mem: BotMem; mesh: import('three').Group; w?: Walker; wm?: import('three').Group; carGone?: boolean }
      let pbots: PBot[] = []
      let endInfo: { id: string; win: 'police' | 'bandit'; until: number } | null = null
      let chase: { id: string; bandits: string[]; got: Set<string>; cops: string[]; bots: number; t0: number; from: string; over: boolean; heist?: boolean } | null = null
      let iCaught = false
      let lobbyCur: { id: string; bandits: string[]; invitees: string[]; invited: Record<string, 'wait' | 'yes' | 'no'>; bots: number } | null = null
      let incoming: { id: string; from: string; fn: string; role: 'bandit' | 'cop'; bots: number } | null = null
      const chaseOn = !!online?.open && isCity
      const syncLobby = () => { const l = lobbyCur; setChaseUi((o) => ({ ...o, lobby: l ? { id: l.id, bandits: l.bandits.map((b) => (b === online?.userId ? 'me' : b)), invited: { ...l.invited }, bots: l.bots } : undefined })) }
      const applyRole = (role: Role | null) => {
        myRole = role
        if (role) { const cc = chaseCar(role, me.kind === 'supercar', false, isBike(me.kind)); eff.kind = cc.kind; eff.color = cc.color; eff.up = undefined; topNow = cc.top }
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
      const startChase = (id: string, bandits: string[], cops: string[], bots: number, from: string, role: Role, heist = false) => {
        if (!online || chase) return
        iCaught = false
        chase = { id, bandits, got: new Set<string>(), cops, bots, t0: performance.now(), from, over: false, heist }
        // Zu Fuß (Bankraub): direkt ins Fluchtauto vor der Tür
        if (foot) {
          const f0 = foot
          let sx = f0.x, sz = f0.z
          for (const [dx, dz] of [[6, 0], [-6, 0], [0, 6], [0, -6], [9, 0], [-9, 0], [0, 9], [0, -9]] as const) { if (!cityPush(f0.x + dx, f0.z + dz) && !buildingAt(f0.x + dx, f0.z + dz)) { sx = f0.x + dx; sz = f0.z + dz; break } }
          car = { ...startCar(track, 0), x: sx, z: sz, h: f0.h, v: 0, lvl: f0.lvl ?? 0, y: f0.y }
          foot = null
          if (footMesh) { scene.remove(footMesh); footMesh = null }
          myMesh.visible = true
        }
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

      // Besondere Häuser: Leuchtsäule und Schild über der Tür
      const poiMeshes: Array<import('three').Object3D> = []
      if (isCity) for (const p of pois()) {
        const col = new THREE.Color(POI_COLOR[p.kind])
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 40, 8), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.35, depthWrite: false }))
        beam.position.set(p.x, 20, p.z)
        const sign = new THREE.Mesh(new THREE.BoxGeometry(5, 1.4, 0.3), new THREE.MeshBasicMaterial({ color: col }))
        sign.position.set(p.x, 4.6, p.z)
        rs.scene.add(beam, sign); poiMeshes.push(beam, sign)
      }
      cleanups.push(() => { for (const m of poiMeshes) rs.scene.remove(m) })
      // ── Zu Fuß (Stadt): aussteigen, in andere Autos einsteigen, Autos spawnen; Autos rollen aus ──
      interface Parked { id: string; car: Car; kind: string; color: string; st: CarStats; top: number | null | undefined; up: typeof me.up; siren: boolean; sp?: boolean; mesh: import('three').Group }
      let parked: Parked[] = []
      let parkN = 0
      let foot: Walker | null = null
      /** Mitfahren: ID des Fahrers, in dessen Auto ich sitze */
      let ride: string | null = null
      const fresh = (r: Remote) => performance.now() - r.seen < 3500
      const occupants = (id: string) => 1 + [...remotes.values()].filter((r) => r.rd === id && fresh(r)).length + (ride === id ? 1 : 0)
      const pkId = (p: Parked) => `pk-${online?.userId.slice(0, 6) ?? 'x'}-${p.id}`
      let footMesh: import('three').Group | null = null
      let footKo = 0
      let lastPunch = 0
      let lastBankPoll = 0
      /** Leben der Figur (auch im Auto: Schäden am Auto und Feuer kosten Leben, es gibt dort keine Erholung) */
      let myHp = hpCfg.max
      let prevV = 0, prevDmg = 0, burnT = 0, wreck = 0
      let footMsg = '', footMsgT = 0
      let lastSpawn = 0, lastRegenHit = 0, lastPark = 0
      const say = (m: string) => { footMsg = m; footMsgT = performance.now() + 3500 }
      const explode = (why: string) => {
        wreck = 3.6; myHp = 0; car = { ...car, v: 0 }
        const y0 = (car.y ?? 0) + 0.8
        for (let i = 0; i < 70; i++) {
          const a = Math.random() * Math.PI * 2, s = 4 + Math.random() * 16
          fx.emit('fire', car.x, y0, car.z, Math.cos(a) * s, 3 + Math.random() * 14, Math.sin(a) * s, 0.7 + Math.random() * 0.8)
          if (i % 2 === 0) fx.emit('smoke', car.x, y0, car.z, Math.cos(a) * s * 0.5, 2 + Math.random() * 8, Math.sin(a) * s * 0.5, 1.4 + Math.random())
        }
        blastAt(car.x, y0, car.z); exN++
        myMesh.visible = false
        say(why)
      }
      const idleIn = { gas: false, brake: false, left: false, right: false }
      const setVehicle = (kind: string, color: string, top: number | null | undefined, up: typeof me.up, siren: boolean) => {
        eff.kind = kind; eff.color = color; eff.up = up; topNow = top
        myStats = mkStats()
        scene.remove(myMesh)
        myMesh = rs.makeCar(kind, color, me.name, true)
        if (siren) rs.addSiren(myMesh)
        scene.add(myMesh)
        bike = isBike(kind)
        car = { ...car, fly: 0, cool: 0 }
        setChaseKind(myRole || kind !== me.kind ? kind : null)
      }
      const mkParked = (c: Car, kind: string, color: string, st: CarStats, top: number | null | undefined, up: typeof me.up, siren: boolean): Parked => {
        const mesh = rs.makeCar(kind, color, '', false)
        if (siren) rs.addSiren(mesh)
        scene.add(mesh)
        const p: Parked = { id: `pk${++parkN}`, car: c, kind, color, st, top, up, siren, mesh }
        parked.push(p)
        if (parked.length > 8) { const o = parked.shift()!; scene.remove(o.mesh) }
        return p
      }
      const exitCar = () => {
        if (!isCity || finishedMs !== null) return
        if (ride) { leaveRide(); return }
        if (foot) { enterCar(); return }
        if (Math.abs(car.vy ?? 0) > 1.5 || car.fly > 0) { say('In der Luft kannst du nicht aussteigen.'); return }
        mkParked({ ...car }, eff.kind, eff.color, myStats, topNow, eff.up, myRole === 'cop')
        foot = exitFromCar({ ...car, wid: myStats.wid }, 1, myHp)
        if (footMesh) scene.remove(footMesh)
        makeFootMesh()
        myMesh.visible = false
        footKo = 0
      }
      remakeFoot.current = () => { if (footMesh) makeFootMesh() }
      const makeFootMesh = () => {
        if (footMesh) scene.remove(footMesh)
        footMesh = rs.makeWalker(myRole === 'cop' ? '#1d4ed8' : myRole === 'bandit' ? '#111827' : (wcRef.current || eff.color))
        scene.add(footMesh)
      }
      const leaveRide = (m?: string) => {
        const r = ride ? remotes.get(ride) : undefined
        ride = null
        foot = exitFromCar({ x: car.x, z: car.z, h: car.h, v: r?.v ?? 0, wid: r ? kindDims(r.kind).wid : 1.8, y: car.y, lvl: car.lvl }, 1, myHp)
        makeFootMesh(); footKo = 0
        if (m) say(m)
      }
      const tickRide = () => {
        const r = ride ? remotes.get(ride) : undefined
        if (!r || !fresh(r) || r.wk || r.rd) { leaveRide('Der Fahrer ist weg – du steigst aus.'); return }
        car = { ...car, x: r.x, z: r.z, h: r.h, v: r.v, steer: 0, slip: 0, y: r.yy ?? 0, vy: 0, fly: r.fl, lvl: r.lv ?? 0, dmg: 0, hit: 0, bump: 0 }
      }
      const enterCar = () => {
        const f = foot
        if (!f || footKo > 0) return
        const cand: Array<{ x: number; z: number; p?: Parked; pb?: PBot; r?: Remote }> = [...parked.map((p) => ({ x: p.car.x, z: p.car.z, p })), ...pbots.filter((pb) => pb.w && !pb.carGone).map((pb) => ({ x: pb.car.x, z: pb.car.z, pb })), ...[...remotes.values()].filter((r) => !r.wk && !r.rd && !r.id.startsWith('pb-') && fresh(r) && Math.abs((r.yy ?? 0) - f.y) < 2.5).map((r) => ({ x: r.x, z: r.z, r }))]
        const n = nearestCar(f, cand, 5.5)
        if (!n) { say('Kein Auto in der Nähe zum Einsteigen.'); return }
        if (n.p) {
          const p = n.p
          scene.remove(p.mesh); parked = parked.filter((q) => q !== p)
          car = { ...p.car }
          setVehicle(p.kind, p.color, p.top, p.up, p.siren)
        } else if (n.r) {
          const r = n.r
          if (r.id.startsWith('pk-')) {
            // verlassenes Auto eines Mitspielers: wer zuerst einsteigt, fährt
            sendCl(r.id)
            if (r.mesh) scene.remove(r.mesh)
            remotes.delete(r.id)
            car = { ...startCar(track, 0), x: r.x, z: r.z, h: r.h, v: 0, lvl: r.lv ?? 0, y: r.yy ?? 0 }
            setVehicle(r.kind, r.color, null, undefined, false)
          } else {
            const occ = occupants(r.id)
            if (occ >= seatConfig.n) { say(`Das Auto ist voll (${occ}/${seatConfig.n}).`); return }
            ride = r.id
            foot = null
            if (footMesh) { scene.remove(footMesh); footMesh = null }
            myMesh.visible = false
            say(`Du fährst bei ${r.name} mit (${occ + 1}/${seatConfig.n}). X = aussteigen.`)
            return
          }
        } else if (n.pb) {
          const pb = n.pb
          pb.carGone = true; scene.remove(pb.mesh)
          car = { ...pb.car, dmg: 0 }
          setVehicle(pb.kind, pb.color, Math.round(pb.st.top * 3.6), undefined, true)
        }
        myHp = f.hp; prevV = 0; prevDmg = car.dmg; burnT = 0
        foot = null
        if (footMesh) { scene.remove(footMesh); footMesh = null }
        myMesh.visible = true
      }
      const respawnAfterDeath = () => {
        car = startCar(track, 0); myHp = hpCfg.max; prevV = 0; prevDmg = 0; burnT = 0; myMesh.visible = true
        say('Dein Auto ist explodiert – du bekommst ein neues.')
      }
      const spawnCar = (o?: RaceCarOption) => {
        if (!isCity) return
        const nowT = performance.now()
        if (nowT - lastSpawn < 1200) return
        const cap = Date.now() < perkRef.current.until ? 5 : 2
        if (parked.filter((q) => q.sp).length >= cap) { say(`Spawn-Limit erreicht (${cap}). Lerne Vokabeln in einem Shop (S auf der Karte) für bis zu 5.`); return }
        const src = foot ?? car
        const h = foot ? foot.h : car.h
        for (const [d, sd] of [[5, 0], [5, 3.5], [5, -3.5], [8, 0], [-5, 0]] as const) {
          const x = src.x + Math.sin(h) * d + Math.cos(h) * sd, z = src.z + Math.cos(h) * d - Math.sin(h) * sd
          if (cityPush(x, z) || cityPush(x + 2, z) || cityPush(x - 2, z) || cityPush(x, z + 2) || cityPush(x, z - 2)) continue
          lastSpawn = nowT
          const k = o?.kind ?? me.kind, col = o?.color ?? me.color, tp = o ? o.top : userTop, up = o ? o.up : me.up, st = statsFor(k, tp, up)
          mkParked({ ...startCar(track, 0), x, z, h, v: 0, lvl: 0, y: foot ? foot.y : (car.y ?? hillHeight(x, z)) }, k, col, st, tp, up, false).sp = true
          return
        }
        say('Hier ist kein Platz zum Spawnen.')
      }
      onClaim = (id) => {
        const r = remotes.get(id)
        if (r) { if (r.mesh) scene.remove(r.mesh); remotes.delete(id) }
        const p = parked.find((q) => pkId(q) === id)
        if (p) { scene.remove(p.mesh); parked = parked.filter((q) => q !== p) }
      }
      exitRef.current = exitCar
      spawnRef.current = (o, nth) => { if (nth) { setPick(false); const b = bestFirst(garageRef.current)[nth - 1]; if (b) spawnCar(b); else say(`Du hast kein Auto Nr. ${nth}.`) } else if (o) { setPick(false); spawnCar(o) } else if (garageRef.current.length > 1) setPick((v) => !v); else spawnCar() }
      /** Schritt zu Fuß: laufen, Autos treffen mich, Leben, K.O. und Wiederkehr */
      const tickFoot = (dt: number, nowT: number) => {
        let w = foot
        if (!w) return
        if (footKo > 0) {
          footKo -= dt
          w = stepWalker(w, { fwd: false, back: false, left: false, right: false }, dt)
          if (footKo <= 0) { w = newWalker(0, 0, 0); w.inv = 2; say('Du bist wieder auf den Beinen.') }
          foot = w
          return
        }
        const m = inp.current
        w = stepWalker(w, { fwd: m.gas || joyRef.current.y > 0.3, back: (m.brake && !m.jump) || joyRef.current.y < -0.3, left: m.left, right: m.right, turn: joyTurnCurve(joyRef.current.x) * joyTurnRef.current * 2, run: m.fly || runRef.current || joyRef.current.y > 0.85, jump: m.jump }, dt)
        const hitBy = (cx: number, cz: number, ch: number, cv: number, len: number, wid: number, cy: number) => {
          const r = carHit(w!, { x: cx, z: cz, h: ch, v: cv, len, wid, y: cy })
          if (r) { w = r; lastRegenHit = nowT }
        }
        for (const b of botList) hitBy(b.car.x, b.car.z, b.car.h, b.car.v, b.st.len, b.st.wid, b.car.y ?? 0)
        for (const pb of pbots) if (!pb.carGone) hitBy(pb.car.x, pb.car.z, pb.car.h, pb.car.v, pb.st.len, pb.st.wid, pb.car.y ?? 0)
        for (const p of parked) hitBy(p.car.x, p.car.z, p.car.h, p.car.v, p.st.len, p.st.wid, p.car.y ?? 0)
        for (const r of remotes.values()) { if (r.wk || r.rd || nowT - r.seen > 2000) continue; const rd = kindDims(r.kind); hitBy(r.x, r.z, r.h, r.v, rd.len, rd.wid, r.yy ?? 0) }
        if (punchReq.current) {
          punchReq.current = false
          if (nowT - lastPunch > 450 && w.stun <= 0) {
            lastPunch = nowT
            let tgt: Remote | null = null, bd = 2.6
            for (const r of remotes.values()) {
              if (!r.wk || r.rd || nowT - r.seen > 2000 || r.id.endsWith('w') || Math.abs((r.yy ?? 0) - w.y) > 2) continue
              const dx = r.x - w.x, dz = r.z - w.z, d = Math.hypot(dx, dz)
              if (d > bd) continue
              let da = Math.atan2(dx, dz) - w.h; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2
              if (Math.abs(da) < 1.2) { tgt = r; bd = d }
            }
            if (tgt && ready) { void ch?.send({ type: 'broadcast', event: 'pn', payload: { to: tgt.id, dx: Math.sin(w.h), dz: Math.cos(w.h) } }).catch(() => undefined); say(`Schlag auf ${tgt.name}!`) }
            else say('Schlag ins Leere.')
            w = { ...w, ph: w.ph + 2 }
          }
        }
        if (w.hp <= 0) { footKo = 3.2; w = { ...w, stun: 3.2 }; say('Überfahren! Du stehst gleich wieder auf.') }
        else if (w.hp < hpCfg.max && w.stun <= 0 && nowT - lastRegenHit > 6000) w = { ...w, hp: Math.min(hpCfg.max, w.hp + 2 * dt) }
        foot = w
      }
      /** Geparkte/ausrollende Autos weiterrollen lassen */
      const tickParked = (dt: number) => {
        for (const p of parked) {
          if (Math.abs(p.car.v) > 0.05 || (p.car.y ?? 0) > hillHeight(p.car.x, p.car.z) + 0.3) p.car = stepCar(p.car, idleIn, dt, track, p.st, true)
          else if (p.car.v !== 0) p.car = { ...p.car, v: 0 }
        }
      }

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
        const heist = !!chase.heist, heistWin = heist && win === 'bandit' && myRole === 'bandit' && !iCaught
        for (const b of pbots) { scene.remove(b.mesh); if (b.wm) scene.remove(b.wm) }
        pbots = []
        dropBotRemotes()
        applyRole(null)
        chase = null
        setChaseUi({ over: { win, mine } })
        if (heist) {
          if (heistWin) void raceBankPay().then((r) => { if (dead) return; setChaseUi((o) => (o.over ? { ...o, over: { ...o.over, coins: r.coins } } : o)); if (r.koins !== null) walletRef.current?.setBalance(r.koins) }).catch(() => undefined)
        } else void raceChaseReward(humansOther, botsN, mine, secs).then((r) => { if (dead) return; setChaseUi((o) => (o.over ? { ...o, over: { ...o.over, coins: r.coins, capped: r.capped } } : o)); if (r.koins !== null) walletRef.current?.setBalance(r.koins) }).catch(() => undefined)
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
          if (bl.includes(online.userId)) { if (p.hz === 1) void raceBankClaim().catch(() => undefined); startChase(id, bl, cops, Number(p.bots) || 0, String(p.from), 'bandit', p.hz === 1) }
          else if (cops.includes(online.userId)) startChase(id, bl, cops, Number(p.bots) || 0, String(p.from), 'cop')
        } else if (p.t === 'cau') {
          if (chase && chase.id === id && typeof p.u === 'string') markCaught(p.u, false)
        } else if (p.t === 'end') {
          dropBotRemotes()
          if (chase && chase.id === id) finishChase(p.win === 'police' ? 'police' : 'bandit', false)
        }
      }
      heistRef.current = () => {
        const f = foot as Walker | null
        if (!f || chase) return
        if (!online) { say('Die Bank kann nur im Online-Spiel ausgeraubt werden.'); return }
        const p = poiNear(f.x, f.z, f.y)
        if (!p || p.kind !== 'bank') return
        void raceBankClaim().then(() => {
          if (dead || chase) return
          const mates = [...remotes.values()].filter((r) => r.wk && !r.rd && !r.ro && !r.id.startsWith('pb-') && !r.id.endsWith('w') && fresh(r) && Math.hypot(r.x - p.x, r.z - p.z) < 11).slice(0, 3).map((r) => r.id)
          const id = `bank-${online.userId}-${Date.now()}`
          const bandits = [online.userId, ...mates]
          const msg = { t: 'go', id, bandits, cops: [] as string[], bots: 6, from: online.userId, hz: 1 }
          for (const dl of [0, 600, 1500]) window.setTimeout(() => { if (!dead) sendCh(msg) }, dl)
          startChase(id, bandits, [], 6, online.userId, 'bandit', true)
        }).catch((e) => say(errorMessage(e)))
      }
      poiKey.current = () => {
        const f = foot as Walker | null
        const p = f ? poiNear(f.x, f.z, f.y) : null
        if (!p) return
        if (p.kind === 'bank') heistRef.current(); else setShopUi(p.kind)
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
        g.fillStyle = '#2f5a35'; g.fillRect(WORLD.x0, WORLD.z0, WORLD.x1 - WORLD.x0, WORLD.z1 - WORLD.z0)
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
        g.fillStyle = '#3b82f6'; g.fillRect(PARK.x0, PARK.z0, PARK.x1 - PARK.x0, PARK.z1 - PARK.z0)
        g.strokeStyle = '#fff'; g.lineWidth = Math.max(2, 1.5 / k); g.strokeRect(PARK.x0, PARK.z0, PARK.x1 - PARK.x0, PARK.z1 - PARK.z0)
        // Tunnel-Einfahrten (Garagen): auffällige orange Punkte mit weißem Rand und Pfeil in Fahrtrichtung nach unten
        const gr = Math.max(14, 7 / k)
        for (const ga of GARAGES) {
          g.fillStyle = '#f97316'; g.strokeStyle = '#fff'; g.lineWidth = Math.max(3, 2 / k)
          g.beginPath(); g.arc(ga.door.x, ga.door.z, gr, 0, 7); g.fill(); g.stroke()
          const dx = ga.inn.x - ga.out.x, dz = ga.inn.z - ga.out.z, dl = Math.hypot(dx, dz)
          g.strokeStyle = '#fff'; g.lineWidth = Math.max(3, 2 / k); g.beginPath()
          g.moveTo(ga.door.x - (dx / dl) * gr * 0.5, ga.door.z - (dz / dl) * gr * 0.5); g.lineTo(ga.door.x + (dx / dl) * gr * 0.5, ga.door.z + (dz / dl) * gr * 0.5); g.stroke()
        }
        g.setTransform(1, 0, 0, 1, 0, 0)
        // Punkte: innerhalb des Kreises an der Stelle, sonst klein am Rand
        const dot = (x: number, z: number, col: string, r: number) => {
          let px = sx(x, z), py = sy(x, z)
          const dx = px - cx, dy = py - cx, dl = Math.hypot(dx, dy)
          let rr = r
          if (dl > rad - 4) { px = cx + (dx / dl) * (rad - 4); py = cx + (dy / dl) * (rad - 4); rr = Math.max(2, r * 0.6) }
          g.fillStyle = '#000'; g.beginPath(); g.arc(px, py, rr + 1.2, 0, 7); g.fill(); g.fillStyle = col; g.beginPath(); g.arc(px, py, rr, 0, 7); g.fill()
        }
        for (const p of pois()) {
          let px = sx(p.x, p.z), py = sy(p.x, p.z)
          const dx = px - cx, dy = py - cx, dl = Math.hypot(dx, dy)
          if (dl > rad - 8) { px = cx + (dx / dl) * (rad - 8); py = cx + (dy / dl) * (rad - 8) }
          g.fillStyle = '#000'; g.beginPath(); g.arc(px, py, 8, 0, 7); g.fill()
          g.fillStyle = POI_COLOR[p.kind]; g.beginPath(); g.arc(px, py, 6.5, 0, 7); g.fill()
          g.fillStyle = '#0f172a'; g.font = 'bold 9px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(POI_LETTER[p.kind], px, py + 0.5)
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
        tickBlasts(dt)

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
          const bands: Array<{ id: string; x: number; z: number; lvl: number; fly: number; y?: number; wk?: boolean }> = []
          for (const bid of chase.bandits) {
            if (chase.got.has(bid)) continue
            if (bid === online.userId) { bands.push({ id: bid, x: car.x, z: car.z, lvl: car.lvl ?? 0, fly: car.fly, y: car.y, wk: !!foot }); continue }
            const br = remotes.get(bid)
            if (br && nowT - br.seen < 6000) bands.push({ id: bid, x: br.x, z: br.z, lvl: br.lv ?? 0, fly: br.fl, y: br.yy, wk: br.wk })
          }
          for (const pb of pbots) {
            if (bands.length && go) {
              let tg = bands[0]
              for (const bd of bands) if (Math.hypot(bd.x - pb.car.x, bd.z - pb.car.z) < Math.hypot(tg.x - pb.car.x, tg.z - pb.car.z)) tg = bd
              if (pb.w) {
                // Polizist zu Fuß: läuft zum Bandit (wenn der zu Fuß ist oder das Auto weg ist), sonst zurück zu seinem Auto
                const onFoot = !!tg.wk || !!pb.carGone
                const tx = onFoot ? tg.x : pb.car.x, tz = onFoot ? tg.z : pb.car.z
                const nv = walkNav({ x: pb.w.x, z: pb.w.z, y: pb.w.y }, { x: tx, z: tz, y: onFoot ? tg.y : pb.car.y }); let dh = Math.atan2(nv.x - pb.w.x, nv.z - pb.w.z) - pb.w.h; while (dh > Math.PI) dh -= Math.PI * 2; while (dh < -Math.PI) dh += Math.PI * 2
                pb.w = stepWalker(pb.w, { fwd: Math.abs(dh) < 1.3, back: false, left: dh > 0.12, right: dh < -0.12, run: true }, dt)
                if (!onFoot && Math.hypot(tx - pb.w.x, tz - pb.w.z) < 2.8) { pb.w = undefined; if (pb.wm) { scene.remove(pb.wm); pb.wm = undefined } }
                else if (onFoot && Math.hypot(tg.x - pb.w.x, tg.z - pb.w.z) < 1.8 && pb.w.stun <= 0 && Math.abs((tg.y ?? 0) - pb.w.y) < 2.5) markCaught(tg.id, true)
                if (!pb.carGone) pb.car = stepCar(pb.car, idleIn, dt, track, pb.st, true)
                continue
              }
              if (pb.carGone) continue
              if (tg.wk && pb.car.v < 14 && Math.hypot(tg.x - pb.car.x, tg.z - pb.car.z) < 26) {
                pb.w = exitFromCar({ ...pb.car, wid: pb.st.wid }, 1)
                pb.wm = rs.makeWalker('#1d4ed8', '#0f172a', pb.name); scene.add(pb.wm)
                continue
              }
              const d = copDrive(pb.car, tg, pb.mem, dt)
              if (d.reset) pb.car = { ...pb.car, x: d.reset.x, z: d.reset.z, h: d.reset.h, v: 0, steer: 0, slip: 0, dmg: 0, hold: 0, lvl: 0, y: 0 }
              if (d.repair) pb.car = { ...pb.car, dmg: 0, hold: 0 }
              // Bots fliegen hoch, wenn der Bandit höher ist, und lassen sich sinken, wenn er tiefer ist
              // Ziel im Parkhaus: außen nahe dran hochfliegen (aufs Dach), über dem Parkhaus sinken lassen und die Rampen hinunterfahren
              const botIn = inParkXZ(pb.car.x, pb.car.z, 0)
              const want = inParkXZ(tg.x, tg.z, 8) ? !botIn && inParkXZ(pb.car.x, pb.car.z, 45) : (tg.y ?? 0) > (pb.car.y ?? 0) + 2.5 && !botIn
              pb.car = stepCar(pb.car, { ...d.inp, fly: want, chase: true }, dt, track, pb.st, true)
              for (const bd of bands) if (chase && caught({ x: pb.car.x, z: pb.car.z, lvl: pb.car.lvl ?? 0, fly: 0, y: pb.car.y }, bd)) markCaught(bd.id, true)
            }
          }
          if (chase && myRole === 'cop') for (const bd of bands) if (chase && caught({ x: car.x, z: car.z, lvl: car.lvl ?? 0, fly: car.fly, y: car.y }, bd)) markCaught(bd.id, true)
          if (chase && myRole === 'bandit' && !iCaught) for (const r of remotes.values()) if (r.ro === 'c' && nowT - r.seen < 2500 && caught({ x: r.x, z: r.z, lvl: r.lv ?? 0, fly: r.fl, y: r.yy }, { x: car.x, z: car.z, lvl: car.lvl ?? 0, fly: car.fly, y: car.y })) { markCaught(online.userId, true); break }
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
        if (wreck > 0) {
          wreck -= dt
          if (wreck <= 0) respawnAfterDeath()
        } else if (!foot && !ride) {
        const nSub = Math.max(1, Math.min(240, Math.ceil(Math.abs(car.v) * dt / 1.6)))
        for (let k = 0; k < nSub; k++) {
          car = stepCar(car, chase && !chase.over ? { ...input, chase: true } : input, dt / nSub, track, myStats, go, true)
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
          for (const p of parked) {
            const c1 = crash(car, myStats, { x: p.car.x, z: p.car.z, h: p.car.h, v: p.car.v }, p.st, 0.5, 60, 1)
            if (!c1) continue
            const pre = car
            car = c1; bumped = true
            const c2 = crash(p.car, p.st, { x: pre.x, z: pre.z, h: pre.h, v: pre.v, slip: pre.slip }, myStats, 0.5, 60, 0)
            if (c2) p.car = c2
          }
          for (const r of remotes.values()) {
            if (r.wk || r.rd || now - r.seen > 3000 || r.fl > 0 || (r.lv ?? 0) !== (car.lvl ?? 0) || Math.abs((r.yy ?? 0) - (car.y ?? 0)) > 2) continue
            const age = Math.min(0.25, (now - r.seen) / 1000), rd = kindDims(r.kind)
            const sc = now - (hitAt.get(r) ?? -1e9) < 250 ? 0 : 1
            const c1 = crash(car, myStats, { x: r.x + Math.sin(r.h) * r.v * age, z: r.z + Math.cos(r.h) * r.v * age, h: r.h, v: r.v, slip: r.slip }, { len: rd.len + 0.5, wid: rd.wid + 0.4 }, 0.5, DMG_MAX, sc)
            if (c1) { car = c1; bumped = true; if (sc) hitAt.set(r, now) }
          }
        }
        if (!canDrive && go) car = { ...car, v: Math.min(car.v, 30) }
        } else if (ride) {
          tickRide()
        } else {
          tickFoot(dt, now)
          const f = foot as Walker | null
          if (f) car = { ...car, x: f.x, z: f.z, h: f.h, v: 0, steer: 0, slip: 0, y: f.y, vy: 0, fly: 0, lvl: f.lvl ?? 0, dmg: 0, hit: 0, bump: 0 }
        }
        // mein Auto überfährt Polizisten zu Fuß
        if (!foot && Math.abs(car.v) > 3) for (const pb of pbots) if (pb.w) { const r = carHit(pb.w, { x: car.x, z: car.z, h: car.h, v: car.v, len: myStats.len, wid: myStats.wid, y: car.y ?? 0 }); if (r) pb.w = r }
        tickParked(dt)

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
          if (jets) jets.visible = fly > 0 || (levelAir && lv === 0 && yy > camGround(x, z) + 1)
          const wh = m.userData.wheels as import('three').Group[] | undefined
          if (wh) for (const w of wh) { w.children.forEach((c) => { c.rotation.x += (v * dt) / (m.userData.wheelR as number) }); if (w.name === 'front') w.rotation.y = steer * 0.45 }
        }
        place(myMesh, car.x, car.z, car.h, car.v, car.steer, car.dmg, car.slip, car.fly, car.lvl ?? 0, car.y ?? 0, pitchOf(car))
        carFx(eff.kind, car.x, car.z, car.h, car.v, car.slip, car.fly, input.gas, dt, isCity && (car.lvl ?? 0) === 0 && (car.y ?? 0) > camGround(car.x, car.z) + 1 ? car.y ?? 0 : 0)
        if (myRole === 'cop') rs.tickSiren(myMesh, now)
        for (const pb of pbots) {
          if (!pb.carGone) { place(pb.mesh, pb.car.x, pb.car.z, pb.car.h, pb.car.v, pb.car.steer, pb.car.dmg, pb.car.slip, 0, pb.car.lvl ?? 0, pb.car.y ?? 0, 0); rs.tickSiren(pb.mesh, now) }
          if (pb.w && pb.wm) { pb.wm.position.set(pb.w.x, pb.w.y, pb.w.z); pb.wm.rotation.y = pb.w.h; poseWalker(pb.wm, pb.w.ph, pb.w.sp, pb.w.stun, pb.w.vy > 1) }
        }
        for (const p of parked) { place(p.mesh, p.car.x, p.car.z, p.car.h, p.car.v, 0, p.car.dmg, p.car.slip, 0, p.car.lvl ?? 0, p.car.y ?? 0, pitchOf(p.car)); if (p.siren) rs.tickSiren(p.mesh, now) }
        if (foot && footMesh) { footMesh.position.set(foot.x, foot.y, foot.z); footMesh.rotation.y = foot.h; poseWalker(footMesh, foot.ph, foot.sp, foot.stun, foot.vy > 1) }
        botList.forEach((b, i) => place(botMeshes[i], b.car.x, b.car.z, b.car.h, b.car.v, b.car.steer, b.car.dmg, b.car.slip))
        for (const b of botList) carFx(b.kind, b.car.x, b.car.z, b.car.h, b.car.v, b.car.slip, 0, b.car.v > 5, dt)
        for (const r of remotes.values()) {
          if (!r.mesh) continue
          const k = Math.min(1, dt * 10)
          r.x += (r.tx + Math.sin(r.th) * r.v * 0.05 - r.x) * k; r.z += (r.tz + Math.cos(r.th) * r.v * 0.05 - r.z) * k
          let dh = r.th - r.h; while (dh > Math.PI) dh -= Math.PI * 2; while (dh < -Math.PI) dh += Math.PI * 2
          r.h += dh * k
          r.mesh.visible = now - r.seen < (r.ro === 'b' ? 9000 : 5000) && !r.rd && (!rrRef.current || Math.hypot(r.x - car.x, r.z - car.z) < rrRef.current)
          if (r.ro === 'c' && !r.wk) rs.tickSiren(r.mesh, now)
          for (const ch of r.mesh.children) if ((ch as { isSprite?: boolean }).isSprite) ch.visible = !r.hd || r.ro === 'b'
          if (r.wk) { r.mesh.position.set(r.x, r.yy ?? 0, r.z); r.mesh.rotation.y = r.h; poseWalker(r.mesh, now / 140, r.v, 0, false) } else place(r.mesh, r.x, r.z, r.h, r.v, 0, r.dmg, r.slip, r.fl, r.lv ?? 0, r.yy ?? 0, r.pt ?? 0)
          if (online?.open && now - r.seen > 15000) { scene.remove(r.mesh); remotes.delete(r.id) }
          if (r.mesh.visible && !r.wk) carFx(r.kind, r.x, r.z, r.h, r.v, r.slip, r.fl, r.v > 5, dt, isCity && (r.lv ?? 0) === 0 && (r.yy ?? 0) > camGround(r.x, r.z) + 1 ? r.yy ?? 0 : 0)
        }

        // Kamera: Verfolger von hinten oder Cockpit (Blick aus dem Fenster)
        const sp = Math.max(0, car.v)
        const camRoll = flyRoll(car.fly)
        // im Tunnel automatisch Ego-Ansicht (Cockpit), danach wieder die gewählte Ansicht
        // Im Tunnel und im Parkhaus (unter dem Dach) automatisch Cockpit
        const inGarage = isCity && ((car.lvl ?? 0) === -1 || ((car.lvl ?? 0) === 0 && inParkXZ(car.x, car.z, 1) && (car.y ?? 0) < PARK.floorH * PARK.floors - 0.8))
        const camEff: 0 | 1 | 2 = inGarage ? 1 : camRef.current
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
          const cxx = car.x - Math.sin(camH) * back, czz = car.z - Math.cos(camH) * back
          camera.position.set(cxx, isCity ? Math.max(0.8 + camGround(cxx, czz), carY(car) - 5) : 0.8, czz)
          camera.lookAt(car.x, carY(car) + 1.3, car.z)
          if (camRoll) camera.rotateZ(-camRoll)
          camera.fov += ((68 + Math.min(14, sp * 0.15)) - camera.fov) * Math.min(1, dt * 3)
        } else {
          myMesh.visible = true
          let dh = car.h - camH; while (dh > Math.PI) dh -= Math.PI * 2; while (dh < -Math.PI) dh += Math.PI * 2
          camH += dh * Math.min(1, dt * 4.5)
          const back = Math.min(40, 9.5 + sp * 0.06), up = Math.min(12, 4.3 + sp * 0.018)
          // Kamera hängt hinten oben über dem Auto und folgt Berg, Dach und Flughöhe; nie unter dem Gelände
          const cxx = car.x - Math.sin(camH) * back, czz = car.z - Math.cos(camH) * back
          if (isCity) {
            const wantY = Math.max(carY(car) + up, camGround(cxx, czz) + 2)
            camY = camY === 0 || car.lvl === -1 ? wantY : camY + (wantY - camY) * Math.min(1, dt * 6)
            camera.position.set(cxx, Math.max(camY, camGround(cxx, czz) + 1.5), czz)
            camera.lookAt(car.x + Math.sin(camH) * 22, carY(car) + 1.4, car.z + Math.cos(camH) * 22)
          } else {
            // Rennstrecken: Kamera wie immer (fest hinter dem Auto)
            camera.position.set(cxx, up + carY(car) * 0.8, czz)
            camera.lookAt(car.x + Math.sin(camH) * 22, 1.4, car.z + Math.cos(camH) * 22)
          }
          if (bike) camera.rotateZ(Math.max(-0.7, Math.min(0.7, car.steer * Math.min(1, sp / 20) * 0.8)) * 0.5)
          if (camRoll) camera.rotateZ(-camRoll)
          camera.fov += ((62 + Math.min(18, sp * 0.22)) - camera.fov) * Math.min(1, dt * 3)
        }
        if (isCity && !foot && !ride && wreck <= 0) {
          // Leben im Auto: Schaden am Auto und Feuer kosten Leben
          const dd = car.dmg - prevDmg
          if (dd > 0) myHp -= dd * 0.9
          const burning = car.dmg / DMG_MAX > 0.85
          if (burning) { burnT += dt; myHp -= 3.5 * dt } else burnT = 0
          const sp = Math.abs(car.v)
          if (prevV > 300 / 3.6 && sp < prevV * 0.5 && car.hit > 0.3) explode('Mit über 300 km/h eingeschlagen – das war tödlich! Das Auto explodiert.')
          else if (myHp <= 0) explode('Du hast den Unfall nicht überlebt – das Auto explodiert.')
          else if (dd > 40) explode('Schwerer Aufprall – das Auto explodiert!')
          else if (burning && burnT > 7) explode('Das brennende Auto ist explodiert!')
          prevV = sp; prevDmg = car.dmg
        }
        if (!foot) rs.showInterior(null)
        if (ride) myMesh.visible = false
        if (foot) {
          // zu Fuß: Kamera dicht hinter der Figur
          myMesh.visible = false
          const fx0 = foot.x - Math.sin(camH) * 4.4, fz0 = foot.z - Math.cos(camH) * 4.4
          const inB = buildingAt(foot.x, foot.z)
          rs.showInterior(inB)
          if (inB) {
            // im Haus: Kamera bleibt zwischen den Außenwänden und unter der Decke
            const fl = Math.max(0, Math.min(Math.floor((foot.y + 0.5) / FLOOR_H), Math.floor(inB.h / FLOOR_H) - 1))
            const cx = Math.max(inB.x - inB.w / 2 + 0.9, Math.min(inB.x + inB.w / 2 - 0.9, fx0)), cz = Math.max(inB.z - inB.d / 2 + 0.9, Math.min(inB.z + inB.d / 2 - 0.9, fz0))
            camera.position.set(cx, Math.min(foot.y + 2.3, fl * FLOOR_H + FLOOR_H - 0.5), cz)
          } else if (inParkXZ(foot.x, foot.z, 1.5) && foot.y < PARK_TOP) {
            // Parkhaus: Kamera nah dran, unter der Decke und zwischen den Wänden
            let ceil = Infinity
            for (const h of parkSurfaces(foot.x, foot.z)) if (h > foot.y + 1 && h < ceil) ceil = h
            const bx = Math.max(PARK.x0 + 0.8, Math.min(PARK.x1 - 0.8, foot.x - Math.sin(camH) * 2.6)), bz = Math.max(PARK.z0 + 0.8, Math.min(PARK.z1 - 0.8, foot.z - Math.cos(camH) * 2.6))
            camera.position.set(bx, Math.max(foot.y + 0.9, Math.min(foot.y + 1.9, ceil - 0.45)), bz)
          } else if ((foot.lvl ?? 0) === -1) {
            const bx = foot.x - Math.sin(camH) * 2.6, bz = foot.z - Math.cos(camH) * 2.6
            const c = tunnelClamp(bx, bz)
            camera.position.set(c ? c.x : bx, foot.y + 1.9, c ? c.z : bz)
          } else {
            const gh = camGround(fx0, fz0)
            camera.position.set(fx0, foot.y < gh - 0.5 ? foot.y + 2.3 : Math.max(foot.y + 2.3, gh + 1.4), fz0)
          }
          camera.up.set(0, 1, 0)
          camera.lookAt(foot.x, foot.y + 1.3, foot.z)
          camera.fov += (66 - camera.fov) * Math.min(1, dt * 4)
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
        { const rr = rrRef.current, far = rr ? rr + 60 : 4000; if (camera.far !== far) { camera.far = far; camera.updateProjectionMatrix(); const fg = scene.fog as { near: number; far: number } | null; if (fg) { fg.far = rr ? rr : (isCity ? 2300 : 1100); fg.near = rr ? rr * 0.45 : 200 } renderer.setPixelRatio(rr ? 1 : Math.min(window.devicePixelRatio, 2)); resize() } }
        renderer.render(scene, camera)

        if (online && now - lastSend > 55) {
          lastSend = now
          send({ u: online.userId, x: car.x, z: car.z, h: car.h, v: foot ? foot.sp : car.v, wk: foot ? 1 : 0, wc: wcRef.current, ex: exN, rd: ride ?? '', t: car.total, k: eff.kind, c: eff.color, ro: myRole === 'bandit' ? 'b' : myRole === 'cop' ? 'c' : '', f: finishedMs, d: Math.round(car.dmg), sl: Math.round(car.slip * 100) / 100, fl: Math.round(car.fly * 100) / 100, lv: car.lvl ?? 0, y: Math.round((car.y ?? 0) * 10) / 10, pt: Math.round(pitchOf(car) * 100) / 100, n: online.name ?? me.name, hd: hiddenNow ? 1 : 0, ce: endInfo && now < endInfo.until ? endInfo.id : '', cw: endInfo?.win ?? '' })
          if (now - lastPark > 900) { lastPark = now; parked.forEach((p) => send({ u: pkId(p), x: p.car.x, z: p.car.z, h: p.car.h, v: p.car.v, t: 0, k: p.kind, c: p.color, ro: '', f: null, d: Math.round(p.car.dmg), sl: 0, fl: 0, lv: p.car.lvl ?? 0, y: Math.round((p.car.y ?? 0) * 10) / 10, pt: 0, n: 'Geparkt', hd: 0 })) }
          for (const pb of pbots) if (pb.w) send({ u: `${pb.id}w`, x: pb.w.x, z: pb.w.z, h: pb.w.h, v: pb.w.sp, wk: 1, t: 0, k: 'kleinwagen', c: '#1d4ed8', ro: 'c', f: null, d: 0, sl: 0, fl: 0, lv: 0, y: Math.round(pb.w.y * 10) / 10, pt: 0, n: pb.name, hd: 0 })
          for (const pb of pbots) if (!pb.carGone) send({ u: pb.id, x: pb.car.x, z: pb.car.z, h: pb.car.h, v: pb.car.v, t: 0, k: pb.kind, c: pb.color, ro: 'c', f: null, d: 0, sl: Math.round(pb.car.slip * 100) / 100, fl: 0, lv: pb.car.lvl ?? 0, y: Math.round((pb.car.y ?? 0) * 10) / 10, pt: 0, n: pb.name, hd: 0 })
        }
        if (now - lastHud > 110) {
          lastHud = now
          const pr = project(track, car.x, car.z, car.idx)
          const dot = Math.sin(car.h) * track.tx[pr.i] + Math.cos(car.h) * track.tz[pr.i]
          const ca = curveAhead(track, pr.i, 110)
          const count = go ? 0 : Math.ceil((startAt - now) / 1000)
          setHud({ alt: isCity ? Math.round(car.y ?? 0) : 0, speed: Math.round(Math.abs(car.v) * 3.6), lap: Math.min(laps, Math.max(1, lapNow + 1)), pos: rankNow(), of: 1 + botList.length + remotes.size, ms: finishedMs ?? raceMs, count, wrong: !isFree && dot < -0.3 && car.v > 4, curve: !isFree && Math.abs(ca.k) > 0.004 ? Math.sign(ca.k) : 0, curveDist: Math.round(ca.dist / 10) * 10, offroad: car.offroad, best: bestLap, dmg: Math.round(car.dmg), drift: Math.abs(car.slip) > 0.2 && car.v > 10, dp: dTotal, dc: Math.round(dCombo), db: Math.round(dBest), fly: Math.round(car.fly * 10) / 10, cool: Math.ceil(car.cool) })
          if (chaseOn) {
            const list = [...remotes.values()].filter((r) => !r.id.startsWith('pb-') && !r.id.startsWith('pk-') && now - r.seen < 4000).map((r) => ({ id: r.id, name: r.name }))
            const key = list.map((x) => x.id + x.name).join('|')
            if (key !== peersKey) { peersKey = key; setPeers(list) }
          }
          setInBush((o) => { const v = isCity && inPark(car.x, car.z); return o === v ? o : v })
          setRep((o) => { const hold = Math.ceil(car.hold ?? 0), cd = Math.max(0, Math.ceil((lastRepair + REPAIR_CD_MS - now) / 1000)); return o.hold === hold && o.cd === cd ? o : { hold, cd } })
          if (isCity) {
            const f = foot as Walker | null
            const near = !!f && footKo <= 0 && !!nearestCar(f, [...parked.map((p) => ({ x: p.car.x, z: p.car.z })), ...pbots.filter((pb) => pb.w && !pb.carGone).map((pb) => ({ x: pb.car.x, z: pb.car.z })), ...[...remotes.values()].filter((r) => !r.wk && !r.rd && !r.id.startsWith('pb-') && fresh(r)).map((r) => ({ x: r.x, z: r.z }))], 5.5)
            const seat = f ? '' : `${ride ? occupants(ride) : occupants(online?.userId ?? '')}/${seatConfig.n}`
            const msg = performance.now() < footMsgT ? footMsg : ''
            const hp = Math.round(f ? f.hp : Math.max(0, myHp))
            const pn = f && footKo <= 0 ? poiNear(f.x, f.z, f.y) : null
            setPoiUi((o) => (o?.name === pn?.name ? o : pn ? { kind: pn.kind, name: pn.name } : null))
            if (pn?.kind === 'bank' && now - lastBankPoll > 4000) { lastBankPoll = now; void raceBankStatus().then((w) => { if (!dead) setBankWait(w) }).catch(() => undefined) }
            setFootUi((o) => (o.on === !!f && o.hp === hp && o.near === near && o.ko === footKo > 0 && o.n === parked.length && o.msg === msg && o.seat === seat && o.ride === !!ride ? o : { on: !!f, hp, near, ko: footKo > 0, n: parked.length, msg, seat, ride: !!ride }))
          }
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
        {flyer && def.mode === 'city' && <p className={`text-xs font-bold ${hud.alt > 1 ? 'text-cyan-300' : 'text-emerald-300'}`}>{hud.alt > 1 ? `Höhe ${hud.alt} m` : 'Fliegen: Taste halten (E)'}</p>}
        {flyer && def.mode !== 'city' && <p className={`text-xs font-bold ${hud.fly > 0 ? 'text-cyan-300' : hud.cool > 0 ? 'text-slate-300' : 'text-emerald-300'}`}>{hud.fly > 0 ? `FLUG ${hud.fly.toFixed(1)} s` : hud.cool > 0 ? `Laden ${hud.cool} s` : 'Flug bereit (E)'}</p>}
      </div>
      {hud.dmg >= 100 && <p className="pointer-events-none absolute top-14 left-1/2 -translate-x-1/2 rounded-lg bg-rose-700 px-3 py-1 text-sm font-bold text-white">Totalschaden! R = Werkstatt (3 s Pause)</p>}
      {hud.curve !== 0 && hud.count === 0 && (
        <div className={`pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-amber-400/90 px-4 py-1 text-sm font-bold text-slate-900`} role="status">
          {hud.curve < 0 ? '◀◀ Linkskurve' : 'Rechtskurve ▶▶'} · {hud.curveDist} m
        </div>
      )}
      {(footUi.on || footUi.hp < perksUi.hearts) && (
        <div className="pointer-events-none absolute bottom-40 left-1/2 w-56 -translate-x-1/2 text-center text-xs text-white">
          <div className="h-3 overflow-hidden rounded-full bg-black/55"><div className={`h-full ${footUi.hp > perksUi.hearts / 2 ? 'bg-emerald-500' : footUi.hp > perksUi.hearts / 4 ? 'bg-amber-400' : 'bg-rose-500'}`} style={{ width: `${Math.min(100, (footUi.hp / perksUi.hearts) * 100)}%` }} /></div>
          <p className="mt-0.5 [text-shadow:0_1px_4px_#000]">❤ {footUi.hp}{footUi.on ? ' · Laufen: WASD · Rennen: Shift · Springen: Leertaste · Einsteigen: X' : ''}</p>
        </div>
      )}
      {def.mode === 'city' && !footUi.on && footUi.seat && <div className="pointer-events-none absolute left-1/2 top-12 -translate-x-1/2 rounded-full bg-black/55 px-3 py-0.5 text-xs font-bold text-white" role="status">{footUi.ride ? 'Mitfahrer' : 'Fahrer'} · 👥 {footUi.seat}</div>}
      {poiUi && footUi.on && !shopUi && (
        <button type="button" onClick={() => poiKey.current()} disabled={poiUi.kind === 'bank' && bankWait > 0} className="absolute bottom-52 left-1/2 z-20 min-h-[48px] -translate-x-1/2 rounded-xl border border-white/40 px-4 text-sm font-bold text-slate-950 disabled:opacity-60" style={{ background: POI_COLOR[poiUi.kind] }}>
          {poiUi.kind === 'bank' ? (bankWait > 0 ? `Bank ruht noch ${Math.ceil(bankWait / 60)} Min` : 'AUSRAUBEN (G) – 6 Min Polizeijagd') : poiUi.kind === 'shop' ? 'Shop betreten (G): Vokabeln lernen' : 'Fitnessstudio (G): Vokabeln lernen'}
        </button>
      )}
      {shopUi && <VocabShop kind={shopUi} perks={perksUi} onPerks={applyPerks} onClose={() => setShopUi(null)} />}
      {pick && (
        <div className="absolute left-3 top-16 z-20 max-h-64 w-52 overflow-auto rounded-xl bg-slate-900/95 p-2 text-sm text-white" role="menu" aria-label="Auto zum Spawnen wählen">
          <p className="px-1 pb-1 text-xs text-slate-300">Welches Auto spawnen? (Schnellstes = 1, auch N dann Ziffer)</p>
          {bestFirst(rcars.cars).map((c, i) => <button key={c.id} type="button" role="menuitem" onClick={() => spawnRef.current(c)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-white/15"><span className="h-3 w-3 shrink-0 rounded-full border border-white/40" style={{ background: c.color }} />{i < 9 ? `${i + 1}. ` : ''}{c.name}</button>)}
        </div>
      )}
      {footUi.ko && <p className="pointer-events-none absolute inset-0 grid place-items-center text-3xl font-black text-rose-300 [text-shadow:0_3px_12px_#000]">Überfahren!</p>}
      {footUi.msg && <p className="pointer-events-none absolute top-24 left-1/2 -translate-x-1/2 rounded-lg bg-black/60 px-3 py-1 text-sm text-white">{footUi.msg}</p>}
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
            {def.mode === 'city' && <label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={supFly} onChange={(e) => applySupFly(e.target.checked)} /> In der Stadt fliegen erlauben</label>}
            <p className="mb-1 mt-2 flex justify-between"><span>Beschleunigung</span><b className="tabular-nums">×{accMul.toLocaleString('de-DE')}</b></p>
            <div className="flex gap-1" role="group" aria-label="Beschleunigung">
              {[0.25, 0.5, 1, 2, 5, 20].map((m) => <button key={m} type="button" onClick={() => applyAcc(m)} aria-pressed={accMul === m} className={`flex-1 rounded py-1 ${accMul === m ? 'bg-cyan-500 font-bold text-slate-950' : 'bg-white/15'}`}>{m.toLocaleString('de-DE')}</button>)}
            </div>
            {def.mode === 'city' && (
              <>
                <p className="mb-1 mt-2 flex justify-between"><span>Joystick-Drehung</span><b className="tabular-nums">×{joyTurn.toLocaleString('de-DE')}</b></p>
                <div className="flex gap-1" role="group" aria-label="Joystick-Drehempfindlichkeit">
                  {[0.2, 0.35, 0.5, 0.75, 1].map((m) => <button key={m} type="button" onClick={() => applyJoyTurn(m)} aria-pressed={joyTurn === m} className={`flex-1 rounded py-1 ${joyTurn === m ? 'bg-cyan-500 font-bold text-slate-950' : 'bg-white/15'}`}>{m.toLocaleString('de-DE')}</button>)}
                </div>
                <p className="mb-1 mt-2 flex items-center justify-between"><span>Farbe der Figur</span>
                  <span className="flex items-center gap-1"><input type="color" aria-label="Figurenfarbe" value={wcUi || '#94a3b8'} onChange={(e) => applyWc(e.target.value)} className="h-6 w-10 rounded" />
                    <button type="button" onClick={() => applyWc('')} className="rounded bg-white/15 px-2 py-1">Auto</button></span></p>
                <p className="mb-1 mt-2 flex justify-between"><span>Nur im Umkreis rendern</span><b className="tabular-nums">{rrUi ? `${rrUi} m` : 'aus'}</b></p>
                <div className="flex gap-1" role="group" aria-label="Render-Umkreis">
                  {[0, 250, 500, 900].map((m) => <button key={m} type="button" onClick={() => applyRr(m)} aria-pressed={rrUi === m} className={`flex-1 rounded py-1 ${rrUi === m ? 'bg-cyan-500 font-bold text-slate-950' : 'bg-white/15'}`}>{m === 0 ? 'Aus' : m}</button>)}
                </div>
              </>
            )}
          </div>
        )}
        {def.mode === 'city' && (
          <>
            <button type="button" onClick={() => exitRef.current()} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${footUi.on ? (footUi.near ? 'bg-emerald-500 text-slate-950' : 'bg-black/45 text-white') : 'bg-black/45 text-white'}`}>{footUi.on ? 'Einsteigen (X)' : 'Aussteigen (X)'}</button>
            <button type="button" onClick={() => spawnRef.current()} className="rounded-lg bg-black/45 px-3 py-1.5 text-xs font-bold text-white">Auto spawnen (N){footUi.n > 0 ? ` · ${footUi.n}` : ''}</button>
          </>
        )}
        {cityOpen && !chaseUi.active && <button type="button" onClick={() => setPanel((o) => !o)} aria-pressed={panel} className="rounded-lg bg-blue-600/80 px-3 py-1.5 text-xs font-bold text-white">🚓 Polizeijagd</button>}
        {def.mode === 'city' && (
          <button type="button" onClick={() => toggleHide.current()} aria-pressed={hidden || inBush} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${hidden || inBush ? 'bg-violet-500 text-white' : 'bg-black/45 text-white'}`}>{inBush ? 'Im Gebüsch: Name versteckt' : hidden ? 'Name versteckt – zeigen (H)' : 'Namen verstecken (H)'}</button>
        )}
        {assistOk && <button type="button" onClick={toggleAssist} aria-pressed={assist} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${assist ? 'bg-emerald-500 text-slate-950' : 'bg-black/45 text-white'}`}>Fahrassistent {assist ? 'AN' : 'aus'} (F)</button>}
      </div>
      {cityOpen && online && <ChasePanel ui={chaseUi} peers={peers} open={panel} onClose={() => setPanel(false)} api={{ invite: (a, b, c) => chaseApi.current.invite(a, b, c), start: () => chaseApi.current.start(), cancel: () => chaseApi.current.cancel(), answer: (ok) => chaseApi.current.answer(ok) }} meName={online.name ?? me.name} myId={online.userId} />}
      {/* Bedienung: links Lenken, rechts Gas und Bremse */}
      {footUi.on ? (
        <div ref={joyBase} aria-label="Steuerknüppel" role="group" className="absolute bottom-4 left-4 h-36 w-36 touch-none select-none rounded-full border border-white/30 bg-black/40 backdrop-blur"
          onPointerDown={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); joyMove(e) }}
          onPointerMove={(e) => { if (e.buttons || e.pointerType === 'touch') joyMove(e) }}
          onPointerUp={joyEnd} onPointerCancel={joyEnd} onLostPointerCapture={joyEnd} onContextMenu={(e) => e.preventDefault()}>
          <div className="pointer-events-none absolute h-14 w-14 rounded-full bg-white/60 shadow" style={{ left: `calc(50% - 28px + ${knob.x * 40}px)`, top: `calc(50% - 28px - ${knob.y * 40}px)` }} />
        </div>
      ) : (
        <div className="absolute bottom-3 left-3 flex gap-3">
          <button type="button" aria-label="Nach links" {...hold('left')} className={`${btn} h-24 w-24 text-4xl`}>◀</button>
          <button type="button" aria-label="Nach rechts" {...hold('right')} className={`${btn} h-24 w-24 text-4xl`}>▶</button>
        </div>
      )}
      <div className="absolute bottom-3 right-3 flex items-end gap-3">
        {footUi.on ? (
          <>
            <button type="button" aria-label="Rennen" {...hold('fly')} className={`${btn} h-20 w-24 text-base !bg-cyan-600/60`}>RENNEN</button>
            <button type="button" aria-label="Schlagen" onPointerDown={() => { punchReq.current = true }} className={`${btn} h-20 w-20 text-base !bg-rose-600/65`}>SCHLAG</button>
            <button type="button" aria-label="Springen" {...hold('jump')} className={`${btn} h-28 w-28 text-lg !bg-emerald-600/65`}>SPRINGEN</button>
          </>
        ) : (
          <>
            {flyer && <button type="button" aria-label="Fliegen" {...hold('fly')} className={`${btn} h-20 w-24 text-base !bg-cyan-600/60`}>FLIEGEN</button>}
            <button type="button" aria-label="Bremse" {...hold('brake')} className={`${btn} h-20 w-24 text-base !bg-rose-600/60`}>BREMSE</button>
            <button type="button" aria-label="Gas" {...hold('gas')} className={`${btn} h-28 w-28 text-xl !bg-emerald-600/65`}>GAS</button>
          </>
        )}
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
