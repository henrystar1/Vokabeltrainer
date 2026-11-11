import { useEffect, useRef, useState } from 'react'
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import { gameClientFor, getGameSlot, whenGameDbsReady } from '../../../lib/gameRealtime'
import type { OgView } from '../../../services/online'
import { SEAT_COLORS } from '../ludoBoard'
import { BODY_H, EYE, RESPAWN_S, SHOT_COOLDOWN, SHOT_DAMAGE, SPAWNS, SPEED, collide, lookDir, makeBoxes, shoot, timeLeft } from './engine'

interface Props {
  view: OgView
  /** Punktestand melden (final = Spielende). */
  onReport: (scores: Record<string, number>, final: boolean) => void
}

interface Remote { id: string; name: string; seat: number; x: number; z: number; yaw: number; hp: number; alive: boolean; hidden: boolean; tx: number; tz: number; mesh?: import('three').Object3D }

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

/** Falsche „Lern-Seite“, die sofort alles überdeckt (Panic-Button). */
function FakePage({ onBack }: { onBack: () => void }) {
  const words = [['the apple', 'der Apfel'], ['to remember', 'sich erinnern'], ['the neighbour', 'der Nachbar'], ['to borrow', 'ausleihen'], ['the weather', 'das Wetter'], ['although', 'obwohl']]
  return (
    <div className="fixed inset-0 z-[10000] overflow-auto bg-white p-6 text-slate-900" role="document">
      <div className="mx-auto max-w-xl">
        <h1 className="text-2xl font-bold">Vokabeln – Unit 4 üben</h1>
        <p className="mt-1 text-sm text-slate-500">Übersetze die Wörter. Runde 2 von 3</p>
        <ul className="mt-5 space-y-3">
          {words.map(([en, de]) => (
            <li key={en} className="flex items-center gap-3 border-b border-slate-200 pb-2">
              <span className="w-1/2 font-medium">{en}</span>
              <input aria-label={`Übersetzung von ${en}`} defaultValue="" placeholder={de.slice(0, 1) + '…'} className="w-1/2 rounded border border-slate-300 px-2 py-1" />
            </li>
          ))}
        </ul>
        <p className="mt-6 text-xs text-slate-400">
          <button type="button" onClick={onBack} className="cursor-default select-none text-slate-300 hover:text-slate-400">zurück</button>
        </p>
      </div>
    </div>
  )
}

/** 3D-Online-Shooter: Ego-Perspektive, Hitscan, 2–4 Personen. Bewegung/Schüsse laufen als Broadcast über die Spiel-Datenbanken. */
export default function ShooterGame({ view, onReport }: Props) {
  const mount = useRef<HTMLDivElement>(null)
  const panicRef = useRef(false)
  const joy = useRef({ x: 0, y: 0 })
  const look = useRef({ dx: 0, dy: 0 })
  const fireHeld = useRef(false)
  const [panic, setPanic] = useState(false)
  const [hud, setHud] = useState({ hp: 100, alive: true, left: 0, scores: {} as Record<string, number>, locked: false, respawn: 0 })
  const report = useRef(onReport)
  report.current = onReport
  const touch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches

  const me = view.me
  const mySeat = me.seat ?? 0
  const players = view.players.filter((p) => p.seat !== null && p.join_state === 'joined')

  function togglePanic(on: boolean) {
    panicRef.current = on
    setPanic(on)
    if (on) document.exitPointerLock?.()
    document.title = on ? 'Vokabeltrainer' : document.title
  }

  useEffect(() => {
    if (touch || !mount.current) return
    const host = mount.current
    let dead = false
    let raf = 0
    let ch: RealtimeChannel | null = null
    let client: SupabaseClient | null = null
    const cleanups: Array<() => void> = []

    void (async () => {
      const THREE = await import('three')
      if (dead) return
      const boxes = makeBoxes(view.id)
      const t0 = Number(view.state && (view.state as unknown as { t0?: number }).t0) || Date.now()
      const minutes = Number((view.state as unknown as { minutes?: number }).minutes) || 5
      const toWin = Number((view.state as unknown as { to_win?: number }).to_win) || 10

      const scene = new THREE.Scene()
      scene.background = new THREE.Color(0x0b1226)
      scene.fog = new THREE.Fog(0x0b1226, 15, 70)
      const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 120)
      camera.rotation.order = 'YXZ'
      const renderer = new THREE.WebGLRenderer({ antialias: true })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      host.appendChild(renderer.domElement)
      renderer.domElement.style.width = '100%'
      renderer.domElement.style.height = '100%'
      renderer.domElement.style.display = 'block'
      const resize = () => { const w = host.clientWidth || 800; const h = host.clientHeight || 500; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix() }
      resize()
      const ro = new ResizeObserver(resize)
      ro.observe(host)

      scene.add(new THREE.HemisphereLight(0xbcd2ff, 0x1a2036, 1.1))
      const sun = new THREE.DirectionalLight(0xffffff, 1.2)
      sun.position.set(10, 30, 8)
      scene.add(sun)
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0x1b2338, roughness: 0.95 }))
      floor.rotation.x = -Math.PI / 2
      scene.add(floor)
      const grid = new THREE.GridHelper(60, 30, 0x3b4a78, 0x25304f)
      grid.position.y = 0.01
      scene.add(grid)
      const wallMat = new THREE.MeshStandardMaterial({ color: 0x334166, transparent: true, opacity: 0.55 })
      for (const [x, z, w, d] of [[0, -30, 60, 0.6], [0, 30, 60, 0.6], [-30, 0, 0.6, 60], [30, 0, 0.6, 60]] as const) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, 4, d), wallMat)
        m.position.set(x, 2, z)
        scene.add(m)
      }
      const palette = [0x4f6cb3, 0x6b4fb3, 0x2f8f83, 0xb36b4f]
      boxes.forEach((b, i) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), new THREE.MeshStandardMaterial({ color: palette[i % palette.length], roughness: 0.7 }))
        m.position.set(b.x, b.h / 2, b.z)
        scene.add(m)
      })

      const label = (text: string, color: string) => {
        const c = document.createElement('canvas'); c.width = 256; c.height = 64
        const g = c.getContext('2d')!
        g.font = 'bold 34px sans-serif'; g.textAlign = 'center'; g.fillStyle = '#000a'; g.fillText(text, 129, 46); g.fillStyle = color; g.fillText(text, 128, 44)
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }))
        s.scale.set(2.4, 0.6, 1); s.position.y = BODY_H + 0.55
        return s
      }
      const remotes = new Map<string, Remote>()
      for (const p of players) {
        if (p.user_id === me.user_id) continue
        const seat = p.seat ?? 0
        const grp = new THREE.Group()
        const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.95, 4, 10), new THREE.MeshStandardMaterial({ color: SEAT_COLORS[seat] }))
        body.position.y = 0.9
        grp.add(body, label(p.name, SEAT_COLORS[seat]))
        const sp = SPAWNS[seat % 4]
        grp.position.set(sp[0], 0, sp[1])
        scene.add(grp)
        remotes.set(p.user_id, { id: p.user_id, name: p.name, seat, x: sp[0], z: sp[1], yaw: 0, hp: 100, alive: true, hidden: false, tx: sp[0], tz: sp[1], mesh: grp })
      }
      const seatOf = new Map(players.map((p) => [p.user_id, p.seat ?? 0]))
      const scores: Record<string, number> = {}
      for (const p of players) scores[String(p.seat)] = Number((view.state as unknown as { scores?: Record<string, number> }).scores?.[String(p.seat)] ?? 0)

      // eigener Zustand
      const sp0 = SPAWNS[mySeat % 4]
      const st = { x: sp0[0], z: sp0[1], yaw: Math.atan2(sp0[0], sp0[1]), pitch: 0, hp: 100, alive: true, respawnAt: 0, invuln: Date.now() + 2000, cool: 0, ended: false }
      const keys = new Set<string>()
      const tracers: Array<{ line: import('three').Line; until: number }> = []

      // Netz
      void whenGameDbsReady().then(() => {
        if (dead) return
        client = gameClientFor(getGameSlot())
        ch = client.channel(`sh-${view.id}`, { config: { broadcast: { self: false } } })
        ch.on('broadcast', { event: 'p' }, ({ payload }) => {
          const r = remotes.get(payload.u as string)
          if (!r) return
          r.tx = payload.x; r.tz = payload.z; r.yaw = payload.yaw; r.hp = payload.hp; r.alive = payload.alive; r.hidden = !!payload.hidden
        })
        ch.on('broadcast', { event: 'h' }, ({ payload }) => {
          if (payload.to !== me.user_id || !st.alive || panicRef.current || Date.now() < st.invuln) return
          st.hp -= Number(payload.dmg) || SHOT_DAMAGE
          if (st.hp <= 0) {
            st.hp = 0; st.alive = false; st.respawnAt = Date.now() + RESPAWN_S * 1000
            const killerSeat = seatOf.get(payload.from as string)
            if (killerSeat !== undefined) scores[String(killerSeat)] = (scores[String(killerSeat)] ?? 0) + 1
            void ch?.send({ type: 'broadcast', event: 'k', payload: { killer: payload.from, victim: me.user_id } })
          }
        })
        ch.on('broadcast', { event: 'k' }, ({ payload }) => {
          const s = seatOf.get(payload.killer as string)
          if (s !== undefined) scores[String(s)] = (scores[String(s)] ?? 0) + 1
        })
        ch.on('broadcast', { event: 's' }, ({ payload }) => addTracer(payload.o, payload.e, 0xfff1a8))
        ch.subscribe()
      })
      const send = (event: string, payload: Record<string, unknown>) => { void ch?.send({ type: 'broadcast', event, payload }).catch(() => undefined) }

      function addTracer(o: number[], e: number[], color: number) {
        const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(o[0], o[1] - 0.15, o[2]), new THREE.Vector3(e[0], e[1], e[2])])
        const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color }))
        scene.add(line)
        tracers.push({ line, until: performance.now() + 90 })
      }

      function fire() {
        const now = performance.now() / 1000
        if (!st.alive || panicRef.current || now < st.cool || st.ended) return
        st.cool = now + SHOT_COOLDOWN
        const o = { x: st.x, y: EYE, z: st.z }
        const d = lookDir(st.yaw, st.pitch)
        const targets = [...remotes.values()].filter((r) => r.alive && !r.hidden).map((r) => ({ id: r.id, x: r.x, z: r.z }))
        const hit = shoot(o, d, boxes, targets)
        const t = hit ? hit.t : 60
        const end = [o.x + d.x * t, o.y + d.y * t, o.z + d.z * t]
        addTracer([o.x, o.y, o.z], end, 0xffffff)
        send('s', { o: [o.x, o.y, o.z], e: end })
        if (hit) send('h', { to: hit.id, from: me.user_id, dmg: SHOT_DAMAGE })
      }

      const el = renderer.domElement
      const onDown = (e: MouseEvent) => {
        if (panicRef.current || touch) return
        if (document.pointerLockElement !== el) { void el.requestPointerLock?.(); return }
        if (e.button === 0) fire()
      }
      const onMove = (e: MouseEvent) => {
        if (document.pointerLockElement !== el || panicRef.current) return
        st.yaw -= e.movementX * 0.0025
        st.pitch = Math.max(-1.4, Math.min(1.4, st.pitch - e.movementY * 0.0025))
      }
      const onKey = (e: KeyboardEvent) => {
        if (e.code === 'KeyP' || e.code === 'Backquote') { e.preventDefault(); if (e.type === 'keydown' && !e.repeat) togglePanic(!panicRef.current); return }
        if (e.type === 'keydown') keys.add(e.code); else keys.delete(e.code)
      }
      const onLock = () => { /* HUD liest den Lock-Zustand im Tick */ }
      el.addEventListener('mousedown', onDown)
      document.addEventListener('mousemove', onMove)
      window.addEventListener('keydown', onKey)
      window.addEventListener('keyup', onKey)
      document.addEventListener('pointerlockchange', onLock)
      cleanups.push(() => {
        el.removeEventListener('mousedown', onDown); document.removeEventListener('mousemove', onMove)
        window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey)
        document.removeEventListener('pointerlockchange', onLock)
      })

      let last = performance.now()
      let sendAcc = 0
      let hudAcc = 0
      let reportAcc = 0
      const frame = (nowMs: number) => {
        raf = requestAnimationFrame(frame)
        const dt = Math.min((nowMs - last) / 1000, 0.1)
        last = nowMs
        const now = Date.now()
        const paused = panicRef.current
        if (!paused) {
          if (look.current.dx || look.current.dy) {
            st.yaw -= look.current.dx * 0.006
            st.pitch = Math.max(-1.4, Math.min(1.4, st.pitch - look.current.dy * 0.006))
            look.current.dx = 0; look.current.dy = 0
          }
          if (fireHeld.current) fire()
          if (!st.alive && now >= st.respawnAt) {
            const s = SPAWNS[(mySeat + Math.floor(Math.random() * 3)) % 4]
            st.x = s[0]; st.z = s[1]; st.hp = 100; st.alive = true; st.invuln = now + 2000
          }
          if (st.alive) {
            let fx = 0; let fz = 0
            if (keys.has('KeyW') || keys.has('ArrowUp')) fz -= 1
            if (keys.has('KeyS') || keys.has('ArrowDown')) fz += 1
            if (keys.has('KeyA') || keys.has('ArrowLeft')) fx -= 1
            if (keys.has('KeyD') || keys.has('ArrowRight')) fx += 1
            fx += joy.current.x; fz += joy.current.y
            const len = Math.max(1, Math.hypot(fx, fz))
            const sp = SPEED * (keys.has('ShiftLeft') ? 1.4 : 1) * dt
            const dx = (fx * Math.cos(st.yaw) + fz * Math.sin(st.yaw)) / len * sp
            const dz = (-fx * Math.sin(st.yaw) + fz * Math.cos(st.yaw)) / len * sp
            ;[st.x, st.z] = collide(st.x + dx, st.z + dz, 0.5, boxes)
          }
        }
        camera.position.set(st.x, st.alive ? EYE : 0.5, st.z)
        camera.rotation.set(st.alive ? st.pitch : -0.9, st.yaw, 0)
        for (const r of remotes.values()) {
          r.x += (r.tx - r.x) * Math.min(1, dt * 14); r.z += (r.tz - r.z) * Math.min(1, dt * 14)
          if (r.mesh) { r.mesh.position.set(r.x, 0, r.z); r.mesh.rotation.y = r.yaw; r.mesh.visible = r.alive && !r.hidden }
        }
        for (let i = tracers.length - 1; i >= 0; i--) if (performance.now() > tracers[i].until) { scene.remove(tracers[i].line); tracers[i].line.geometry.dispose(); tracers.splice(i, 1) }
        if (!paused) renderer.render(scene, camera)

        sendAcc += dt
        if (sendAcc > 0.08) { sendAcc = 0; send('p', { u: me.user_id, x: st.x, z: st.z, yaw: st.yaw, hp: st.hp, alive: st.alive, hidden: paused }) }
        hudAcc += dt
        if (hudAcc > 0.2) {
          hudAcc = 0
          const left = timeLeft(t0, minutes, now)
          setHud({ hp: st.hp, alive: st.alive, left, scores: { ...scores }, locked: touch || document.pointerLockElement === el, respawn: st.alive ? 0 : Math.max(0, Math.ceil((st.respawnAt - now) / 1000)) })
          const top = Math.max(0, ...Object.values(scores))
          if (!st.ended && (top >= toWin || left === 0)) {
            st.ended = true
            const isHost = view.host_id === me.user_id
            window.setTimeout(() => report.current(scores, true), isHost ? 0 : 3500)
          }
        }
        reportAcc += dt
        if (reportAcc > 15 && view.host_id === me.user_id && !st.ended) { reportAcc = 0; report.current(scores, false) }
      }
      raf = requestAnimationFrame(frame)
      cleanups.push(() => {
        cancelAnimationFrame(raf); ro.disconnect()
        renderer.dispose(); host.removeChild(renderer.domElement)
        if (document.pointerLockElement === el) document.exitPointerLock()
      })
    })()

    return () => {
      dead = true
      for (const c of cleanups) c()
      if (ch && client) void client.removeChannel(ch)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.id, touch])

  return (
    <div className="relative">
      <div ref={mount} className="relative h-[70vh] min-h-[360px] w-full overflow-hidden rounded-2xl border border-white/10 bg-black" />
      {!panic && (
        <>
          <div className="pointer-events-none absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2" aria-hidden>
            <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white/80" /><span className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-white/80" />
          </div>
          <div className="pointer-events-none absolute left-3 top-3 space-y-1 rounded-lg bg-black/50 p-2 text-xs text-white">
            <p className="font-mono text-sm">{mmss(hud.left)}</p>
            {players.map((p) => (
              <p key={p.user_id} className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full" style={{ background: SEAT_COLORS[p.seat ?? 0] }} />{p.name}{p.user_id === me.user_id ? ' (du)' : ''}: <b>{hud.scores[String(p.seat)] ?? 0}</b></p>
            ))}
          </div>
          <div className="pointer-events-none absolute bottom-3 left-3 w-40">
            <div className="h-3 overflow-hidden rounded bg-black/60"><div className="h-full bg-emerald-400 transition-[width]" style={{ width: `${hud.hp}%`, background: hud.hp > 50 ? '#34d399' : hud.hp > 25 ? '#fbbf24' : '#ef4444' }} /></div>
            <p className="mt-0.5 text-xs text-white">{hud.alive ? `${hud.hp} Leben` : `Du bist raus – zurück in ${hud.respawn} s`}</p>
          </div>
          {!hud.locked && <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 text-center text-white"><p className="max-w-xs text-sm">Klicke ins Bild, um zu spielen.<br />WASD bewegen · Maus zielen · Klick schießen · Shift rennen · <b>P</b> = Panik</p></div>}
          {touch && hud.alive && <TouchControls joy={joy} look={look} fireHeld={fireHeld} />}
          <button type="button" onClick={() => togglePanic(true)} className="absolute right-3 top-3 min-h-[40px] rounded-lg bg-rose-600 px-3 text-sm font-bold text-white shadow hover:bg-rose-500" aria-label="Panik-Knopf: Spiel sofort verstecken">PANIK (P)</button>
        </>
      )}
      {panic && <FakePage onBack={() => togglePanic(false)} />}
    </div>
  )
}

type XY = { current: { x: number; y: number } }

/** Touch-Steuerung (iPad/Tablet): links Joystick, rechts wischen zum Zielen, großer Feuer-Knopf. */
function TouchControls({ joy, look, fireHeld }: { joy: XY; look: { current: { dx: number; dy: number } }; fireHeld: { current: boolean } }) {
  const [knob, setKnob] = useState<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const joyId = useRef<number | null>(null)
  const lookId = useRef<{ id: number; x: number; y: number } | null>(null)
  const R = 55
  return (
    <>
      <div
        className="absolute bottom-0 left-0 top-1/3 w-1/2 touch-none select-none"
        onPointerDown={(e) => { if (joyId.current !== null) return; joyId.current = e.pointerId; e.currentTarget.setPointerCapture(e.pointerId); setKnob({ x: 0, y: 0, ox: e.clientX, oy: e.clientY }) }}
        onPointerMove={(e) => {
          if (e.pointerId !== joyId.current) return
          setKnob((k) => {
            if (!k) return k
            let dx = e.clientX - k.ox; let dy = e.clientY - k.oy
            const m = Math.hypot(dx, dy)
            if (m > R) { dx = (dx / m) * R; dy = (dy / m) * R }
            joy.current.x = dx / R; joy.current.y = dy / R
            return { ...k, x: dx, y: dy }
          })
        }}
        onPointerUp={(e) => { if (e.pointerId !== joyId.current) return; joyId.current = null; joy.current.x = 0; joy.current.y = 0; setKnob(null) }}
        onPointerCancel={() => { joyId.current = null; joy.current.x = 0; joy.current.y = 0; setKnob(null) }}
        aria-label="Joystick zum Laufen"
      >
        {knob && (
          <div className="pointer-events-none fixed h-[110px] w-[110px] rounded-full border-2 border-white/40 bg-white/10" style={{ left: knob.ox - R, top: knob.oy - R }}>
            <div className="absolute h-12 w-12 rounded-full bg-white/60" style={{ left: R - 24 + knob.x, top: R - 24 + knob.y }} />
          </div>
        )}
        {!knob && <p className="pointer-events-none absolute bottom-16 left-4 text-xs text-white/60">Laufen: Finger links ziehen</p>}
      </div>
      <div
        className="absolute right-0 top-14 h-[55%] w-1/2 touch-none select-none"
        onPointerDown={(e) => { if (lookId.current) return; lookId.current = { id: e.pointerId, x: e.clientX, y: e.clientY }; e.currentTarget.setPointerCapture(e.pointerId) }}
        onPointerMove={(e) => {
          const l = lookId.current
          if (!l || e.pointerId !== l.id) return
          look.current.dx += e.clientX - l.x; look.current.dy += e.clientY - l.y
          l.x = e.clientX; l.y = e.clientY
        }}
        onPointerUp={(e) => { if (lookId.current?.id === e.pointerId) lookId.current = null }}
        onPointerCancel={() => { lookId.current = null }}
        aria-label="Zielen: Finger bewegen"
      >
        <p className="pointer-events-none absolute right-4 top-2 text-xs text-white/60">Zielen: Finger rechts bewegen</p>
      </div>
      <button
        type="button"
        className="absolute bottom-6 right-6 h-24 w-24 touch-none select-none rounded-full border-4 border-white/60 bg-rose-600/80 text-lg font-extrabold text-white active:bg-rose-500"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); fireHeld.current = true }}
        onPointerUp={() => { fireHeld.current = false }}
        onPointerCancel={() => { fireHeld.current = false }}
        onContextMenu={(e) => e.preventDefault()}
        aria-label="Schießen"
      >
        FEUER
      </button>
    </>
  )
}
