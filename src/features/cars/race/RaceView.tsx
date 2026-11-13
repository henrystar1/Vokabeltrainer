import { useEffect, useRef, useState } from 'react'
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import { gameClientFor, slotForKey, whenGameDbsReady } from '../../../lib/gameRealtime'
import { botInput, crash, startCar, statsFor, stepCar, type Bot, type Car, type CarStats, type Input } from './physics'
import { TRACKS, buildTrack, curveAhead, pointAt, project, trackKey, type TrackDef } from './track'
import { botSteer, buildRaceLine } from './line'
import { kindDims } from '../stats'
import { raceSubmit } from '../../../services/cars'

export interface RaceCarInfo { /** Auto-ID im Shop (für die Rangliste) */ id?: string; name: string; kind: string; color: string; /** eigene Höchstgeschwindigkeit des Autos (km/h) */ top?: number | null }
export interface RaceStanding { name: string; ms: number | null; me?: boolean }
interface Props {
  trackId: number
  /** Eigene (gemalte) Strecke statt einer festen */
  custom?: TrackDef
  laps: number
  me: RaceCarInfo
  /** Fahrassistent (Ideallinie) darf eingeschaltet werden: Supercar */
  assistOk?: boolean
  bots?: Array<RaceCarInfo & { skill: number }>
  online?: { gameId: string; userId: string; players: Array<{ id: string; name: string }>; /** gewählte Autos aller Spieler (vom Server) */ cars?: Record<string, { name?: string; kind: string; color: string; top?: number | null }> }
  /** Zielzeit melden (Millisekunden seit Start der Ampel) */
  onFinish?: (ms: number) => void
  onAgain?: () => void
  onExit?: () => void
}

interface Remote { id: string; name: string; kind: string; color: string; x: number; z: number; h: number; v: number; tx: number; tz: number; th: number; total: number; ft: number | null; seen: number; dmg: number; slip: number; mesh?: import('three').Group }

const COUNT_MS = 4500
const fmt = (ms: number) => { const m = Math.floor(ms / 60000); const s = ms / 1000 - m * 60; return `${m}:${s.toFixed(2).padStart(5, '0')}` }
const lapKey = (key: string) => `race-best-${key}`

/** 3D-Rennen: Verfolgerkamera, Fahrphysik, Bots und Online-Mitspieler (Broadcast über die Spiel-Datenbanken). */
export default function RaceView({ trackId, custom, laps, me, assistOk = false, bots = [], online, onFinish, onAgain, onExit }: Props) {
  const mount = useRef<HTMLDivElement>(null)
  const mini = useRef<HTMLCanvasElement>(null)
  const inp = useRef<Input>({ gas: false, brake: false, left: false, right: false })
  const resetReq = useRef(false)
  const camRef = useRef<0 | 1>((() => { try { return localStorage.getItem('vt-race-cam') === '1' ? 1 : 0 } catch { return 0 } })())
  const [cockpit, setCockpit] = useState(camRef.current === 1)
  const wheelEl = useRef<HTMLDivElement>(null)
  const toggleCam = () => { camRef.current = camRef.current === 1 ? 0 : 1; setCockpit(camRef.current === 1); try { localStorage.setItem('vt-race-cam', String(camRef.current)) } catch { /* ignorieren */ } }
  const toggleRef = useRef(toggleCam)
  toggleRef.current = toggleCam
  const finishCb = useRef(onFinish)
  finishCb.current = onFinish
  const def = custom ?? TRACKS[Math.max(0, Math.min(TRACKS.length - 1, trackId))]
  const assistRef = useRef(false)
  const [assist, setAssist] = useState(false)
  const toggleAssist = () => { if (!assistOk) return; assistRef.current = !assistRef.current; setAssist(assistRef.current) }
  const assistToggleRef = useRef(toggleAssist)
  assistToggleRef.current = toggleAssist
  const [hud, setHud] = useState({ speed: 0, lap: 1, pos: 1, of: 1 + bots.length + (online ? online.players.length - 1 : 0), ms: 0, count: 4, wrong: false, curve: 0, curveDist: 0, offroad: false, best: 0, dmg: 0, drift: false })
  const [done, setDone] = useState<{ ms: number; best: number; standings: RaceStanding[] } | null>(null)
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

      // Fahrzeuge
      const myStats: CarStats = statsFor(me.kind, me.top)
      const line = buildRaceLine(track)
      let slot = 0
      const mySlot = online ? Math.max(0, online.players.findIndex((p) => p.id === online.userId)) : bots.length
      let car: Car = startCar(track, mySlot)
      const myMesh = rs.makeCar(me.kind, me.color, me.name, true)
      scene.add(myMesh)
      const botList: Bot[] = bots.map((b, i) => {
        const bt: Bot = { car: startCar(track, slot++), kind: b.kind, color: b.color, name: b.name, skill: b.skill, lane: (i % 3 - 1) * Math.min(2.2, def.width * 0.1), wobble: i * 1.7, finished: null, top: b.top, st: statsFor(b.kind, b.top) }
        return bt
      })
      const botMeshes = botList.map((b) => { const m = rs.makeCar(b.kind, b.color, b.name, false); scene.add(m); return m })
      const remotes = new Map<string, Remote>()
      if (online) online.players.forEach((p, i) => { if (p.id !== online.userId) { const c = startCar(track, i); const oc = online.cars?.[p.id]; const r: Remote = { id: p.id, name: p.name, kind: oc?.kind ?? 'kleinwagen', color: oc?.color ?? '#94a3b8', x: c.x, z: c.z, h: c.h, v: 0, tx: c.x, tz: c.z, th: c.h, total: c.total, ft: null, seen: 0, dmg: 0, slip: 0 }; if (oc) { r.mesh = rs.makeCar(r.kind, r.color, r.name, false); r.mesh.position.set(c.x, 0, c.z); r.mesh.rotation.y = c.h; scene.add(r.mesh) } remotes.set(p.id, r) } })

      // Tastatur
      const keyMap: Record<string, keyof Input> = { ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right', ArrowUp: 'gas', w: 'gas', W: 'gas', ArrowDown: 'brake', s: 'brake', S: 'brake', ' ': 'brake' }
      const kd = (e: KeyboardEvent) => { const k = keyMap[e.key]; if (k) { inp.current[k] = true; e.preventDefault() } else if (e.key === 'r' || e.key === 'R') resetReq.current = true; else if (e.key === 'c' || e.key === 'C') toggleRef.current(); else if (e.key === 'f' || e.key === 'F') assistToggleRef.current() }
      const ku = (e: KeyboardEvent) => { const k = keyMap[e.key]; if (k) { inp.current[k] = false; e.preventDefault() } }
      window.addEventListener('keydown', kd); window.addEventListener('keyup', ku)
      cleanups.push(() => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku) })

      // Netz
      let ready = false
      const send = (payload: Record<string, unknown>) => { if (ready) void ch?.send({ type: 'broadcast', event: 'r', payload }).catch(() => undefined) }
      if (online) void whenGameDbsReady().then(() => {
        if (dead) return
        client = gameClientFor(slotForKey(online.gameId))
        ch = client.channel(`rc-${online.gameId}`, { config: { broadcast: { self: false } } })
        ch.on('broadcast', { event: 'r' }, ({ payload }) => {
          const r = remotes.get(payload.u as string)
          if (!r) return
          r.tx = Number(payload.x) || 0; r.tz = Number(payload.z) || 0; r.th = Number(payload.h) || 0; r.v = Number(payload.v) || 0
          r.dmg = Number(payload.d) || 0; r.slip = Number(payload.sl) || 0
          r.total = Number(payload.t) || 0; r.ft = typeof payload.f === 'number' ? payload.f : null; r.seen = performance.now()
          if (typeof payload.k === 'string' && (payload.k !== r.kind || payload.c !== r.color)) {
            r.kind = payload.k; r.color = String(payload.c || '#94a3b8')
            if (r.mesh) { scene.remove(r.mesh); r.mesh = undefined }
          }
          if (!r.mesh) { r.mesh = rs.makeCar(r.kind, r.color, r.name, false); r.x = r.tx; r.z = r.tz; r.h = r.th; scene.add(r.mesh) }
        })
        ch.subscribe((s) => { if (s === 'SUBSCRIBED') ready = true })
      })

      // Ablauf
      const startAt = performance.now() + COUNT_MS
      let finishedMs: number | null = null
      let lastLap = 0, lapStart = 0, bestLap = Number(localStorage.getItem(lapKey(trackKey(def)))) || 0
      let raceBest = 0, usedAssist = false
      let camH = car.h
      let lastSend = 0, lastHud = 0
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

      const total = laps * track.length
      const rankNow = () => {
        const all: Array<{ t: number; ft: number | null; me?: boolean }> = [{ t: car.total, ft: finishedMs, me: true }]
        for (const b of botList) all.push({ t: b.car.total, ft: b.finished })
        for (const r of remotes.values()) all.push({ t: r.total, ft: r.ft })
        all.sort((a, b) => (a.ft !== null && b.ft !== null ? a.ft - b.ft : a.ft !== null ? -1 : b.ft !== null ? 1 : b.t - a.t))
        return all.findIndex((a) => a.me) + 1
      }

      const loop = () => {
        raf = requestAnimationFrame(loop)
        const now = performance.now()
        const dt = Math.min(0.05, (now - prev) / 1000)
        prev = now
        const go = now >= startAt
        const raceMs = Math.max(0, now - startAt)

        if (resetReq.current) {
          resetReq.current = false
          const p = pointAt(track, track.s[car.idx], 0)
          // Zurücksetzen = Werkstatt: Auto wird repariert, steht aber 3 Sekunden
          car = { ...car, x: p.x, z: p.z, h: Math.atan2(p.hx, p.hz), v: 0, steer: 0, slip: 0, dmg: 0, hold: go ? 3 : 0, hit: 0 }
        }
        const prevTotal = car.total
        const canDrive = go && finishedMs === null
        let input: Input = finishedMs === null ? inp.current : { gas: car.v < 25, brake: false, left: false, right: false }
        const assisting = assistRef.current && finishedMs === null && go
        if (assisting) {
          usedAssist = true
          const m = inp.current, ai = botSteer(car, myStats, line, 1, 0)
          input = { left: m.left || m.right ? m.left : ai.left, right: m.left || m.right ? m.right : ai.right, gas: m.gas || m.brake ? m.gas : ai.gas, brake: m.gas || m.brake ? m.brake : ai.brake }
        }
        car = stepCar(car, input, dt, track, myStats, go, !assisting)
        if (!canDrive && go) car = { ...car, v: Math.min(car.v, 30) }

        // Bots
        for (const b of botList) {
          const bi = go ? botInput(b, line, now / 1000) : { gas: false, brake: false, left: false, right: false }
          b.car = stepCar(b.car, bi, dt, track, b.st, go, false)
          if (b.finished === null && b.car.total >= total) b.finished = raceMs
        }
        // Zusammenstöße: gedrehte Hitboxen, Schaden aus der Aufprallgeschwindigkeit
        let bumped = false
        for (const b of botList) {
          const c1 = crash(car, myStats, { x: b.car.x, z: b.car.z, h: b.car.h, v: b.car.v }, b.st, 0.5)
          if (c1) { car = c1; bumped = true }
          const c2 = crash(b.car, b.st, { x: car.x, z: car.z, h: car.h, v: car.v, slip: car.slip }, myStats, 0.5, 85)
          if (c2) b.car = c2
        }
        for (let i = 0; i < botList.length; i++) for (let j = i + 1; j < botList.length; j++) {
          const A = botList[i], B = botList[j]
          const c1 = crash(A.car, A.st, { x: B.car.x, z: B.car.z, h: B.car.h, v: B.car.v }, B.st, 0.5, 85)
          if (c1) A.car = c1
          const c2 = crash(B.car, B.st, { x: A.car.x, z: A.car.z, h: A.car.h, v: A.car.v }, A.st, 0.5, 85)
          if (c2) B.car = c2
        }
        for (const r of remotes.values()) {
          if (now - r.seen > 3000) continue
          const c1 = crash(car, myStats, { x: r.x, z: r.z, h: r.h, v: r.v, slip: r.slip }, kindDims(r.kind), 0.5)
          if (c1) { car = c1; bumped = true }
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
          if (me.id && raceBest > 0 && !usedAssist) void raceSubmit(trackKey(def), me.id, Math.round(raceBest)).catch(() => undefined)
        }

        // Modelle
        const place = (m: import('three').Group, x: number, z: number, h: number, v: number, steer: number, dmg = 0, slip = 0) => {
          rs.damageCar(m, dmg, slip, v, now / 1000)
          m.position.set(x, 0, z); m.rotation.y = h; m.rotation.z = -steer * Math.min(1, Math.abs(v) / 40) * 0.05
          const wh = m.userData.wheels as import('three').Group[] | undefined
          if (wh) for (const w of wh) { w.children.forEach((c) => { c.rotation.x += (v * dt) / (m.userData.wheelR as number) }); if (w.name === 'front') w.rotation.y = steer * 0.45 }
        }
        place(myMesh, car.x, car.z, car.h, car.v, car.steer, car.dmg, car.slip)
        botList.forEach((b, i) => place(botMeshes[i], b.car.x, b.car.z, b.car.h, b.car.v, b.car.steer, b.car.dmg, b.car.slip))
        for (const r of remotes.values()) {
          if (!r.mesh) continue
          const k = Math.min(1, dt * 10)
          r.x += (r.tx + Math.sin(r.th) * r.v * 0.05 - r.x) * k; r.z += (r.tz + Math.cos(r.th) * r.v * 0.05 - r.z) * k
          let dh = r.th - r.h; while (dh > Math.PI) dh -= Math.PI * 2; while (dh < -Math.PI) dh += Math.PI * 2
          r.h += dh * k
          r.mesh.visible = now - r.seen < 5000
          place(r.mesh, r.x, r.z, r.h, r.v, 0, r.dmg, r.slip)
        }

        // Kamera: Verfolger von hinten oder Cockpit (Blick aus dem Fenster)
        const sp = Math.max(0, car.v)
        if (camRef.current === 1) {
          myMesh.visible = false
          camH = car.h
          const bx = Math.sin(car.h), bz = Math.cos(car.h)
          camera.position.set(car.x + bx * 0.25 - bz * 0.35, 1.18, car.z + bz * 0.25 + bx * 0.35)
          const look = car.h + car.steer * 0.05
          camera.lookAt(car.x + Math.sin(look) * 40, 1.0, car.z + Math.cos(look) * 40)
          camera.rotateZ(-car.steer * 0.03 * Math.min(1, sp / 40))
          camera.fov += ((74 + Math.min(16, sp * 0.2)) - camera.fov) * Math.min(1, dt * 3)
          if (wheelEl.current) wheelEl.current.style.transform = `rotate(${(-car.steer * 95).toFixed(1)}deg)`
        } else {
          myMesh.visible = true
          let dh = car.h - camH; while (dh > Math.PI) dh -= Math.PI * 2; while (dh < -Math.PI) dh += Math.PI * 2
          camH += dh * Math.min(1, dt * 4.5)
          const back = 9.5 + sp * 0.06, up = 4.3 + sp * 0.018
          camera.position.set(car.x - Math.sin(camH) * back, up, car.z - Math.cos(camH) * back)
          camera.lookAt(car.x + Math.sin(camH) * 22, 1.4, car.z + Math.cos(camH) * 22)
          camera.fov += ((62 + Math.min(18, sp * 0.22)) - camera.fov) * Math.min(1, dt * 3)
        }
        camera.updateProjectionMatrix()
        if (car.bump > 0.2 || bumped) camera.position.y += (Math.random() - 0.5) * (0.25 + car.hit * 0.9)
        rs.follow.position.set(camera.position.x, 0, camera.position.z)
        rs.sun.position.set(car.x + 120, 220, car.z + 80); rs.sun.target.position.set(car.x, 0, car.z); rs.sun.target.updateMatrixWorld()
        renderer.render(scene, camera)

        if (online && now - lastSend > 55) {
          lastSend = now
          send({ u: online.userId, x: car.x, z: car.z, h: car.h, v: car.v, t: car.total, k: me.kind, c: me.color, f: finishedMs, d: Math.round(car.dmg), sl: Math.round(car.slip * 100) / 100 })
        }
        if (now - lastHud > 110) {
          lastHud = now
          const pr = project(track, car.x, car.z, car.idx)
          const dot = Math.sin(car.h) * track.tx[pr.i] + Math.cos(car.h) * track.tz[pr.i]
          const ca = curveAhead(track, pr.i, 110)
          const count = go ? 0 : Math.ceil((startAt - now) / 1000)
          setHud({ speed: Math.round(Math.abs(car.v) * 3.6), lap: Math.min(laps, Math.max(1, lapNow + 1)), pos: rankNow(), of: 1 + botList.length + remotes.size, ms: finishedMs ?? raceMs, count, wrong: dot < -0.3 && car.v > 4, curve: Math.abs(ca.k) > 0.004 ? Math.sign(ca.k) : 0, curveDist: Math.round(ca.dist / 10) * 10, offroad: car.offroad, best: bestLap, dmg: Math.round(car.dmg), drift: Math.abs(car.slip) > 0.2 && car.v > 10 })
          drawMini()
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

  const hold = (k: keyof Input) => ({
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
      {cockpit && (
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
        <p className="text-3xl font-black leading-none">{hud.pos}<span className="text-lg font-bold">/{hud.of}</span></p>
        <p className="text-sm font-semibold">Runde {hud.lap}/{laps}</p>
        <p className="font-mono text-sm">{fmt(hud.ms)}</p>
        {hud.best > 0 && <p className="text-xs text-amber-200">Beste Runde {fmt(hud.best)}</p>}
      </div>
      <canvas ref={mini} width={220} height={160} className="pointer-events-none absolute right-2 top-2 h-[84px] w-[116px] rounded-xl bg-black/35 sm:h-[120px] sm:w-[165px]" aria-label="Streckenkarte" />
      <div className="pointer-events-none absolute right-3 top-[100px] text-right text-white [text-shadow:0_1px_3px_#000] sm:top-[135px]">
        <p className="text-3xl font-black leading-none">{hud.speed}</p><p className="text-xs">km/h</p>
        <div className="ml-auto mt-1 h-2 w-20 overflow-hidden rounded bg-black/50" role="img" aria-label={`Schaden ${hud.dmg} Prozent`}><div className={`h-full ${hud.dmg > 70 ? 'bg-rose-500' : hud.dmg > 35 ? 'bg-amber-400' : 'bg-emerald-400'}`} style={{ width: `${hud.dmg}%` }} /></div>
        <p className="text-[10px]">Schaden {hud.dmg}%</p>
        {hud.drift && <p className="text-xs font-bold text-amber-200">DRIFT!</p>}
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
        <button type="button" onClick={toggleCam} className="rounded-lg bg-black/45 px-3 py-1.5 text-xs text-white">{cockpit ? 'Außenansicht' : 'Cockpit'} (C)</button>
        <button type="button" onClick={() => { resetReq.current = true }} className="rounded-lg bg-black/45 px-3 py-1.5 text-xs text-white">Zurücksetzen / Reparieren (R)</button>
        {assistOk && <button type="button" onClick={toggleAssist} aria-pressed={assist} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${assist ? 'bg-emerald-500 text-slate-950' : 'bg-black/45 text-white'}`}>Fahrassistent {assist ? 'AN' : 'aus'} (F)</button>}
      </div>
      {/* Bedienung: links Lenken, rechts Gas und Bremse */}
      <div className="absolute bottom-3 left-3 flex gap-3">
        <button type="button" aria-label="Nach links" {...hold('left')} className={`${btn} h-24 w-24 text-4xl`}>◀</button>
        <button type="button" aria-label="Nach rechts" {...hold('right')} className={`${btn} h-24 w-24 text-4xl`}>▶</button>
      </div>
      <div className="absolute bottom-3 right-3 flex items-end gap-3">
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
            {done.standings.length > 1 && <ul className="space-y-0.5 text-left text-sm">{[...done.standings].sort((a, b) => (a.ms ?? 1e12) - (b.ms ?? 1e12)).map((s, i) => <li key={s.name + i} className={s.me ? 'font-bold text-accent-cyan' : ''}>{i + 1}. {s.name} {s.ms !== null ? `· ${fmt(s.ms)}` : '· fährt noch'}</li>)}</ul>}
            <div className="flex justify-center gap-2">
              {onAgain && <button type="button" onClick={onAgain} className="min-h-[44px] rounded-lg bg-accent-cyan px-4 font-semibold text-slate-950">Nochmal</button>}
              {onExit && <button type="button" onClick={onExit} className="min-h-[44px] rounded-lg bg-white/10 px-4">Zurück</button>}
            </div>
          </div>
        </div>
      )}
      <p className="pointer-events-none sr-only">Steuerung: Pfeiltasten oder WASD, R setzt das Auto zurück, C wechselt die Kamera, Bremse + Lenken driftet.{assistOk ? ' F schaltet den Fahrassistenten ein.' : ''}</p>
    </div>
  )
}
