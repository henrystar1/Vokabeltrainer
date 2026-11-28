import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import { gameClientFor, gameDbsLoaded, onGameDbsChange, slotForKey, whenGameDbsReady } from '../../../lib/gameRealtime'
import { DMG_MAX, botInput, crash, packLimit, startCar, statsFor, stepCar, type Bot, type Car, type CarStats, type Input } from './physics'
import { TRACKS, buildTrack, curveAhead, isOpen, pointAt, project, trackKey, type TrackDef } from './track'
import { assistSteer, buildRaceLine } from './line'
import { createFx } from './fx'
import { canFly, carKmh, flyHeight, flyRoll, isArmored, isBike, kindDims, seatsOf, toughOf } from '../stats'
import { useRaceCars, type RaceCarOption } from './useRaceCars'
import { PARK, PARK_TOP, parkSurfaces, inParkXZ } from './parkhaus'
import { ARMY, BRIDGES, CITY, FIRE, GARAGES, HOSPITAL, POLICE, TUNNELS, bridgeAt, bridgeH, city, inPark, roofH, tunnelClamp, tunnelD } from './city'
import { MOUNTAINS, WORLD, hillH, hillSlope, outRoads } from './mountains'
import { CHASE_MAX_MS, chaseCar, clearLine, copDrive, type BotMem, type Role } from './chase'
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

interface Remote { gr?: number; id: string; name: string; kind: string; color: string; x: number; z: number; h: number; v: number; tx: number; tz: number; th: number; total: number; ft: number | null; seen: number; dmg: number; slip: number; fl: number; lv?: number; yy?: number; pt?: number; hd?: boolean; wk?: boolean; wc?: string; ex?: number; pc?: number; pcAt?: number; rd?: string; ro?: 'b' | 'c'; bt?: boolean; dn?: boolean; dc?: string; od?: string; mesh?: import('three').Group }

import { buildingAt, layoutOf, walkNav } from './interior'
import { raceAtmPay, raceDutyPay, raceGearList, raceRevivePay } from '../../../services/cars'
import WeaponShop from './WeaponShop'
import { stepHeli } from './heli'
import { addGear, gearFromList, gearMask, NO_GEAR, type GearSet } from './gear'
import { streetRoute } from './route'
import { makeSafeNav } from './walkSafe'
import { currentFire, douse, flameLevel, parkSpot, type FireInfo } from './fire'
import { setFireLadder } from './scene'
import { shotBlocked, shotWallT } from './shoot'
import { suitReady } from './ironSuit'
import { seatWalker, setQuadWeapon } from './quad'
import { BUNKER, DEFAULT_LOADOUT, HATCH_MS, LIFT_MS, bunkerSpotNear, inBunkerHall, liftY, parseLoadout, type KskLoadout } from './bunker'
import { buildBunker } from './bunkerMesh'
import { DronePanel, QuadTunePanel, type DroneData } from './BunkerPanel'
import { raceKskGet, raceHouseBuy, raceHouseList, raceHouseSave, raceKskMissionPay } from '../../../services/cars'
import { HOUSE_PRICE, MAX_GARAGE, wallColors, garageDoor, garageOut, houseById, houseEligible, houseId, parseHouses, wallCams, type Furn, type HouseData, type StoredCar, type WallCam } from './house'
import { makeHouseWorld, makeWallCamMeshes } from './houseMesh'
import { nightness } from './daynight'
import { FurnitureEditor, GaragePanel, MissionPanel, PlaneMapPanel } from './HousePanels'
import type { Bld } from './city'
import { armUp } from './gunMesh'
import { HP_MAX, footConfig, groundAt, hpCfg, carHit, exitFromCar, nearestCar, newWalker, stepWalker, type Walker } from './foot'
import { stepIron } from './ironman'
import { poseWalker } from './walkerMesh'
import { addBaton, makeMedic, makeSwatMan } from './swatMan'
import { POI_COLOR, POI_LETTER, hospitalBed, pois, spotNear, type SpotKind } from './poi'
import VocabShop from './VocabShop'
import { racePerkInfo, raceBankClaim, raceBankPay, raceBankStatus, type RacePerks } from '../../../services/cars'
import { useAuthOptional } from '../../auth/AuthProvider'
import { usePlusOptional } from '../../plus/PlusProvider'
import { cityPush } from './city'
import LangToggle from '../LangToggle'
import { errorMessage } from '../../../lib/errors'
import { hillH as hillHeight } from './mountains'

const COUNT_MS = 4500
/** Offene Felder: Wartezeit zwischen zwei Reparaturen (ohne Totalschaden) */
const REPAIR_CD_MS = 12000
const lsGet = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d } catch { return d } }
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* ignorieren */ } }
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
  const heliDown = useRef(false)
  const ironRef = useRef<() => void>(() => undefined)
  const bombRef = useRef<(x: number, z: number) => void>(() => undefined)
  const mapPos = useRef<{ x: number; z: number; h: number }>({ x: 0, z: 0, h: 0 })
  const rocketRef = useRef<() => void>(() => undefined)
  const egoRef = useRef<() => void>(() => undefined)
  const [egoUi, setEgoUi] = useState(false)
  type WheelInfo = { list: { id: string; icon: string; name: string }[]; cur: string }
  const [wheelUi, setWheelUi] = useState<WheelInfo | null>(null)
  const weaponInfoRef = useRef<() => WheelInfo>(() => ({ list: [], cur: '' }))
  const weaponPickRef = useRef<(id: string) => void>(() => undefined)
  const [heliUi, setHeliUi] = useState(false)
  const ironKeyRef = useRef<() => boolean>(() => false)
  const [ironUi, setIronUi] = useState(false)
  const [ironOk, setIronOk] = useState(false)
  const ironGrantRef = useRef(false)
  const [grantUi, setGrantUi] = useState<{ id: string; name: string; on: boolean; k?: boolean } | null>(null)
  const ironGiveRef = useRef<(id: string) => void>(() => undefined)
  const ironOffRef = useRef<() => void>(() => undefined)
  const kskRef = useRef<() => void>(() => undefined)
  const kskOffRef = useRef<() => void>(() => undefined)
  const kskGiveRef = useRef<(id: string) => void>(() => undefined)
  const quadCallRef = useRef<() => void>(() => undefined)
  const kskGrantRef = useRef(false)
  const [kskOk, setKskOk] = useState(false)
  const [kskUi, setKskUi] = useState(false)
  const [bunkerUi, setBunkerUi] = useState<'tune' | 'drone' | 'mission' | 'plane' | null>(null)
  const [acts, setActs] = useState<Array<{ k: string; label: string }>>([])
  const [furnUi, setFurnUi] = useState<{ b: Bld; furn: Furn[]; wall: string | null } | null>(null)
  const [garageUi, setGarageUi] = useState<StoredCar[] | null>(null)
  const [missionTxt, setMissionTxt] = useState('')
  const [camUi, setCamUi] = useState<{ n: number; i: number; who: string } | null>(null)
  /** Sammel-Schnittstelle React → Spielschleife (Häuser, Garage, Aufträge, Flugzeug, Kameras) */
  const xRef = useRef<(cmd: string, a?: unknown) => void>(() => undefined)
  const [loadout, setLoadout] = useState<KskLoadout>(DEFAULT_LOADOUT)
  const loadoutRef = useRef<KskLoadout>(DEFAULT_LOADOUT)
  const bunkerQuadRef = useRef<(l: KskLoadout) => void>(() => undefined)
  const droneRef = useRef<() => DroneData>(() => ({ me: { x: 0, z: 0, h: 0 }, players: [] }))
  const applyLoadout = useCallback((l: KskLoadout) => { loadoutRef.current = l; setLoadout(l); bunkerQuadRef.current(l) }, [])
  const ironTpRef = useRef<() => void>(() => undefined)
  const gearRef = useRef<GearSet>(NO_GEAR)
  const [gearUi, setGearUi] = useState<GearSet>(NO_GEAR)
  const batonRef = useRef((() => { try { return localStorage.getItem('vt-baton') === '1' } catch { return false } })())
  const applyGear = useCallback((g: GearSet) => { gearRef.current = g; setGearUi(g); if (g.baton) batonRef.current = true }, [])
  const [perksUi, setPerksUi] = useState<RacePerks>({ spawn_max: 2, spawn_sec: 0, speed_sec: 0, jump_sec: 0, armor_sec: 0, hearts: 100, shop: 0, gym: 0 })
  const isAdmin = !!useAuthOptional()?.isAdmin
  const adminRef = useRef(isAdmin)
  adminRef.current = isAdmin
  /** Spawn-Limit (2, oder 5 nach Lernen im Shop) und Ablaufzeit */
  const perkRef = useRef({ until: 0, speed: 0, jump: 0, armor: 0, hearts: 100 })
  const applyPerks = (p: RacePerks) => { const t = Date.now(); perkRef.current = { until: p.spawn_sec > 0 ? t + p.spawn_sec * 1000 : 0, speed: p.speed_sec > 0 ? t + p.speed_sec * 1000 : 0, jump: p.jump_sec > 0 ? t + p.jump_sec * 1000 : 0, armor: p.armor_sec > 0 ? t + p.armor_sec * 1000 : 0, hearts: p.hearts }; hpCfg.max = p.hearts; setPerksUi(p) }
  const [shopUi, setShopUi] = useState<'shop' | 'gym' | 'weapons' | null>(null)
  const [dutyUi, setDutyUi] = useState<'' | 'p' | 'm' | 'f'>('')
  const [starsUi, setStarsUi] = useState(0)
  const [sniperUi, setSniperUi] = useState(false)
  const zoomKey = useRef(false)
  const [reviveUi, setReviveUi] = useState<{ mine: boolean; sec: number; other: { id: string; name: string } | null; busy: boolean }>({ mine: false, sec: 0, other: null, busy: false })
  const [poiUi, setPoiUi] = useState<{ kind: SpotKind | 'bunker'; label: string } | null>(null)
  const healRef = useRef(false)
  /** Minecraft-Skin (nur Pro/Admin): PNG-Daten-URL im Browser gespeichert, an andere gesendet */
  const pro = !!usePlusOptional()?.pro
  const skinAllowed = pro || isAdmin
  const skinRef = useRef(lsGet('vt-race-skin', ''))
  const [skinUi, setSkinUi] = useState(skinRef.current)
  const skinOkRef = useRef(false)
  skinOkRef.current = skinAllowed
  const skinNow = () => (skinOkRef.current && skinRef.current.startsWith('data:image/png;base64,') ? skinRef.current : '')
  const applySkin = (d: string) => { skinRef.current = d; setSkinUi(d); lsSet('vt-race-skin', d); remakeFoot.current(); skinSend.current() }
  const skinSend = useRef<() => void>(() => undefined)
  const [skinErr, setSkinErr] = useState<string | null>(null)
  const pickSkin = (file: File | undefined) => {
    setSkinErr(null)
    if (!file) return
    if (file.size > 30000) { setSkinErr('Die Datei ist zu groß für einen Skin.'); return }
    const rd = new FileReader()
    rd.onload = () => {
      const url = String(rd.result)
      if (!url.startsWith('data:image/png;base64,')) { setSkinErr('Bitte eine PNG-Datei wählen.'); return }
      const img = new Image()
      img.onload = () => { if (img.naturalWidth !== 64 || (img.naturalHeight !== 64 && img.naturalHeight !== 32)) setSkinErr('Ein Minecraft-Skin ist 64×64 (oder 64×32) Pixel groß.'); else applySkin(url) }
      img.onerror = () => setSkinErr('Das Bild konnte nicht gelesen werden.')
      img.src = url
    }
    rd.readAsDataURL(file)
  }
  const rootEl = useRef<HTMLDivElement>(null)
  const [full, setFull] = useState(false)
  /** Vollbild: echtes Vollbild des Browsers, sonst (z. B. iPhone) die ganze Seite füllen */
  const toggleFull = () => {
    const el = rootEl.current as (HTMLDivElement & { webkitRequestFullscreen?: () => Promise<void> }) | null
    const doc = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => Promise<void> }
    if (full) { if (doc.fullscreenElement || doc.webkitFullscreenElement) void (doc.exitFullscreen?.() ?? doc.webkitExitFullscreen?.())?.catch?.(() => undefined); setFull(false); return }
    setFull(true)
    try { void (el?.requestFullscreen?.() ?? el?.webkitRequestFullscreen?.())?.catch?.(() => undefined) } catch { /* nur Seitenfüllung */ }
  }
  useEffect(() => {
    const onFs = () => { const d = document as Document & { webkitFullscreenElement?: Element }; if (!d.fullscreenElement && !d.webkitFullscreenElement) setFull((o) => (o ? false : o)) }
    document.addEventListener('fullscreenchange', onFs); document.addEventListener('webkitfullscreenchange', onFs)
    return () => { document.removeEventListener('fullscreenchange', onFs); document.removeEventListener('webkitfullscreenchange', onFs) }
  }, [])
  const [bankWait, setBankWait] = useState(0)
  const heistRef = useRef<() => void>(() => undefined)
  const crimeRef = useRef<(what: 'armory' | 'steal') => void>(() => undefined)
  const dutyRef = useRef<'' | 'p' | 'm' | 'f'>('')
  const reviveRef = useRef<() => void>(() => undefined)
  const reviveOtherRef = useRef<(id: string) => void>(() => undefined)
  const poiKey = useRef<() => void>(() => undefined)
  useEffect(() => {
    if (def.mode !== 'city' || !online) return
    racePerkInfo().then(applyPerks).catch(() => undefined)
    return () => { hpCfg.max = 100 }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const joyRef = useRef({ x: 0, y: 0 })
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
  useEffect(() => { void raceGearList().then((l) => applyGear(gearFromList(l))).catch(() => undefined) }, [applyGear])
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
      interface Blast { t: number; ball: import('three').Mesh; ring: import('three').Mesh; light: import('three').PointLight | null; debris: Array<{ m: import('three').Mesh; vx: number; vy: number; vz: number; rx: number; rz: number }> }
      const blasts: Blast[] = []
      // Geteilte Geometrie/Material und feste Lichter: neue Lichter oder Geometrien pro Explosion ließen bei Raketen-Salven den WebGL-Kontext abstürzen (weißer Bildschirm)
      const blGeo = { ball: new THREE.SphereGeometry(1, 12, 8), ring: new THREE.RingGeometry(0.8, 1, 24), box: new THREE.BoxGeometry(1, 1, 1) }
      const blDebrisMat = new THREE.MeshBasicMaterial({ color: '#2b2b2b' })
      const blLights: Array<{ l: import('three').PointLight; used: boolean }> = [0, 1].map(() => { const l = new THREE.PointLight('#ff7a1a', 0, 90); l.visible = true; rs.scene.add(l); return { l, used: false } })
      cleanups.push(() => { for (const o of blLights) rs.scene.remove(o.l); blGeo.ball.dispose(); blGeo.ring.dispose(); blGeo.box.dispose(); blDebrisMat.dispose() })
      const dropBlast = (b: Blast) => {
        rs.scene.remove(b.ball, b.ring); for (const d of b.debris) rs.scene.remove(d.m)
        ;(b.ball.material as import('three').Material).dispose(); (b.ring.material as import('three').Material).dispose()
        if (b.light) { b.light.intensity = 0; const o = blLights.find((q) => q.l === b.light); if (o) o.used = false }
      }
      const blastAt = (x: number, y: number, z: number, color = '#ff7a1a') => {
        while (blasts.length >= 6) { const o = blasts.shift(); if (o) dropBlast(o) }
        const ball = new THREE.Mesh(blGeo.ball, new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.95, depthWrite: false }))
        ball.position.set(x, y, z)
        const ring = new THREE.Mesh(blGeo.ring, new THREE.MeshBasicMaterial({ color: '#fff3d6', transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }))
        ring.rotation.x = -Math.PI / 2; ring.position.set(x, y - 0.6, z)
        const slot = blLights.find((q) => !q.used)
        let light: import('three').PointLight | null = null
        if (slot) { slot.used = true; light = slot.l; light.color.set(color); light.position.set(x, y + 1, z); light.intensity = 60 }
        const debris: Blast['debris'] = []
        for (let i = 0; i < 8; i++) {
          const m = new THREE.Mesh(blGeo.box, blDebrisMat)
          m.scale.set(0.3 + Math.random() * 0.7, 0.15 + Math.random() * 0.3, 0.3 + Math.random() * 0.6)
          m.position.set(x, y, z)
          const a = Math.random() * Math.PI * 2, sp = 5 + Math.random() * 12
          debris.push({ m, vx: Math.cos(a) * sp, vy: 6 + Math.random() * 12, vz: Math.sin(a) * sp, rx: (Math.random() - 0.5) * 14, rz: (Math.random() - 0.5) * 14 })
          rs.scene.add(m)
        }
        rs.scene.add(ball, ring)
        blasts.push({ t: 0, ball, ring, light, debris })
      }
      const tickBlasts = (dt: number) => {
        for (let i = blasts.length - 1; i >= 0; i--) {
          const b = blasts[i]; b.t += dt
          const k = b.t / 1.6
          const bs = 1 + Math.min(1, b.t / 0.45) * 6.5
          b.ball.scale.setScalar(bs); (b.ball.material as import('three').MeshBasicMaterial).opacity = Math.max(0, 0.95 - b.t / 0.8)
          b.ring.scale.setScalar(1 + b.t * 34); (b.ring.material as import('three').MeshBasicMaterial).opacity = Math.max(0, 0.8 - b.t / 0.7)
          if (b.light) b.light.intensity = Math.max(0, 60 * (1 - b.t / 0.9))
          for (const d of b.debris) { d.vy -= 22 * dt; d.m.position.x += d.vx * dt; d.m.position.y = Math.max(0.1, d.m.position.y + d.vy * dt); d.m.position.z += d.vz * dt; d.m.rotation.x += d.rx * dt; d.m.rotation.z += d.rz * dt }
          if (k >= 1) { dropBlast(b); blasts.splice(i, 1) }
        }
      }
      cleanups.push(() => { for (const b of blasts) dropBlast(b); blasts.length = 0 })
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
      const mkStats = (): CarStats => { const st1 = statsFor(eff.kind, eff.kind === 'quad' && loadoutRef.current.items.includes('turbo') && topNow ? topNow * 1.25 : topNow, eff.up); const st0 = def.mode === 'city' && eff.kind === 'supercar' && !supFlyRef.current ? { ...st1, fly: false } : st1; return accRef.current === 1 ? st0 : { ...st0, acc: st0.acc * accRef.current } }
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
      const kd = (e: KeyboardEvent) => { if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return; if (e.key === 'z' || e.key === 'Z') zoomKey.current = true; else if (e.key === 'g' || e.key === 'G') { poiKey.current(); return } const k = keyMap[e.key]; if (k) { inp.current[k] = true; e.preventDefault() } else if (e.key === 'r' || e.key === 'R') { if ((eff.kind === 'heli' && !foot) || ironKeyRef.current()) heliDown.current = true; else resetReq.current = true } else if (e.key === 'c' || e.key === 'C') toggleRef.current(); else if (e.key === 'f' || e.key === 'F') assistToggleRef.current(); else if (e.key === 'h' || e.key === 'H') toggleHide.current(); else if (e.key === 'i' || e.key === 'I') ironRef.current(); else if (e.key === 't' || e.key === 'T') ironTpRef.current(); else if (e.key === 'x' || e.key === 'X') exitRef.current(); else if (e.key === 'm' || e.key === 'M') rocketRef.current(); else if (e.key === 'v' || e.key === 'V') egoRef.current(); else if (e.key === 'q' || e.key === 'Q') punchReq.current = true; else if (e.key === 'n' || e.key === 'N') { spawnArm.current = performance.now() + 2500; spawnRef.current() } else if (e.key >= '1' && e.key <= '9' && performance.now() < spawnArm.current) { spawnArm.current = 0; spawnRef.current(undefined, Number(e.key)) } else if (e.key === 'Shift') runRef.current = true; if (e.key === ' ') inp.current.jump = true }
      const ku = (e: KeyboardEvent) => { if (e.key === 'r' || e.key === 'R') heliDown.current = false; const k = keyMap[e.key]; if (k) { inp.current[k] = false; e.preventDefault() } else if (e.key === 'Shift') runRef.current = false; if (e.key === ' ') inp.current.jump = false }
      window.addEventListener('keydown', kd); window.addEventListener('keyup', ku)
      cleanups.push(() => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku) })

      // Netz
      let ready = false
      let onCh: (p: Record<string, unknown>) => void = () => undefined
      const sendCh = (payload: Record<string, unknown>) => { if (ready) void ch?.send({ type: 'broadcast', event: 'ch', payload }).catch(() => undefined) }
      let onClaim: (id: string) => void = () => undefined
      const skins = new Map<string, string>()
      const sendSkin = () => { const d = skinNow(); if (ready && d) void ch?.send({ type: 'broadcast', event: 'sk', payload: { u: online?.userId, d } }).catch(() => undefined) }
      skinSend.current = sendSkin
      if (online) { const st = window.setInterval(sendSkin, 15000), st0 = window.setTimeout(sendSkin, 3000); cleanups.push(() => { window.clearInterval(st); window.clearTimeout(st0) }) }
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
          { const pc = Number(payload.pc) || 0; if (r.pc !== undefined && pc > r.pc) r.pcAt = performance.now(); r.pc = pc }
          { const ex = Number(payload.ex) || 0; if (r.ex !== undefined && ex > r.ex) blastAt(Number(payload.x) || 0, (Number(payload.y) || 0) + 0.8, Number(payload.z) || 0); r.ex = ex }
          const wcNew = typeof payload.wc === 'string' && /^#[0-9a-f]{6}$/i.test(payload.wc) ? payload.wc : ''
          if (wcNew !== (r.wc ?? '')) { r.wc = wcNew; if (r.mesh && r.wk) { scene.remove(r.mesh); r.mesh = undefined } }
          if (r.mesh && !!r.mesh.userData.wk !== r.wk) { scene.remove(r.mesh); r.mesh = undefined }
          if (typeof payload.ce === 'string' && chase && !chase.over && chase.id === payload.ce) finishChase(payload.cw === 'police' ? 'police' : 'bandit', false)
          r.hd = payload.hd === 1; r.lv = Number(payload.lv) || 0; r.yy = Number(payload.y) || 0; r.pt = Number(payload.pt) || 0
          r.tx = Number(payload.x) || 0; r.tz = Number(payload.z) || 0; r.th = Number(payload.h) || 0; r.v = Number(payload.v) || 0
          r.dmg = Number(payload.d) || 0; r.slip = Number(payload.sl) || 0; r.fl = Number(payload.fl) || 0
          { const wasDn = r.dn; r.dn = !!payload.dn; if (r.dn && !wasDn && lastHit.id === r.id && performance.now() - lastHit.t < 8000 && !r.id.startsWith('pb-')) { lastHit.id = ''; killedPlayer(r.name ?? 'Spieler') } } r.dc = String(payload.dc ?? ''); r.od = String(payload.od ?? ''); r.bt = !!payload.bt; if (r.bt && r.mesh && r.wk && !r.mesh.userData.bt) addBaton(THREE, r.mesh)
          r.gr = Number(payload.gr) || 0; if (r.gr && r.mesh && r.wk && (r.mesh.userData.gr ?? 0) !== r.gr) addGear(THREE, r.mesh, r.gr)
          r.total = Number(payload.t) || 0; r.ft = typeof payload.f === 'number' ? payload.f : null; r.seen = performance.now()
          if (typeof payload.k === 'string' && (payload.k !== r.kind || payload.c !== r.color || (r.mesh && r.mesh.userData.ro !== r.ro))) {
            r.kind = payload.k; r.color = String(payload.c || '#94a3b8')
            if (r.mesh) { scene.remove(r.mesh); r.mesh = undefined }
          }
          if (!r.mesh) { if (r.wk && r.kind === 'swatman') { r.mesh = makeSwatMan(THREE); r.mesh.userData.wk = true } else if (r.wk) { r.mesh = rs.makeWalker(r.ro === 'c' ? '#1d4ed8' : r.ro === 'b' ? '#111827' : (r.wc || r.color), undefined, r.name, skins.get(r.id)); r.mesh.userData.wk = true; if (r.bt || r.ro === 'c') addBaton(THREE, r.mesh) } else { r.mesh = rs.makeCar(r.kind, r.color, r.name, false); if (r.ro === 'c') rs.addSiren(r.mesh) } r.mesh.userData.ro = r.ro; r.x = r.tx; r.z = r.tz; r.h = r.th; scene.add(r.mesh) }
        })
        ch.on('broadcast', { event: 'ch' }, ({ payload }) => onCh(payload as Record<string, unknown>))
        ch.on('broadcast', { event: 'sk' }, ({ payload }) => {
          const p = payload as { u?: unknown; d?: unknown }
          if (typeof p.u !== 'string' || p.u === online.userId || typeof p.d !== 'string' || !p.d.startsWith('data:image/png;base64,') || p.d.length > 45000) return
          if (skins.get(p.u) === p.d) return
          skins.set(p.u, p.d)
          const r = remotes.get(p.u)
          if (r?.mesh && r.wk) { scene.remove(r.mesh); r.mesh = undefined }
        })
        ch.on('broadcast', { event: 'pn' }, ({ payload }) => {
          const p = payload as { to?: unknown; dx?: unknown; dz?: unknown; d?: unknown }
          if (!foot || p.to !== online.userId || ride) return
          const dx = Math.max(-1, Math.min(1, Number(p.dx) || 0)), dz = Math.max(-1, Math.min(1, Number(p.dz) || 0))
          const dm = Math.max(1, Math.min(30, Number(p.d) || 8))
          foot = { ...foot, vx: foot.vx + dx * 8, vz: foot.vz + dz * 8, hp: Math.max(0, foot.hp - dm * hpCfg.armor), stun: Math.max(foot.stun, 0.45) }
          lastRegenHit = performance.now(); say('Du wurdest geschlagen!')
        })
        // Schüsse (SWAT-Männer, SWAT-Geschütz) auf mich: zu Fuß Lebenspunkte, im Auto Schaden am Auto (SWAT-Wagen halten mehr aus)
        // Rettung: Sanitäter melden sich (mc), laden mich ein (mp), liefern mich ab (mh); der Admin gibt gratis frei (rv)
        ch.on('broadcast', { event: 'mc' }, ({ payload }) => { const p = payload as { to?: unknown; by?: unknown }; if (p.to === online.userId && rescue && !rescue.claimed && typeof p.by === 'string') rescueClaim(p.by) })
        ch.on('broadcast', { event: 'mp' }, ({ payload }) => { const p = payload as { to?: unknown; by?: unknown }; if (p.to === online.userId && rescue && rescue.claimed === p.by) { rescue.phase = 'carried'; say('Die Sanitäter haben dich aufgeladen – ab ins Krankenhaus!') } })
        ch.on('broadcast', { event: 'mh' }, ({ payload }) => { const p = payload as { to?: unknown }; if (p.to === online.userId && rescue) finishRescue() })
        ch.on('broadcast', { event: 'fo' }, ({ payload }) => { const n = Number((payload as { s?: unknown }).s); if (Number.isFinite(n)) fireDone.add(n) })
        ch.on('broadcast', { event: 'qa' }, ({ payload }) => { const p = payload as { to?: unknown; x?: unknown; y?: unknown; z?: unknown }; if (p.to !== online.userId) return; quadPass = { t: performance.now(), x: Number(p.x) || 0, y: Number(p.y) || 0, z: Number(p.z) || 0 } })
        ch.on('broadcast', { event: 'ig' }, ({ payload }) => { const p = payload as { to?: unknown; on?: unknown; k?: unknown }; if (p.to !== online.userId) return; if (p.k === 'ksk') { kskGrantRef.current = !!p.on; setKskOk(!!p.on); say(p.on ? 'Der Admin hat dich zur KSK befördert! Knopf „KSK“, dann Quad rufen.' : 'Der Admin hat dir die KSK-Rechte genommen.'); if (!p.on && !adminRef.current) kskOffRef.current(); return } ironGrantRef.current = !!p.on; setIronOk(!!p.on); say(p.on ? 'Der Admin hat dir den Iron-Man-Anzug gegeben! (I)' : 'Der Admin hat dir den Iron-Man-Anzug wieder genommen.'); if (!p.on && !adminRef.current) ironOffRef.current() })
        ch.on('broadcast', { event: 'rv' }, ({ payload }) => { const p = payload as { to?: unknown }; if (p.to === online.userId && rescue) reviveHere('Der Admin hat dich wiederbelebt!') })
        ch.on('broadcast', { event: 'sd' }, ({ payload }) => {
          const p = payload as { to?: unknown; d?: unknown; k?: unknown }
          if (p.to !== online.userId) return
          hurtByShot(Math.max(1, Math.min(40, Number(p.d) || 5)), p.k === 'f', (p as { a?: unknown }).a === 1)
        })
        ch.on('broadcast', { event: 'rk' }, ({ payload }) => { if ((payload as { to?: unknown }).to === online.userId) rocketHitMe() })
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
      interface PBot { id: string; name: string; kind: string; color: string; car: Car; st: CarStats; mem: BotMem; mesh: import('three').Group; w?: Walker; wm?: import('three').Group; carGone?: boolean; swat?: boolean; men?: SwatMan[]; pcd?: number; fcd?: number; pa?: number; scd?: number }
      interface SwatMan { id: string; w: Walker; m: import('three').Group; cd: number; ang?: number; grp?: number; aimT?: number }
      let pbots: PBot[] = []
      // Figuren zu Fuß (Sanitäter, Polizisten, SWAT) laufen um die Häuser herum statt hindurch
      const safeNav = makeSafeNav((x, z) => !!buildingAt(x, z) || (cityPush(x, z)?.depth ?? 0) > 0.3, (sx, sz, tx, tz) => streetRoute(sx, sz, tx, tz, CITY.pitch, CITY.K))
      const navFoot = (key: string, from: { x: number; z: number; y: number }, to: { x: number; z: number; y?: number }): { x: number; z: number } => {
        const n = walkNav(from, to)
        return buildingAt(from.x, from.z) ? n : safeNav(key, from, n)
      }
      let endInfo: { id: string; win: 'police' | 'bandit'; until: number } | null = null
      let chase: { id: string; bandits: string[]; got: Set<string>; cops: string[]; bots: number; t0: number; from: string; over: boolean; heist?: boolean; extra?: string; sw: number } | null = null
      let iCaught = false
      let lobbyCur: { id: string; bandits: string[]; invitees: string[]; invited: Record<string, 'wait' | 'yes' | 'no'>; bots: number } | null = null
      let incoming: { id: string; from: string; fn: string; role: 'bandit' | 'cop'; bots: number } | null = null
      const chaseOn = !!online?.open && isCity
      const syncLobby = () => { const l = lobbyCur; setChaseUi((o) => ({ ...o, lobby: l ? { id: l.id, bandits: l.bandits.map((b) => (b === online?.userId ? 'me' : b)), invited: { ...l.invited }, bots: l.bots } : undefined })) }
      let carSwapped = false
      const applyRole = (role: Role | null, swat = false) => {
        myRole = role
        // Banditen behalten ihr eigenes Fahrzeug (auch ein geklauter Panzer oder Hubschrauber); nur Polizei bekommt ein Dienstfahrzeug
        if (role === 'bandit' && !swat) { setChaseKind(eff.kind); return }
        if (role === null && !carSwapped) { setChaseKind(null); return }
        carSwapped = role !== null
        if (role) { const cc = swat || (role === 'cop' && me.kind === 'swat') ? { kind: 'swat', color: '#0b1220', top: 300 } : chaseCar(role, me.kind === 'supercar', false, isBike(me.kind)); eff.kind = cc.kind; eff.color = cc.color; eff.up = undefined; topNow = cc.top }
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
      /** Polizei-Bot (oder SWAT-Panzerwagen) an der Polizeiwache: nebeneinander vor der Tür, Blick weg vom Haus */
      const mkPbot = (i: number, swat: boolean): PBot => {
        const st0 = pois().find((p) => p.kind === 'police')
        const cc = swat ? { kind: 'swat', color: '#0b1220', top: 280 } : chaseCar('cop', false, true)
        void st0
        // Start in der Garage der Polizeiwache (weitere Wagen davor im Hof)
        const slot = POLICE.slots[i % POLICE.slots.length]
        const x = slot.x - Math.floor(i / POLICE.slots.length) * 9, z = slot.z
        const name = swat ? `SWAT ${i + 1}` : `Polizei-Bot ${i + 1}`
        const mesh = rs.makeCar(cc.kind, cc.color, name, false)
        rs.addSiren(mesh); scene.add(mesh)
        return { id: `pb-${(online?.userId ?? 'x').slice(0, 6)}-${swat ? 's' : ''}${i}`, name, kind: cc.kind, color: cc.color, car: { ...startCar(track, 0), x, z, h: slot.h, v: 0 }, st: statsFor(cc.kind, cc.top), mem: { stuck: 0 }, mesh, swat }
      }
      /** SWAT-Wagen hält beim Bandit zu Fuß: bis zu 10 Männer (insgesamt höchstens 10 pro Jagd) steigen aus */
      function deploySwat(pb: PBot) {
        const out = pbots.reduce((n, o) => n + (o.men?.length ?? 0), 0)
        const n = Math.min(10 - out, 10)
        if (n <= 0) { pb.car = stepCar(pb.car, idleIn, 0.016, track, pb.st, true); return }
        const sx = Math.cos(pb.car.h), sz = -Math.sin(pb.car.h), bx = -Math.sin(pb.car.h), bz = -Math.cos(pb.car.h)
        pb.men = Array.from({ length: n }, (_, i) => {
          const off = (i - (n - 1) / 2) * 0.9
          const w = { ...newWalker(pb.car.x + bx * 3.4 + sx * off, pb.car.z + bz * 3.4 + sz * off, pb.car.h + Math.PI, pb.car.y ?? 0), hp: 1 }
          const m = makeSwatMan(THREE); scene.add(m)
          return { id: `${pb.id}m${i}w`, w, m, cd: 0.6 + Math.random() * 1.2, ang: (i / n) * Math.PI * 2 + Math.random() * 0.4, grp: i % 2 }
        })
      }
      /** SWAT-Männer: laufen auf den Bandit zu, bleiben auf ~12 m stehen und schießen mit Pistolen; steigt der Bandit ins Auto, laufen sie zurück in ihren Wagen */
      function swatMen(pb: PBot, tg: { id: string; x: number; z: number; y?: number; wk?: boolean }, dt: number) {
        const men = pb.men ?? []
        for (const mn of [...men]) {
          const onFoot = !!tg.wk
          // Absprache: zwei Gruppen wechseln sich ab – die eine rückt vor, die andere hält und gibt Feuerschutz; jeder hat seinen eigenen Winkel um das Ziel (kein Haufen)
          const adv = (mn.grp ?? 0) === Math.floor(performance.now() / 3500) % 2
          const R = adv ? 7 : 12
          const gx = onFoot ? tg.x + Math.cos(mn.ang ?? 0) * R : pb.car.x, gz = onFoot ? tg.z + Math.sin(mn.ang ?? 0) * R : pb.car.z
          const d = Math.hypot((onFoot ? tg.x : pb.car.x) - mn.w.x, (onFoot ? tg.z : pb.car.z) - mn.w.z)
          const sees = onFoot && d < 40 && clearLine(mn.w.x, mn.w.z, tg.x, tg.z) && !shotBlocked(mn.w.x, mn.w.y + 1.3, mn.w.z, tg.x, (tg.y ?? 0) + 1, tg.z) && !shotBlocked(mn.w.x, mn.w.y + 1.3, mn.w.z, tg.x, (tg.y ?? 0) + 1, tg.z)
          const hold = sees && (adv ? d < 9 : d < 28)
          if (!hold) {
            const nv = navFoot(mn.id, { x: mn.w.x, z: mn.w.z, y: mn.w.y }, { x: gx, z: gz, y: onFoot ? tg.y : pb.car.y })
            let dh = Math.atan2(nv.x - mn.w.x, nv.z - mn.w.z) - mn.w.h; while (dh > Math.PI) dh -= Math.PI * 2; while (dh < -Math.PI) dh += Math.PI * 2
            mn.w = stepWalker(mn.w, { fwd: Math.abs(dh) < 1.3, back: false, left: dh > 0.12, right: dh < -0.12, run: true }, dt)
          } else {
            let dh = Math.atan2(tg.x - mn.w.x, tg.z - mn.w.z) - mn.w.h; while (dh > Math.PI) dh -= Math.PI * 2; while (dh < -Math.PI) dh += Math.PI * 2
            mn.w = stepWalker({ ...mn.w, h: mn.w.h + dh * Math.min(1, dt * 8) }, { fwd: false, back: false, left: false, right: false }, dt)
          }
          mn.cd -= dt
          if (sees && d < 30 && mn.cd <= 0) {
            mn.cd = (adv ? 1.1 : 0.7) + Math.random() * 0.7; mn.aimT = performance.now()
            const hit = Math.random() < 0.7
            tracer(mn.w.x, mn.w.y + 1.3, mn.w.z, tg.x + (hit ? 0 : (Math.random() - 0.5) * 3), (tg.y ?? 0) + 1.1, tg.z + (hit ? 0 : (Math.random() - 0.5) * 3))
            if (hit) { if (tg.id === online?.userId) hurtByShot(6, true); else if (ready) void ch?.send({ type: 'broadcast', event: 'sd', payload: { to: tg.id, d: 6, k: 'f' } }).catch(() => undefined) }
          }
          if (!onFoot && Math.hypot(pb.car.x - mn.w.x, pb.car.z - mn.w.z) < 3.2) killMan(pb, mn)
        }
      }
      /** SWAT-Wagen schießt (Geschütz) auf ein Auto vor sich, wenn es ungefähr in Fahrtrichtung liegt und frei zu sehen ist */
      function swatTruckFire(pb: PBot, tg: { id: string; x: number; z: number; y?: number }, dt: number) {
        pb.fcd = (pb.fcd ?? 0) - dt
        if (pb.fcd > 0) return
        const dx = tg.x - pb.car.x, dz = tg.z - pb.car.z, d = Math.hypot(dx, dz)
        if (d > 90 || d < 4) return
        let da = Math.atan2(dx, dz) - pb.car.h; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2
        if (Math.abs(da) > 0.12 || !clearLine(pb.car.x, pb.car.z, tg.x, tg.z) || Math.abs((tg.y ?? 0) - (pb.car.y ?? 0)) > 8 || shotBlocked(pb.car.x, (pb.car.y ?? 0) + 1.5, pb.car.z, tg.x, (tg.y ?? 0) + 1, tg.z)) return
        pb.fcd = 0.6
        const hx = Math.sin(pb.car.h), hz = Math.cos(pb.car.h)
        tracer(pb.car.x + hx * 3.6, (pb.car.y ?? 0) + 2.1, pb.car.z + hz * 3.6, tg.x, (tg.y ?? 0) + 1, tg.z)
        if (tg.id === online?.userId) hurtByShot(8, false)
        else if (ready) void ch?.send({ type: 'broadcast', event: 'sd', payload: { to: tg.id, d: 8, k: 'c' } }).catch(() => undefined)
      }
      /** Ein Polizist zu Fuß wurde ausgeschaltet: er bleibt liegen, und die Polizei ruft einen schnellen SWAT-Panzerwagen von der Wache (höchstens 4 je Jagd) */
      function killCop(pb: PBot) {
        if (!pb.w) return
        pb.w = undefined; if (pb.wm) { scene.remove(pb.wm); pb.wm = undefined }
        pb.carGone = true; scene.remove(pb.mesh)
        addStar(1)
        say('Polizist ausgeschaltet – die Polizei ruft SWAT!')
        callSwat()
      }
      function callSwat() {
        const c = chase
        if (!c || c.over || c.from !== online?.userId || c.sw >= 4) return
        const n = c.sw++
        window.setTimeout(() => { if (!dead && chase === c && !c.over) pbots.push(mkPbot(100 + n, true)) }, 2500)
      }
      function killMan(pb: PBot, mn: SwatMan) {
        scene.remove(mn.m)
        pb.men = (pb.men ?? []).filter((x) => x !== mn)
      }
      /** Streifenwagen: fahren (nur bei mir, nicht synchronisiert) durch die Straßen; wer einen rammt, wird von der Polizei verfolgt */
      interface Patrol { id: number; car: Car; st: CarStats; mem: BotMem; mesh: import('three').Group; goal: { x: number; z: number }; sleep: number }
      const patrols: Patrol[] = []
      const rndNode = (): { x: number; z: number } => { const K = CITY.K, P = CITY.pitch; return { x: (Math.floor(Math.random() * (2 * K - 1)) - (K - 1)) * P, z: (Math.floor(Math.random() * (2 * K - 1)) - (K - 1)) * P } }
      if (isCity && online) {
        for (let i = 0; i < 4; i++) {
          const cc = chaseCar('cop', false, true), n = rndNode()
          const st = statsFor(cc.kind, Math.min(cc.top, 150)), mesh = rs.makeCar(cc.kind, cc.color, 'Streife', false)
          rs.addSiren(mesh); scene.add(mesh)
          patrols.push({ id: i, car: { ...startCar(track, 0), x: n.x + 5, z: n.z, h: Math.PI / 2, v: 0 }, st, mem: { stuck: 0 }, mesh, goal: rndNode(), sleep: 0 })
        }
        cleanups.push(() => { for (const pt of patrols) scene.remove(pt.mesh) })
      }
      const tickPatrols = (dt: number) => {
        for (const pt of patrols) {
          if (pt.sleep > 0) { pt.sleep -= dt; pt.mesh.visible = false; if (pt.sleep <= 0) { const n = rndNode(); pt.car = { ...startCar(track, 0), x: n.x + 5, z: n.z, h: Math.PI / 2, v: 0 }; pt.goal = rndNode(); pt.mesh.visible = true }; continue }
          if (Math.hypot(pt.goal.x - pt.car.x, pt.goal.z - pt.car.z) < 16) pt.goal = rndNode()
          const d = copDrive(pt.car, pt.goal, pt.mem, dt)
          if (d.reset) pt.car = { ...pt.car, x: d.reset.x, z: d.reset.z, h: d.reset.h, v: 0, steer: 0, slip: 0, dmg: 0, hold: 0, lvl: 0, y: 0 }
          if (d.repair) pt.car = { ...pt.car, dmg: 0, hold: 0 }
          const inp = { ...d.inp, fly: false, chase: true }
          if (pt.car.v > 13) inp.gas = false
          pt.car = stepCar(pt.car, inp, dt, track, pt.st, true)
        }
      }
      /** Fahndungsstufe (Sterne 0–5): Taten geben Sterne; ein Stern verschwindet nach 60 s ohne neue Tat, der Tod löscht alle */
      let stars = 0, starAt = 0, starCd = 0
      const setStars = (n: number) => { n = Math.max(0, Math.min(12, n)); if (n === stars) return; stars = n; starAt = performance.now(); setStarsUi(n) }
      const addStar = (n = 1) => {
        const nowT = performance.now()
        if (nowT < starCd) return
        starCd = nowT + 3500
        setStars(stars + n); say(`Fahndungsstufe: ${'★'.repeat(stars)}`)
        if (stars >= 2 && (!chase || chase.over || myRole === 'cop')) startWanted('crime', 'Die Polizei jagt dich – 6 Minuten durchhalten!')
        if (chase && !chase.over && myRole === 'bandit') { if (stars >= 3) callSwat(); if (stars >= 5) callSwat(); armyWave(); kskWave(); ironWave() }
      }
      /** Wen habe ich zuletzt getroffen? Geht er innerhalb von 8 s zu Boden, zählt das als Mord */
      const lastHit = { id: '', t: 0 }
      const markHit = (id: string) => { lastHit.id = id; lastHit.t = performance.now() }
      const killedPlayer = (name: string) => { if (myRole === 'cop') return; starCd = 0; addStar(2); say(`${name} getötet – die Polizei sucht dich!`) }
      const tickStars = (nowT: number) => { if (stars > 0 && nowT - starAt > 60000) { setStars(stars - 1); say(stars ? `Die Polizei sucht weniger: ${'★'.repeat(stars)}` : 'Du bist nicht mehr gesucht.') } }
      /** Polizei startet eine Jagd auf mich (Rammen, Passanten töten …) */
      const startWanted = (extra: string, text: string) => {
        if (!online || ride || dead) return
        // laufende Jagd: nur als Polizist (Dienst) zählt eine eigene Straftat – dann wechselt man die Seite; beendete Jagd wird ersetzt
        if (chase && !chase.over) { if (myRole !== 'cop') return; chase = null; dutyChase = false }
        else if (chase) chase = null
        const id = `${extra}-${online.userId}-${Date.now()}`
        const dc = dutyCops()
        if (dc.length) { const msg = { t: 'go', id, bandits: [online.userId], cops: dc, bots: 4, from: online.userId, ex: extra }; for (const dl of [0, 600, 1500]) window.setTimeout(() => { if (!dead) sendCh(msg) }, dl) }
        startChase(id, [online.userId], dc, 4, online.userId, 'bandit', false, extra)
        say(text)
      }
      const ramPatrol = (pt: Patrol) => { pt.sleep = 45; startWanted('ram', 'Du hast einen Streifenwagen gerammt! Die Polizei verfolgt dich – 6 Minuten durchhalten!') }
      /** Passanten: laufen auf den Gehwegen (nur bei mir), sterben beim Überfahren, kämpfen zurück oder fliehen, wenn man sie schlägt */
      interface Ped { w: Walker; m: import('three').Group; ax: 0 | 1; lane: number; dir: number; st: 'walk' | 'flee' | 'fight' | 'dead'; t: number; hp: number; cd: number; keep?: boolean }
      const peds: Ped[] = []
      let pedHurt = 0
      const PED_COL = ['#ef4444', '#22c55e', '#f59e0b', '#a855f7', '#06b6d4', '#f472b6', '#84cc16', '#94a3b8', '#fb923c']
      const pedGoal = (pd: Ped) => { const L = CITY.half - 20; return pd.ax === 0 ? { x: pd.lane, z: Math.max(-L, Math.min(L, pd.w.z + pd.dir * 70)) } : { x: Math.max(-L, Math.min(L, pd.w.x + pd.dir * 70)), z: pd.lane } }
      const spawnPed = (px: number, pz: number): Ped | undefined => {
        const P = CITY.pitch, L = CITY.half - 20, ax = Math.random() < 0.5 ? 0 : 1
        const node = Math.round((ax === 0 ? px : pz) / P) + Math.floor(Math.random() * 3) - 1
        const lane = node * P + (Math.random() < 0.5 ? -13 : 13)
        const along = (ax === 0 ? pz : px) + (Math.random() - 0.5) * 230
        if (Math.abs(lane) > L || Math.abs(along) > L) return
        const x = ax === 0 ? lane : along, z = ax === 0 ? along : lane
        if (Math.hypot(x - px, z - pz) < 25 || buildingAt(x, z)) return
        const m = rs.makeWalker(PED_COL[Math.floor(Math.random() * PED_COL.length)], '#1f2937'); scene.add(m)
        const np: Ped = { w: newWalker(x, z, 0, 0), m, ax: ax as 0 | 1, lane, dir: Math.random() < 0.5 ? -1 : 1, st: 'walk', t: 0, hp: 30, cd: 0 }
        peds.push(np)
        return np
      }
      const killPed = (pd: Ped) => {
        if (pd.st === 'dead') return
        pd.st = 'dead'; pd.t = 6; pd.hp = 0
        pd.m.rotation.x = -Math.PI / 2; pd.m.position.set(pd.w.x, pd.w.y + 0.25, pd.w.z)
        if (stars < 2) addStar(1)
        say('Passant getötet!')
        if (stars >= 2 && !chase) startWanted('ped', 'Zeugen haben die Polizei gerufen – 6 Minuten durchhalten!')
      }
      const punchPed = (w0: Walker, d: number): boolean => {
        for (const pd of peds) {
          if (pd.st === 'dead') continue
          const dx = pd.w.x - w0.x, dz = pd.w.z - w0.z
          if (Math.hypot(dx, dz) > 2.6 || Math.abs(pd.w.y - w0.y) > 2) continue
          let da = Math.atan2(dx, dz) - w0.h; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2
          if (Math.abs(da) > 1.2) continue
          pd.hp -= d; pd.w = { ...pd.w, vx: pd.w.vx + Math.sin(w0.h) * 5, vz: pd.w.vz + Math.cos(w0.h) * 5 }
          if (pd.hp <= 0) killPed(pd)
          else { pd.st = Math.random() < 0.5 ? 'fight' : 'flee'; pd.t = 10 }
          return true
        }
        return false
      }
      const tickPeds = (dt: number, nowT: number) => {
        if (!isCity) return
        const me = foot ?? car
        if (peds.filter((q) => q.st !== 'dead').length < 16 && Math.random() < 0.3) spawnPed(me.x, me.z)
        for (const pd of [...peds]) {
          if (pd.st === 'dead') { pd.t -= dt; if (pd.t <= 0) { scene.remove(pd.m); peds.splice(peds.indexOf(pd), 1) } continue }
          const d = Math.hypot(pd.w.x - me.x, pd.w.z - me.z)
          if (d > 170 && !pd.keep) { scene.remove(pd.m); peds.splice(peds.indexOf(pd), 1); continue }
          // überfahren
          if (!foot && !ride && Math.abs(car.v) > 3 && d < 8 && Math.abs((car.y ?? 0) - pd.w.y) < 2.5) {
            const dx = pd.w.x - car.x, dz = pd.w.z - car.z
            const lon = dx * Math.sin(car.h) + dz * Math.cos(car.h), lat = dx * Math.cos(car.h) - dz * Math.sin(car.h)
            if (Math.abs(lon) < myStats.len / 2 + 0.5 && Math.abs(lat) < myStats.wid / 2 + 0.5) { killPed(pd); continue }
          }
          pd.t -= dt; pd.cd -= dt
          let goal = pedGoal(pd), run = false
          if (pd.st === 'fight' && foot && !rescue && footKo <= 0 && pd.t > 0) {
            goal = { x: foot.x, z: foot.z }; run = true
            if (d < 1.8 && pd.cd <= 0 && Math.abs(foot.y - pd.w.y) < 2) { pd.cd = 1.1; pedHurt += 5; say('Ein Passant schlägt dich!') }
          } else if (pd.st === 'flee' && pd.t > 0) { goal = { x: pd.w.x + (pd.w.x - me.x) * 3, z: pd.w.z + (pd.w.z - me.z) * 3 }; run = true }
          else if (pd.st !== 'walk') pd.st = 'walk'
          else if (Math.hypot(goal.x - pd.w.x, goal.z - pd.w.z) < 4) pd.dir = Math.random() < 0.7 ? -pd.dir : pd.dir
          let dh = Math.atan2(goal.x - pd.w.x, goal.z - pd.w.z) - pd.w.h; while (dh > Math.PI) dh -= Math.PI * 2; while (dh < -Math.PI) dh += Math.PI * 2
          pd.w = stepWalker(pd.w, { fwd: Math.abs(dh) < 1.3 && !(pd.st === 'fight' && d < 1.4), back: false, left: dh > 0.12, right: dh < -0.12, run }, dt)
          pd.m.position.set(pd.w.x, pd.w.y, pd.w.z); pd.m.rotation.y = pd.w.h
          poseWalker(pd.m, pd.w.ph, pd.w.sp, 0, false)
        }
        void nowT
      }
      cleanups.push(() => { for (const pd of peds) scene.remove(pd.m) })
      /** Armee-Gelände: Fahrzeuge zum Klauen, Wachen (greifen nur an, was sie sehen), Schutzwesten; ab 4 Sternen rückt die Armee an (Hubschrauber + Panzer) */
      const armyGone = new Map<number, number>()
      const rpgCd = new Map<object, number>()
      const armyMeshes: Array<import('three').Group | undefined> = []
      interface Soldier { w: Walker; m: import('three').Group; wp: number; cd: number; alert: number; dead: number }
      const soldiers: Soldier[] = []
      if (isCity) {
        ARMY.vehicles.forEach((v, i) => { const m = rs.makeCar(v.kind, '#4d5d3a', '', false); m.position.set(v.x, 0.31, v.z); m.rotation.y = v.h; scene.add(m); armyMeshes[i] = m })
        for (let i = 0; i < 6; i++) {
          const P = ARMY.patrol[i % ARMY.patrol.length], m = rs.makeWalker('#4d5d3a', '#3f4f2f'); addGear(THREE, m, 1 | 2 | 16); scene.add(m)
          soldiers.push({ w: newWalker(P.x + i, P.z, 0, 0), m, wp: (i + 1) % ARMY.patrol.length, cd: 1 + i * 0.3, alert: 0, dead: 0 })
        }
        cleanups.push(() => { for (const m of armyMeshes) if (m) scene.remove(m); for (const q of soldiers) scene.remove(q.m) })
      }
      let tempVest = false
      const takeVest = () => {
        if (gearRef.current.vest) { say('Du trägst schon eine Schutzweste.'); return }
        tempVest = true; applyGear({ ...gearRef.current, vest: true }); say('Schutzweste genommen – sie hält bis zu deinem nächsten Tod.')
      }
      const killSoldier = (q: Soldier) => {
        if (q.dead > 0) return
        q.dead = 25; q.m.rotation.x = -Math.PI / 2; q.m.position.set(q.w.x, q.w.y + 0.25, q.w.z)
        addStar(1); say('Soldat ausgeschaltet!')
      }
      const tickSoldiers = (dt: number) => {
        if (!soldiers.length) return
        const me = foot ?? car, my = foot ? foot.y : (car.y ?? 0)
        if (Math.hypot(me.x - ARMY.cx, me.z - ARMY.cz) > 300) return
        for (const q of soldiers) {
          if (q.dead > 0) { q.dead -= dt; if (q.dead <= 0) { const P = ARMY.patrol[q.wp]; q.w = newWalker(P.x, P.z, 0, 0); q.m.rotation.x = 0; q.alert = 0 } continue }
          const d = Math.hypot(me.x - q.w.x, me.z - q.w.z)
          let dv = Math.atan2(me.x - q.w.x, me.z - q.w.z) - q.w.h; while (dv > Math.PI) dv -= Math.PI * 2; while (dv < -Math.PI) dv += Math.PI * 2
          const inBase = Math.abs(me.x - ARMY.cx) < ARMY.half + 0.5 && Math.abs(me.z - ARMY.cz) < ARMY.half + 0.5
          const sees = inBase && d < 60 && Math.abs(dv) < 1.2 && my - q.w.y < 60 && clearLine(q.w.x, q.w.z, me.x, me.z) && !shotBlocked(q.w.x, q.w.y + 1.3, q.w.z, me.x, my + 1.1, me.z)
          if (sees) q.alert = 4; else q.alert -= dt
          if (q.alert > 0) {
            q.w = stepWalker({ ...q.w, h: q.w.h + dv * Math.min(1, dt * 6) }, { fwd: false, back: false, left: false, right: false }, dt)
            q.cd -= dt
            if (sees && q.cd <= 0) {
              q.cd = 1 + Math.random() * 0.8
              const hit = Math.random() < 0.55
              tracer(q.w.x, q.w.y + 1.3, q.w.z, me.x + (hit ? 0 : (Math.random() - 0.5) * 3), my + 1.1, me.z + (hit ? 0 : (Math.random() - 0.5) * 3))
              if (hit) hurtByShot(foot ? 6 : 5, !!foot, true)
            }
            // jeder dritte Soldat trägt eine Panzerfaust und feuert auf Fahrzeuge
            if (sees && !foot && soldiers.indexOf(q) % 3 === 0 && d > 14) {
              const cd = (rpgCd.get(q) ?? 3) - dt
              if (cd <= 0) {
                rpgCd.set(q, 7)
                launchRocket(q.w.x, q.w.y + 1.4, q.w.z, me.x - q.w.x, 0.15, me.z - q.w.z, false, () => { const m2 = foot ?? car; return { x: m2.x, y: (foot ? foot.y : (car.y ?? 0)) + 1.2, z: m2.z } }, 38, 1.1)
                say('Panzerfaust! Weich aus!')
              } else rpgCd.set(q, cd)
            }
          } else {
            const P = ARMY.patrol[q.wp]
            if (Math.hypot(P.x - q.w.x, P.z - q.w.z) < 2) q.wp = (q.wp + 1) % ARMY.patrol.length
            let dh = Math.atan2(P.x - q.w.x, P.z - q.w.z) - q.w.h; while (dh > Math.PI) dh -= Math.PI * 2; while (dh < -Math.PI) dh += Math.PI * 2
            q.w = stepWalker(q.w, { fwd: Math.abs(dh) < 1.3, back: false, left: dh > 0.12, right: dh < -0.12, run: false }, dt)
          }
          q.m.position.set(q.w.x, q.w.y, q.w.z); q.m.rotation.y = q.w.h
          poseWalker(q.m, q.w.ph, q.w.sp, 0, false); armUp(q.m)
        }
      }
      const tickArmyBase = (nowT: number) => {
        for (const [i, t] of [...armyGone]) if (nowT > t) { armyGone.delete(i); const m = armyMeshes[i]; if (m) m.visible = true }
      }
      /** Zaun überklettern: auf die andere Seite springen (von außen hinein, von innen hinaus) */
      const climbFence = (spot: { x: number; z: number }) => {
        if (!foot) return
        const dx = spot.x - ARMY.cx, dz = spot.z - ARMY.cz, axisX = Math.abs(Math.abs(dx) - ARMY.half) < 1, sg = Math.sign(axisX ? dx : dz)
        const inside = Math.abs(foot.x - ARMY.cx) < ARMY.half && Math.abs(foot.z - ARMY.cz) < ARMY.half
        const dir = inside ? sg : -sg, line = (axisX ? ARMY.cx : ARMY.cz) + sg * ARMY.half
        foot = axisX ? { ...foot, x: line + dir * 2.4, y: foot.y + 3, vy: 6 } : { ...foot, z: line + dir * 2.4, y: foot.y + 3, vy: 6 }
        say(inside ? 'Du kletterst aus dem Gelände.' : 'Du kletterst über den Zaun!')
      }
      const stealArmy = (spot: { x: number; z: number }) => {
        const kind = (spot as { kind?: string }).kind
        let i = ARMY.vehicles.findIndex((v) => Math.hypot(v.x - spot.x, v.z - spot.z) < 0.5)
        // Schlüsselbrett in der Kaserne: das nächste freie Fahrzeug dieser Art im Hof
        if (i < 0) i = ARMY.vehicles.findIndex((v, k) => v.kind === kind && !armyGone.has(k))
        const v = ARMY.vehicles[i]
        if (!foot) return
        if (!v || armyGone.has(i)) { say('Das Fahrzeug ist weg – es kommt bald ein neues.'); return }
        armyGone.set(i, performance.now() + 120000); const am = armyMeshes[i]; if (am) am.visible = false
        car = { ...car, x: v.x, z: v.z, h: v.h, v: 0, y: v.kind === 'heli' ? 1 : 0, vy: 0, fly: 0, lvl: 0, dmg: 0, hit: 0, steer: 0, slip: 0 }
        foot = null; if (footMesh) { scene.remove(footMesh); footMesh = null }
        setVehicle(v.kind, '#4d5d3a', null, undefined, false); myMesh.visible = true
        setStars(Math.max(stars, v.kind === 'heli' ? 4 : v.kind === 'tank' ? 3 : 2))
        say(v.kind === 'heli' ? 'Hubschrauber geklaut! W/S fliegen, A/D drehen, E hoch, R runter, Q/Tippen schießt.' : v.kind === 'tank' ? 'Panzer geklaut! Pfeile/Wischen drehen, W/S fahren, Q/Tippen schießt.' : 'Waffenauto geklaut!')
        if (!chase) startWanted('army', 'Armee-Fahrzeug geklaut – die Polizei und die Armee jagen dich!')
        armyWave()
      }
      let armyReq = { id: '', h: 0, t: 0 }
      const mkArmy = (kind: 'tank' | 'heli', i: number): PBot => {
        const name = kind === 'tank' ? `Panzer ${i + 1}` : `Kampfheli ${i + 1}`
        const mesh = rs.makeCar(kind, '#4d5d3a', name, false); scene.add(mesh)
        const pads = ARMY.vehicles.filter((q) => q.kind === 'heli')
        const pos = kind === 'tank' ? { x: ARMY.cx - 12 + (i % 3) * 12, z: ARMY.cz - 54, h: Math.PI } : { x: pads[i % pads.length].x + (i >= 2 ? 6 : 0), z: ARMY.cz - 8, h: 0 }
        return { id: `pb-${(online?.userId ?? 'x').slice(0, 6)}-a${kind[0]}${i}`, name, kind, color: '#4d5d3a', car: { ...startCar(track, 0), x: pos.x, z: pos.z, h: pos.h, v: 0, y: kind === 'heli' ? 1 : 0 }, st: statsFor(kind, kind === 'tank' ? 70 : 250), mem: { stuck: 0 }, mesh }
      }
      /** 4 Sterne: 2 Hubschrauber + 3 Panzer; jeder weitere Stern +1 Hubschrauber und +1 Panzer */
      /** Feindliche Iron Mans (ab 8 Sternen; vorher kommt ab 6 die KSK): fliegen um dich, feuern Lenkraketen, die sogar Panzer zerstören */
      /** Im KSK-Bunker (Halle/Fahrstuhl) wird weder geschossen noch hineingeschossen */
      const safe = { garage: false, plane: false }
      const inBunkerNow = () => safe.garage || safe.plane || (!!foot && (foot.lvl === -2 || (foot.y < -2 && inBunkerHall(foot.x, foot.z))))
      const nowMs = () => performance.now()
      let bunkerNoFire = 0
      type IronBot = { m: import('three').Group; x: number; y: number; z: number; h: number; cd: number; hits: number; dead: number; ph: number }
      const ironBots: IronBot[] = []
      let ironReq = { id: '', n: 0 }
      const mkIronBot = () => {
        const me = foot ?? car, a = Math.random() * Math.PI * 2
        const m = rs.makeWalker('#1f2937', '#111827'); addGear(THREE, m, 64); scene.add(m)
        ironBots.push({ m, x: me.x + Math.sin(a) * 150, y: 45, z: me.z + Math.cos(a) * 150, h: 0, cd: 2.5 + Math.random() * 2, hits: 0, dead: 0, ph: Math.random() * 6 })
      }
      const ironWave = () => {
        const c = chase
        if (!c || c.over || c.from !== online?.userId || stars < 8) return
        if (ironReq.id !== c.id) ironReq = { id: c.id, n: 0 }
        const want = Math.min(8, 2 + (stars - 8)), announce = ironReq.n === 0
        for (let k = 0; ironReq.n < want; ironReq.n++, k++) window.setTimeout(() => { if (!dead && chase === c && !c.over) mkIronBot() }, 2500 + 1800 * k)
        if (announce) say('Iron Mans greifen an – sie halten einiges aus und ihre Raketen zerstören sogar Panzer!')
      }
      const killIronBot = (ib: IronBot) => {
        if (ib.dead > 0) return
        ib.dead = 3; blastAt(ib.x, ib.y + 1, ib.z); say('Ein Iron Man ist abgestürzt!')
      }
      const dropIronBot = (ib: IronBot) => { scene.remove(ib.m); const ix = ironBots.indexOf(ib); if (ix >= 0) ironBots.splice(ix, 1) }
      const tickIronBots = (dt: number) => {
        if (ironBots.length && (!chase || chase.over || stars < 8)) { for (const ib of [...ironBots]) dropIronBot(ib); ironReq = { id: '', n: 0 } }
        const me = foot ?? car, my = foot ? foot.y : (car.y ?? 0)
        for (const ib of [...ironBots]) {
          ib.ph += dt
          if (ib.dead > 0) {
            ib.dead -= dt; ib.y -= 22 * dt; ib.m.rotation.x += dt * 3; ib.m.rotation.z += dt * 2
            fx.emit('fire', ib.x, ib.y + 1, ib.z, 0, 1, 0, 0.5)
            if (ib.y <= 0 || ib.dead <= 0) { blastAt(ib.x, Math.max(ib.y, 0.5) + 1, ib.z); dropIronBot(ib); continue }
          } else {
            const dx = me.x - ib.x, dz = me.z - ib.z, d = Math.hypot(dx, dz) || 1
            ib.h = Math.atan2(dx, dz)
            const want = d > 30 ? 1 : d < 18 ? -0.5 : 0, side = Math.sin(ib.ph * 0.7) * 10
            ib.x += (dx / d * want * 34 + dz / d * side) * dt; ib.z += (dz / d * want * 34 - dx / d * side) * dt
            const wy = Math.max(my + 14 + Math.sin(ib.ph) * 3, roofH(ib.x, ib.z) + 6)
            ib.y += Math.max(-12, Math.min(12, wy - ib.y)) * dt * 1.5
            ib.cd -= dt
            if (ib.cd <= 0 && d < 300) {
              ib.cd = 3.6 + Math.random() * 1.6
              launchRocket(ib.x + Math.sin(ib.h) * 0.7, ib.y + 1.2, ib.z + Math.cos(ib.h) * 0.7, me.x - ib.x, my + 1 - (ib.y + 1.2), me.z - ib.z, false, () => { const m2 = foot ?? car; return { x: m2.x, y: (foot ? foot.y : (car.y ?? 0)) + 1, z: m2.z } }, 48, 1.5, true)
            }
            fx.emit('fire', ib.x, ib.y + 0.05, ib.z, (Math.random() - 0.5) * 2, -7, (Math.random() - 0.5) * 2, 0.3)
            ib.m.rotation.set(0, ib.h, 0)
          }
          ib.m.position.set(ib.x, ib.y, ib.z)
          poseWalker(ib.m, ib.ph * 2, 0, 0, false)
          ib.m.children[0].rotation.x = ib.dead > 0 ? ib.m.children[0].rotation.x : -0.25
        }
      }
      cleanups.push(() => { for (const ib of ironBots) scene.remove(ib.m) })
      /** Feindliche KSK-Soldaten (ab 6 Sternen): laufen auf dich zu, schießen, einige mit Panzerfaust */
      type KskBot = { w: Walker; m: import('three').Group; cd: number; rk: number; dead: number; n: number }
      const kskBots: KskBot[] = []
      let kskReq = { id: '', n: 0 }
      const mkKskBot = (n: number) => {
        const me = foot ?? car
        let x = me.x + 80, z = me.z
        for (let t = 0; t < 14; t++) { const a = Math.random() * Math.PI * 2, r = 60 + Math.random() * 40, px = me.x + Math.sin(a) * r, pz = me.z + Math.cos(a) * r; if (roofH(px, pz) <= 0.5 && Math.abs(px) < 1400 && Math.abs(pz) < 1400) { x = px; z = pz; break } }
        const m = rs.makeWalker('#3d4a32', '#2b3523'); addGear(THREE, m, 256 | 1 | 2 | 16); scene.add(m)
        kskBots.push({ w: newWalker(x, z, 0), m, cd: 1.5, rk: 4 + Math.random() * 3, dead: 0, n })
      }
      const kskWave = () => {
        const c = chase
        if (!c || c.over || c.from !== online?.userId || stars < 6) return
        if (kskReq.id !== c.id) kskReq = { id: c.id, n: 0 }
        const want = Math.min(8, 3 + (stars - 6) * 2), announce = kskReq.n === 0
        for (let k = 0; kskReq.n < want; kskReq.n++, k++) { const n = kskReq.n; window.setTimeout(() => { if (!dead && chase === c && !c.over) mkKskBot(n) }, 2000 + 1500 * k) }
        if (announce) say('Die KSK rückt an – Elitesoldaten mit Sturmgewehren und Panzerfäusten!')
      }
      const killKskBot = (kb: KskBot) => { if (kb.dead > 0) return; kb.dead = 20; kb.m.rotation.x = -Math.PI / 2; kb.m.position.set(kb.w.x, kb.w.y + 0.25, kb.w.z); say('KSK-Soldat ausgeschaltet!') }
      const tickKskBots = (dt: number) => {
        if (kskBots.length && (!chase || chase.over || stars < 6)) { for (const kb of kskBots) scene.remove(kb.m); kskBots.length = 0; kskReq = { id: '', n: 0 } }
        const me = foot ?? car, my = foot ? foot.y : (car.y ?? 0)
        for (const kb of [...kskBots]) {
          if (kb.dead > 0) { kb.dead -= dt; if (kb.dead <= 0) { scene.remove(kb.m); kskBots.splice(kskBots.indexOf(kb), 1) } continue }
          const dx = me.x - kb.w.x, dz = me.z - kb.w.z, d = Math.hypot(dx, dz)
          let dv = Math.atan2(dx, dz) - kb.w.h; while (dv > Math.PI) dv -= Math.PI * 2; while (dv < -Math.PI) dv += Math.PI * 2
          const sees = d < 120 && clearLine(kb.w.x, kb.w.z, me.x, me.z) && !shotBlocked(kb.w.x, kb.w.y + 1.3, kb.w.z, me.x, my + 1.1, me.z)
          const go = d > (sees ? 24 : 4)
          kb.w = stepWalker({ ...kb.w, h: kb.w.h + dv * Math.min(1, dt * 6) }, { fwd: go && Math.abs(dv) < 1.4, back: false, left: false, right: false, run: d > 30 }, dt)
          kb.cd -= dt
          if (sees && kb.cd <= 0 && !inBunkerNow()) {
            kb.cd = 0.7 + Math.random() * 0.7
            const hit = Math.random() < 0.5
            tracer(kb.w.x, kb.w.y + 1.3, kb.w.z, me.x + (hit ? 0 : (Math.random() - 0.5) * 3), my + 1.1, me.z + (hit ? 0 : (Math.random() - 0.5) * 3))
            if (hit) hurtByShot(foot ? 6 : 5, !!foot, true)
          }
          kb.rk -= dt
          if (sees && kb.n % 2 === 0 && d > 14 && kb.rk <= 0 && !inBunkerNow()) {
            kb.rk = 8
            launchRocket(kb.w.x, kb.w.y + 1.4, kb.w.z, me.x - kb.w.x, 0.15, me.z - kb.w.z, false, () => { const m2 = foot ?? car; return { x: m2.x, y: (foot ? foot.y : (car.y ?? 0)) + 1.2, z: m2.z } }, 38, 1.1)
          }
          kb.m.position.set(kb.w.x, kb.w.y, kb.w.z); kb.m.rotation.y = kb.w.h
          poseWalker(kb.m, kb.w.ph, kb.w.sp, 0, false); armUp(kb.m)
        }
      }
      cleanups.push(() => { for (const kb of kskBots) scene.remove(kb.m) })
      const armyWave = () => {
        const c = chase
        if (!c || c.over || c.from !== online?.userId || stars < 4) return
        if (armyReq.id !== c.id) armyReq = { id: c.id, h: 0, t: 0 }
        const wantH = Math.min(8, 2 + (stars - 4)), wantT = Math.min(9, 3 + (stars - 4))
        let k = 0
        const announce = armyReq.h + armyReq.t === 0
        for (; armyReq.h < wantH; armyReq.h++) { const n = armyReq.h; window.setTimeout(() => { if (!dead && chase === c && !c.over) pbots.push(mkArmy('heli', n)) }, 2500 + 1400 * k++) }
        for (; armyReq.t < wantT; armyReq.t++) { const n = armyReq.t; window.setTimeout(() => { if (!dead && chase === c && !c.over) pbots.push(mkArmy('tank', n)) }, 2500 + 1400 * k++) }
        if (announce && k > 0) say('Die Armee rückt an – Kampfhubschrauber und Panzer!')
      }
      /** Kampfhubschrauber: umkreist das Ziel in ~28 m, steigt über Dächer und schießt von oben */
      const heliAI = (pb: PBot, tg: { id: string; x: number; z: number; y?: number; wk?: boolean }, dt: number) => {
        const dx = tg.x - pb.car.x, dz = tg.z - pb.car.z, d = Math.hypot(dx, dz), ring = 28
        const aim = Math.atan2(dx, dz) + (d < ring ? Math.PI / 2 : 0)
        let dh = aim - pb.car.h; while (dh > Math.PI) dh -= Math.PI * 2; while (dh < -Math.PI) dh += Math.PI * 2
        const wantY = Math.max((tg.y ?? 0) + 18, roofH(pb.car.x, pb.car.z) + 8, 14), cy = pb.car.y ?? 0
        pb.car = stepHeli(pb.car, { gas: d > ring * 0.7 || Math.abs(dh) < 0.4, brake: false, left: dh > 0.08, right: dh < -0.08, fly: cy < wantY - 1 }, cy > wantY + 2, dt, camGround)
        pb.fcd = (pb.fcd ?? 0) - dt
        if (d < 110 && pb.fcd <= 0 && cy > 6) {
          pb.fcd = 0.5
          const hit = Math.random() < 0.5
          tracer(pb.car.x, cy + 0.6, pb.car.z, tg.x + (hit ? 0 : (Math.random() - 0.5) * 4), (tg.y ?? 0) + 1, tg.z + (hit ? 0 : (Math.random() - 0.5) * 4))
          if (hit) { if (tg.id === online?.userId) hurtByShot(5, !!tg.wk, true); else if (ready) void ch?.send({ type: 'broadcast', event: 'sd', payload: { to: tg.id, d: 5, k: tg.wk ? 'f' : 'c', a: 1 } }).catch(() => undefined) }
        }
      }
      /** Panzer: feuert aus dem Rohr auf alles Sichtbare in ~130 m vor sich */
      const tankFire = (pb: PBot, tg: { id: string; x: number; z: number; y?: number; wk?: boolean }, dt: number) => {
        pb.fcd = (pb.fcd ?? 0) - dt
        if (pb.fcd > 0) return
        const dx = tg.x - pb.car.x, dz = tg.z - pb.car.z, d = Math.hypot(dx, dz)
        if (d > 130 || d < 5) return
        let da = Math.atan2(dx, dz) - pb.car.h; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2
        if (Math.abs(da) > 0.5 || !clearLine(pb.car.x, pb.car.z, tg.x, tg.z) || shotBlocked(pb.car.x, (pb.car.y ?? 0) + 1.5, pb.car.z, tg.x, (tg.y ?? 0) + 1, tg.z)) return
        pb.fcd = 1.6
        tracer(pb.car.x + Math.sin(pb.car.h) * 5, (pb.car.y ?? 0) + 2.1, pb.car.z + Math.cos(pb.car.h) * 5, tg.x, (tg.y ?? 0) + 1, tg.z)
        if (tg.id === online?.userId) hurtByShot(12, !!tg.wk, true)
        else if (ready) void ch?.send({ type: 'broadcast', event: 'sd', payload: { to: tg.id, d: 12, k: tg.wk ? 'f' : 'c', a: 1 } }).catch(() => undefined)
      }
      const startChase = (id: string, bandits: string[], cops: string[], bots: number, from: string, role: Role, heist = false, extra = '') => {
        if (!online || chase) return
        iCaught = false
        chase = { id, bandits, got: new Set<string>(), cops, bots, t0: performance.now(), from, over: false, heist, extra, sw: 0 }
        if (role === 'bandit') setStars(Math.max(stars, extra === 'steal' ? 2 : 1))
        window.setTimeout(() => { if (!dead) armyWave() }, 1500)
        // Bankraub: Tresor auf, Fluchtautos (eins je Räuber) stehen vor der Tür; man bleibt zu Fuß
        const bank = heist ? pois().find((p) => p.kind === 'bank') : extra === 'armory' ? pois().find((p) => p.kind === 'police') : undefined
        const station = pois().find((p) => p.kind === 'police')
        if (role === 'bandit' && extra === 'steal' && station) {
          // SWAT-Wagen vom Hof der Wache klauen: man sitzt sofort drin
          car = { ...startCar(track, 0), x: station.x + station.nx * 9, z: station.z + station.nz * 9, h: Math.atan2(station.nx, station.nz), v: 0, lvl: 0, y: 0 }
          foot = null
          if (footMesh) { scene.remove(footMesh); footMesh = null }
          myMesh.visible = true
        } else if (role === 'bandit' && bank) {
          if (heist) rs.setVault(true)
          const n = bank.nx, m = bank.nz, idx = Math.max(0, bandits.indexOf(online.userId))
          const cc = chaseCar('bandit', false, false, false)
          const ux = bank.x + n * 7 + -m * (idx - (bandits.length - 1) / 2) * 5, uz = bank.z + m * 7 + n * (idx - (bandits.length - 1) / 2) * 5
          const pk = mkParked({ ...startCar(track, 0), x: ux, z: uz, h: Math.atan2(n, m), v: 0, lvl: 0, y: 0 }, cc.kind, cc.color, statsFor(cc.kind, cc.top), cc.top, undefined, false)
          pk.sp = false
        } else if (foot) {
          const f0 = foot
          let sx = f0.x, sz = f0.z
          for (const [dx, dz] of [[6, 0], [-6, 0], [0, 6], [0, -6], [9, 0], [-9, 0], [0, 9], [0, -9]] as const) { if (!cityPush(f0.x + dx, f0.z + dz) && !buildingAt(f0.x + dx, f0.z + dz)) { sx = f0.x + dx; sz = f0.z + dz; break } }
          car = { ...startCar(track, 0), x: sx, z: sz, h: f0.h, v: 0, lvl: f0.lvl ?? 0, y: f0.y }
          foot = null
          if (footMesh) { scene.remove(footMesh); footMesh = null }
          myMesh.visible = true
        }
        applyRole(role, extra === 'steal')
        dutyChase = false
        if (role === 'cop' && dutyRef.current === 'p' && (heist || extra)) {
          // Polizist im Dienst: zur Wache gebracht, Streifenwagen aus der Garage, Gangster verfolgen
          const slot = POLICE.slots[POLICE.slots.length - 1 - (Math.max(0, cops.indexOf(online.userId)) % POLICE.slots.length)]
          car = { ...car, x: slot.x, z: slot.z, h: slot.h, v: 0, y: 0, vy: 0, fly: 0, lvl: 0, dmg: 0, hit: 0, steer: 0, slip: 0 }
          foot = null; if (footMesh) { scene.remove(footMesh); footMesh = null }
          myMesh.visible = true; dutyChase = true
          say('Einsatz! Du wurdest zur Wache gebracht – verfolge den Gangster (blaue Linie).')
        }
        if (foot) makeFootMesh()
        if (from === online.userId) pbots = Array.from({ length: extra === 'steal' ? Math.min(4, bots) : Math.min(6, bots) }, (_, i) => mkPbot(i, extra === 'steal'))
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
      let lastPunch = -1e9
      let punchN = 0
      let lastBankPoll = 0
      /** Leben der Figur (auch im Auto: Schäden am Auto und Feuer kosten Leben, es gibt dort keine Erholung) */
      let myHp = hpCfg.max
      let prevV = 0, prevDmg = 0, burnT = 0, wreck = 0, swatHurt = 0
      let footMsg = '', footMsgT = 0
      let lastSpawn = 0, lastRegenHit = 0, lastPark = 0, lastMen = 0
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
        setHeliUi(kind === 'heli')
        myStats = mkStats()
        scene.remove(myMesh)
        myMesh = rs.makeCar(kind, color, me.name, true)
        if (siren) rs.addSiren(myMesh)
        if (kind === 'quad') {
          // der Fahrer sitzt mit seinem eigenen Skin und der KSK-Ausrüstung auf dem Quad
          const pr = myMesh.userData.rider as import('three').Group | undefined; if (pr) pr.visible = false
          const w = rs.makeWalker('#1c231a', '#111827', undefined, skinNow() || undefined)
          addGear(THREE, w, 256 | 1 | 2); seatWalker(w, -0.3, 0.36); myMesh.add(w)
          setQuadWeapon(myMesh, loadoutRef.current.weapon)
        }
        scene.add(myMesh)
        bike = isBike(kind)
        car = { ...car, fly: 0, cool: 0 }
        setChaseKind(myRole || kind !== me.kind ? kind : null)
      }
      const mkParked = (c: Car, kind: string, color: string, st: CarStats, top: number | null | undefined, up: typeof me.up, siren: boolean): Parked => {
        const mesh = rs.makeCar(kind, color, '', false)
        { const rd = mesh.userData.rider as import('three').Group | undefined; if (rd) rd.visible = false }
        if (siren) rs.addSiren(mesh)
        scene.add(mesh)
        const p: Parked = { id: `pk${++parkN}`, car: c, kind, color, st, top, up, siren, mesh }
        parked.push(p)
        if (parked.length > 8) { const o = parked.shift()!; scene.remove(o.mesh) }
        return p
      }
      /** Auto ohne Fahrer sprengen (mehrere Schüsse): Feuerball, Druckwelle, weg */
      const blowParked = (pk: Parked) => {
        if (!parked.includes(pk)) return
        const y0 = (pk.car.y ?? 0) + 0.8
        for (let i = 0; i < 50; i++) {
          const a = Math.random() * Math.PI * 2, sp = 4 + Math.random() * 14
          fx.emit('fire', pk.car.x, y0, pk.car.z, Math.cos(a) * sp, 3 + Math.random() * 12, Math.sin(a) * sp, 0.7 + Math.random() * 0.7)
          if (i % 2 === 0) fx.emit('smoke', pk.car.x, y0, pk.car.z, Math.cos(a) * sp * 0.5, 2 + Math.random() * 7, Math.sin(a) * sp * 0.5, 1.3 + Math.random())
        }
        blastAt(pk.car.x, y0, pk.car.z)
        scene.remove(pk.mesh); parked = parked.filter((q) => q !== pk)
        say('Das Auto ist explodiert!')
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
        footMesh = rs.makeWalker(myRole === 'cop' ? '#1d4ed8' : myRole === 'bandit' ? '#111827' : dutyRef.current === 'f' ? '#b91c1c' : (wcRef.current || eff.color), undefined, undefined, skinNow() || undefined)
        if (batonRef.current || myRole === 'cop') addBaton(THREE, footMesh)
        addGear(THREE, footMesh, myMask())
        scene.add(footMesh)
      }
      const leaveRide = (m?: string) => {
        const r = ride ? remotes.get(ride) : undefined
        ride = null
        foot = exitFromCar({ x: car.x, z: car.z, h: car.h, v: r?.v ?? 0, wid: r ? kindDims(r.kind).wid : 1.8, y: car.y, lvl: car.lvl }, 1, myHp)
        makeFootMesh(); footKo = 0
        if (m) say(m)
      }
      let rideDmg = 0, rideEx = 0, rideBurn = 0
      const tickRide = (dt: number) => {
        const r = ride ? remotes.get(ride) : undefined
        if (!r || !fresh(r) || r.wk || r.rd) { leaveRide('Der Fahrer ist weg – du steigst aus.'); return }
        // Mitfahrer teilen das Schicksal des Autos: Schaden, Feuer und Explosion treffen auch sie
        const dd = r.dmg - rideDmg
        if (dd > 0) myHp -= dd * 0.9 * hpCfg.armor
        rideDmg = r.dmg
        if (r.dmg / DMG_MAX > 0.85) { rideBurn += dt; myHp -= 3.5 * dt * hpCfg.armor } else rideBurn = 0
        if ((r.ex ?? 0) > rideEx) { hospitalRespawn('Das Auto ist explodiert – du hast es nicht überlebt und wachst im Krankenhaus auf.'); return }
        rideEx = r.ex ?? 0
        if (myHp <= 0) { hospitalRespawn('Du hast die Fahrt nicht überlebt – du wachst im Krankenhaus auf.'); return }
        car = { ...car, x: r.x, z: r.z, h: r.h, v: r.v, steer: 0, slip: 0, y: r.yy ?? 0, vy: 0, fly: r.fl, lvl: r.lv ?? 0, dmg: 0, hit: 0, bump: 0 }
      }
      const enterCar = () => {
        const f = foot
        if (!f || footKo > 0 || rescue) return
        const cand: Array<{ x: number; z: number; p?: Parked; pb?: PBot; r?: Remote }> = [...parked.map((p) => ({ x: p.car.x, z: p.car.z, p })), ...pbots.filter((pb) => pb.w && !pb.carGone).map((pb) => ({ x: pb.car.x, z: pb.car.z, pb })), ...[...remotes.values()].filter((r) => !r.wk && !r.rd && !r.id.startsWith('pb-') && fresh(r) && Math.abs((r.yy ?? 0) - f.y) < 2.5).map((r) => ({ x: r.x, z: r.z, r }))]
        const n = nearestCar(f, cand, 5.5)
        if (!n) { say('Kein Auto in der Nähe zum Einsteigen.'); return }
        if ((n.p?.kind ?? n.pb?.kind ?? n.r?.kind) === 'quad' && !(adminRef.current || kskGrantRef.current)) { say('Das Quad ist nur für die KSK.'); return }
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
            if (occ >= seatsOf(r.kind)) { say(`Das Auto ist voll (${occ}/${seatsOf(r.kind)}).`); return }
            ride = r.id; rideDmg = r.dmg; rideEx = r.ex ?? 0; rideBurn = 0; myHp = f.hp
            foot = null
            if (footMesh) { scene.remove(footMesh); footMesh = null }
            myMesh.visible = false
            say(`Du fährst bei ${r.name} mit (${occ + 1}/${seatsOf(r.kind)}). X = aussteigen.`)
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
      /** Nach dem Tod: zu Fuß in einem Bett im Krankenhaus aufwachen (kein neues Auto) */
      const hospitalWake = (msg: string) => {
        const bd = hospitalBed()
        ride = null; wreck = 0
        car = { ...car, x: bd.x, z: bd.z, h: bd.h, v: 0, y: 0, vy: 0, fly: 0, lvl: 0, dmg: 0, hit: 0, steer: 0, slip: 0 }
        myHp = hpCfg.max; prevV = 0; prevDmg = 0; burnT = 0
        foot = { ...newWalker(bd.x, bd.z, bd.h), stun: 1.2 }
        footKo = 0
        makeFootMesh(); myMesh.visible = false
        say(msg)
      }

      // ── Tod und Rettung: Krankenwagen (Bot) oder Sanitäter-Spieler holt die Liege, sonst Wiederbelebung für 10 Coins ──
      interface Medic { w: Walker; m: import('three').Group; key: string }
      interface Rescue { t0: number; phase: 'wait' | 'go' | 'park' | 'walk' | 'carry' | 'back' | 'claimed' | 'carried'; amb?: PBot; medics: Medic[]; stretcher?: import('three').Group; body: { x: number; z: number; h: number; y: number }; claimed?: string; msg: string; free: boolean }
      let rescue: Rescue | null = null
      let dutyChase = false
      const hospLot = { x: (HOSPITAL.lot.x0 + HOSPITAL.lot.x1) / 2, z: HOSPITAL.lot.z1 - 12 }
      /** Krankenhausgelände: der Block samt Gehweg (±48 m) und ein Stück Straße davor */
      const inHospGrounds = (x: number, z: number) => Math.hypot(Math.max(Math.abs(x - HOSPITAL.cx) - 48, 0), Math.max(Math.abs(z - HOSPITAL.cz) - 48, 0)) < 20
      let phaseSeen = '', phaseT = 0
      const mkAmb = (): PBot => {
        const slot = HOSPITAL.slots[0]
        const mesh = rs.makeCar('ambulance', '#f8fafc', 'Krankenwagen', false); scene.add(mesh)
        return { id: `pb-amb-${(online?.userId ?? 'x').slice(0, 6)}`, name: 'Krankenwagen', kind: 'ambulance', color: '#f8fafc', car: { ...startCar(track, 0), x: slot.x, z: slot.z, h: slot.h, v: 0 }, st: statsFor('ambulance', 190), mem: { stuck: 0 }, mesh }
      }
      const mkMedHeli = (): PBot => {
        const mesh = rs.makeCar('heli', '#f8fafc', 'Rettungshubschrauber', false); scene.add(mesh)
        return { id: `pb-mheli-${(online?.userId ?? 'x').slice(0, 6)}`, name: 'Rettungshubschrauber', kind: 'heli', color: '#f8fafc', car: { ...startCar(track, 0), x: hospLot.x, z: hospLot.z, h: 0, v: 0, y: 1 }, st: statsFor('heli', 250), mem: { stuck: 0 }, mesh }
      }
      /** Rettungshubschrauber fliegt zu einem Punkt (Reiseflug über den Dächern, am Ziel im Sinkflug) */
      const heliTo = (a: PBot, tx: number, tz: number, dt: number, land: boolean) => {
        const dx = tx - a.car.x, dz = tz - a.car.z, d = Math.hypot(dx, dz)
        let dh = Math.atan2(dx, dz) - a.car.h; while (dh > Math.PI) dh -= Math.PI * 2; while (dh < -Math.PI) dh += Math.PI * 2
        const cy = a.car.y ?? 0, alt = land && d < 26 ? 0 : Math.max(26, roofH(a.car.x, a.car.z) + 10)
        a.car = stepHeli(a.car, { gas: d > 16 && Math.abs(dh) < 0.8, brake: d < 14 && a.car.v > 5, left: dh > 0.06, right: dh < -0.06, fly: cy < alt - 1 }, cy > alt + 1, dt, camGround)
      }
      const holdCar = (a: PBot, dt: number) => { a.car = a.kind === 'heli' ? { ...stepHeli({ ...a.car, v: 0 }, { gas: false, brake: false, left: false, right: false }, true, dt, camGround), v: 0, x: a.car.x, z: a.car.z, h: a.car.h } : stepCar(a.car, { ...idleIn, brake: true }, dt, track, a.st, true) }
      const mkStretcher = (): import('three').Group => {
        const g = new THREE.Group()
        const frame = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.08, 2.0), new THREE.MeshStandardMaterial({ color: 0xe5e7eb, roughness: 0.6 }))
        const pad = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 1.9), new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.8 })); pad.position.y = 0.1
        const cross = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.1), new THREE.MeshBasicMaterial({ color: 0xffffff })); cross.position.set(0, 0.17, 0.7)
        g.add(frame, pad, cross)
        return g
      }
      const clearRescueMeshes = () => {
        if (!rescue) return
        if (rescue.amb) scene.remove(rescue.amb.mesh)
        for (const m of rescue.medics) scene.remove(m.m)
        if (rescue.stretcher) scene.remove(rescue.stretcher)
        rescue.amb = undefined; rescue.medics = []; rescue.stretcher = undefined
      }
      function rescueClaim(by: string) {
        if (!rescue) return
        rescue.claimed = by; rescue.phase = 'claimed'
        if (rescue.amb) { scene.remove(rescue.amb.mesh); rescue.amb = undefined }
        say('Ein Sanitäter ist auf dem Weg zu dir!')
      }
      const startRescue = (msg: string) => {
        setStars(0)
        if (tempVest) { tempVest = false; applyGear({ ...gearRef.current, vest: false }) }
        if (armyGun) { armyGun = null; zoomOn = false; setSniperUi(false) }
        ownLong.rifle = false; ownLong.sniper = false
        if (!hospitalBed || !pois().some((q) => q.kind === 'hospital') || rescue) { hospitalWake(msg); return }
        const bx = foot ? foot.x : car.x, bz = foot ? foot.z : car.z, bh = foot ? foot.h : car.h, by = foot ? foot.y : (car.y ?? 0)
        // Gefangen ist man nur noch, wenn man in der Jagd stirbt
        if (chase && !chase.over && myRole === 'bandit' && !iCaught && online) markCaught(online.userId, true)
        ride = null; wreck = 0; footKo = 0
        myHp = 1; prevV = 0; prevDmg = 0; burnT = 0; swatHurt = 0
        car = { ...car, x: bx, z: bz, v: 0, fly: 0, dmg: 0, hit: 0, steer: 0, slip: 0 }
        foot = { ...newWalker(bx, bz, bh, by), hp: 1, stun: 99 }
        rescue = { t0: performance.now(), phase: 'wait', medics: [], body: { x: bx, z: bz, h: bh, y: by }, msg, free: adminRef.current }
        makeFootMesh(); myMesh.visible = false
        say(msg + ' Hilfe ist unterwegs …')
      }
      /** Aufwachen im Krankenhausbett (Rettung abgeschlossen) */
      function finishRescue() {
        const r = rescue
        clearRescueMeshes(); rescue = null
        hospitalWake(r ? 'Du wurdest ins Krankenhaus gebracht und liegst im Bett.' : 'Du wachst im Krankenhaus auf.')
      }
      /** Sofort wiederbeleben, an Ort und Stelle */
      function reviveHere(msg: string) {
        const r = rescue
        if (!r) return
        clearRescueMeshes(); rescue = null
        myHp = hpCfg.max
        const b = r.body
        foot = { ...newWalker(b.x, b.z, b.h, b.y), inv: 2.5 }
        footKo = 0
        makeFootMesh(); myMesh.visible = false
        say(msg)
      }
      reviveRef.current = () => {
        if (!rescue) return
        setReviveUi((o) => ({ ...o, busy: true }))
        void raceRevivePay().then((bal) => { if (dead) return; walletRef.current?.setBalance(bal); reviveHere('Wiederbelebt!') }).catch((e) => say(errorMessage(e))).finally(() => { if (!dead) setReviveUi((o) => ({ ...o, busy: false })) })
      }
      reviveOtherRef.current = (id) => { if (adminRef.current && ready) void ch?.send({ type: 'broadcast', event: 'rv', payload: { to: id } }).catch(() => undefined) }
      const steerTo = (bot: PBot, tx: number, tz: number, dt: number) => {
        const d = copDrive(bot.car, { x: tx, z: tz }, bot.mem, dt)
        if (d.reset) bot.car = { ...bot.car, x: d.reset.x, z: d.reset.z, h: d.reset.h, v: 0, steer: 0, slip: 0, dmg: 0, hold: 0, lvl: 0, y: 0 }
        if (d.repair) bot.car = { ...bot.car, dmg: 0, hold: 0 }
        bot.car = stepCar(bot.car, { ...d.inp, fly: false, chase: true }, dt, track, bot.st, true)
      }
      const walkTo = (m: Medic, tx: number, tz: number, dt: number): number => {
        const nv = navFoot(m.key, { x: m.w.x, z: m.w.z, y: m.w.y }, { x: tx, z: tz, y: rescue?.body.y ?? 0 })
        let dh = Math.atan2(nv.x - m.w.x, nv.z - m.w.z) - m.w.h; while (dh > Math.PI) dh -= Math.PI * 2; while (dh < -Math.PI) dh += Math.PI * 2
        const d = Math.hypot(tx - m.w.x, tz - m.w.z)
        m.w = stepWalker(m.w, { fwd: d > 1.2 && Math.abs(dh) < 1.3, back: false, left: dh > 0.12, right: dh < -0.12, run: true }, dt)
        return d
      }
      const tickRescue = (dt: number, nowT: number) => {
        const r = rescue
        if (!r || !foot) return
        const b = r.body, t = (nowT - r.t0) / 1000
        foot = { ...foot, stun: 99, hp: 1 }
        if (phaseSeen !== r.phase) { phaseSeen = r.phase; phaseT = nowT }
        const stuckFor = (nowT - phaseT) / 1000
        const hasMedic = [...remotes.values()].some((x) => x.od === 'm' && fresh(x) && !x.dn)
        if (r.phase === 'wait') {
          if (t > (hasMedic ? 14 : 5)) { const far = Math.hypot(b.x - hospLot.x, b.z - hospLot.z) > 260; r.amb = far ? mkMedHeli() : mkAmb(); r.phase = 'go'; say(far ? 'Ein Rettungshubschrauber fliegt zu dir.' : 'Ein Krankenwagen fährt zu dir.') }
        } else if (r.phase === 'go' && r.amb) {
          const a = r.amb, dd = Math.hypot(b.x - a.car.x, b.z - a.car.z)
          const isH = a.kind === 'heli'
          if (isH ? dd < 7 && (a.car.y ?? 0) < 3.5 && Math.abs(a.car.v) < 3 : dd < 20 && Math.abs(a.car.v) < 3) {
            // mit etwas Abstand geparkt: zwei Sanitäter steigen aus und bringen die Trage
            const sx = Math.cos(a.car.h), sz = -Math.sin(a.car.h)
            r.medics = [-1, 1].map((sd) => {
              const w = newWalker(a.car.x + sx * sd * 2.4, a.car.z + sz * sd * 2.4, a.car.h, a.car.y ?? 0)
              const m = makeMedic(THREE); scene.add(m)
              return { w, m, key: `med${sd}` }
            })
            r.stretcher = mkStretcher(); scene.add(r.stretcher)
            r.phase = 'walk'
          } else if (isH) heliTo(a, b.x, b.z, dt, true)
          else if (dd < 20) holdCar(a, dt)
          else {
            steerTo(a, b.x, b.z, dt)
            if (stuckFor > 45) {
              // Notfall: der Krankenwagen steht schon in der Nähe, falls er sich verirrt hat
              for (const [ox, oz] of [[16, 0], [-16, 0], [0, 16], [0, -16], [22, 0], [-22, 0], [0, 22], [0, -22]] as const) if (!cityPush(b.x + ox, b.z + oz) && !buildingAt(b.x + ox, b.z + oz)) { a.car = { ...a.car, x: b.x + ox, z: b.z + oz, v: 0, lvl: 0, y: 0 }; break }
              phaseT = nowT
            }
          }
        } else if (r.phase === 'walk') {
          const a = r.amb
          const d0 = walkTo(r.medics[0], b.x - Math.cos(b.h) * 0.9, b.z + Math.sin(b.h) * 0.9, dt), d1 = walkTo(r.medics[1], b.x + Math.cos(b.h) * 0.9, b.z - Math.sin(b.h) * 0.9, dt)
          if (r.stretcher) { const m0 = r.medics[0].w, m1 = r.medics[1].w; r.stretcher.position.set((m0.x + m1.x) / 2, m0.y + 0.7, (m0.z + m1.z) / 2); r.stretcher.rotation.y = Math.atan2(m1.x - m0.x, m1.z - m0.z) + Math.PI / 2 }
          if (stuckFor > 25) for (const [i, m] of r.medics.entries()) m.w = { ...m.w, x: b.x + (i ? 2 : -2), z: b.z + 0.5, y: b.y }
          if (d0 < 2.2 && d1 < 2.2) { r.phase = 'carry'; say('Die Sanitäter legen dich auf die Trage …') }
          if (a) holdCar(a, dt)
        } else if (r.phase === 'carry' && r.amb) {
          const a = r.amb, bx = a.car.x - Math.sin(a.car.h) * 4.2, bz = a.car.z - Math.cos(a.car.h) * 4.2
          const d0 = walkTo(r.medics[0], bx - Math.cos(a.car.h) * 0.9, bz + Math.sin(a.car.h) * 0.9, dt), d1 = walkTo(r.medics[1], bx + Math.cos(a.car.h) * 0.9, bz - Math.sin(a.car.h) * 0.9, dt)
          const m0 = r.medics[0].w, m1 = r.medics[1].w
          const mx = (m0.x + m1.x) / 2, mz = (m0.z + m1.z) / 2
          if (r.stretcher) { r.stretcher.position.set(mx, m0.y + 0.7, mz); r.stretcher.rotation.y = Math.atan2(m1.x - m0.x, m1.z - m0.z) + Math.PI / 2 }
          foot = { ...foot, x: mx, z: mz, y: m0.y + 0.95, h: Math.atan2(m1.x - m0.x, m1.z - m0.z) + Math.PI / 2 }
          if (stuckFor > 25) for (const [i, m] of r.medics.entries()) m.w = { ...m.w, x: a.car.x - Math.sin(a.car.h) * 3 + (i ? 1 : -1), z: a.car.z - Math.cos(a.car.h) * 3 }
          holdCar(a, dt)
          if (d0 < 2.6 && d1 < 2.6) {
            for (const m of r.medics) scene.remove(m.m)
            if (r.stretcher) scene.remove(r.stretcher)
            r.medics = []; r.stretcher = undefined; r.phase = 'back'
            if (footMesh) footMesh.visible = false
            say('Du liegst im Krankenwagen – es geht ins Krankenhaus.')
          }
        } else if (r.phase === 'back' && r.amb) {
          const a = r.amb
          if (a.kind === 'heli') heliTo(a, hospLot.x, hospLot.z, dt, true); else steerTo(a, hospLot.x, hospLot.z, dt)
          foot = { ...foot, x: a.car.x, z: a.car.z, y: a.car.y ?? 0 }
          if (inHospGrounds(a.car.x, a.car.z)) finishRescue()
        } else if (r.phase === 'carried') {
          const m = r.claimed ? remotes.get(r.claimed) : undefined
          if (m) foot = { ...foot, x: m.x, z: m.z, y: m.yy ?? 0 }
          if (footMesh) footMesh.visible = false
        }
        // Sanitäter zeigen: Figuren setzen, tragen mit nach vorn gestreckten Armen
        for (const m of r.medics) {
          m.m.position.set(m.w.x, m.w.y, m.w.z); m.m.rotation.y = m.w.h
          poseWalker(m.m, m.w.ph, m.w.sp, 0, false)
          const u = m.m.userData as Record<string, import('three').Group>
          if (u.armL && u.armR) { u.armL.rotation.x = -1.0; u.armR.rotation.x = -1.0 }
        }
        // Sanitäter-Spieler ausgefallen oder zu langsam: nach 100 s kommt doch die Rettung
        if (t > 110 && r.phase !== 'back') { finishRescue(); return }
        if (r.phase === 'claimed' && t > 70) { r.claimed = undefined; r.phase = 'go'; r.amb = mkAmb(); say('Der Sanitäter ist nicht angekommen – ein Krankenwagen fährt zu dir.') }
        if (footMesh && r.phase !== 'back' && r.phase !== 'carried') footMesh.visible = true
      }
      const hospitalRespawn = (msg: string) => { startRescue(msg) }

      // ── Dienste: Polizei (Ankleidezimmer in der Wache) und Sanitäter (Ankleidezimmer im Krankenhaus) ──
      // ── Brände und Feuerwehr ──
      // Alle 4 Minuten brennt ein Haus (Plan nur nach Uhrzeit, siehe fire.ts). Löschen: Löschzug (Q/Tippen) oder als Feuerwehrmann mit dem Schlauch zu Fuß; ohne Spieler rückt ein Bot-Löschzug an.
      const fireHp = new Map<number, number>()
      const fireDone = new Set<number>()
      let fireAnn = -1, fireMine = -1, fireLastEm = 0
      const hpOf = (f: FireInfo) => fireHp.get(f.slot) ?? 100
      const curFire = (): FireInfo | null => { const f = currentFire(Date.now()); return f && !fireDone.has(f.slot) ? f : null }
      const fireGlow = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xff5a00, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }))
      fireGlow.visible = false; scene.add(fireGlow)
      // Flammenzungen: feste Kegel auf Dach und an den Fenstern, flackern je nach Stärke (zuverlässiger sichtbar als nur Partikel)
      const flameGeo = new THREE.ConeGeometry(1, 1, 7, 1, true)
      const flameMats = [0xe11d00, 0xff6a00, 0xffb81c].map((c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }))
      const flames = Array.from({ length: 30 }, (_, i) => { const m = new THREE.Mesh(flameGeo, flameMats[i % 3]); m.visible = false; scene.add(m); return { m, u: Math.random(), v: Math.random(), roof: i < 14, ph: Math.random() * 6.28, sz: 0.7 + Math.random() * 0.9 } })
      let flameSlot = -1
      cleanups.push(() => { for (const fl of flames) scene.remove(fl.m); flameGeo.dispose(); for (const m of flameMats) m.dispose() })
      cleanups.push(() => { scene.remove(fireGlow); fireGlow.geometry.dispose(); (fireGlow.material as import('three').Material).dispose() })
      const wallDist = (f: FireInfo, x: number, z: number) => Math.hypot(Math.max(Math.abs(x - f.b.x) - f.b.w / 2, 0), Math.max(Math.abs(z - f.b.z) - f.b.d / 2, 0))
      const extinguish = (f: FireInfo, mine: boolean) => {
        if (fireDone.has(f.slot)) return
        fireDone.add(f.slot)
        for (let i = 0; i < 40; i++) fx.emit('cloud', f.b.x + (Math.random() - 0.5) * f.b.w, 2 + Math.random() * f.b.h, f.b.z + (Math.random() - 0.5) * f.b.d, (Math.random() - 0.5) * 3, 3 + Math.random() * 4, (Math.random() - 0.5) * 3, 5 + Math.random() * 4)
        void ch?.send({ type: 'broadcast', event: 'fo', payload: { s: f.slot } }).catch(() => undefined)
        say(mine ? 'Feuer gelöscht! Gut gemacht.' : 'Das Feuer ist gelöscht.')
        if (mine && dutyRef.current === 'f') void raceDutyPay('fire').then((r) => { if (dead || !r.coins) return; say(`Einsatz abgeschlossen: +${r.coins} Coins`); if (r.koins !== null) walletRef.current?.setBalance(r.koins) }).catch(() => undefined)
      }
      /** Wasserstrahl von (ox,oz) in Richtung h: Partikel + Wirkung auf das brennende Haus */
      const sprayAt = (ox: number, oy: number, oz: number, h: number, reach: number, power: number, mine: boolean) => {
        for (let i = 0; i < 4; i++) {
          const a = h + (Math.random() - 0.5) * 0.1, sp = reach * (0.7 + Math.random() * 0.5)
          fx.emit('cloud', ox + Math.sin(a) * 2, oy, oz + Math.cos(a) * 2, Math.sin(a) * sp, 3 + Math.random() * 5, Math.cos(a) * sp, 1.2 + Math.random() * 1.2)
        }
        const f = curFire(); if (!f) return
        const dist = wallDist(f, ox, oz)
        let da = Math.atan2(f.b.x - ox, f.b.z - oz) - h; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2
        if (dist > 5 && Math.abs(da) > 0.7) return
        const before = hpOf(f), after = douse(before, dist, reach, power)
        if (after < before) { fireHp.set(f.slot, after); if (mine) fireMine = f.slot; if (after <= 0) extinguish(f, mine && fireMine === f.slot) }
      }
      const sprayTruck = () => {
        const nowT = performance.now(); if (nowT - lastShot < 90) return
        lastShot = nowT
        const tall = Math.abs(car.v) < 4 ? 4.5 : 2.6
        sprayAt(car.x, (car.y ?? 0) + tall, car.z, car.h, 60, 5, true)
      }
      const sprayHose = () => {
        const nowT = performance.now(); if (!foot || nowT - lastShot < 110) return
        lastShot = nowT
        sprayAt(foot.x, foot.y + 1.2, foot.z, foot.h, 24, 2.4, true)
      }
      // Feuerwehr-Alarm: Feuerwehrleute werden ins Obergeschoss gebeamt, rutschen die Stange runter und steigen in den Löschzug
      let alarm: { t0: number; phase: 'up' | 'slide' | 'board'; x: number; z: number } | null = null
      const poleSpot = () => pois().find((q) => q.kind === 'fire')?.spots.find((q) => q.kind === 'pole')
      const startAlarm = () => {
        const sp = poleSpot(); if (!sp || !foot || chase || rescue || ride || alarm) return
        foot = { ...foot, x: sp.x + 1.2, z: sp.z, y: 5.05, vx: 0, vy: 0, vz: 0, stun: 99 }
        alarm = { t0: performance.now(), phase: 'up', x: sp.x, z: sp.z }
        say('🚨 ALARM! Brand in der Stadt – ab zur Rutschstange!')
      }
      const slidePole = () => {
        const sp = poleSpot(); if (!sp || !foot || alarm) return
        foot = { ...foot, x: sp.x, z: sp.z, y: foot.y, vx: 0, vy: 0, vz: 0, stun: 99 }
        alarm = { t0: performance.now(), phase: 'slide', x: sp.x, z: sp.z }
        say('Du rutschst die Stange runter …')
      }
      const tickAlarm = (nowT: number) => {
        if (!alarm || !foot) { if (alarm && !foot) alarm = null; return }
        const t = (nowT - alarm.t0) / 1000
        if (alarm.phase === 'up') { if (t > 2.2) { alarm.phase = 'slide'; alarm.t0 = nowT } return }
        if (alarm.phase === 'slide') {
          const k = Math.min(1, t / 1.1)
          foot = { ...foot, x: alarm.x, z: alarm.z, y: 5.05 * (1 - k * k), vx: 0, vy: 0, vz: 0, stun: 99 }
          if (k >= 1) {
            const sl = FIRE.slots[0]
            foot = { ...foot, x: sl.x - 4, z: sl.z + 2.5, y: 0, stun: 0 }
            alarm.phase = 'board'; alarm.t0 = nowT
            const f = curFire(); setRoute(f ? { x: f.b.x, z: f.b.z } : null)
            if (!parked.some((q) => q.kind === 'firetruck' && Math.hypot(q.car.x - sl.x, q.car.z - sl.z) < 8)) mkParked({ ...startCar(track, 0), x: sl.x, z: sl.z, h: sl.h, v: 0 }, 'firetruck', '#dc2626', statsFor('firetruck', 150), 150, undefined, false)
            if (dutyRef.current === 'f' && f) { enterCar(); if (eff.kind === 'firetruck') say('Los! Zum Brand – die blaue Linie zeigt den Weg. Q/Tippen spritzt Wasser.') }
          }
          return
        }
        if (t > 0.5) alarm = null
      }
      // Löschzüge stehen in der Halle der Feuerwache und kommen nach einer Weile wieder
      let lastTruckCheck = 0
      const keepTrucks = (nowT: number) => {
        if (!isCity || nowT - lastTruckCheck < 4000) return
        lastTruckCheck = nowT
        for (const sl of FIRE.slots.slice(0, 2)) {
          const busy = parked.some((q) => q.kind === 'firetruck' && Math.hypot(q.car.x - sl.x, q.car.z - sl.z) < 6) || (eff.kind === 'firetruck' && !foot && Math.hypot(car.x - sl.x, car.z - sl.z) < 6) || (fireBot && Math.hypot(fireBot.truck.car.x - sl.x, fireBot.truck.car.z - sl.z) < 6)
          if (busy) continue
          if (Math.hypot((foot ?? car).x - sl.x, (foot ?? car).z - sl.z) < 25) continue
          if (parked.filter((q) => q.kind === 'firetruck').length >= 2 || (fireBot && Math.hypot(fireBot.truck.car.x - sl.x, fireBot.truck.car.z - sl.z) < 200)) break
          mkParked({ ...startCar(track, 0), x: sl.x, z: sl.z, h: sl.h, v: 0 }, 'firetruck', '#dc2626', statsFor('firetruck', 150), 150, undefined, false)
        }
      }
      // Bot-Löschzug: fährt zum Brand, fährt die Drehleiter aus, löscht, fährt zurück (nur ein Spieler – der mit der kleinsten Kennung – startet ihn)
      interface FireBot { slot: number; truck: PBot; phase: 'go' | 'work' | 'back'; t0: number; ladder: number }
      let fireBot: FireBot | null = null
      const fireHost = () => !online || [online.userId, ...[...remotes.values()].filter((r) => fresh(r) && !r.id.startsWith('pb-')).map((r) => r.id)].sort()[0] === online.userId
      const tickFireBot = (dt: number, nowT: number) => {
        const f = curFire(), nowMs = Date.now()
        if (!fireBot && f && nowMs - f.startMs > 25_000 && fireHost() && !fireBotDone.has(f.slot) && !(eff.kind === 'firetruck' && !foot)) {
          const sl = FIRE.slots[2], mesh = rs.makeCar('firetruck', '#dc2626', 'Feuerwehr', false); rs.addSiren(mesh); scene.add(mesh)
          fireBotDone.add(f.slot)
          fireBot = { slot: f.slot, truck: { id: `pb-fire-${(online?.userId ?? 'x').slice(0, 6)}`, name: 'Feuerwehr', kind: 'firetruck', color: '#dc2626', car: { ...startCar(track, 0), x: sl.x, z: sl.z, h: sl.h, v: 0 }, st: statsFor('firetruck', 150), mem: { stuck: 0 }, mesh } as PBot, phase: 'go', t0: nowT, ladder: 0 }
        }
        const fb = fireBot; if (!fb) return
        const tr = fb.truck, live = f && f.slot === fb.slot ? f : null
        if (fb.phase === 'go') {
          if (!live) fb.phase = 'back'
          else {
            const sp = parkSpot(live.b, tr.car.x, tr.car.z)
            steerTo(tr, sp.x, sp.z, dt)
            const d = Math.hypot(sp.x - tr.car.x, sp.z - tr.car.z)
            if (d < 10 || nowT - fb.t0 > 90_000) { fb.phase = 'work'; fb.t0 = nowT; if (d >= 10) { tr.car = { ...tr.car, x: sp.x, z: sp.z, v: 0 } } }
          }
        } else if (fb.phase === 'work') {
          holdCar(tr, dt)
          if (!live) fb.phase = 'back'
          else {
            const hd = Math.atan2(live.b.x - tr.car.x, live.b.z - tr.car.z)
            let dh = hd - tr.car.h; while (dh > Math.PI) dh -= Math.PI * 2; while (dh < -Math.PI) dh += Math.PI * 2
            tr.car = { ...tr.car, h: tr.car.h + Math.max(-1, Math.min(1, dh)) * 1.2 * dt }
            fb.ladder = Math.min(1, fb.ladder + dt / 3)
            if (fb.ladder > 0.9) sprayAt(tr.car.x + Math.sin(tr.car.h) * 8, 9, tr.car.z + Math.cos(tr.car.h) * 8, tr.car.h, 60, 12 * dt * 2, false)
          }
        } else {
          fb.ladder = Math.max(0, fb.ladder - dt / 2)
          const sl = FIRE.slots[2]
          if (fb.ladder > 0) holdCar(tr, dt); else steerTo(tr, sl.x, sl.z, dt)
          if (fb.ladder <= 0 && (Math.hypot(sl.x - tr.car.x, sl.z - tr.car.z) < 12 || nowT - fb.t0 > 240_000)) { scene.remove(tr.mesh); fireBot = null; return }
        }
        setFireLadder(tr.mesh, fb.ladder)
      }
      const fireBotDone = new Set<number>()
      const tickFire = (dt: number, nowT: number) => {
        const f = curFire(), nowMs = Date.now()
        keepTrucks(nowT); tickAlarm(nowT); tickFireBot(dt, nowT)
        // eigener Löschzug: Leiter hoch, wenn er am Brand steht
        if (eff.kind === 'firetruck' && !foot) { const near = f && wallDist(f, car.x, car.z) < 40 && Math.abs(car.v) < 3; const k = (myMesh.userData.ladK as number | undefined) ?? 0; const nk = near ? Math.min(1, k + dt / 3) : Math.max(0, k - dt / 2); myMesh.userData.ladK = nk; setFireLadder(myMesh, nk) }
        if (!f) { fireGlow.visible = false; for (const fl of flames) fl.m.visible = false; return }
        if (fireAnn !== f.slot) {
          fireAnn = f.slot
          say('🔥 Brand! Ein Haus steht in Flammen – die Feuerwehr rückt aus.')
          if (dutyRef.current === 'f') startAlarm()
        }
        const lvl = flameLevel(f, nowMs, hpOf(f))
        const px = (foot ?? car).x, pz = (foot ?? car).z
        if (Math.hypot(px - f.b.x, pz - f.b.z) > 320) { fireGlow.visible = false; for (const fl of flames) fl.m.visible = false; return }
        if (flameSlot !== f.slot) { flameSlot = f.slot; for (const fl of flames) { fl.u = Math.random(); fl.v = Math.random() } }
        for (const [i, fl] of flames.entries()) {
          const wall = i % 4, hh = 3 + fl.v * Math.max(1, f.b.h - 5)
          if (fl.roof) fl.m.position.set(f.b.x + (fl.u - 0.5) * f.b.w * 0.85, f.b.h + 0.4, f.b.z + (fl.v - 0.5) * f.b.d * 0.85)
          else if (wall < 2) fl.m.position.set(f.b.x + (wall ? 1 : -1) * (f.b.w / 2 + 0.4), hh, f.b.z + (fl.u - 0.5) * f.b.d * 0.9)
          else fl.m.position.set(f.b.x + (fl.u - 0.5) * f.b.w * 0.9, hh, f.b.z + (wall === 2 ? 1 : -1) * (f.b.d / 2 + 0.4))
          const fk = lvl * fl.sz * (0.75 + 0.25 * Math.sin(nowT / 110 + fl.ph)) * (fl.roof ? 1 : 0.7)
          fl.m.scale.set(1.6 * fk + 0.01, 5.5 * fk + 0.01, 1.6 * fk + 0.01); fl.m.position.y += 2.7 * fk
          fl.m.visible = lvl > 0.03
        }
        fireGlow.visible = lvl > 0.02
        fireGlow.position.set(f.b.x, f.b.h / 2, f.b.z); fireGlow.scale.set(f.b.w + 0.8, f.b.h + 0.8, f.b.d + 0.8)
        ;(fireGlow.material as import('three').MeshBasicMaterial).opacity = (0.05 + 0.1 * lvl) * (0.8 + 0.2 * Math.sin(nowT / 90))
        if (nowT - fireLastEm > 40) {
          fireLastEm = nowT
          const n = Math.round(1 + lvl * 6)
          for (let i = 0; i < n; i++) {
            const onRoof = Math.random() < 0.5
            const x = f.b.x + (Math.random() - 0.5) * f.b.w * 0.9, z = f.b.z + (Math.random() - 0.5) * f.b.d * 0.9
            const y = onRoof ? f.b.h + 0.3 : 3 + Math.random() * (f.b.h - 4)
            // Fensterflammen schlagen an den Wänden heraus
            const wx = onRoof ? x : f.b.x + (Math.random() < 0.5 ? -1 : 1) * (f.b.w / 2 + 0.3), wz = onRoof ? z : f.b.z + (Math.random() - 0.5) * f.b.d * 0.9
            fx.emit('fire', wx, y, wz, (Math.random() - 0.5) * 2, 3 + Math.random() * 6 * lvl, (Math.random() - 0.5) * 2, 2 + Math.random() * 3 * (0.4 + lvl))
          }
          fx.emit('smoke', f.b.x + (Math.random() - 0.5) * f.b.w * 0.6, f.b.h + 1, f.b.z + (Math.random() - 0.5) * f.b.d * 0.6, 2 + Math.random() * 2, 6 + Math.random() * 4, 1, 5 + Math.random() * 4)
        }
      }
      const toggleDuty = (kind: 'p' | 'm' | 'f') => {
        if (chase || rescue) return
        const on = dutyRef.current === kind
        dutyRef.current = on ? '' : kind; setDutyUi(dutyRef.current); if (foot) makeFootMesh()
        say(on ? 'Du bist nicht mehr im Dienst.' : kind === 'p' ? 'Du bist jetzt Polizist! Bei Bankraub, Autodiebstahl und Waffenkammer-Einbruch wirst du zur Wache gebracht – dafür gibt es Coins.' : kind === 'f' ? 'Du bist jetzt Feuerwehrmann! Bei einem Brand ertönt der Alarm – du rutschst die Stange runter und fährst mit dem Löschzug los (Coins für jedes gelöschte Feuer).' : 'Du bist jetzt Sanitäter! Wenn jemand stirbt, wirst du mit dem Krankenwagen losgeschickt – dafür gibt es Coins.')
      }
      // gestrichelte Wegelinie auf den Straßen zum Ziel
      const dashMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, 0.06, 3.4), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }), 520)
      dashMesh.count = 0; dashMesh.frustumCulled = false; scene.add(dashMesh)
      cleanups.push(() => { scene.remove(dashMesh); dashMesh.dispose() })
      let routeTgt: { x: number; z: number } | null = null, routeAt = 0
      const setRoute = (t: { x: number; z: number } | null) => { routeTgt = t; routeAt = 0; if (!t) dashMesh.count = 0 }
      const updateRoute = (nowT: number) => {
        if (!routeTgt || nowT - routeAt < 1000) return
        routeAt = nowT
        const src = foot ?? car, P = CITY.pitch, T = routeTgt
        const pts = streetRoute(src.x, src.z, T.x, T.z, P, 6)
        const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1)
        let n = 0
        for (let i = 0; i + 1 < pts.length && n < 520; i++) {
          const [x0, z0] = pts[i], [x1, z1] = pts[i + 1], len = Math.hypot(x1 - x0, z1 - z0)
          if (len < 1) continue
          const yaw = Math.atan2(x1 - x0, z1 - z0); qq.setFromAxisAngle(up, yaw)
          const alongBridge = Math.abs(z1 - z0) < 1 && !!bridgeAt((x0 + x1) / 2, z0)
          for (let d = 2; d < len && n < 520; d += 7) {
            const px = x0 + ((x1 - x0) * d) / len, pz = z0 + ((z1 - z0) * d) / len
            m4.compose(new THREE.Vector3(px, 0.34 + (alongBridge ? bridgeH(px, pz) : 0), pz), qq, one); dashMesh.setMatrixAt(n++, m4)
          }
        }
        dashMesh.count = n; dashMesh.instanceMatrix.needsUpdate = true
      }
      // Sanitäter-Einsatz (Spieler): zum Krankenhaus teleportiert, im Krankenwagen zum Patienten, dann zurück
      let mission: { victim: string; phase: 'drive' | 'back'; t0: number } | null = null
      let lastDuty = 0
      const endMission = () => { mission = null; setRoute(null); applyRole(null) }
      const tickDuty = (nowT: number) => {
        updateRoute(nowT)
        if (nowT - lastDuty < 500) return
        lastDuty = nowT
        { const mineNow = !!rescue, oth = adminRef.current ? [...remotes.values()].find((x) => x.dn && fresh(x) && Math.hypot(x.x - (foot ?? car).x, x.z - (foot ?? car).z) < 90) : undefined
        { const near = adminRef.current ? [...remotes.values()].filter((x) => !x.rd && !x.id.startsWith('pb-') && x.id !== online?.userId && fresh(x) && Math.hypot(x.x - (foot ?? car).x, x.z - (foot ?? car).z) < 60).sort((a, b) => Math.hypot(a.x - (foot ?? car).x, a.z - (foot ?? car).z) - Math.hypot(b.x - (foot ?? car).x, b.z - (foot ?? car).z))[0] : undefined
          setGrantUi((g) => (near ? (g && g.id === near.id ? g : { id: near.id, name: near.name, on: granted.has(near.id), k: grantedK.has(near.id) }) : g ? null : g)) }
          setReviveUi((o) => (o.mine === mineNow && o.other?.id === oth?.id ? o : { ...o, mine: mineNow, other: oth ? { id: oth.id, name: oth.name } : null })) }
        // Polizist im Dienst: Weg zum nächsten Gangster
        if (chase && !chase.over && myRole === 'cop' && dutyRef.current === 'p') {
          let best: Remote | null = null
          for (const bd of chase.bandits) { const rr = remotes.get(bd); if (rr && fresh(rr) && !chase.got.has(bd) && (!best || Math.hypot(rr.x - car.x, rr.z - car.z) < Math.hypot(best.x - car.x, best.z - car.z))) best = rr }
          setRoute(best ? { x: best.x, z: best.z } : chase.from === online?.userId ? null : null)
        } else if (dutyRef.current === 'f') { const fr = curFire(); setRoute(fr ? { x: fr.b.x, z: fr.b.z } : null) } else if (!mission && !rescue) setRoute(null)
        if (!online || dutyRef.current !== 'm' || chase || rescue) { if (mission && dutyRef.current !== 'm') endMission(); return }
        if (!mission) {
          const v = [...remotes.values()].find((x) => x.dn && !x.dc && fresh(x) && !x.id.startsWith('pb-'))
          if (!v) return
          mission = { victim: v.id, phase: 'drive', t0: nowT }
          if (ready) void ch?.send({ type: 'broadcast', event: 'mc', payload: { to: v.id, by: online.userId } }).catch(() => undefined)
          const slot = HOSPITAL.slots[1]
          car = { ...car, x: slot.x, z: slot.z, h: slot.h, v: 0, y: 0, vy: 0, fly: 0, lvl: 0, dmg: 0, hit: 0, steer: 0, slip: 0 }
          foot = null; if (footMesh) { scene.remove(footMesh); footMesh = null }
          const farAway = Math.hypot(v.x - hospLot.x, v.z - hospLot.z) > 260
          setVehicle(farAway ? 'heli' : 'ambulance', '#f8fafc', null, undefined, false); myMesh.visible = true
          setRoute({ x: v.x, z: v.z }); say(farAway ? `${v.name} liegt weit weg! Flieg mit dem Rettungshubschrauber hin (E hoch, R runter) und lande neben ihm.` : `${v.name} braucht Hilfe! Fahr mit dem Krankenwagen hin (blaue Linie).`)
          return
        }
        const v = remotes.get(mission.victim)
        if (!v || !fresh(v) || !v.dn || nowT - mission.t0 > 150000) { say('Der Einsatz ist beendet.'); endMission(); return }
        if (mission.phase === 'drive') {
          setRoute({ x: v.x, z: v.z })
          if (Math.hypot(v.x - car.x, v.z - car.z) < 10 && Math.abs(car.v) < 10 && (car.y ?? 0) < 5) {
            if (ready) void ch?.send({ type: 'broadcast', event: 'mp', payload: { to: v.id, by: online.userId } }).catch(() => undefined)
            mission.phase = 'back'; say('Patient aufgeladen! Bring ihn zum Krankenhaus.')
          }
        } else {
          setRoute({ x: hospLot.x, z: hospLot.z })
          if (inHospGrounds(car.x, car.z) && (car.y ?? 0) < 6) {
            if (ready) void ch?.send({ type: 'broadcast', event: 'mh', payload: { to: v.id } }).catch(() => undefined)
            void raceDutyPay('medic').then((r) => { if (dead || !r.coins) return; say(`Einsatz abgeschlossen: +${r.coins} Coins`); if (r.koins !== null) walletRef.current?.setBalance(r.koins) }).catch(() => undefined)
            endMission()
          }
        }
      }
      const respawnAfterDeath = () => { if (isCity) hospitalRespawn('Dein Auto ist explodiert – du wachst im Krankenhaus auf.'); else { car = startCar(track, 0); myHp = hpCfg.max; prevV = 0; prevDmg = 0; burnT = 0; myMesh.visible = true; say('Dein Auto ist explodiert – du bekommst ein neues.') } }
      const spawnCar = (o?: RaceCarOption) => {
        if (!isCity || rescue) return
        const nowT = performance.now()
        if (nowT - lastSpawn < 1200) return
        const cap = adminRef.current ? 8 : Date.now() < perkRef.current.until ? 5 : 2
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
        if (rescue) { tickRescue(dt, nowT); return }
        if (liftTick(dt, nowT)) return
        if (garageTick(dt)) return
        if (planeTick(dt)) return
        if (chute && foot) { chuteT += dt; if (foot.vy < -6) { foot = { ...foot, vy: -6 }; w = foot } else if (chuteT > 1.5 && foot.vy > -0.6) { chute.parent?.remove(chute); chute = null; say('Gelandet.') } }
        if (footKo > 0) {
          footKo -= dt
          w = stepWalker(w, { fwd: false, back: false, left: false, right: false }, dt)
          if (footKo <= 0) { w = newWalker(0, 0, 0); w.inv = 2; say('Du bist wieder auf den Beinen.') }
          foot = w
          return
        }
        const m = inp.current
        const suitBusy = ironOn && !suitReady(footMesh)
        if (suitBusy) w = stepWalker(w, { fwd: false, back: false, left: false, right: false, run: false }, dt)
        else if (ironOn && (w.lvl ?? 0) === 0 && (adminRef.current || ironGrantRef.current)) w = stepIron(w, { fwd: m.gas || joyRef.current.y > 0.3, back: (m.brake && !m.jump) || joyRef.current.y < -0.3, left: m.left, right: m.right, turn: joyTurnCurve(joyRef.current.x) * joyTurnRef.current * 2, up: m.fly || m.jump, down: heliDown.current, boost: runRef.current }, dt, (x, z, y) => groundAt(x, z, y, 0), roofH)
        else w = stepWalker(w, { fwd: m.gas || joyRef.current.y > 0.3, back: (m.brake && !m.jump) || joyRef.current.y < -0.3, left: m.left, right: m.right, turn: joyTurnCurve(joyRef.current.x) * joyTurnRef.current * 2, run: m.fly || runRef.current || joyRef.current.y > 0.85, jump: m.jump }, dt)
        if (ironOn) {
          w = { ...w, hp: hpCfg.max }
          const gy = groundAt(w.x, w.z, w.y, 0)
          if (!suitBusy && w.y > gy + 0.6) for (let i = 0; i < 2; i++) fx.emit('fire', w.x + (Math.random() - 0.5) * 0.4, w.y + 0.05, w.z + (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 2, -7 - Math.random() * 3, (Math.random() - 0.5) * 2, 0.35)
        }
        const hitBy = (cx: number, cz: number, ch: number, cv: number, len: number, wid: number, cy: number) => {
          const r = carHit(w!, { x: cx, z: cz, h: ch, v: cv, len, wid, y: cy })
          if (r) { w = r; lastRegenHit = nowT }
        }
        for (const b of botList) hitBy(b.car.x, b.car.z, b.car.h, b.car.v, b.st.len, b.st.wid, b.car.y ?? 0)
        for (const pb of pbots) if (!pb.carGone) hitBy(pb.car.x, pb.car.z, pb.car.h, pb.car.v, pb.st.len, pb.st.wid, pb.car.y ?? 0)
        for (const p of parked) hitBy(p.car.x, p.car.z, p.car.h, p.car.v, p.st.len, p.st.wid, p.car.y ?? 0)
        for (const r of remotes.values()) { if (r.wk || r.rd || nowT - r.seen > 2000) continue; const rd = kindDims(r.kind); hitBy(r.x, r.z, r.h, r.v, rd.len, rd.wid, r.yy ?? 0) }
        footConfig.speed = Date.now() < perkRef.current.speed ? 1.4 : 1
        footConfig.jump = Date.now() < perkRef.current.jump ? 1.35 : 1
        hpCfg.armor = (Date.now() < perkRef.current.armor ? 0.5 : 1) * (gearRef.current.vest ? 0.55 : 1) * (gearRef.current.helmet ? 0.85 : 1) * (kskOn ? (loadoutRef.current.items.includes('armor') ? 0.28 : 0.4) : 1)
        if (healRef.current) { healRef.current = false; w = { ...w, hp: hpCfg.max } }
        if (punchReq.current && (pistolArmed() || hoseReady())) { punchReq.current = false; fireGun('pistol', false, true) }
        if (punchReq.current) {
          punchReq.current = false
          if (nowT - lastPunch > 450 && w.stun <= 0) {
            lastPunch = nowT; punchN++
            let tgt: Remote | null = null, bd = 2.6
            for (const r of remotes.values()) {
              if (!r.wk || r.rd || nowT - r.seen > 2000 || r.id.endsWith('w') || Math.abs((r.yy ?? 0) - w.y) > 2) continue
              const dx = r.x - w.x, dz = r.z - w.z, d = Math.hypot(dx, dz)
              if (d > bd) continue
              let da = Math.atan2(dx, dz) - w.h; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2
              if (Math.abs(da) < 1.2) { tgt = r; bd = d }
            }
            // Polizisten und SWAT-Männer (laufen bei mir als Bots): ein Schlag schaltet sie aus
            let hitBot = false
            const w0 = w!
            for (const pb of [...pbots]) {
              const near = (x: number, z: number, y: number) => { const dx = x - w0.x, dz = z - w0.z; if (Math.hypot(dx, dz) > 2.6 || Math.abs(y - w0.y) > 2) return false; let da = Math.atan2(dx, dz) - w0.h; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2; return Math.abs(da) < 1.2 }
              if (pb.w && near(pb.w.x, pb.w.z, pb.w.y)) { killCop(pb); hitBot = true; break }
              const mn = (pb.men ?? []).find((m) => near(m.w.x, m.w.z, m.w.y))
              if (mn) { killMan(pb, mn); addStar(1); hitBot = true; break }
            }
            if (!hitBot) { const sq = soldiers.find((q) => q.dead <= 0 && Math.hypot(q.w.x - w0.x, q.w.z - w0.z) < 2.4 && Math.abs(q.w.y - w0.y) < 2); if (sq) { killSoldier(sq); hitBot = true } }
            if (!hitBot && punchPed(w0, melee() === 'baton' && !armyGun ? 22 : 8)) hitBot = true
            if (hitBot) say('Treffer – er geht zu Boden!')
            else if (tgt && ready) { void (markHit(tgt.id), ch)?.send({ type: 'broadcast', event: 'pn', payload: { to: tgt.id, dx: Math.sin(w.h), dz: Math.cos(w.h), d: melee() === 'baton' && !armyGun ? 22 : 8 } }).catch(() => undefined); say(melee() === 'baton' && !armyGun ? `Schlagstock auf ${tgt.name}!` : `Schlag auf ${tgt.name}!`) }
            else say('Schlag ins Leere.')
            if (nearFacade(w.x + Math.sin(w.h) * 1.2, w.z + Math.cos(w.h) * 1.2, 4)) smashAt(w.x + Math.sin(w.h) * 1.5, w.z + Math.cos(w.h) * 1.5)
            w = { ...w, ph: w.ph + 2 }
          }
        }
        if (pedHurt > 0) { w = { ...w, hp: Math.max(0, w.hp - pedHurt * hpCfg.armor), stun: Math.max(w.stun, 0.2) }; pedHurt = 0; lastRegenHit = nowT }
        if (w.hp <= 0) { hospitalRespawn('Du bist gestorben – du wachst im Krankenhaus auf.'); return }
        else if (w.hp < hpCfg.max && w.stun <= 0 && nowT - lastRegenHit > 6000) w = { ...w, hp: Math.min(hpCfg.max, w.hp + 2 * dt) }
        foot = w
      }
      /** Geparkte/ausrollende Autos weiterrollen lassen */
      const tickParked = (dt: number) => {
        if (footMesh && !footMesh.userData.bt && (batonRef.current || myRole === 'cop')) { addBaton(THREE, footMesh); footMesh.userData.gr = -1 }
        if (footMesh && (footMesh.userData.gr ?? 0) !== myMask()) addGear(THREE, footMesh, myMask())
        tickBank()
        if (zoomKey.current) { zoomKey.current = false; if (armyGun === 'sniper' && foot) zoomOn = !zoomOn }
        tickPatrols(dt)
        tickPeds(dt, performance.now())
        tickStars(performance.now())
        tickSoldiers(dt)
        tickRockets(dt)
        if (isCity) tickFire(dt, performance.now())
        tickIronBots(dt)
        tickKskBots(dt)
        tickArmyBase(performance.now())
        tickTracers(dt)
        tickDuty(performance.now())
        for (const p of parked) {
          if (Math.abs(p.car.v) > 0.05 || (p.car.y ?? 0) > hillHeight(p.car.x, p.car.z) + 0.3) p.car = stepCar(p.car, idleIn, dt, track, p.st, true)
          else if (p.car.v !== 0) p.car = { ...p.car, v: 0 }
        }
      }

      // ── Schüsse: sichtbare Leuchtspur, Treffer auf mich, SWAT-Geschütz (Taste Q im SWAT-Wagen) ──
      const tracerMat = new THREE.MeshBasicMaterial({ color: 0xfde047 })
      const tracers: Array<{ m: import('three').Mesh; t: number }> = []
      const tracer = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
        const len = Math.hypot(bx - ax, by - ay, bz - az) || 1
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, len), tracerMat)
        m.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2); m.lookAt(bx, by, bz)
        scene.add(m); tracers.push({ m, t: 0.14 })
      }
      const tickTracers = (dt: number) => { for (let i = tracers.length - 1; i >= 0; i--) { const t = tracers[i]; t.t -= dt; if (t.t <= 0) { scene.remove(t.m); t.m.geometry.dispose(); tracers.splice(i, 1) } } }
      cleanups.push(() => { for (const t of tracers) scene.remove(t.m) })
      /** Armee-Hubschrauber abgeschossen / Panzer zerstört */
      const wreckBot = (pb: PBot) => {
        if (!pbots.includes(pb)) return
        const y0 = (pb.car.y ?? 0) + 1.5
        blastAt(pb.car.x, y0, pb.car.z)
        for (let i = 0; i < 40; i++) { const a = Math.random() * Math.PI * 2, sp = 3 + Math.random() * 12; fx.emit('fire', pb.car.x, y0, pb.car.z, Math.cos(a) * sp, 2 + Math.random() * 10, Math.sin(a) * sp, 0.8 + Math.random() * 0.8) }
        scene.remove(pb.mesh); if (pb.wm) scene.remove(pb.wm)
        pbots = pbots.filter((q) => q !== pb)
        say(pb.kind === 'heli' ? 'Kampfhubschrauber abgeschossen!' : 'Panzer zerstört!')
      }
      /** Streifen-/SWAT-Wagen explodiert: Feuerball, Wagen weg, ausgestiegene Männer fallen mit */
      const blowPbot = (pb: PBot, byMe: boolean) => {
        if (!pbots.includes(pb)) return
        const y0 = (pb.car.y ?? 0) + 1
        for (let i = 0; i < 30; i++) { const a = Math.random() * Math.PI * 2, sp = 3 + Math.random() * 12; fx.emit('fire', pb.car.x, y0, pb.car.z, Math.cos(a) * sp, 2 + Math.random() * 10, Math.sin(a) * sp, 0.8 + Math.random() * 0.8) }
        blastAt(pb.car.x, y0, pb.car.z)
        scene.remove(pb.mesh); if (pb.wm) scene.remove(pb.wm)
        for (const mn of pb.men ?? []) scene.remove(mn.m)
        pb.men = []; pb.w = undefined; pb.wm = undefined; pb.carGone = true
        pbots = pbots.filter((q) => q !== pb)
        if (byMe) addStar(1)
        say(pb.swat ? 'SWAT-Wagen explodiert!' : 'Streifenwagen explodiert!')
      }
      /** Raketen: Lenkraketen des Armee-Helis (ich) und Panzerfäuste der Soldaten */
      type Rocket = { m: import('three').Mesh; x: number; y: number; z: number; dx: number; dy: number; dz: number; t: number; mine: boolean; home: (() => { x: number; y: number; z: number } | null) | null; sp: number; turn: number; mega?: boolean }
      const rockets: Rocket[] = []
      const rkMat = new THREE.MeshBasicMaterial({ color: 0xf1f5f9 }), rkGeo = new THREE.CylinderGeometry(0.13, 0.13, 1.6, 8)
      const launchRocket = (x: number, y: number, z: number, dx: number, dy: number, dz: number, mine: boolean, home: Rocket['home'], sp = 64, turn = 3.2, mega = false) => {
        while (rockets.length >= 24) { const o = rockets.shift(); if (o) scene.remove(o.m) }
        const m = new THREE.Mesh(rkGeo, rkMat); m.position.set(x, y, z); scene.add(m)
        const l = Math.hypot(dx, dy, dz) || 1
        rockets.push({ m, x, y, z, dx: dx / l, dy: dy / l, dz: dz / l, t: 0, mine, home, sp, turn, mega })
      }
      const rocketHitMe = (mega = false) => { if (inBunkerNow()) return; hurtByShot(eff.kind === 'tank' && !foot && !mega ? 55 : 9999, !!foot, true, true) }
      const rocketBlast = (x: number, y: number, z: number, mine: boolean, mega = false, rad = 1) => {
        blastAt(x, y, z)
        const near = (px: number, py: number, pz: number, r = 7) => Math.hypot(px - x, py - y, pz - z) < r * rad
        for (const q of soldiers) if (q.dead <= 0 && near(q.w.x, q.w.y + 0.9, q.w.z)) killSoldier(q)
        for (const pd of peds) if (pd.st !== 'dead' && near(pd.w.x, pd.w.y + 0.9, pd.w.z)) killPed(pd)
        for (const pb of [...pbots]) {
          if (!pb.carGone && near(pb.car.x, (pb.car.y ?? 0) + 1, pb.car.z, 8)) { if (pb.kind === 'heli' || pb.kind === 'tank') { if (mine) wreckBot(pb) } else blowPbot(pb, mine) }
          if (pb.w && near(pb.w.x, pb.w.y + 0.9, pb.w.z)) killCop(pb)
          for (const mn of pb.men ?? []) if (near(mn.w.x, mn.w.y + 0.9, mn.w.z)) { killMan(pb, mn); if (mine) addStar(1) }
        }
        for (const pk of [...parked]) if (near(pk.car.x, (pk.car.y ?? 0) + 1, pk.car.z, 8)) blowParked(pk)
        if (mine) for (const ib of [...ironBots]) if (ib.dead <= 0 && near(ib.x, ib.y + 1, ib.z, 8)) { ib.hits += mega ? 12 : 8; if (ib.hits >= 24) killIronBot(ib); else fx.emit('smoke', ib.x, ib.y + 1, ib.z, 0, 1, 0, 0.6) }
        if (mine) for (const kb of [...kskBots]) if (kb.dead <= 0 && near(kb.w.x, kb.w.y + 0.9, kb.w.z, 8)) killKskBot(kb)
        for (const b of botList) if (near(b.car.x, (b.car.y ?? 0) + 1, b.car.z, 8)) b.car = { ...b.car, dmg: DMG_MAX }
        if (mine) for (const r of remotes.values()) { if (r.rd || r.id.startsWith('pb-') || r.id === online?.userId) continue; if (near(r.x, (r.yy ?? 0) + 1, r.z, 8) && ready) void (markHit(r.id), ch)?.send({ type: 'broadcast', event: 'rk', payload: { to: r.id } }).catch(() => undefined) }
        else { const me = foot ?? car; if (near(me.x, (foot ? foot.y : (car.y ?? 0)) + 1, me.z, 6)) rocketHitMe(mega) }
      }
      const tickRockets = (dt: number) => {
        tickBombs(dt)
        for (let i = rockets.length - 1; i >= 0; i--) {
          const r = rockets[i]
          r.t += dt
          const tp = r.home?.()
          if (tp) {
            let vx = tp.x - r.x, vy = tp.y - r.y, vz = tp.z - r.z; const l = Math.hypot(vx, vy, vz) || 1; vx /= l; vy /= l; vz /= l
            const k = Math.min(1, dt * r.turn); r.dx += (vx - r.dx) * k; r.dy += (vy - r.dy) * k; r.dz += (vz - r.dz) * k
            const n = Math.hypot(r.dx, r.dy, r.dz) || 1; r.dx /= n; r.dy /= n; r.dz /= n
          }
          const nx = r.x + r.dx * r.sp * dt, ny = r.y + r.dy * r.sp * dt, nz = r.z + r.dz * r.sp * dt
          let boom = r.t > 8 || ny < 0.3 || shotWallT(r.x, r.y, r.z, nx, ny, nz) < Infinity
          if (tp && Math.hypot(tp.x - nx, tp.y - ny, tp.z - nz) < 3.2) boom = true
          r.x = nx; r.y = ny; r.z = nz
          r.m.position.set(nx, ny, nz); r.m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(r.dx, r.dy, r.dz))
          fx.emit('smoke', nx - r.dx * 1.2, ny - r.dy * 1.2, nz - r.dz * 1.2, 0, 0.6, 0, 0.9)
          if (boom) { scene.remove(r.m); rockets.splice(i, 1); rocketBlast(nx, ny, nz, r.mine, r.mega) }
        }
      }
      cleanups.push(() => { for (const r of rockets) scene.remove(r.m) })
      /** Iron-Man-Bombe von der Minimap: fällt vom Himmel, Riesen-Explosion (Radius ×4) */
      const bombs: { m: import('three').Mesh; x: number; y: number; z: number; gy: number }[] = []
      let lastBomb = 0
      const bombGeo = new THREE.SphereGeometry(0.7, 12, 10), bombMat = new THREE.MeshStandardMaterial({ color: 0x222831, metalness: 0.7, roughness: 0.4, emissive: 0xff2200, emissiveIntensity: 0.6 })
      const dropBomb = (x: number, z: number) => {
        if (!ironOn || !isCity) return
        const now = performance.now()
        if (now - lastBomb < 4000) { say('Bombe lädt nach …'); return }
        lastBomb = now
        const gy = Math.max(0, camGround(x, z))
        const m = new THREE.Mesh(bombGeo, bombMat); m.position.set(x, gy + 90, z); scene.add(m)
        bombs.push({ m, x, y: gy + 90, z, gy })
        say('Bombe unterwegs!')
      }
      bombRef.current = dropBomb
      const tickBombs = (dt: number) => {
        for (let i = bombs.length - 1; i >= 0; i--) {
          const b = bombs[i]
          b.y -= 55 * dt; b.m.position.y = b.y
          fx.emit('smoke', b.x, b.y + 0.8, b.z, 0, 1, 0, 1.4)
          if (b.y <= b.gy + 0.6) {
            scene.remove(b.m); bombs.splice(i, 1)
            rocketBlast(b.x, b.gy + 1, b.z, true, true, 4)
            for (let k = 0; k < 4; k++) rocketBlast(b.x + (Math.random() - 0.5) * 22, b.gy + 1, b.z + (Math.random() - 0.5) * 22, true, true, 1.2)
          }
        }
      }
      cleanups.push(() => { for (const b of bombs) scene.remove(b.m) })
      let lastRocket = 0
      /** Lenkrakete des Armee-Helis: sucht das Ziel, das am besten vor dem Heli liegt (±30°, bis 520 m) */
      type RC = { x: number; y: number; z: number }
      /** Bestes Ziel vor (px, pz) in Blickrichtung h (±cone, bis 520 m): Getter, der die aktuelle Position liefert */
      const pickRocketTarget = (px: number, pz: number, h: number, cone: number, humans = false): (() => RC | null) | null => {
        const pick: { get: (() => RC | null) | null; sc: number } = { get: null, sc: 1e9 }
        const consider = (get: () => RC | null) => {
          const p = get(); if (!p) return
          const dx = p.x - px, dz = p.z - pz, d = Math.hypot(dx, dz)
          if (d < 8 || d > 520) return
          let da = Math.atan2(dx, dz) - h; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2
          if (Math.abs(da) > cone) return
          const sc = d * (1 + Math.abs(da) * 3)
          if (sc < pick.sc) { pick.sc = sc; pick.get = get }
        }
        for (const pb of pbots) {
          if (humans && pb.w) consider(() => pb.w && pbots.includes(pb) ? { x: pb.w.x, y: pb.w.y + 1, z: pb.w.z } : null)
          if (!pb.carGone) consider(() => pbots.includes(pb) ? { x: pb.car.x, y: (pb.car.y ?? 0) + 1, z: pb.car.z } : null)
          for (const mn of pb.men ?? []) consider(() => mn.w.hp > 0 ? { x: mn.w.x, y: mn.w.y + 1, z: mn.w.z } : null)
        }
        for (const b of botList) consider(() => ({ x: b.car.x, y: (b.car.y ?? 0) + 1, z: b.car.z }))
        for (const r of remotes.values()) { if (r.rd || r.id.startsWith('pb-') || r.id === online?.userId) continue; consider(() => performance.now() - r.seen < 2500 ? { x: r.x, y: (r.yy ?? 0) + 1, z: r.z } : null) }
        for (const q of soldiers) consider(() => q.dead <= 0 ? { x: q.w.x, y: q.w.y + 1, z: q.w.z } : null)
        if (!humans) for (const pd of peds) consider(() => pd.st !== 'dead' ? { x: pd.w.x, y: pd.w.y + 1, z: pd.w.z } : null)
        if (!humans) for (const pk of parked) consider(() => parked.includes(pk) ? { x: pk.car.x, y: (pk.car.y ?? 0) + 1, z: pk.car.z } : null)
        for (const kb of kskBots) consider(() => kb.dead <= 0 ? { x: kb.w.x, y: kb.w.y + 1, z: kb.w.z } : null)
        for (const ib of ironBots) consider(() => ib.dead <= 0 ? { x: ib.x, y: ib.y + 1, z: ib.z } : null)
        return pick.get
      }
      const fireRocket = () => {
        if (foot || ride || eff.kind !== 'heli' || eff.color === '#f8fafc') return
        const nowT = performance.now()
        if (nowT - lastRocket < 3500) { say('Raketen laden nach …'); return }
        const tg = pickRocketTarget(car.x, car.z, car.h, 0.55)
        lastRocket = nowT
        launchRocket(car.x + Math.sin(car.h) * 3, (car.y ?? 0) + 0.6, car.z + Math.cos(car.h) * 3, Math.sin(car.h), -0.14, Math.cos(car.h), true, tg, 72, 3.6)
        say(tg ? 'Lenkrakete gestartet!' : 'Rakete ohne Ziel gestartet.')
      }
      /** Iron Man: Lenkrakete aus der Handfläche, ohne Wartezeit; Q zielt aufs nächste Ziel vor mir, Tippen in die Zielrichtung des Fingers */
      let lastIronRk = 0
      const fireIronRocket = (auto: boolean) => {
        if (!foot || !ironOn) return
        const nowT = performance.now(); if (nowT - lastIronRk < 130) return
        lastIronRk = nowT
        let h = foot.h
        const ray = auto ? null : aimRay()
        if (ray) h = Math.atan2(ray.direction.x, ray.direction.z)
        const tg = pickRocketTarget(foot.x, foot.z, h, auto ? 0.95 : 0.45, true)
        const o = foot.y + 1.2
        launchRocket(foot.x + Math.sin(h) * 0.7, o, foot.z + Math.cos(h) * 0.7, Math.sin(h), ray ? Math.max(-0.5, Math.min(0.4, ray.direction.y)) : 0.02, Math.cos(h), true, tg, 82, 4.4)
      }
      rocketRef.current = fireRocket
      function hurtByShot(d: number, onFootHit: boolean, army = false, rocket = false) {
        if (inBunkerNow()) return // im Bunker wird nicht hineingeschossen
        if (ironOn && foot) return // Iron-Man-Anzug: kein Schaden
        if (foot) {
          if (footKo > 0 || foot.inv > 0.2) return
          foot = { ...foot, hp: Math.max(0, foot.hp - d * hpCfg.armor), stun: Math.max(foot.stun, 0.12), vx: foot.vx + (Math.random() - 0.5) * 2, vz: foot.vz + (Math.random() - 0.5) * 2 }
          lastRegenHit = performance.now(); say('Du wirst beschossen!')
        } else if (!ride && !onFootHit) {
          if (eff.kind === 'swat') swatHurt += d * 0.55
          else if (eff.kind === 'tank') { if (!rocket) return; swatHurt += d * 0.55 } // Panzer: Schüsse prallen ab, nur Panzerfaust/Raketen wirken
          else if (eff.kind === 'heli') { if (!army) return; swatHurt += d * 0.55 }
          else car = { ...car, dmg: Math.min(DMG_MAX, car.dmg + d * toughOf(eff.kind)) }
          say('Dein Auto wird beschossen!')
        }
      }
      let lastShot = 0
      let lastPassSend = 0
      let lastQuadRk = 0
      /** Raketenwerfer auf dem Quad: Lenkraketen, Halten = Salve alle 0,6 s */
      const quadRocket = (aim: { x: number; y: number; z: number } | null, auto: boolean, nowT: number) => {
        if (nowT - lastQuadRk < 600) return
        let h = car.h, dy = 0.04
        if (aim) { h = Math.atan2(aim.x - car.x, aim.z - car.z); dy = Math.max(-0.4, Math.min(0.4, (aim.y - ((car.y ?? 0) + 2)) / (Math.hypot(aim.x - car.x, aim.z - car.z) || 1))) }
        else if (!auto) { const ray = aimRay(); if (ray) { h = Math.atan2(ray.direction.x, ray.direction.z); dy = Math.max(-0.4, Math.min(0.4, ray.direction.y)) } }
        const tg = pickRocketTarget(car.x, car.z, h, auto ? Math.PI : 0.5, true)
        if (auto && !tg) return
        lastQuadRk = nowT
        quadDir = { h, t: nowT }
        launchRocket(car.x + Math.sin(h) * 1.4, (car.y ?? 0) + 2.1, car.z + Math.cos(h) * 1.4, Math.sin(h), dy, Math.cos(h), true, tg, 84, 4.2, true)
      }
      const tickQuad = (dt: number, nowT: number) => {
        // fremde Quads: Fahrer nur sichtbar, solange jemand drauf sitzt; Beifahrer, wenn mitgefahren wird
        for (const r of remotes.values()) {
          if (!r.mesh || r.kind !== 'quad') continue
          const rd = r.mesh.userData.rider as import('three').Group | undefined, r2 = r.mesh.userData.rider2 as import('three').Group | undefined
          if (rd) rd.visible = !r.id.startsWith('pk-')
          if (r2) r2.visible = [...remotes.values()].some((o) => o.rd === r.id && fresh(o)) || ride === r.id
        }
        // Beifahrer auf einem Quad: Halten = Dauerfeuer, der Fahrer schießt für ihn (Zielpunkt per Funk)
        if (ride) {
          const r = remotes.get(ride)
          if (r && r.kind === 'quad' && fireHold && ready && nowT - lastPassSend > 90) {
            lastPassSend = nowT
            const ray = aimRay()
            if (ray) {
              const t = ray.direction.y < -0.01 ? Math.min(220, Math.max(8, (1.2 - ray.origin.y) / ray.direction.y)) : 120
              void ch?.send({ type: 'broadcast', event: 'qa', payload: { to: ride, x: ray.origin.x + ray.direction.x * t, y: ray.origin.y + ray.direction.y * t, z: ray.origin.z + ray.direction.z * t } }).catch(() => undefined)
            }
          }
          return
        }
        if (foot || eff.kind !== 'quad') return
        // unzerstörbar: weder Auto noch Fahrer nehmen Schaden
        if (car.dmg > 0) car = { ...car, dmg: 0 }
        myHp = hpCfg.max
        const mine = online?.userId
        const pass = !!mine && [...remotes.values()].some((r) => r.rd === mine && fresh(r))
        const r2 = myMesh.userData.rider2 as import('three').Group | undefined
        if (r2) r2.visible = pass
        const rocket = loadoutRef.current.weapon === 'rocket'
        if (pass) {
          // zu zweit: der Beifahrer schießt, ich fahre
          if (quadPass && nowT - quadPass.t < 260) { if (rocket) quadRocket(quadPass, false, nowT); else { quadAimPt = quadPass; fireGun('swat'); quadAimPt = null } }
        } else if (fireHold) { if (rocket) quadRocket(null, false, nowT); else fireGun('swat') }
        else if (rocket) quadRocket(null, true, nowT)
        else { quadAuto = true; fireGun('swat', false, true); quadAuto = false } // allein: schießt automatisch auf alles in der Umgebung
        // Geschütz dreht zum Ziel, Rohre rotieren beim Feuern, Mündungsfeuer
        const gy = myMesh.userData.gunYaw as import('three').Group | undefined, br = myMesh.userData.barrels as import('three').Group | undefined, mz = myMesh.userData.muzzle as import('three').Mesh | undefined
        const firing = nowT - quadDir.t < 220
        if (gy) { let want = firing ? quadDir.h - car.h : 0; while (want > Math.PI) want -= Math.PI * 2; while (want < -Math.PI) want += Math.PI * 2; gy.rotation.y += (want - gy.rotation.y) * Math.min(1, dt * 14) }
        if (br && firing) br.rotation.z += dt * 55
        if (mz) mz.visible = firing && Math.random() < 0.7
      }
      // Zielpunkt: letzte Mausposition / Fingertipp auf dem Bild, als Richtung vom Geschütz aus auf der Bodenebene
      let lastPtr: { x: number; y: number; t: number } | null = null
      const aimRay = () => {
        if (!lastPtr || performance.now() - lastPtr.t > 10000) return null
        const rc = new THREE.Raycaster(), r = renderer.domElement.getBoundingClientRect()
        rc.setFromCamera(new THREE.Vector2(((lastPtr.x - r.left) / r.width) * 2 - 1, -(((lastPtr.y - r.top) / r.height) * 2 - 1)), camera)
        return rc.ray
      }
      let armyGun: 'rifle' | 'sniper' | null = null, zoomOn = false
      /** Iron-Man-Anzug (nur Admin): zu Fuß fliegen und mit den Handflächen schießen */
      let ironOn = false
      let kskOn = false
      let quadPass: { t: number; x: number; y: number; z: number } | null = null
      let quadAimPt: { x: number; y: number; z: number } | null = null
      let quadAuto = false
      let quadDir = { h: 0, t: -1e9 }
      let fireHold = false
      /** Ich-Perspektive zu Fuß (V); mit Scharfschützengewehr im Zoom immer */
      let egoOn = false
      egoRef.current = () => { egoOn = !egoOn; setEgoUi(egoOn) }
      /** Waffenrad: gewählte Nahkampf-/Pistolen-Waffe (auto = Pistole, sonst Schlagstock, sonst Fäuste); Gewehre kommen über armyGun */
      let sel0: 'auto' | 'fist' | 'baton' | 'pistol' = 'auto'
      const ownLong = { rifle: false, sniper: false }
      const haveBaton = () => batonRef.current || myRole === 'cop'
      const melee = (): 'fist' | 'baton' | 'pistol' => (sel0 === 'baton' && haveBaton() ? 'baton' : sel0 === 'pistol' && gearRef.current.pistol ? 'pistol' : sel0 === 'fist' ? 'fist' : sel0 === 'auto' ? (gearRef.current.pistol ? 'pistol' : haveBaton() ? 'baton' : 'fist') : 'fist')
      const myMask = (): number => ironOn ? 64 : (kskOn ? 256 | 1 | 2 | 16 : (gearMask(gearRef.current) & 3) | (armyGun ? 0 : melee() === 'pistol' ? 8 : melee() === 'baton' ? 4 : 0)) | (dutyRef.current === 'f' ? 128 : 0) | (armyGun === 'rifle' ? 16 : armyGun === 'sniper' ? 32 : 0)
      const curGun = (): 'pistol' | 'rifle' | 'sniper' => ironOn ? 'rifle' : armyGun ?? (kskOn ? 'rifle' : 'pistol')
      const toggleIron = () => {
        if (!(adminRef.current || ironGrantRef.current) || !isCity) return
        if (!ironOn && kskOn) { kskOn = false; setKskUi(false) }
        ironOn = !ironOn; setIronUi(ironOn)
        if (foot) { const f = foot; makeFootMesh(); foot = f }
        say(ironOn ? 'Iron-Man-Anzug an! W/S fliegen, A/D drehen, E hoch, R runter, Klick/Tippen schießt. Tippe auf die Minimap: Bombe!' : 'Anzug aus.')
      }
      ironRef.current = toggleIron
      const toggleKsk = () => {
        if (!(adminRef.current || kskGrantRef.current) || !isCity) return
        if (!kskOn && ironOn) toggleIron()
        kskOn = !kskOn; setKskUi(kskOn)
        if (foot) { const f = foot; makeFootMesh(); foot = f }
        say(kskOn ? 'KSK-Spezialausrüstung an: Sturmgewehr, Spezialpanzerung, Nachtsicht. Knopf „Quad rufen“ holt dein Quad.' : 'KSK-Ausrüstung aus.')
      }
      kskRef.current = toggleKsk
      kskOffRef.current = () => { if (kskOn) toggleKsk() }
      // ── KSK-Bunker: Luke, Fahrstuhl, Halle ──
      const bunker = isCity ? buildBunker(THREE, scene) : null
      if (bunker) {
        cleanups.push(() => bunker.dispose())
        bunkerQuadRef.current = (l) => bunker.setQuad(l.color, l.weapon)
        bunker.setQuad(loadoutRef.current.color, loadoutRef.current.weapon)
      }
      let hatchP = 0, hatchWant = 0, liftP = 0, liftDir = 0, hatchOpenT = 0, bunkerT = 0, carryQuad = false
      const isKsk = () => adminRef.current || kskGrantRef.current
      // ═══ Häuser, Garage, Wandkameras, KSK-Aufträge, Flugzeug (Update 155) ═══
      const houseWorld = makeHouseWorld(THREE, scene)
      cleanups.push(() => houseWorld.dispose())
      let houses: HouseData[] = []
      const houseOf = (id: number) => houses.find((h) => h.bld === id)
      const setHouse = (h: HouseData) => { houses = houses.some((o) => o.bld === h.bld) ? houses.map((o) => (o.bld === h.bld ? h : o)) : [...houses, h] }
      const saveHouse = (h: HouseData) => { void raceHouseSave(h.bld, h.furn, h.garage, h.wall).catch((e) => say(errorMessage(e))) }
      const syncWalls = () => { wallColors.clear(); for (const h of houses) if (h.wall) wallColors.set(h.bld, h.wall) }
      let furnOpen: { b: Bld; furn: Furn[]; wall: string | null } | null = null
      if (online && isCity) void raceHouseList().then((j) => { if (dead) return; houses = parseHouses(j); syncWalls(); houseWorld.setHouses(houses) }).catch(() => undefined)
      let homeCache: Bld[] | null = null
      const homes = () => (homeCache ??= city().buildings.filter(houseEligible))
      let inGarage: { bld: number } | null = null
      let garageStar = 0

      const computeActs = (): Array<{ k: string; label: string }> => {
        if (!isCity || rescue || footKo > 0 || inGarage || planeS || camS || ride) return []
        const f = foot as Walker | null
        if (f && (f.lvl ?? 0) !== 0) return []
        const px = f ? f.x : car.x, pz = f ? f.z : car.z
        for (const h of houses) { const b = houseById(h.bld); if (b) { const g = garageDoor(b); houseWorld.setDoor(h.bld, Math.hypot(px - g.x, pz - g.z) < 11) } }
        const out: Array<{ k: string; label: string }> = []
        for (const b of homes()) {
          if (Math.abs(b.x - px) > b.w / 2 + 14 || Math.abs(b.z - pz) > b.d / 2 + 14) continue
          const id = houseId(b), mine = houseOf(id), d = layoutOf(b).door
          if (f) {
            const inside = buildingAt(f.x, f.z) === b, dd = Math.hypot(f.x - d.x, f.z - d.z)
            if (!mine && (inside || dd < 4.5)) out.push({ k: `buy:${id}`, label: isAdmin ? 'Haus nehmen (Admin: gratis)' : `Haus kaufen (${HOUSE_PRICE} Coins)` })
            if (mine && (inside || dd < 4.5)) out.push({ k: `furn:${id}`, label: 'Haus einrichten' })
            if (mine) { const g = garageDoor(b); if (Math.hypot(f.x - g.x, f.z - g.z) < 5) out.push({ k: `gin:${id}`, label: 'Garage betreten (verstecken)' }) }
          } else if (mine) {
            const g = garageDoor(b), o = garageOut(g, 3)
            if (Math.hypot(car.x - o.x, car.z - o.z) < 8 && Math.abs(car.v) < 15) out.push({ k: `gin:${id}`, label: 'In die Garage fahren (verstecken)' })
          }
        }
        return out
      }

      // — Garage: versteckt vor der Polizei —
      const enterGarage = (id: number) => {
        const h = houseOf(id), b = houseById(id)
        if (!h || !b) return
        if (!foot) {
          if (Math.abs(car.vy ?? 0) > 1.5 || car.fly > 0) { say('In der Luft geht das nicht.'); return }
          if (h.garage.length >= MAX_GARAGE) { say('Die Garage ist voll.'); return }
          const nh: HouseData = { ...h, garage: [...h.garage, { kind: eff.kind, color: eff.color }] }
          setHouse(nh); saveHouse(nh)
          foot = exitFromCar({ ...car, wid: myStats.wid }, 1, myHp)
          if (footMesh) scene.remove(footMesh)
          makeFootMesh(); myMesh.visible = false; footKo = 0
        }
        inGarage = { bld: id }; safe.garage = true; garageStar = 0
        houseWorld.setDoor(id, true); window.setTimeout(() => houseWorld.setDoor(id, false), 2600)
        setGarageUi(houseOf(id)?.garage ?? [])
        say('Das Tor schließt sich – hier findet dich die Polizei nicht.')
      }
      const leaveGarage = (carIdx: number | null) => {
        const g0 = inGarage; if (!g0) return
        const b = houseById(g0.bld), h = houseOf(g0.bld); if (!b || !h) { inGarage = null; safe.garage = false; setGarageUi(null); return }
        const gd = garageDoor(b), hh = Math.atan2(gd.nx, gd.nz)
        if (carIdx !== null && h.garage[carIdx]) {
          const c = h.garage[carIdx], o = garageOut(gd, 5.5)
          const nh: HouseData = { ...h, garage: h.garage.filter((_, i) => i !== carIdx) }
          setHouse(nh); saveHouse(nh)
          mkParked({ ...car, x: o.x, z: o.z, h: hh, v: 0, steer: 0, slip: 0, y: 0, vy: 0, fly: 0, lvl: 0, dmg: 0, hit: 0, bump: 0 }, c.kind, c.color, statsFor(c.kind), undefined, undefined, false)
        }
        const o2 = garageOut(gd, 2.6)
        foot = newWalker(o2.x + gd.tx * 3.2, o2.z + gd.tz * 3.2, hh)
        if (footMesh) footMesh.visible = true
        inGarage = null; safe.garage = false; setGarageUi(null)
        houseWorld.setDoor(g0.bld, true)
        say(carIdx !== null ? 'Dein Auto steht vor der Garage – steig ein.' : 'Du verlässt die Garage.')
      }
      const garageTick = (dt: number): boolean => {
        if (!inGarage || !foot) return false
        foot = { ...foot, vx: 0, vz: 0, vy: 0, sp: 0 }
        if (footMesh) footMesh.visible = false
        garageStar += dt
        if (garageStar > 3) { garageStar = 0; if (stars > 0) setStars(stars - 1) }
        return true
      }

      // — KSK-Aufträge —
      interface KMission { kind: 'kill' | 'car'; ped?: Ped; pk?: Parked; x: number; z: number; t0: number; text: string; beam: import('three').Mesh }
      let kmission: KMission | null = null
      const beamGeo = new THREE.CylinderGeometry(0.4, 0.4, 180, 8, 1, true)
      const beamMat = new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.5, depthWrite: false })
      cleanups.push(() => { beamGeo.dispose(); beamMat.dispose() })
      const endKMission = () => { const m = kmission; if (!m) return; if (m.ped) m.ped.keep = false; m.beam.parent?.remove(m.beam); kmission = null; setMissionTxt('') }
      const failKMission = (why: string) => { endKMission(); say(`Auftrag gescheitert: ${why}`) }
      const completeKMission = () => {
        const m = kmission; if (!m) return
        const kind = m.kind
        endKMission(); say('Auftrag erfüllt! Der Auftraggeber überweist …')
        void raceKskMissionPay(kind).then((r) => { if (dead) return; walletRef.current?.setBalance(r.koins); say(`Auftrag erfüllt: +${r.coins} Coins`) }).catch((e) => say(errorMessage(e)))
      }
      const startKMission = (kind: 'kill' | 'car') => {
        if (kmission) return
        const me2 = foot ?? car, L = CITY.half - 60
        const beam = new THREE.Mesh(beamGeo, beamMat); beam.position.y = 90
        const far = () => { for (let t = 0; t < 60; t++) { const x = (Math.random() * 2 - 1) * L, z = (Math.random() * 2 - 1) * L; if (Math.hypot(x - me2.x, z - me2.z) > 160) return { x, z } } return { x: -me2.x, z: -me2.z } }
        if (kind === 'kill') {
          let ped: Ped | undefined
          for (let t = 0; t < 40 && !ped; t++) { const q = far(); ped = spawnPed(q.x, q.z) }
          if (!ped) { say('Gerade lässt sich keine Zielperson finden – versuch es gleich nochmal.'); return }
          ped.keep = true; ped.m.add(beam)
          kmission = { kind, ped, x: ped.w.x, z: ped.w.z, t0: performance.now(), text: 'Schalte die rot markierte Person aus', beam }
        } else {
          const P = CITY.pitch
          let x = 0, z = 0, ok = false
          for (let t = 0; t < 60 && !ok; t++) { const q = far(); x = Math.round(q.x / P) * P + 5; z = q.z; ok = !buildingAt(x, z) }
          const pk = mkParked({ ...car, x, z, h: 0, v: 0, steer: 0, slip: 0, y: 0, vy: 0, fly: 0, lvl: 0, dmg: 0, hit: 0, bump: 0 }, 'supercar', '#facc15', statsFor('supercar'), undefined, undefined, false)
          pk.mesh.add(beam)
          kmission = { kind, pk, x, z, t0: performance.now(), text: 'Klaue den gelben Supercar (roter Strahl)', beam }
        }
        say('Auftrag angenommen – das Ziel ist auf der Karte (blinkender Punkt).')
      }
      const kmissionText = (): string => { const m = kmission; if (!m) return ''; const me2 = foot ?? car; return `${m.text} · ${Math.round(Math.hypot(m.x - me2.x, m.z - me2.z))} m` }
      const tickKMission = (now: number) => {
        const m = kmission; if (!m) return
        if (now - m.t0 > 360000) { failKMission('Die Zeit ist abgelaufen.'); return }
        if (m.kind === 'kill' && m.ped) {
          if (m.ped.st === 'dead') { completeKMission(); return }
          if (!peds.includes(m.ped)) { failKMission('Die Zielperson ist verschwunden.'); return }
          m.x = m.ped.w.x; m.z = m.ped.w.z
        } else if (m.pk) {
          if (parked.includes(m.pk)) { m.x = m.pk.car.x; m.z = m.pk.car.z }
          else if (!foot && !ride && eff.kind === 'supercar' && eff.color === '#facc15') completeKMission()
          else failKMission('Das Zielauto ist weg.')
        }
      }

      // — Flugzeug und Fallschirm —
      interface PlaneS { x: number; z: number; tx: number; tz: number; h: number; mesh: import('three').Group; phase: 'fly' | 'away'; t: number }
      let planeS: PlaneS | null = null
      let chute: import('three').Group | null = null
      let chuteT = 0
      const PLANE_Y = 150
      const mkPlane = () => {
        const g = new THREE.Group()
        const mat = (c: number) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.2 })
        const add = (geo: import('three').BufferGeometry, c: number, x: number, y: number, z: number, rx = 0) => { const m = new THREE.Mesh(geo, mat(c)); m.position.set(x, y, z); m.rotation.x = rx; g.add(m); return m }
        add(new THREE.CylinderGeometry(1.4, 1.0, 12, 12), 0x4b5320, 0, 0, 0, Math.PI / 2)
        add(new THREE.ConeGeometry(1.4, 2.6, 12), 0x374151, 0, 0, 7.3, Math.PI / 2)
        add(new THREE.BoxGeometry(20, 0.3, 3.2), 0x3d4a32, 0, 0.35, 0.6)
        add(new THREE.BoxGeometry(6.4, 0.25, 1.8), 0x3d4a32, 0, 0.9, -5.6)
        add(new THREE.BoxGeometry(0.25, 2.6, 1.8), 0x3d4a32, 0, 2, -5.6)
        for (const sx of [-5, 5]) add(new THREE.CylinderGeometry(0.5, 0.5, 2, 10), 0x1f2937, sx, 0.1, 1.4, Math.PI / 2)
        const prop = add(new THREE.BoxGeometry(0.2, 5, 0.25), 0x111827, 0, 0, 8.7)
        g.userData.prop = prop
        return g
      }
      const disposeTree = (o: import('three').Object3D) => o.traverse((c) => { const m = c as import('three').Mesh; if (m.geometry) m.geometry.dispose(); const mt = m.material as import('three').Material | undefined; if (mt && 'dispose' in mt) mt.dispose() })
      cleanups.push(() => { if (planeS) { scene.remove(planeS.mesh); disposeTree(planeS.mesh) } })
      const startPlane = (tx: number, tz: number) => {
        const f = foot as Walker | null
        if (!f || (f.lvl ?? 0) !== -2 || liftDir !== 0 || planeS) return
        if (!isKsk()) { say('Das Flugzeug ist nur für die KSK.'); return }
        const h = Math.atan2(tx - BUNKER.ex, tz - BUNKER.ez)
        const mesh = mkPlane(); mesh.position.set(BUNKER.ex, PLANE_Y, BUNKER.ez); mesh.rotation.y = h; scene.add(mesh)
        planeS = { x: BUNKER.ex, z: BUNKER.ez, tx, tz, h, mesh, phase: 'fly', t: 0 }
        safe.plane = true
        foot = { ...f, x: BUNKER.ex, z: BUNKER.ez, y: PLANE_Y + 1, lvl: 0, vx: 0, vz: 0, vy: 0, sp: 0, h }
        if (footMesh) footMesh.visible = false
        say('Du bist im Flugzeug über dem Bunker – es fliegt zum Ziel und wirft dich mit dem Fallschirm ab.')
      }
      const planeTick = (dt: number): boolean => {
        const p = planeS
        if (!p || p.phase !== 'fly' || !foot) return false
        const dx = p.tx - p.x, dz = p.tz - p.z, d = Math.hypot(dx, dz)
        if (d < 25) {
          p.phase = 'away'; p.t = 0; safe.plane = false
          foot = { ...foot, y: PLANE_Y - 2, vy: -2, vx: 0, vz: 0 }
          if (footMesh) {
            footMesh.visible = true
            const cg = new THREE.Group()
            const can = new THREE.Mesh(new THREE.SphereGeometry(2.7, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xea580c, side: THREE.DoubleSide, roughness: 0.8 }))
            can.position.y = 3.4; cg.add(can)
            for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2, ln = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.9, 4), new THREE.MeshBasicMaterial({ color: 0xe5e7eb })); ln.position.set(Math.sin(a) * 1.15, 1.9, Math.cos(a) * 1.15); ln.rotation.set(Math.cos(a) * 0.4, 0, -Math.sin(a) * 0.4); cg.add(ln) }
            footMesh.add(cg); chute = cg; chuteT = 0
          }
          say('Absprung! Der Fallschirm öffnet sich – steuere zum Ziel.')
          return false
        }
        const k = Math.min(1, (80 * dt) / d)
        p.x += dx * k; p.z += dz * k
        foot = { ...foot, x: p.x, z: p.z, y: PLANE_Y + 1, vx: 0, vz: 0, vy: 0, sp: 0, h: p.h, lvl: 0 }
        if (footMesh) footMesh.visible = false
        return true
      }
      const tickPlaneMesh = (dt: number) => {
        const p = planeS; if (!p) return
        const prop = p.mesh.userData.prop as import('three').Object3D | undefined
        if (prop) prop.rotation.z += dt * 45
        if (p.phase === 'away') { p.t += dt; p.x += Math.sin(p.h) * 80 * dt; p.z += Math.cos(p.h) * 80 * dt; if (p.t > 12) { scene.remove(p.mesh); disposeTree(p.mesh); planeS = null; return } }
        p.mesh.position.set(p.x, PLANE_Y, p.z)
      }

      // — Wandkameras ansehen (vom Drohnen-Computer im Bunker) —
      const wcs = wallCams()
      cleanups.push(makeWallCamMeshes(THREE, scene, wcs))
      type CamPick = { x: number; y: number; z: number; name: string }
      interface CamEntry { cam: WallCam; find: () => CamPick | null }
      let camS: { list: CamEntry[]; i: number } | null = null
      let camUiT = 0
      let dayT = 0, dayN = -1
      const openCams = () => {
        const persons: Array<{ x: number; y: number; z: number; name: string; w: number; find: () => CamPick | null }> = []
        for (const r of remotes.values()) if (!r.id.startsWith('pb-') && !r.id.startsWith('pk-') && !r.id.endsWith('w') && !r.rd && fresh(r) && !r.hd) { const id = r.id; persons.push({ x: r.x, y: 1.2, z: r.z, name: r.name, w: 0, find: () => { const q = remotes.get(id); return q ? { x: q.x, y: (q.yy ?? 0) + 1.2, z: q.z, name: q.name } : null } }) }
        for (const pd of peds) if (pd.st !== 'dead') persons.push({ x: pd.w.x, y: 1.2, z: pd.w.z, name: 'Passant', w: 1, find: () => (pd.st === 'dead' ? null : { x: pd.w.x, y: pd.w.y + 1.2, z: pd.w.z, name: 'Passant' }) })
        const list: CamEntry[] = []
        for (const cam of wcs) {
          const dx0 = Math.sin(cam.yaw), dz0 = Math.cos(cam.yaw)
          let best: (typeof persons)[number] | null = null, bs = 1e9
          for (const q of persons) {
            const dx = q.x - cam.x, dz = q.z - cam.z, d = Math.hypot(dx, dz)
            if (d < 3 || d > 80 || (dx * dx0 + dz * dz0) / d < 0.34) continue
            const sc = d + q.w * 300
            if (sc < bs) { bs = sc; best = q }
          }
          if (best) list.push({ cam, find: best.find })
        }
        list.sort((a, b) => (a.find()?.name === 'Passant' ? 1 : 0) - (b.find()?.name === 'Passant' ? 1 : 0))
        if (list.length === 0) { const me2 = foot ?? car; for (const cam of [...wcs].sort((a, b) => Math.hypot(a.x - me2.x, a.z - me2.z) - Math.hypot(b.x - me2.x, b.z - me2.z)).slice(0, 8)) list.push({ cam, find: () => null }); say('Gerade sieht keine Kamera jemanden – du siehst die nächsten Kameras.') }
        camS = { list: list.slice(0, 40), i: 0 }
        setCamUi({ n: camS.list.length, i: 0, who: camS.list[0].find()?.name ?? 'niemand im Bild' })
      }
      const tickExtras = (dt: number, now: number) => {
        houseWorld.tick((foot ?? car).x, (foot ?? car).z, dt)
        if (isCity && now - dayT > 500) {
          dayT = now
          const ib = foot ? buildingAt(foot.x, foot.z) : null
          houseWorld.setInside(ib ? houseId(ib) : -1)
          // Tag/Nacht: alle 5 Minuten Wechsel (für alle Spieler gleich, nach Uhrzeit), mit kurzem sanftem Übergang
          const n = nightness(Date.now() / 1000)
          if (Math.abs(n - dayN) > 0.004) { dayN = n; rs.setNight(n) }
        }
        tickKMission(now)
        tickPlaneMesh(dt)
        if (camS && now - camUiT > 300) { camUiT = now; const cs = camS; const who = cs.list[cs.i].find()?.name ?? 'niemand im Bild'; setCamUi((o) => (o && o.i === cs.i && o.who === who && o.n === cs.list.length ? o : { n: cs.list.length, i: cs.i, who })) }
      }
      xRef.current = (cmd, a) => {
        if (cmd === 'act') {
          const [kind, ids] = String(a).split(':'), id = Number(ids), b = houseById(id)
          if (!b) return
          if (kind === 'buy') void raceHouseBuy(id).then((r) => { if (dead) return; walletRef.current?.setBalance(r.koins); setHouse({ bld: id, furn: [], garage: [], wall: null }); houseWorld.setHouses(houses); say('Das Haus gehört jetzt dir! Du kannst es einrichten und hast eine Garage.') }).catch((e) => say(errorMessage(e)))
          else if (kind === 'furn') { const h = houseOf(id); if (h) { furnOpen = { b, furn: h.furn, wall: h.wall }; setFurnUi(furnOpen) } }
          else if (kind === 'gin') enterGarage(id)
        } else if (cmd === 'furnChange') {
          const fu = furnOpen; if (!fu) return
          const id = houseId(fu.b), h = houseOf(id); if (!h) return
          const f = a as Furn[]; setHouse({ ...h, furn: f }); houseWorld.setFurn(id, f); furnOpen = { ...fu, furn: f }; setFurnUi(furnOpen)
        } else if (cmd === 'wallChange') {
          const fu = furnOpen; if (!fu) return
          const id = houseId(fu.b), h = houseOf(id); if (!h) return
          const c = a as string | null; setHouse({ ...h, wall: c }); syncWalls(); houseWorld.setWall(id, c); rs.refreshInterior(); furnOpen = { ...fu, wall: c }; setFurnUi(furnOpen)
        } else if (cmd === 'furnDone') {
          const fu = furnOpen; if (fu) { const h = houseOf(houseId(fu.b)); if (h) saveHouse(h) }
          furnOpen = null; setFurnUi(null)
        } else if (cmd === 'take') leaveGarage(Number(a))
        else if (cmd === 'gfoot') leaveGarage(null)
        else if (cmd === 'mstart') startKMission(a as 'kill' | 'car')
        else if (cmd === 'mcancel') { endKMission(); say('Auftrag abgebrochen.') }
        else if (cmd === 'plane') { const t = a as { x: number; z: number }; startPlane(t.x, t.z) }
        else if (cmd === 'cam') {
          if (a === 'open') openCams()
          else if (a === 'close') { camS = null; setCamUi(null) }
          else if (camS) { const n = camS.list.length; camS = { ...camS, i: (camS.i + (a === 'next' ? 1 : n - 1)) % n }; setCamUi({ n, i: camS.i, who: camS.list[camS.i].find()?.name ?? 'niemand im Bild' }) }
        }
      }
      const bunkerAct = (kind: string) => {
        const f = foot as Walker | null
        if (!f || liftDir !== 0) return
        if (kind === 'keypad') {
          if (!isKsk()) { say('Zugang nur für die KSK.'); return }
          hatchWant = hatchWant > 0.5 ? 0 : 1; hatchOpenT = performance.now()
          say(hatchWant ? 'Die Bunker-Luke fährt auf …' : 'Die Bunker-Luke schließt sich.')
        } else if (kind === 'lift_down') {
          if (hatchP < 0.9) { say('Die Luke ist noch nicht offen.'); return }
          carryQuad = false; liftDir = 1; liftP = 0; foot = { ...f, x: BUNKER.ex, z: BUNKER.ez, vx: 0, vz: 0, lvl: 0 }
          say('Der Fahrstuhl fährt nach unten …')
        } else if (kind === 'lift_up') {
          carryQuad = true; liftDir = -1; liftP = 1; hatchWant = 1; hatchOpenT = performance.now(); foot = { ...f, x: BUNKER.ex, z: BUNKER.ez, vx: 0, vz: 0, lvl: -2, y: BUNKER.y }
          say('Der Fahrstuhl fährt nach oben …')
        } else if (kind === 'tune') setBunkerUi('tune')
        else if (kind === 'drone') setBunkerUi('drone')
        else if (kind === 'forge') say('Der Bauarm setzt hier die Iron-Man-Anzüge zusammen – alle 16 Sekunden ein neuer.')
        else if (kind === 'table') { if (!isKsk()) { say('Aufträge gibt es nur für die KSK.'); return } setBunkerUi('mission') }
        else if (kind === 'plane') { if (!isKsk()) { say('Das Flugzeug ist nur für die KSK.'); return } setBunkerUi('plane') }
      }
      /** Fahrstuhlfahrt: Figur bleibt in der Kabine, Kabine folgt liftY */
      const liftTick = (dt: number, nowT: number): boolean => {
        if (liftDir === 0 || !foot) return false
        liftP = Math.max(0, Math.min(1, liftP + (liftDir * dt * 1000) / LIFT_MS))
        if (liftDir > 0) hatchWant = liftP > 0.25 ? 0 : 1
        foot = { ...foot, x: BUNKER.ex, z: BUNKER.ez, y: liftY(liftP), vy: 0, vx: 0, vz: 0, sp: 0, lvl: 0 }
        if (liftDir > 0 && liftP >= 1) { foot = { ...foot, lvl: -2, y: BUNKER.y }; liftDir = 0; say('Willkommen im KSK-Bunker! Computer, Quad-Schmiede und Iron-Man-Werkstatt.') }
        else if (liftDir < 0 && liftP <= 0) {
          foot = { ...foot, lvl: 0, y: 0, z: BUNKER.ez - 4.2 }; liftDir = 0; hatchOpenT = nowT
          if (carryQuad && isKsk()) { spawnQuad(BUNKER.ex + 9, BUNKER.ez - 3, 0, 0); say('Du bist oben. Dein Quad steht neben der Luke bereit.') } else say('Du bist wieder oben.')
          carryQuad = false
        }
        return true
      }
      const bunkerFrame = (dt: number, nowT: number) => {
        if (!bunker) return
        bunkerT += dt
        const d = hatchWant - hatchP
        hatchP += Math.sign(d) * Math.min(Math.abs(d), (dt * 1000) / HATCH_MS)
        // Luke schließt sich von selbst, wenn niemand mehr in der Nähe ist
        if (hatchWant > 0.5 && liftDir === 0 && nowT - hatchOpenT > 25000 && !(foot && Math.hypot(foot.x - BUNKER.ex, foot.z - BUNKER.ez) < 12) && (foot?.lvl ?? 0) !== -2) hatchWant = 0
        const inHall = !!foot && (foot.lvl ?? 0) === -2
        const nearPit = hatchP > 0.02 && Math.hypot(car.x - BUNKER.ex, car.z - BUNKER.ez) < 80
        bunker.update({ hatch: hatchP, lift: liftP, moving: liftDir !== 0 || Math.abs(hatchWant - hatchP) > 0.01, showHall: inHall || liftDir !== 0 || nearPit, t: bunkerT, dt })
      }
      droneRef.current = () => ({ me: { x: car.x, z: car.z, h: car.h }, players: [...remotes.values()].filter((r) => !r.id.startsWith('pb-') && !r.id.startsWith('pk-') && !r.id.endsWith('w') && !r.rd && fresh(r) && r.id !== online?.userId).map((r) => ({ id: r.id, name: r.name || 'Spieler', x: r.x, z: r.z, kind: r.kind, wk: !!r.wk })) })
      if (online && isCity) void raceKskGet().then((j) => { if (!dead) applyLoadout(parseLoadout(j)) }).catch(() => undefined)
      let myQuad: Parked | null = null
      const spawnQuad = (x: number, z: number, h: number, y: number) => {
        if (myQuad && parked.includes(myQuad)) { scene.remove(myQuad.mesh); parked = parked.filter((q) => q !== myQuad) }
        const lo = loadoutRef.current
        myQuad = mkParked({ ...car, x, z, h, v: 0, y, vy: 0, fly: 0, lvl: 0, dmg: 0, hit: 0, steer: 0, slip: 0 }, 'quad', lo.color, statsFor('quad', 130), 130, undefined, false)
        setQuadWeapon(myQuad.mesh, lo.weapon)
      }
      quadCallRef.current = () => {
        if (!kskOn || !foot || !isCity || rescue || footKo > 0 || (foot.lvl ?? 0) !== 0) return
        spawnQuad(foot.x + Math.sin(foot.h) * 4, foot.z + Math.cos(foot.h) * 4, foot.h, foot.y)
        say('Dein Quad steht bereit. X = aufsteigen (nur KSK, höchstens 2 Personen).')
      }
      ironOffRef.current = () => { if (ironOn) toggleIron() }
      const granted = new Set<string>()
      ironGiveRef.current = (id) => {
        if (!adminRef.current || !ready) return
        const on = !granted.has(id); if (on) granted.add(id); else granted.delete(id)
        void ch?.send({ type: 'broadcast', event: 'ig', payload: { to: id, on } }).catch(() => undefined)
        setGrantUi((g) => (g && g.id === id ? { ...g, on } : g)); say(on ? 'Iron Man vergeben.' : 'Iron Man genommen.')
      }
      const grantedK = new Set<string>()
      kskGiveRef.current = (id) => {
        if (!adminRef.current || !ready) return
        const on = !grantedK.has(id); if (on) grantedK.add(id); else grantedK.delete(id)
        void ch?.send({ type: 'broadcast', event: 'ig', payload: { to: id, on, k: 'ksk' } }).catch(() => undefined)
        setGrantUi((g) => (g && g.id === id ? { ...g, k: on } : g)); say(on ? 'KSK vergeben.' : 'KSK genommen.')
      }
      let tpIdx = 0
      ironTpRef.current = () => {
        if (!ironOn || !foot || !suitReady(footMesh)) return
        const list = [...remotes.values()].filter((r) => !r.rd && !r.id.startsWith('pb-') && r.id !== online?.userId && fresh(r) && (r.lv ?? 0) === 0)
        if (!list.length) { say('Niemand sonst ist gerade in der Stadt.'); return }
        const r = list[tpIdx++ % list.length]
        const a = Math.random() * Math.PI * 2, ty = Math.max(r.yy ?? 0, roofH(r.x, r.z)) + 2
        foot = { ...foot, x: r.x + Math.sin(a) * 3, z: r.z + Math.cos(a) * 3, y: ty, vx: 0, vy: 0, vz: 0 }
        say(`Teleport zu ${r.name}!`)
      }
      ironKeyRef.current = () => ironOn && !!foot
      const takeGun = (k: 'rifle' | 'sniper') => { ownLong[k] = true; armyGun = k; zoomOn = false; setSniperUi(k === 'sniper'); say(k === 'sniper' ? 'Scharfschützengewehr! Z = Zoom, Tippen/Klick schießt (ein Treffer reicht).' : 'Sturmgewehr! Es schießt viel schneller als die Pistole.') }
      weaponInfoRef.current = () => {
        if (ironOn || kskOn) return { list: [], cur: '' }
        const list = [{ id: 'fist', icon: '👊', name: 'Fäuste' }]
        if (haveBaton()) list.push({ id: 'baton', icon: '🏏', name: 'Schlagstock' })
        if (gearRef.current.pistol) list.push({ id: 'pistol', icon: '🔫', name: 'Pistole' })
        if (ownLong.rifle) list.push({ id: 'rifle', icon: '🪖', name: 'Sturmgewehr' })
        if (ownLong.sniper) list.push({ id: 'sniper', icon: '🎯', name: 'Scharfschütze' })
        return { list, cur: armyGun ?? melee() }
      }
      weaponPickRef.current = (id) => {
        if (id === 'rifle' || id === 'sniper') { if (!ownLong[id]) return; armyGun = id; setSniperUi(id === 'sniper') } else { armyGun = null; setSniperUi(false); sel0 = id as 'fist' | 'baton' | 'pistol' }
        zoomOn = false
        if (footMesh) footMesh.userData.gr = -1
        say(id === 'fist' ? 'Fäuste.' : id === 'baton' ? 'Schlagstock in der Hand.' : id === 'pistol' ? 'Pistole in der Hand.' : id === 'rifle' ? 'Sturmgewehr in der Hand.' : 'Scharfschützengewehr in der Hand.')
      }
      const gunCar = () => eff.kind === 'quad' || eff.kind === 'firetruck' || eff.kind === 'swat' || eff.kind === 'tank' || (eff.kind === 'heli' && eff.color !== '#f8fafc')
      const swatArmed = () => gunCar() && !foot && !ride
      /** Feuerwehrmann im Dienst zu Fuß: Q/Tippen spritzt mit dem Schlauch (statt zu schießen) */
      const hoseReady = () => !!foot && !rescue && footKo <= 0 && !alarm && dutyRef.current === 'f' && !armyGun && !ironOn
      const pistolArmed = () => !!foot && !rescue && footKo <= 0 && (melee() === 'pistol' || !!armyGun || ironOn || kskOn)
      const hitCount = new WeakMap<object, number>()
      const onPtrRot = (e: PointerEvent) => { if (lastPtr && (e.buttons & 1 || e.pointerType === 'touch') && !foot && !ride && (eff.kind === 'tank' || eff.kind === 'heli') && performance.now() - lastPtr.t < 120) car = { ...car, h: car.h - (e.clientX - lastPtr.x) * 0.006 } }
      const onPtrMove = (e: PointerEvent) => { lastPtr = { x: e.clientX, y: e.clientY, t: performance.now() } }
      const onPtrDown = (e: PointerEvent) => { onPtrMove(e); fireHold = true; if (swatArmed()) fireGun('swat'); else if (pistolArmed() || hoseReady()) fireGun('pistol') }
      renderer.domElement.addEventListener('pointermove', onPtrRot); renderer.domElement.addEventListener('pointermove', onPtrMove); renderer.domElement.addEventListener('pointerdown', onPtrDown)
      const onPtrUp = () => { fireHold = false }
      window.addEventListener('pointerup', onPtrUp); window.addEventListener('pointercancel', onPtrUp)
      cleanups.push(() => { window.removeEventListener('pointerup', onPtrUp); window.removeEventListener('pointercancel', onPtrUp) })
      cleanups.push(() => { renderer.domElement.removeEventListener('pointermove', onPtrRot); renderer.domElement.removeEventListener('pointermove', onPtrMove); renderer.domElement.removeEventListener('pointerdown', onPtrDown) })
      /** SWAT-Geschütz (jeder im SWAT-Wagen, 400 m, auch nach oben/unten) und Pistole zu Fuß (150 m). Zielt dorthin, wo man auf den Bildschirm tippt – inkl. Höhe. */
      const fireGun = (gun: 'swat' | 'pistol', straight = false, auto = false) => {
        if (inBunkerNow()) { if (!auto && nowMs() - bunkerNoFire > 3000) { bunkerNoFire = nowMs(); say('Im Bunker wird nicht geschossen.') } return }
        if (eff.kind === 'quad' && loadoutRef.current.weapon === 'rocket') return // Raketen feuert tickQuad
        if (gun === 'swat' && eff.kind === 'firetruck' && !foot && !ride) { sprayTruck(); return }
        if (gun === 'pistol' && hoseReady()) { sprayHose(); return }
        if (gun === 'swat' ? (!gunCar() || foot || ride) : !pistolArmed()) return
        if (gun === 'pistol' && ironOn) { if (suitReady(footMesh)) fireIronRocket(auto); return }
        const nowT = performance.now()
        if (nowT - lastShot < (gun === 'pistol' ? (curGun() === 'rifle' ? 110 : curGun() === 'sniper' ? 1100 : 450) : eff.kind === 'heli' ? 170 : eff.kind === 'tank' ? 800 : eff.kind === 'quad' ? (loadoutRef.current.items.includes('rate') ? 46 : 70) : 330)) return
        lastShot = nowT
        const ox = gun === 'swat' ? car.x : foot!.x, oz = gun === 'swat' ? car.z : foot!.z, hd = gun === 'swat' ? car.h : foot!.h
        const big = gun === 'swat' && eff.kind !== 'swat'
        const oy = gun === 'swat' ? (car.y ?? 0) + (eff.kind === 'heli' ? 1.2 : eff.kind === 'tank' ? 2.6 : eff.kind === 'quad' ? 1.9 : 2.1) : foot!.y + 1.3
        const RANGE = gun === 'pistol' ? (curGun() === 'sniper' ? 600 : curGun() === 'rifle' ? 230 : 150) : eff.kind === 'heli' ? 260 : eff.kind === 'tank' ? 320 : eff.kind === 'quad' ? 180 : 400, MUZ = gun === 'pistol' ? 0.9 : eff.kind === 'tank' ? 5 : eff.kind === 'heli' ? 4.5 : eff.kind === 'quad' ? 1.6 : 3.6
        type Tg = { x: number; y: number; z: number; r: number; apply: () => void }
        const tgs: Tg[] = []
        const dmgCar = (b: { car: Car; kind: string }, k: number) => { b.car = { ...b.car, dmg: Math.min(DMG_MAX, b.car.dmg + k * toughOf(b.kind)) } }
        const hits = (o: object, need0: number, kill: () => void) => { const need = curGun() === 'sniper' ? 1 : curGun() === 'rifle' ? need0 + 2 : need0; if (gun === 'swat') { kill(); return } const n = (hitCount.get(o) ?? 0) + 1; hitCount.set(o, n); if (n >= need) kill() }
        for (const b of botList) tgs.push({ x: b.car.x, y: (b.car.y ?? 0) + 1, z: b.car.z, r: 2.4, apply: () => dmgCar(b, gun === 'swat' ? (big ? 24 : 14) : curGun() === 'sniper' ? 20 : curGun() === 'rifle' ? 3 : 5) })
        for (const pb of pbots) {
          if (!pb.carGone && pb.kind === 'tank') tgs.push({ x: pb.car.x, y: (pb.car.y ?? 0) + 1.4, z: pb.car.z, r: 3, apply: () => { fx.emit('smoke', pb.car.x, (pb.car.y ?? 0) + 2.4, pb.car.z, 0, 1, 0, 0.3) } })
          else if (!pb.carGone && pb.kind === 'heli') tgs.push({ x: pb.car.x, y: (pb.car.y ?? 0) + 1.2, z: pb.car.z, r: 3.2, apply: () => {
            const n = (hitCount.get(pb) ?? 0) + (gun === 'swat' ? (eff.kind === 'quad' ? 3 : 14) : curGun() === 'sniper' ? 30 : curGun() === 'rifle' ? 7 : 4)
            hitCount.set(pb, n)
            if (n >= 140) wreckBot(pb); else fx.emit('smoke', pb.car.x, (pb.car.y ?? 0) + 1.5, pb.car.z, 0, 2, 0, 0.8)
          } })
          else if (!pb.carGone) tgs.push({ x: pb.car.x, y: (pb.car.y ?? 0) + 1, z: pb.car.z, r: 2.6, apply: () => dmgCar(pb, gun === 'swat' ? (big ? 24 : 14) : curGun() === 'sniper' ? 20 : curGun() === 'rifle' ? 3 : 4) })
          if (pb.w) tgs.push({ x: pb.w.x, y: pb.w.y + 0.9, z: pb.w.z, r: 0.9, apply: () => hits(pb, 3, () => killCop(pb)) })
          for (const mn of pb.men ?? []) tgs.push({ x: mn.w.x, y: mn.w.y + 0.9, z: mn.w.z, r: 0.9, apply: () => hits(mn, 3, () => { killMan(pb, mn); addStar(1) }) })
        }
        for (const r of remotes.values()) {
          if (r.rd || nowT - r.seen > 2500 || r.id.startsWith('pb-') || r.id === online?.userId) continue
          const dm = gun === 'swat' && eff.kind === 'quad' ? (r.wk ? 5 : 4) : gun === 'swat' ? (big ? (r.wk ? 28 : 22) : (r.wk ? 20 : 14)) : curGun() === 'sniper' ? (r.wk ? 40 : 30) : curGun() === 'rifle' ? (r.wk ? 6 : 3) : (r.wk ? 12 : 6)
          tgs.push({ x: r.x, y: (r.yy ?? 0) + (r.wk ? 0.9 : 1), z: r.z, r: r.wk ? 0.9 : 2.4, apply: () => { if (ready) void (markHit(r.id), ch)?.send({ type: 'broadcast', event: 'sd', payload: { to: r.id, d: dm, k: r.wk ? 'f' : 'c' } }).catch(() => undefined) } })
        }
        // Autos ohne Fahrer: nach mehreren Treffern explodieren sie (Panzer/Heli-Geschütz schneller)
        for (const pk of parked) {
          if (isArmored(pk.kind)) continue
          tgs.push({ x: pk.car.x, y: (pk.car.y ?? 0) + 1, z: pk.car.z, r: 2.4, apply: () => {
            const n = (hitCount.get(pk) ?? 0) + (gun === 'swat' ? 3 : curGun() === 'sniper' ? 3 : curGun() === 'rifle' ? 1 : 1)
            hitCount.set(pk, n)
            if (n >= 7) blowParked(pk); else fx.emit('smoke', pk.car.x, (pk.car.y ?? 0) + 1.2, pk.car.z, 0, 2, 0, 0.8)
          } })
        }
        for (const ib of ironBots) if (ib.dead <= 0) tgs.push({ x: ib.x, y: ib.y + 1, z: ib.z, r: 1.3, apply: () => {
          ib.hits += gun === 'swat' ? (eff.kind === 'quad' ? 2 : 4) : curGun() === 'sniper' ? 6 : curGun() === 'rifle' ? 2 : 1
          if (ib.hits >= 24) killIronBot(ib); else fx.emit('smoke', ib.x, ib.y + 1, ib.z, 0, 1, 0, 0.4)
        } })
        for (const q of soldiers) if (q.dead <= 0) tgs.push({ x: q.w.x, y: q.w.y + 0.9, z: q.w.z, r: 0.9, apply: () => hits(q, 3, () => killSoldier(q)) })
        for (const kb of kskBots) if (kb.dead <= 0) tgs.push({ x: kb.w.x, y: kb.w.y + 0.9, z: kb.w.z, r: 0.9, apply: () => hits(kb, 7, () => killKskBot(kb)) })
        for (const pd of peds) if (pd.st !== 'dead') tgs.push({ x: pd.w.x, y: pd.w.y + 0.9, z: pd.w.z, r: 0.9, apply: () => hits(pd, 2, () => killPed(pd)) })
        let dx = Math.sin(hd), dy = 0, dz = Math.cos(hd)
        if (auto) {
          // Q: nächste Person vor mir (±55°), sonst nächstes Ziel; unmittelbar auf sie zielen
          let pk: Tg | null = null, pd = 1e9
          for (const pass of [0, 1]) {
            for (const t of tgs) {
              if (pass === 0 && t.r >= 1) continue
              const vx = t.x - ox, vz = t.z - oz, dd = Math.hypot(vx, vz)
              if (dd < 1.5 || dd > RANGE) continue
              let da = Math.atan2(vx, vz) - hd; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2
              if (Math.abs(da) > (quadAuto ? 9 : 0.95) || shotBlocked(ox, oy, oz, t.x, t.y, t.z)) continue
              if (dd < pd) { pd = dd; pk = t }
            }
            if (pk) break
          }
          if (quadAuto && !pk) return
          if (pk) { const l = Math.hypot(pk.x - ox, pk.y - oy, pk.z - oz) || 1; dx = (pk.x - ox) / l; dy = (pk.y - oy) / l; dz = (pk.z - oz) / l }
        }
        const ray = straight || auto || quadAimPt ? null : aimRay()
        if (ray) {
          const ro = ray.origin, rd = ray.direction
          let pick: Tg | null = null, pa = 1e9
          for (const t of tgs) {
            const vx = t.x - ro.x, vy = t.y - ro.y, vz = t.z - ro.z, al = vx * rd.x + vy * rd.y + vz * rd.z
            if (al < 1 || al >= pa) continue
            const px = vx - rd.x * al, py = vy - rd.y * al, pz = vz - rd.z * al
            if (Math.hypot(px, py, pz) < t.r * 1.6 + al * (auto ? 0.12 : 0.025) && !shotBlocked(ox, oy, oz, t.x, t.y, t.z)) { pick = t; pa = al }
          }
          let tx: number, ty: number, tz: number
          if (pick) { tx = pick.x; ty = pick.y; tz = pick.z }
          else if (rd.y < -0.01) { const t = (oy - ro.y) / rd.y; tx = ro.x + rd.x * t; ty = oy; tz = ro.z + rd.z * t }
          else { tx = ro.x + rd.x * 200; ty = ro.y + rd.y * 200; tz = ro.z + rd.z * 200 }
          const l = Math.hypot(tx - ox, ty - oy, tz - oz)
          if (l > 2) { dx = (tx - ox) / l; dy = (ty - oy) / l; dz = (tz - oz) / l }
        }
        if (quadAimPt && gun === 'swat') { const l = Math.hypot(quadAimPt.x - ox, quadAimPt.y - oy, quadAimPt.z - oz); if (l > 2) { dx = (quadAimPt.x - ox) / l; dy = (quadAimPt.y - oy) / l; dz = (quadAimPt.z - oz) / l } }
        if (eff.kind === 'quad' && gun === 'swat') quadDir = { h: Math.atan2(dx, dz), t: nowT }
        const ax = ox + dx * MUZ, ay = oy + dy * MUZ, az = oz + dz * MUZ
        let best: Tg | null = null, bt = RANGE
        for (const t of tgs) {
          const vx = t.x - ax, vy = t.y - ay, vz = t.z - az, al = vx * dx + vy * dy + vz * dz
          if (al < 1 || al > bt) continue
          if (Math.hypot(vx - dx * al, vy - dy * al, vz - dz * al) > t.r) continue
          if (shotBlocked(ax, ay, az, t.x, t.y, t.z)) continue
          best = t; bt = al
        }
        best?.apply()
        // Wände halten Kugeln auf (Bank-Glas und Zaun nicht)
        bt = Math.min(bt, shotWallT(ax, ay, az, ax + dx * bt, ay + dy * bt, az + dz * bt))
        // Kugeln durchschlagen Bankscheiben (erste Scheibe entlang der Schusslinie)
        if (bankP && Math.hypot(ax - bankP.b.x, az - bankP.b.z) < bt + 60) {
          const bb = bankP.b
          for (let t = 0; t < bt; t += 1.2) {
            const px = ax + dx * t, pz = az + dz * t, py = ay + dy * t
            if (Math.abs(px - bb.x) < bb.w / 2 + 0.8 && Math.abs(pz - bb.z) < bb.d / 2 + 0.8 && py < 16) { if (rs.smashGlass(px, pz, 3.6, py) > 0) say('Klirr! Die Scheibe ist kaputt.'); break }
          }
        }
        tracer(ax, ay, az, ax + dx * bt, ay + dy * bt, az + dz * bt)
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
        rs.setVault(false)
        endInfo = { id: chase.id, win, until: performance.now() + 20000 }
        if (announce) { const eid = chase.id; for (const dl of [0, 500, 1200, 2500]) window.setTimeout(() => { if (!dead) sendCh({ t: 'end', id: eid, win }) }, dl) }
        const mine = (myRole === 'cop') === (win === 'police')
        if (dutyChase && myRole === 'cop') { dutyChase = false; void raceDutyPay('police').then((r) => { if (dead || !r.coins) return; say(`Einsatz beendet: +${r.coins} Coins`); if (r.koins !== null) walletRef.current?.setBalance(r.koins) }).catch(() => undefined) }
        const humansOther = chase.cops.length, botsN = chase.bots, secs = Math.round((performance.now() - chase.t0) / 1000)
        const heist = !!chase.heist, heistWin = heist && win === 'bandit' && myRole === 'bandit' && !iCaught, extra = chase.extra ?? '', crimeWin = win === 'bandit' && myRole === 'bandit' && !iCaught
        for (const b of pbots) { scene.remove(b.mesh); if (b.wm) scene.remove(b.wm) }
        pbots = []
        dropBotRemotes()
        applyRole(null)
        chase = null
        setChaseUi({ over: { win, mine } })
        if (extra === 'armory' && crimeWin) { batonRef.current = true; try { localStorage.setItem('vt-baton', '1') } catch { /* egal */ }; say('Geschafft! Du hast einen Schlagstock – er macht mehr Schaden (Q).') }
        if (extra) { /* Einbruch/Diebstahl: kein Kopfgeld */ } else if (heist) {
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
          if (bl.includes(online.userId)) { if (p.hz === 1) void raceBankClaim().catch(() => undefined); startChase(id, bl, cops, Number(p.bots) || 0, String(p.from), 'bandit', p.hz === 1, String(p.ex ?? '')) }
          else if (cops.includes(online.userId)) startChase(id, bl, cops, Number(p.bots) || 0, String(p.from), 'cop', p.hz === 1, String(p.ex ?? ''))
        } else if (p.t === 'cau') {
          if (chase && chase.id === id && typeof p.u === 'string') markCaught(p.u, false)
        } else if (p.t === 'end') {
          dropBotRemotes()
          if (chase && chase.id === id) finishChase(p.win === 'police' ? 'police' : 'bandit', false)
        }
      }
      const dutyCops = () => [...remotes.values()].filter((r) => r.od === 'p' && fresh(r) && !r.ro && !r.rd && !r.id.startsWith('pb-')).map((r) => r.id)
      let armoryUntil = 0
      crimeRef.current = (what) => {
        const f = foot as Walker | null
        if (!f || chase) return
        if (!online) { say('Das geht nur im Online-Spiel.'); return }
        if (what === 'armory' && Date.now() < armoryUntil) { say('Die Waffenkammer ist leer – komm später wieder.'); return }
        if (what === 'armory') armoryUntil = Date.now() + 8 * 60 * 1000
        const id = `${what}-${online.userId}-${Date.now()}`
        const dc = dutyCops()
        if (dc.length) { const msg = { t: 'go', id, bandits: [online.userId], cops: dc, bots: what === 'steal' ? 4 : 6, from: online.userId, ex: what }; for (const dl of [0, 600, 1500]) window.setTimeout(() => { if (!dead) sendCh(msg) }, dl) }
        startChase(id, [online.userId], dc, what === 'steal' ? 4 : 6, online.userId, 'bandit', false, what)
        say(what === 'armory' ? 'Waffenkammer offen! Schnapp dir den Schlagstock-Ruhm: überlebe 6 Minuten – die Polizei steht vor der Tür!' : 'Du sitzt im SWAT-Wagen! 6 Minuten Polizeijagd – die SWAT-Wagen fliegen auch.')
      }
      let atmNext = 0
      const atmRob = () => {
        const nowT = performance.now()
        if (!online) { say('Geldautomaten knacken geht nur im Online-Spiel.'); return }
        if (nowT < atmNext) { say(`Der Automat ist noch leer – warte ${Math.ceil((atmNext - nowT) / 1000)} s.`); return }
        atmNext = nowT + 40000
        void raceAtmPay().then((r) => { if (dead) return; say(r.coins > 0 ? `Geldautomat geknackt: +${r.coins} Coins!` : 'Der Automat war leer.'); if (r.koins !== null) walletRef.current?.setBalance(r.koins) }).catch((e) => { atmNext = 0; say(errorMessage(e)) })
      }
      /** Bankfenster: Schlag oder schnelles Auto an der Fassade lässt das Glas klirren */
      const bankP = pois().find((q) => q.kind === 'bank')
      let glassT = 0
      const nearFacade = (x: number, z: number, reach: number) => {
        if (!bankP) return false
        const dx = x - bankP.x, dz = z - bankP.z
        return Math.abs(dx * bankP.nz - dz * bankP.nx) < 32 && dx * bankP.nx + dz * bankP.nz > -1 && dx * bankP.nx + dz * bankP.nz < reach
      }
      const smashAt = (x: number, z: number) => { const n = rs.smashGlass(x, z, 5); if (n > 0) say('Klirr! Die Scheibe ist kaputt.'); return n }
      const tickBank = () => {
        if (foot || ride || !bankP) return
        const nowT = performance.now()
        if (nowT - glassT < 250) return
        if (Math.abs(car.v) > 9 && nearFacade(car.x, car.z, 5.5)) { glassT = nowT; smashAt(car.x + Math.sin(car.h) * 2.5, car.z + Math.cos(car.h) * 2.5) }
      }
      heistRef.current = () => {
        const f = foot as Walker | null
        if (!f || chase) return
        if (!online) { say('Die Bank kann nur im Online-Spiel ausgeraubt werden.'); return }
        const sn = spotNear(f.x, f.z, f.y)
        const p = sn && sn.spot.kind === 'vault' ? sn.poi : null
        if (!p) return
        void raceBankClaim().then(() => {
          if (dead || chase) return
          const mates = [...remotes.values()].filter((r) => r.wk && !r.rd && !r.ro && !r.id.startsWith('pb-') && !r.id.endsWith('w') && fresh(r) && buildingAt(r.x, r.z) === p.b).slice(0, 3).map((r) => r.id)
          const id = `bank-${online.userId}-${Date.now()}`
          const bandits = [online.userId, ...mates]
          const dc = dutyCops().filter((i) => !bandits.includes(i))
          const msg = { t: 'go', id, bandits, cops: dc, bots: 6, from: online.userId, hz: 1 }
          for (const dl of [0, 600, 1500]) window.setTimeout(() => { if (!dead) sendCh(msg) }, dl)
          startChase(id, bandits, dc, 6, online.userId, 'bandit', true)
          say('Der Tresor ist offen! Lauf zu Fuß nach draußen zu den Fluchtautos!')
        }).catch((e) => say(errorMessage(e)))
      }
      poiKey.current = () => {
        const f = foot as Walker | null
        const bs = f && footKo <= 0 && !rescue && isCity ? bunkerSpotNear(f.x, f.z, f.lvl ?? 0, hatchP > 0.9) : null
        if (bs) { bunkerAct(bs.kind); return }
        const sn = f && footKo <= 0 && !rescue ? spotNear(f.x, f.z, f.y) : null
        if (!sn) return
        if (sn.spot.kind === 'vault') heistRef.current()
        else if (sn.spot.kind === 'dress') toggleDuty(sn.poi.kind === 'police' ? 'p' : sn.poi.kind === 'fire' ? 'f' : 'm')
        else if (sn.spot.kind === 'armory' || sn.spot.kind === 'steal') crimeRef.current(sn.spot.kind === 'armory' ? 'armory' : 'steal')
        else if (sn.spot.kind === 'tank' || sn.spot.kind === 'heli' || sn.spot.kind === 'armycar') stealArmy(sn.spot)
        else if (sn.spot.kind === 'vest') takeVest()
        else if (sn.spot.kind === 'rifle' || sn.spot.kind === 'sniper') takeGun(sn.spot.kind)
        else if (sn.spot.kind === 'climb') climbFence(sn.spot)
        else if (sn.spot.kind === 'pole') slidePole()
        else if (sn.spot.kind === 'rest' || sn.spot.kind === 'kitchen') { if (foot) { foot = { ...foot, hp: 1 }; myHp = 1 }; say(sn.spot.kind === 'rest' ? 'Du ruhst dich aus – volle Leben.' : 'Du isst etwas – volle Leben.') }
        else if (sn.spot.kind === 'atm') atmRob()
        else setShopUi(sn.spot.kind === 'weapons' ? 'weapons' : sn.spot.kind === 'counter' ? 'shop' : 'gym')
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
        mapPos.current = { x: car.x, z: car.z, h: car.h }
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
        if (kmission) dot(kmission.x, kmission.z, Math.floor(nowT / 400) % 2 ? '#ff2d2d' : '#ffffff', 6.5)
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
        hiddenNow = isCity && !myRole && (hiddenRef.current || inPark(car.x, car.z) || safe.garage)
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
              if (pb.kind === 'heli') { heliAI(pb, tg, dt); continue }
              if (pb.swat && pb.men?.length) { swatMen(pb, tg, dt); pb.car = stepCar(pb.car, idleIn, dt, track, pb.st, true); continue }
              if (pb.w) {
                // Polizist zu Fuß: läuft zum Bandit (wenn der zu Fuß ist oder das Auto weg ist), sonst zurück zu seinem Auto
                const onFoot = !!tg.wk || !!pb.carGone
                // Absprache: Deckungs-Schützen halten ~12 m Abstand und schießen, die Nahkämpfer umkreisen das Ziel aus anderem Winkel (jeder hat seinen eigenen Winkel – kein Haufen)
                let hs = 0; for (let k = 0; k < pb.id.length; k++) hs = (hs * 31 + pb.id.charCodeAt(k)) % 1009
                const cov = hs % 2 === 1, ang = (hs / 1009) * Math.PI * 2
                const dT = Math.hypot(tg.x - pb.w.x, tg.z - pb.w.z), seesT = onFoot && dT < 30 && clearLine(pb.w.x, pb.w.z, tg.x, tg.z) && !shotBlocked(pb.w.x, pb.w.y + 1.3, pb.w.z, tg.x, (tg.y ?? 0) + 1, tg.z)
                const ringR = cov ? 12 : dT > 14 ? 6 : 0
                const tx = onFoot ? tg.x + Math.cos(ang) * ringR : pb.car.x, tz = onFoot ? tg.z + Math.sin(ang) * ringR : pb.car.z
                const holdC = cov && seesT && dT < 16
                const nv = navFoot(pb.id, { x: pb.w.x, z: pb.w.z, y: pb.w.y }, { x: tx, z: tz, y: onFoot ? tg.y : pb.car.y }); let dh = Math.atan2(holdC ? tg.x - pb.w.x : nv.x - pb.w.x, holdC ? tg.z - pb.w.z : nv.z - pb.w.z) - pb.w.h; while (dh > Math.PI) dh -= Math.PI * 2; while (dh < -Math.PI) dh += Math.PI * 2
                pb.w = stepWalker(holdC ? { ...pb.w, h: pb.w.h + dh * Math.min(1, dt * 8) } : pb.w, { fwd: !holdC && Math.abs(dh) < 1.3, back: false, left: !holdC && dh > 0.12, right: !holdC && dh < -0.12, run: true }, dt)
                if (holdC) {
                  pb.scd = (pb.scd ?? 1) - dt
                  if (pb.scd <= 0) {
                    pb.scd = 1.2 + Math.random() * 0.8
                    const hit = Math.random() < 0.55
                    tracer(pb.w.x, pb.w.y + 1.3, pb.w.z, tg.x + (hit ? 0 : (Math.random() - 0.5) * 3), (tg.y ?? 0) + 1.1, tg.z + (hit ? 0 : (Math.random() - 0.5) * 3))
                    if (hit) { if (tg.id === online.userId) hurtByShot(4, true); else if (ready) void ch?.send({ type: 'broadcast', event: 'sd', payload: { to: tg.id, d: 4, k: 'f' } }).catch(() => undefined) }
                  }
                }
                if (!onFoot && Math.hypot(tx - pb.w.x, tz - pb.w.z) < 2.8) { pb.w = undefined; if (pb.wm) { scene.remove(pb.wm); pb.wm = undefined } }
                pb.pcd = (pb.pcd ?? 0) - dt
                if (pb.w && onFoot && Math.hypot(tg.x - pb.w.x, tg.z - pb.w.z) < 1.8 && pb.w.stun <= 0 && Math.abs((tg.y ?? 0) - pb.w.y) < 2.5 && pb.pcd <= 0) {
                  // Polizist schlägt zu (der Bandit stirbt erst durch Lebenspunkte)
                  pb.pcd = 0.8; pb.pa = nowT
                  const sx = Math.sin(pb.w.h), sz = Math.cos(pb.w.h)
                  if (tg.id === online.userId) { if (foot) { foot = { ...foot, vx: foot.vx + sx * 8, vz: foot.vz + sz * 8, hp: Math.max(0, foot.hp - 10 * hpCfg.armor), stun: Math.max(foot.stun, 0.45) }; lastRegenHit = nowT; say('Ein Polizist schlägt dich!') } }
                  else if (ready) void ch?.send({ type: 'broadcast', event: 'pn', payload: { to: tg.id, dx: sx, dz: sz, d: 10 } }).catch(() => undefined)
                }
                if (!pb.carGone) pb.car = stepCar(pb.car, idleIn, dt, track, pb.st, true)
                continue
              }
              if (pb.carGone) continue
              if (tg.wk && pb.car.v < 14 && pb.kind !== 'tank' && Math.hypot(tg.x - pb.car.x, tg.z - pb.car.z) < 26) {
                if (pb.swat) { deploySwat(pb); continue }
                pb.w = exitFromCar({ ...pb.car, wid: pb.st.wid }, 1)
                pb.wm = rs.makeWalker('#1d4ed8', '#0f172a', pb.name); addBaton(THREE, pb.wm); scene.add(pb.wm)
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
              if (pb.swat && !tg.wk) swatTruckFire(pb, tg, dt)
              if (pb.kind === 'tank') tankFire(pb, tg, dt)
            }
          }
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
          if (eff.kind === 'heli') car = stepHeli(car, input, heliDown.current, dt / nSub, camGround)
          else {
            if (eff.kind === 'tank' && Math.abs(car.v) < 3) { const tr = (input.left ? 1 : 0) - (input.right ? 1 : 0); if (tr) car = { ...car, h: car.h + tr * 1.25 * dt / nSub } }
            car = stepCar(car, chase && !chase.over ? { ...input, chase: true } : input, dt / nSub, track, myStats, go, true)
          }
          if (car.fly > 0 || eff.kind === 'heli') continue
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
          for (const pb of pbots) {
            if (pb.carGone || (pb.car.lvl ?? 0) !== (car.lvl ?? 0) || Math.abs((pb.car.y ?? 0) - (car.y ?? 0)) > 2.5) continue
            const pre = car
            const sc = now - (hitAt.get(pb) ?? -1e9) < 250 ? 0 : 1
            const c1 = crash(pre, myStats, { x: pb.car.x, z: pb.car.z, h: pb.car.h, v: pb.car.v }, pb.st, 0.5, DMG_MAX, sc)
            if (!c1) continue
            if (sc && !pb.swat && Math.abs(pre.v) > 10 && Math.abs(pre.v) > Math.abs(pb.car.v)) { callSwat(); addStar(1) }
            if (eff.kind === 'swat' && sc && Math.abs(pb.car.v) > Math.abs(pre.v)) swatHurt += Math.max(0, c1.dmg - pre.dmg) * 3
            car = c1; bumped = true
            const c2 = crash(pb.car, pb.st, { x: pre.x, z: pre.z, h: pre.h, v: pre.v, slip: pre.slip }, myStats, 0.5, 85, sc)
            if (c2) pb.car = c2
            if (sc) hitAt.set(pb, now)
          }
          for (const pt of patrols) {
            if (pt.sleep > 0 || (pt.car.lvl ?? 0) !== (car.lvl ?? 0) || Math.abs((pt.car.y ?? 0) - (car.y ?? 0)) > 2.5) continue
            const pre = car
            const c1 = crash(pre, myStats, { x: pt.car.x, z: pt.car.z, h: pt.car.h, v: pt.car.v }, pt.st, 0.5, DMG_MAX, 1)
            if (!c1) continue
            car = c1; bumped = true
            const c2 = crash(pt.car, pt.st, { x: pre.x, z: pre.z, h: pre.h, v: pre.v, slip: pre.slip }, myStats, 0.5, 85, 0)
            if (c2) pt.car = c2
            if (eff.kind !== 'swat' || Math.abs(pre.v) > 8) ramPatrol(pt)
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
          tickRide(dt)
        } else {
          tickFoot(dt, now)
          const f = foot as Walker | null
          if (f) car = { ...car, x: f.x, z: f.z, h: f.h, v: 0, steer: 0, slip: 0, y: f.y, vy: 0, fly: 0, lvl: f.lvl ?? 0, dmg: 0, hit: 0, bump: 0 }
        }
        // mein Auto überfährt Polizisten zu Fuß
        if (!foot && Math.abs(car.v) > 3) for (const pb of pbots) if (pb.w) { const r = carHit(pb.w, { x: car.x, z: car.z, h: car.h, v: car.v, len: myStats.len, wid: myStats.wid, y: car.y ?? 0 }); if (r) pb.w = r }
        if (!foot && punchReq.current) { punchReq.current = false; if (!ride) fireGun('swat', true) }
        tickQuad(dt, now)
        bunkerFrame(dt, now)
        tickExtras(dt, now)
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
          const rotor = m.userData.rotor as import('three').Group | undefined; if (rotor) rotor.rotation.y = now / 25
          const trot = m.userData.tailRotor as import('three').Object3D | undefined; if (trot) trot.rotation.x = now / 20
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
        for (const pb of [...pbots]) if (pb.swat && !pb.carGone && pb.car.dmg >= DMG_MAX) blowPbot(pb, true)
        for (const pb of pbots) {
          if (!pb.carGone) { place(pb.mesh, pb.car.x, pb.car.z, pb.car.h, pb.car.v, pb.car.steer, pb.car.dmg, pb.car.slip, 0, pb.car.lvl ?? 0, pb.car.y ?? 0, 0); rs.tickSiren(pb.mesh, now) }
          if (pb.w && pb.wm) { pb.wm.position.set(pb.w.x, pb.w.y, pb.w.z); pb.wm.rotation.y = pb.w.h; poseWalker(pb.wm, pb.w.ph, pb.w.sp, pb.w.stun, pb.w.vy > 1, (now - (pb.pa ?? -1e9)) / 320) }
          for (const mn of pb.men ?? []) { mn.m.position.set(mn.w.x, mn.w.y, mn.w.z); mn.m.rotation.y = mn.w.h; poseWalker(mn.m, mn.w.ph, mn.w.sp, mn.w.stun, mn.w.vy > 1); armUp(mn.m) }
        }
        if (fireBot) { const fa = fireBot.truck; place(fa.mesh, fa.car.x, fa.car.z, fa.car.h, fa.car.v, fa.car.steer, fa.car.dmg, fa.car.slip, 0, fa.car.lvl ?? 0, fa.car.y ?? 0, 0); rs.tickSiren(fa.mesh, now) }
        if (rescue?.amb) { const ra = rescue.amb; place(ra.mesh, ra.car.x, ra.car.z, ra.car.h, ra.car.v, ra.car.steer, ra.car.dmg, ra.car.slip, 0, ra.car.lvl ?? 0, ra.car.y ?? 0, 0); rs.tickSiren(ra.mesh, now) }
        for (const pt of patrols) if (pt.sleep <= 0) { place(pt.mesh, pt.car.x, pt.car.z, pt.car.h, pt.car.v, pt.car.steer, pt.car.dmg, pt.car.slip, 0, pt.car.lvl ?? 0, pt.car.y ?? 0, 0); rs.tickSiren(pt.mesh, now) }
        for (const p of parked) { place(p.mesh, p.car.x, p.car.z, p.car.h, p.car.v, 0, p.car.dmg, p.car.slip, 0, p.car.lvl ?? 0, p.car.y ?? 0, pitchOf(p.car)); if (p.siren) rs.tickSiren(p.mesh, now) }
        if (foot && footMesh) { footMesh.visible = !(egoOn || (zoomOn && armyGun === 'sniper')); footMesh.position.set(foot.x, foot.y, foot.z); footMesh.rotation.y = foot.h; poseWalker(footMesh, foot.ph, foot.sp, foot.stun, foot.vy > 1, (now - lastPunch) / 320); armUp(footMesh) }
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
          if (r.wk) { r.mesh.position.set(r.x, r.yy ?? 0, r.z); r.mesh.rotation.y = r.h; poseWalker(r.mesh, now / 140, r.v, 0, false, (now - (r.pcAt ?? -1e9)) / 320); armUp(r.mesh) } else place(r.mesh, r.x, r.z, r.h, r.v, 0, r.dmg, r.slip, r.fl, r.lv ?? 0, r.yy ?? 0, r.pt ?? 0)
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
          const armored = isArmored(eff.kind)
          if (armored) { myHp -= swatHurt; swatHurt = 0; car = { ...car, dmg: 0 }; prevDmg = 0 }
          const dd = armored ? 0 : car.dmg - prevDmg
          if (dd > 0) myHp -= dd * 0.9
          const burning = !armored && car.dmg / DMG_MAX > 0.85
          if (burning) { burnT += dt; myHp -= 3.5 * dt } else burnT = 0
          const sp = Math.abs(car.v)
          if (!armored && prevV > 300 / 3.6 && sp < prevV * 0.5 && car.hit > 0.3) explode('Mit über 300 km/h eingeschlagen – das war tödlich! Das Auto explodiert.')
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
            const lay = layoutOf(inB), fl = Math.max(0, Math.min(Math.floor((foot.y + 0.5) / lay.fh), lay.floors - 1))
            const cx = Math.max(inB.x - inB.w / 2 + 0.9, Math.min(inB.x + inB.w / 2 - 0.9, fx0)), cz = Math.max(inB.z - inB.d / 2 + 0.9, Math.min(inB.z + inB.d / 2 - 0.9, fz0))
            camera.position.set(cx, Math.min(foot.y + 2.3, fl * lay.fh + lay.fh - 0.5), cz)
          } else if (inParkXZ(foot.x, foot.z, 1.5) && foot.y < PARK_TOP) {
            // Parkhaus: Kamera nah dran, unter der Decke und zwischen den Wänden
            let ceil = Infinity
            for (const h of parkSurfaces(foot.x, foot.z)) if (h > foot.y + 1 && h < ceil) ceil = h
            const bx = Math.max(PARK.x0 + 0.8, Math.min(PARK.x1 - 0.8, foot.x - Math.sin(camH) * 2.6)), bz = Math.max(PARK.z0 + 0.8, Math.min(PARK.z1 - 0.8, foot.z - Math.cos(camH) * 2.6))
            camera.position.set(bx, Math.max(foot.y + 0.9, Math.min(foot.y + 1.9, ceil - 0.45)), bz)
          } else if ((foot.lvl ?? 0) === -2 || liftDir !== 0) {
            // Bunker: Kamera zwischen den Hallenwänden bzw. im Fahrstuhlschacht
            let bx = foot.x - Math.sin(camH) * 3.4, bz = foot.z - Math.cos(camH) * 3.4
            if (liftDir !== 0) { bx = Math.max(BUNKER.ex - 3.2, Math.min(BUNKER.ex + 3.2, bx)); bz = Math.max(BUNKER.ez - 3.2, Math.min(BUNKER.ez + 3.2, bz)) }
            else { bx = Math.max(BUNKER.x0 + 1, Math.min(BUNKER.x1 - 1, bx)); bz = Math.max(BUNKER.z0 + 1.2, Math.min(BUNKER.z1 - 1.2, bz)) }
            camera.position.set(bx, foot.y + 2.2, bz)
          } else if ((foot.lvl ?? 0) === -1) {
            const bx = foot.x - Math.sin(camH) * 2.6, bz = foot.z - Math.cos(camH) * 2.6
            const c = tunnelClamp(bx, bz)
            camera.position.set(c ? c.x : bx, foot.y + 1.9, c ? c.z : bz)
          } else {
            const gh = camGround(fx0, fz0)
            camera.position.set(fx0, foot.y < gh - 0.5 ? foot.y + 2.3 : Math.max(foot.y + 2.3, gh + 1.4), fz0)
          }
          camera.up.set(0, 1, 0)
          const ego = egoOn || (zoomOn && armyGun === 'sniper')
          if (ego) {
            const ey = foot.y + 1.62
            camera.position.set(foot.x + Math.sin(foot.h) * 0.15, ey, foot.z + Math.cos(foot.h) * 0.15)
            camera.lookAt(foot.x + Math.sin(foot.h) * 10, ey, foot.z + Math.cos(foot.h) * 10)
          } else if (ironOn && footMesh && !suitReady(footMesh) && !inB) {
            // Anzug-Animation: Kamera VOR der Figur, langsam seitlich schwenkend – man sieht alle Teile
            const t = performance.now() / 1000, ang = foot.h + Math.sin(t * 0.9) * 0.55
            camera.position.set(foot.x + Math.sin(ang) * 3.6, foot.y + 1.5, foot.z + Math.cos(ang) * 3.6)
            camera.lookAt(foot.x, foot.y + 1.1, foot.z)
          } else camera.lookAt(foot.x, foot.y + 1.3, foot.z)
          camera.fov += ((zoomOn && armyGun === 'sniper' ? 16 : 66) - camera.fov) * Math.min(1, dt * 6)
        }
        if (camS) {
          const e = camS.list[camS.i], c = e.cam, tg = e.find()
          camera.position.set(c.x, c.y, c.z); camera.up.set(0, 1, 0)
          if (tg) camera.lookAt(tg.x, tg.y, tg.z); else camera.lookAt(c.x + Math.sin(c.yaw) * 10, c.y - 2.5, c.z + Math.cos(c.yaw) * 10)
          camera.fov = 62
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
          send({ u: online.userId, x: car.x, z: car.z, h: car.h, v: foot ? foot.sp : car.v, wk: foot ? 1 : 0, wc: wcRef.current, ex: exN, pc: punchN, rd: ride ?? '', t: car.total, k: eff.kind, c: eff.color, ro: myRole === 'bandit' ? 'b' : myRole === 'cop' ? 'c' : '', f: finishedMs, d: Math.round(car.dmg), sl: Math.round(car.slip * 100) / 100, fl: Math.round(car.fly * 100) / 100, lv: car.lvl ?? 0, y: Math.round((car.y ?? 0) * 10) / 10, pt: Math.round(pitchOf(car) * 100) / 100, n: online.name ?? me.name, bt: batonRef.current || myRole === 'cop' ? 1 : 0, gr: myMask(), dn: rescue ? 1 : 0, dc: rescue?.claimed ?? '', od: dutyRef.current, hd: hiddenNow ? 1 : 0, ce: endInfo && now < endInfo.until ? endInfo.id : '', cw: endInfo?.win ?? '' })
          if (now - lastPark > 900) { lastPark = now; parked.forEach((p) => send({ u: pkId(p), x: p.car.x, z: p.car.z, h: p.car.h, v: p.car.v, t: 0, k: p.kind, c: p.color, ro: '', f: null, d: Math.round(p.car.dmg), sl: 0, fl: 0, lv: p.car.lvl ?? 0, y: Math.round((p.car.y ?? 0) * 10) / 10, pt: 0, n: 'Geparkt', hd: 0 })) }
          for (const pb of pbots) if (pb.w) send({ u: `${pb.id}w`, x: pb.w.x, z: pb.w.z, h: pb.w.h, v: pb.w.sp, wk: 1, t: 0, k: 'kleinwagen', c: '#1d4ed8', ro: 'c', f: null, d: 0, sl: 0, fl: 0, lv: 0, y: Math.round(pb.w.y * 10) / 10, pt: 0, n: pb.name, hd: 0 })
          if (now - lastMen > 190) { lastMen = now; for (const pb of pbots) for (const mn of pb.men ?? []) send({ u: mn.id, x: mn.w.x, z: mn.w.z, h: mn.w.h, v: mn.w.sp, wk: 1, t: 0, k: 'swatman', c: '#0f172a', ro: 'c', f: null, d: 0, sl: 0, fl: 0, lv: 0, y: Math.round(mn.w.y * 10) / 10, pt: 0, n: 'SWAT', hd: 0 }) }
          for (const pb of [...pbots, ...(rescue?.amb ? [rescue.amb] : []), ...(fireBot ? [fireBot.truck] : [])]) if (!pb.carGone) send({ u: pb.id, x: pb.car.x, z: pb.car.z, h: pb.car.h, v: pb.car.v, t: 0, k: pb.kind, c: pb.color, ro: 'c', f: null, d: 0, sl: Math.round(pb.car.slip * 100) / 100, fl: 0, lv: pb.car.lvl ?? 0, y: Math.round((pb.car.y ?? 0) * 10) / 10, pt: 0, n: pb.name, hd: 0 })
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
            const near = !!f && footKo <= 0 && !rescue && !!nearestCar(f, [...parked.map((p) => ({ x: p.car.x, z: p.car.z })), ...pbots.filter((pb) => pb.w && !pb.carGone).map((pb) => ({ x: pb.car.x, z: pb.car.z })), ...[...remotes.values()].filter((r) => !r.wk && !r.rd && !r.id.startsWith('pb-') && fresh(r)).map((r) => ({ x: r.x, z: r.z }))], 5.5)
            const seat = f ? '' : `${ride ? occupants(ride) : occupants(online?.userId ?? '')}/${seatsOf(ride ? remotes.get(ride)?.kind ?? '' : eff.kind)}`
            const msg = performance.now() < footMsgT ? footMsg : ''
            const hp = Math.round(f ? f.hp : Math.max(0, myHp))
            const bsn = f && footKo <= 0 && !rescue && liftDir === 0 ? bunkerSpotNear(f.x, f.z, f.lvl ?? 0, hatchP > 0.9) : null
            const pn = f && footKo <= 0 && !rescue && !bsn ? spotNear(f.x, f.z, f.y) : null
            setPoiUi((o) => { const lab = bsn?.label ?? pn?.spot.label; return o?.label === lab ? o : bsn ? { kind: 'bunker', label: bsn.label } : pn ? { kind: pn.spot.kind, label: pn.spot.label } : null })
            { const ac = computeActs(), key = ac.map((a) => a.k).join('|'); setActs((o) => (o.map((a) => a.k).join('|') === key ? o : ac)); const mt = kmissionText(); setMissionTxt((o) => (o === mt ? o : mt)) }
            if (pn?.spot.kind === 'vault' && now - lastBankPoll > 4000) { lastBankPoll = now; void raceBankStatus().then((w) => { if (!dead) setBankWait(w) }).catch(() => undefined) }
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
    <div ref={rootEl} className={`select-none overflow-hidden bg-slate-900 ${full ? 'fixed inset-0 z-[70]' : 'relative rounded-2xl'}`} style={{ height: full ? '100dvh' : 'min(72vh, 640px)', touchAction: 'none' }}>
      <div ref={mount} className="absolute inset-0" />
      <button type="button" onClick={toggleFull} aria-label={full ? 'Vollbild beenden' : 'Vollbild'} aria-pressed={full} className="absolute left-1/2 top-2 z-20 -translate-x-1/2 rounded-lg bg-black/45 px-2.5 py-1 text-xs text-white">{full ? '⤢ Vollbild aus' : '⤢ Vollbild'}</button>
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
      {def.mode === 'city' && mapUi.on && <canvas ref={cmini} width={220} height={220} aria-label="Karte" style={{ width: MAP_SIZES[mapUi.s], height: MAP_SIZES[mapUi.s] }} className={`absolute right-2 top-2 rounded-full bg-black/40 ${ironUi ? 'pointer-events-auto cursor-crosshair ring-2 ring-red-500' : 'pointer-events-none'}`}
        onPointerDown={ironUi ? (e) => {
          e.stopPropagation()
          const r = e.currentTarget.getBoundingClientRect(), S = 220, cx = S / 2, k = (S / 2 - 3) / MAP_RANGES[mapUi.r]
          const a = ((e.clientX - r.left) / r.width * S - cx) / k, b = (cx - (e.clientY - r.top) / r.height * S) / k
          const { x, z, h } = mapPos.current, ch = Math.cos(h), sh = Math.sin(h)
          bombRef.current(x + (-ch * a + sh * b), z + (sh * a + ch * b))
        } : undefined} />}
      {def.mode === 'city' && (
        <div className="absolute right-2 z-20 text-right" style={{ top: (mapUi.on ? MAP_SIZES[mapUi.s] : 0) + 12 }}>
          <button type="button" onClick={() => setMapPanel((o) => !o)} aria-expanded={mapPanel} className="rounded-lg bg-black/45 px-2.5 py-1 text-xs text-white">⚙ Karte & Steuerung</button>
          {mapPanel && (
            <div className="mt-1 max-h-[60vh] w-60 space-y-2 overflow-y-auto rounded-xl bg-slate-900/95 p-3 text-left text-xs text-white" role="group" aria-label="Karten-Einstellungen">
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
              <div className="border-t border-white/15 pt-2">
            <p className="mb-1 flex justify-between"><span>Joystick-Drehung</span><b className="tabular-nums">×{joyTurn.toLocaleString('de-DE')}</b></p>
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
            <p className="mb-1 mt-2">Minecraft-Skin {skinAllowed ? '' : '(nur Pro)'}</p>
            {skinAllowed ? (
              <div className="flex items-center gap-1">
                <label className="flex-1 cursor-pointer rounded bg-white/15 px-2 py-1 text-center">PNG wählen<input type="file" accept="image/png" className="sr-only" onChange={(e) => { pickSkin(e.target.files?.[0]); e.target.value = '' }} /></label>
                {skinUi && <button type="button" onClick={() => applySkin('')} className="rounded bg-white/15 px-2 py-1">Entfernen</button>}
              </div>
            ) : <p className="text-slate-400">Mit Pro kannst du deinen Minecraft-Skin importieren.</p>}
            {skinErr && <p className="mt-1 text-rose-300">{skinErr}</p>}
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
      {reviveUi.mine && (
        <div className="absolute inset-x-0 top-1/3 z-20 grid justify-items-center gap-2 px-4 text-center">
          <p className="pointer-events-none text-2xl font-black text-rose-200 [text-shadow:0_3px_12px_#000]">Du bist bewusstlos – Hilfe ist unterwegs</p>
          <button type="button" disabled={reviveUi.busy} onClick={() => reviveRef.current()} className="min-h-[48px] rounded-xl border border-white/40 bg-emerald-400 px-4 text-sm font-bold text-slate-950 disabled:opacity-60">{isAdmin || pro ? 'Sofort wiederbeleben (gratis)' : 'Sofort wiederbeleben (10 Coins)'}</button>
        </div>
      )}
      <div className="pointer-events-none absolute bottom-44 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-2"><div className="pointer-events-auto flex flex-col items-center gap-2">
      {poiUi && footUi.on && !shopUi && (
        <button type="button" onClick={() => poiKey.current()} disabled={poiUi.kind === 'vault' && (bankWait > 0 || !!chaseUi.over)} className="min-h-[56px] rounded-xl border border-white/40 px-5 text-base font-bold text-slate-950 disabled:opacity-60" style={{ background: poiUi.kind === 'vault' ? POI_COLOR.bank : poiUi.kind === 'counter' ? POI_COLOR.shop : poiUi.kind === 'armory' || poiUi.kind === 'steal' ? POI_COLOR.police : poiUi.kind === 'dress' ? '#a5b4fc' : poiUi.kind === 'weapons' ? POI_COLOR.weapons : poiUi.kind === 'vest' || poiUi.kind === 'rifle' || poiUi.kind === 'sniper' || poiUi.kind === 'climb' || poiUi.kind === 'tank' || poiUi.kind === 'heli' || poiUi.kind === 'armycar' ? POI_COLOR.army : poiUi.kind === 'atm' ? POI_COLOR.bank : POI_COLOR.gym }}>
          {poiUi.kind === 'vault' ? (bankWait > 0 ? `Bank ruht noch ${Math.ceil(bankWait / 60)} Min` : 'TRESOR ÖFFNEN (G) – danach 6 Min Polizeijagd') : poiUi.kind === 'armory' ? 'WAFFENKAMMER AUFBRECHEN (G) – Schlagstock, 6 Min Polizeijagd' : poiUi.kind === 'steal' ? 'SWAT-WAGEN KLAUEN (G) – 6 Min Polizeijagd' : poiUi.kind === 'dress' ? `${poiUi.label} (G) – an/aus` : `${poiUi.label} (G)`}
        </button>
      )}
      {footUi.on || acts.length > 0 ? acts.map((a) => <button key={a.k} type="button" onClick={() => xRef.current('act', a.k)} className="min-h-[56px] rounded-xl border border-white/40 bg-amber-300 px-5 text-base font-bold text-slate-950">{a.label}</button>) : null}
      {isAdmin && grantUi && <button type="button" onClick={() => kskGiveRef.current(grantUi.id)} className="min-h-[52px] rounded-xl border border-white/40 bg-emerald-700 px-4 text-sm font-bold text-white">{grantUi.k ? `KSK von ${grantUi.name} nehmen` : `${grantUi.name} KSK geben`}</button>}
      {isAdmin && grantUi && <button type="button" onClick={() => ironGiveRef.current(grantUi.id)} className="min-h-[52px] rounded-xl border border-white/40 bg-red-600 px-4 text-sm font-bold text-amber-200">{grantUi.on ? `Iron Man von ${grantUi.name} nehmen` : `${grantUi.name} Iron Man geben`}</button>}
      {isAdmin && reviveUi.other && !reviveUi.mine && (
        <button type="button" onClick={() => reviveUi.other && reviveOtherRef.current(reviveUi.other.id)} className="min-h-[52px] rounded-xl border border-white/40 bg-emerald-400 px-4 text-sm font-bold text-slate-950">{reviveUi.other.name} gratis wiederbeleben</button>
      )}
      {sniperUi && <button type="button" onClick={() => { zoomKey.current = true }} className="min-h-[52px] rounded-xl bg-black/70 px-4 text-base font-bold text-white">🔭 Zoom (Z)</button>}
      </div></div>
      <div className="pointer-events-none absolute left-3 top-24 z-20"><div className="pointer-events-auto grid grid-cols-2 gap-1.5 rounded-2xl border border-white/20 bg-black/45 p-1.5 backdrop-blur-sm">
      {def.mode === 'city' && <button type="button" onClick={() => egoRef.current()} aria-pressed={!!egoUi} className={`flex h-[54px] w-[54px] flex-col items-center justify-center rounded-xl border text-white ${egoUi? 'border-amber-300 bg-sky-600' : 'border-white/30 bg-slate-800/80'}`}><span className="text-xl leading-none" aria-hidden>👁</span><span className="mt-0.5 text-[10px] font-bold leading-none">Ego</span></button>}
      {def.mode === 'city' && <button type="button" onClick={() => setWheelUi((w) => (w ? null : weaponInfoRef.current()))} aria-pressed={!!!!wheelUi} className={`flex h-[54px] w-[54px] flex-col items-center justify-center rounded-xl border text-white ${!!wheelUi? 'border-amber-300 bg-sky-600' : 'border-white/30 bg-slate-800/80'}`}><span className="text-xl leading-none" aria-hidden>🔫</span><span className="mt-0.5 text-[10px] font-bold leading-none">Waffen</span></button>}
      {(isAdmin || ironOk) && def.mode === 'city' && <button type="button" onClick={() => ironRef.current()} aria-pressed={!!ironUi} className={`flex h-[54px] w-[54px] flex-col items-center justify-center rounded-xl border text-white ${ironUi? 'border-amber-300 bg-sky-600' : 'border-white/30 bg-slate-800/80'}`}><span className="text-xl leading-none" aria-hidden>🦸</span><span className="mt-0.5 text-[10px] font-bold leading-none">Iron Man</span></button>}
      {(isAdmin || kskOk) && def.mode === 'city' && <button type="button" onClick={() => kskRef.current()} aria-pressed={!!kskUi} className={`flex h-[54px] w-[54px] flex-col items-center justify-center rounded-xl border text-white ${kskUi? 'border-amber-300 bg-sky-600' : 'border-white/30 bg-slate-800/80'}`}><span className="text-xl leading-none" aria-hidden>🪖</span><span className="mt-0.5 text-[10px] font-bold leading-none">KSK</span></button>}
      {kskUi && def.mode === 'city' && <button type="button" onClick={() => quadCallRef.current()} aria-pressed={!!false} className={`flex h-[54px] w-[54px] flex-col items-center justify-center rounded-xl border text-white ${false? 'border-amber-300 bg-sky-600' : 'border-white/30 bg-slate-800/80'}`}><span className="text-xl leading-none" aria-hidden>🛞</span><span className="mt-0.5 text-[10px] font-bold leading-none">Quad</span></button>}
      {ironUi && def.mode === 'city' && <button type="button" onClick={() => ironTpRef.current()} aria-pressed={!!false} className={`flex h-[54px] w-[54px] flex-col items-center justify-center rounded-xl border text-white ${false? 'border-amber-300 bg-sky-600' : 'border-white/30 bg-slate-800/80'}`}><span className="text-xl leading-none" aria-hidden>⚡</span><span className="mt-0.5 text-[10px] font-bold leading-none">Teleport</span></button>}
      <LangToggle className="!min-h-[54px] !w-[54px]" />
      </div></div>
      {wheelUi && (
        <div className="absolute inset-0 z-30 bg-black/40" onClick={() => setWheelUi(null)} role="dialog" aria-label="Waffenrad">
          {wheelUi.list.length === 0 && <p className="absolute left-1/2 top-1/2 w-64 -translate-x-1/2 -translate-y-1/2 rounded-xl bg-slate-900/90 p-3 text-center text-sm font-bold text-white">Im Anzug und in der KSK-Ausrüstung hast du deine Waffe schon.</p>}
          <div className="absolute left-1/2 top-1/2 h-0 w-0">
            {wheelUi.list.map((w, i, arr) => {
              const a = -Math.PI / 2 + (i / arr.length) * Math.PI * 2, r = arr.length > 1 ? 96 : 0
              return (
                <button key={w.id} type="button" aria-pressed={wheelUi.cur === w.id} onClick={(e) => { e.stopPropagation(); weaponPickRef.current(w.id); setWheelUi(null) }}
                  style={{ transform: `translate(calc(-50% + ${Math.cos(a) * r}px), calc(-50% + ${Math.sin(a) * r}px))` }}
                  className={`absolute flex h-[84px] w-[84px] flex-col items-center justify-center rounded-full border-2 text-white shadow-xl ${wheelUi.cur === w.id ? 'border-amber-300 bg-sky-600' : 'border-white/50 bg-slate-800/95'}`}>
                  <span className="text-3xl leading-none" aria-hidden>{w.icon}</span><span className="mt-1 text-[11px] font-bold leading-none">{w.name}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
      {def.mode === 'city' && (
<button type="button" onClick={() => exitRef.current()} className={`absolute bottom-48 left-4 z-30 min-h-[60px] min-w-[132px] rounded-2xl border-2 border-white/50 px-5 text-lg font-black shadow-lg ${footUi.on ? (footUi.near ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800/85 text-white') : 'bg-slate-800/85 text-white'}`}>{footUi.on ? 'Einsteigen (X)' : 'Aussteigen (X)'}</button>
      )}
      {starsUi > 0 && <div className="pointer-events-none absolute left-1/2 top-28 -translate-x-1/2 rounded-full bg-black/60 px-3 py-0.5 text-lg font-black tracking-widest text-amber-300" role="status" aria-label={`Fahndungsstufe ${starsUi} von ${Math.max(5, starsUi)}`}>{starsUi > 7 ? `★ ${starsUi}` : '★'.repeat(starsUi)}<span className="text-white/30">{'★'.repeat(Math.max(0, 5 - starsUi))}</span></div>}
      {dutyUi && <div className="pointer-events-none absolute left-1/2 top-20 -translate-x-1/2 rounded-full px-3 py-0.5 text-xs font-bold text-white" style={{ background: dutyUi === 'p' ? '#2563eb' : dutyUi === 'f' ? '#ea580c' : '#dc2626' }} role="status">{dutyUi === 'p' ? '👮 Im Dienst: Polizei' : dutyUi === 'f' ? '🚒 Im Dienst: Feuerwehr' : '🚑 Im Dienst: Sanitäter'}</div>}
      {bunkerUi === 'tune' && <QuadTunePanel isAdmin={isAdmin} coins={wallet?.balance ?? null} loadout={loadout} onLoadout={applyLoadout} onKoins={(k) => walletRef.current?.setBalance(k)} onClose={() => setBunkerUi(null)} />}
      {bunkerUi === 'drone' && <DronePanel getData={() => droneRef.current()} onClose={() => setBunkerUi(null)} onCams={() => { setBunkerUi(null); xRef.current('cam', 'open') }} />}
      {bunkerUi === 'mission' && <MissionPanel active={missionTxt || null} onStart={(k) => { xRef.current('mstart', k); setBunkerUi(null) }} onCancel={() => xRef.current('mcancel')} onClose={() => setBunkerUi(null)} />}
      {bunkerUi === 'plane' && <PlaneMapPanel onGo={(x, z) => { setBunkerUi(null); xRef.current('plane', { x, z }) }} onClose={() => setBunkerUi(null)} />}
      {furnUi && <FurnitureEditor b={furnUi.b} furn={furnUi.furn} wall={furnUi.wall} onChange={(f) => xRef.current('furnChange', f)} onWall={(c) => xRef.current('wallChange', c)} onClose={() => xRef.current('furnDone')} />}
      {garageUi && <GaragePanel cars={garageUi} onTake={(i) => xRef.current('take', i)} onFoot={() => xRef.current('gfoot')} />}
      {camUi && (
        <div className="absolute left-1/2 top-3 z-30 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-red-400/70 bg-black/75 px-2 py-1 text-white">
          <span className="animate-pulse text-red-400" aria-hidden>●</span>
          <button type="button" onClick={() => xRef.current('cam', 'prev')} className="min-h-[44px] min-w-[44px] rounded-lg bg-white/15 text-lg font-bold" aria-label="Vorherige Kamera">‹</button>
          <span className="text-xs font-bold">Kamera {camUi.i + 1}/{camUi.n}<br />{camUi.who}</span>
          <button type="button" onClick={() => xRef.current('cam', 'next')} className="min-h-[44px] min-w-[44px] rounded-lg bg-white/15 text-lg font-bold" aria-label="Nächste Kamera">›</button>
          <button type="button" onClick={() => xRef.current('cam', 'close')} className="min-h-[44px] rounded-lg bg-red-500/80 px-3 text-sm font-bold">Schließen</button>
        </div>
      )}
      {missionTxt && !camUi && <div className="pointer-events-none absolute left-1/2 top-14 z-20 max-w-[80%] -translate-x-1/2 rounded-lg bg-red-700/80 px-3 py-1 text-center text-xs font-bold text-white">🎯 {missionTxt}</div>}
      {shopUi === 'weapons' && <WeaponShop isAdmin={isAdmin} coins={wallet?.balance ?? null} owned={gearUi} onOwned={applyGear} onKoins={(k) => walletRef.current?.setBalance(k)} onClose={() => setShopUi(null)} />}
      {(shopUi === 'shop' || shopUi === 'gym') && <VocabShop kind={shopUi} perks={perksUi} isAdmin={isAdmin} onPerks={applyPerks} onBought={(it) => { if (it === 'heal') healRef.current = true }} onClose={() => setShopUi(null)} />}
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
          </div>
        )}
        {def.mode === 'city' && (
          <>
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
            <button type="button" aria-label="Runter" onPointerDown={() => { heliDown.current = true }} onPointerUp={() => { heliDown.current = false }} onPointerCancel={() => { heliDown.current = false }} onContextMenu={(e) => e.preventDefault()} className={`${btn} h-20 w-20 text-base ${ironUi ? '' : 'hidden'} !bg-sky-700/70`}>RUNTER</button>
            <button type="button" aria-label="Schlagen" onPointerDown={() => { punchReq.current = true }} className={`${btn} h-20 w-20 text-base !bg-rose-600/65`}>SCHLAG</button>
            <button type="button" aria-label="Springen" {...hold('jump')} className={`${btn} h-28 w-28 text-lg !bg-emerald-600/65`}>SPRINGEN</button>
          </>
        ) : (
          <>
            {heliUi && <button type="button" aria-label="Runter" onPointerDown={() => { heliDown.current = true }} onPointerUp={() => { heliDown.current = false }} onPointerCancel={() => { heliDown.current = false }} onLostPointerCapture={() => { heliDown.current = false }} onContextMenu={(e) => e.preventDefault()} className={`${btn} h-20 w-24 text-base !bg-sky-700/70`}>RUNTER</button>}
            {heliUi && <button type="button" aria-label="Rakete" onPointerDown={() => rocketRef.current()} className={`${btn} h-20 w-24 text-base !bg-orange-600/70`}>RAKETE</button>}
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
