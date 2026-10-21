import { useEffect, useRef, useState } from 'react'
import { ArrowUp } from 'lucide-react'
import { Joystick } from '../games/joystick'
import { useFocusMode } from '../koins/focusMode'
import { supabase } from '../../lib/supabaseClient'
import { teamParkourFinish, type TeamState } from '../../services/play'
import { LEVELS, ROWS, TILE, VIEW_H, VIEW_W } from './levels'
import { PH, PW, checkpointAt, inExit, newBody, pressedMap, spawnAt, stepBody, type Body, type Pressed } from './engine'

const COLORS = ['#22d3ee', '#e879f9']
const SEND_MS = 50
const STALE_MS = 2500

interface Remote { x: number; y: number; face: 1 | -1; lv: number; cp: number | null; dead: boolean; ex: boolean; dc: number; seen: number }

const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

/** Joystick-Parkour für zwei: beide laufen durch dieselben Level, Positionen laufen über Supabase Realtime. */
export default function ParkourGame({ st, startLevel = 0 }: { st: TeamState; startLevel?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useFocusMode(true)
  const input = useRef({ stick: 0, left: false, right: false, jump: false })
  const [hud, setHud] = useState({ level: 0, deaths: 0, ms: 0, linked: false, done: false })
  const hostIdx = st.is_host ? 0 : 1
  const names = [st.people.find((p) => p.is_host)?.name ?? 'Host', st.people.find((p) => !p.is_host)?.name ?? 'Partner']

  useEffect(() => {
    const cv = canvas.current
    const ctx = cv?.getContext('2d')
    if (!cv || !ctx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    cv.width = VIEW_W * dpr
    cv.height = VIEW_H * dpr
    ctx.scale(dpr, dpr)

    let lv = startLevel
    let cp: number | null = null
    let deaths = 0
    let deadT = 0
    let exitHold = 0
    let finished = false
    let cam = 0
    let t = 0
    let titleT = 3
    const startPerf = performance.now()
    const me: Body = (() => { const s = spawnAt(LEVELS[startLevel], st.is_host, null); return newBody(s.x, s.y) })()
    let remote: Remote | null = null
    const draw: { x: number; y: number } = { x: 0, y: 0 }
    let ready = false
    let lastSend = 0
    let lastHud = 0

    const ch = supabase.channel(`parkour-${st.id}`, { config: { broadcast: { self: false } } })
    ch.on('broadcast', { event: 's' }, ({ payload }) => {
      const p = payload as Partial<Remote> & { u?: string }
      if (p.u === st.me || typeof p.x !== 'number' || typeof p.y !== 'number') return
      const first = remote === null
      remote = { x: p.x, y: p.y, face: p.face === -1 ? -1 : 1, lv: p.lv ?? 0, cp: p.cp ?? null, dead: !!p.dead, ex: !!p.ex, dc: p.dc ?? 0, seen: performance.now() }
      if (first) { draw.x = remote.x; draw.y = remote.y }
      if (remote.lv > lv && remote.lv < LEVELS.length) goLevel(remote.lv)
      if (remote.lv === lv && remote.cp !== null && (cp === null || remote.cp > cp)) cp = remote.cp
    }).subscribe((s) => { ready = s === 'SUBSCRIBED' })

    function goLevel(n: number) {
      lv = n
      cp = null
      exitHold = 0
      titleT = 3
      const s = spawnAt(LEVELS[lv], st.is_host, null)
      Object.assign(me, newBody(s.x, s.y))
      remote = remote ? { ...remote, ex: false } : null
      cam = 0
    }

    function respawn() {
      const s = spawnAt(LEVELS[lv], st.is_host, cp)
      Object.assign(me, newBody(s.x, s.y))
    }

    function send(now: number) {
      if (!ready || now - lastSend < SEND_MS) return
      lastSend = now
      void ch.send({ type: 'broadcast', event: 's', payload: { u: st.me, x: me.x, y: me.y, face: me.face, lv, cp, dead: deadT > 0, ex: inExit(LEVELS[lv], me), dc: deaths } })
    }

    function step(dt: number, now: number) {
      const level = LEVELS[lv]
      const fresh = remote !== null && now - remote.seen < STALE_MS
      const other = fresh && remote && !remote.dead ? { x: remote.x, y: remote.y } : null
      const pressed: Pressed = pressedMap(level, [deadT > 0 ? null : me, other])
      if (deadT > 0) {
        deadT -= dt
        if (deadT <= 0) respawn()
        return
      }
      const i = input.current
      const move = i.stick !== 0 ? i.stick : (i.right ? 1 : 0) - (i.left ? 1 : 0)
      const r = stepBody(me, { move, jump: i.jump }, level, pressed, other, dt)
      if (r === 'dead') { deaths += 1; deadT = 0.7; return }
      const c = checkpointAt(level, me)
      if (c !== null && (cp === null || c > cp)) cp = c
      // Ausgang: beide gleichzeitig drin
      if (inExit(level, me) && fresh && remote && remote.lv === lv && remote.ex) {
        exitHold += dt
        if (exitHold > 0.7 && !finished) {
          if (lv + 1 < LEVELS.length) goLevel(lv + 1)
          else {
            finished = true
            void teamParkourFinish(st.id, Math.round(now - startPerf), deaths + (remote?.dc ?? 0)).catch(() => undefined)
          }
        }
      } else exitHold = 0
    }

    function render(now: number) {
      const level = LEVELS[lv]
      const fresh = remote !== null && now - remote.seen < STALE_MS
      const other = fresh && remote && !remote.dead ? { x: remote.x, y: remote.y } : null
      const pressed = pressedMap(level, [deadT > 0 ? null : me, other])
      // Kamera
      const mid = fresh && remote ? (me.x + remote.x) / 2 : me.x
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
      const drawP = (x: number, y: number, face: 1 | -1, color: string, name: string, dead: boolean, self: boolean) => {
        ctx!.save()
        ctx!.globalAlpha = dead ? 0.25 : 1
        ctx!.fillStyle = color
        ctx!.shadowColor = color; ctx!.shadowBlur = self ? 12 : 8
        ctx!.beginPath(); ctx!.roundRect(x, y, PW, PH, 7); ctx!.fill()
        ctx!.shadowBlur = 0
        ctx!.fillStyle = '#fff'
        ctx!.fillRect(x + (face > 0 ? 11 : 3), y + 7, 7, 7)
        ctx!.fillStyle = '#0f172a'
        ctx!.fillRect(x + (face > 0 ? 15 : 4), y + 9, 3, 4)
        ctx!.font = '600 11px system-ui, sans-serif'; ctx!.textAlign = 'center'
        ctx!.fillStyle = 'rgba(255,255,255,0.9)'
        ctx!.fillText(self ? 'Du' : name.slice(0, 10), x + PW / 2, y - 6)
        ctx!.restore()
      }
      if (fresh && remote) drawP(draw.x, draw.y, remote.face, COLORS[1 - hostIdx], names[1 - hostIdx], remote.dead, false)
      drawP(me.x, me.y, me.face, COLORS[hostIdx], names[hostIdx], deadT > 0, true)
      ctx!.restore()
      // Anzeige
      ctx!.fillStyle = 'rgba(2,6,23,0.55)'
      ctx!.fillRect(0, 0, VIEW_W, 26)
      ctx!.font = '600 12px system-ui, sans-serif'; ctx!.textAlign = 'left'; ctx!.fillStyle = '#e2e8f0'
      const secs = Math.floor((now - startPerf) / 1000)
      ctx!.fillText(`Level ${level.name}`, 10, 17)
      ctx!.textAlign = 'right'
      ctx!.fillText(`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}  ·  Stürze ${deaths + (remote?.dc ?? 0)}`, VIEW_W - 10, 17)
      ctx!.textAlign = 'center'
      if (!fresh) {
        ctx!.fillStyle = 'rgba(2,6,23,0.7)'; ctx!.fillRect(VIEW_W / 2 - 150, 40, 300, 28)
        ctx!.fillStyle = '#fbbf24'; ctx!.fillText('Warte auf die Verbindung zu deinem Partner …', VIEW_W / 2, 58)
      } else if (exitHold > 0 || (inExit(level, me) && !(remote?.ex))) {
        ctx!.fillStyle = 'rgba(2,6,23,0.7)'; ctx!.fillRect(VIEW_W / 2 - 150, 40, 300, 28)
        ctx!.fillStyle = '#fde047'; ctx!.fillText(exitHold > 0 ? 'Geschafft!' : 'Warte, bis dein Partner auch im Ausgang ist', VIEW_W / 2, 58)
      }
      if (titleT > 0) {
        ctx!.globalAlpha = Math.min(1, titleT)
        ctx!.fillStyle = 'rgba(2,6,23,0.7)'; ctx!.fillRect(40, 130, VIEW_W - 80, 110)
        ctx!.fillStyle = '#fff'; ctx!.font = '700 22px system-ui, sans-serif'; ctx!.fillText(`Level ${level.name}`, VIEW_W / 2, 168)
        ctx!.font = '500 13px system-ui, sans-serif'; ctx!.fillStyle = '#cbd5e1'
        const words = level.hint.split(' '); let line = ''; let yy = 192
        for (const w of words) { if ((line + w).length > 78) { ctx!.fillText(line, VIEW_W / 2, yy); line = ''; yy += 18 } line += w + ' ' }
        ctx!.fillText(line, VIEW_W / 2, yy)
        ctx!.globalAlpha = 1
      }
      if (finished) {
        ctx!.fillStyle = 'rgba(2,6,23,0.75)'; ctx!.fillRect(0, 0, VIEW_W, VIEW_H)
        ctx!.fillStyle = '#fde047'; ctx!.font = '700 28px system-ui, sans-serif'; ctx!.fillText('Alle Level geschafft!', VIEW_W / 2, VIEW_H / 2)
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
      if (remote) { const k = Math.min(1, dt * 14); draw.x += (remote.x - draw.x) * k; draw.y += (remote.y - draw.y) * k }
      send(now)
      render(now)
      if (now - lastHud > 400) {
        lastHud = now
        setHud({ level: lv, deaths, ms: now - startPerf, linked: remote !== null && now - remote.seen < STALE_MS, done: finished })
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    const key = (e: KeyboardEvent, down: boolean) => {
      const k = e.key
      if (k === 'ArrowLeft' || k === 'a') { input.current.left = down; e.preventDefault() }
      if (k === 'ArrowRight' || k === 'd') { input.current.right = down; e.preventDefault() }
      if (k === ' ' || k === 'ArrowUp' || k === 'w') { input.current.jump = down; e.preventDefault() }
    }
    const kd = (e: KeyboardEvent) => key(e, true)
    const ku = (e: KeyboardEvent) => key(e, false)
    window.addEventListener('keydown', kd)
    window.addEventListener('keyup', ku)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', kd)
      window.removeEventListener('keyup', ku)
      void supabase.removeChannel(ch)
    }
  }, [st.id, st.is_host, st.me]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mx-auto flex max-w-[720px] flex-col items-center gap-3">
      <canvas ref={canvas} className="aspect-[704/384] w-full touch-none select-none rounded-2xl border border-white/10" aria-label="Parkour-Spielfeld" />
      <div className="flex w-full items-center justify-between px-2">
        <Joystick onChange={(x) => { input.current.stick = x }} />
        <button
          type="button"
          aria-label="Springen"
          onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); input.current.jump = true }}
          onPointerUp={() => { input.current.jump = false }}
          onPointerCancel={() => { input.current.jump = false }}
          onContextMenu={(e) => e.preventDefault()}
          className="flex h-28 w-28 touch-none select-none items-center justify-center rounded-full border border-white/25 bg-fuchsia-400/25 text-white shadow-lg active:scale-95 active:bg-fuchsia-400/45"
        >
          <ArrowUp size={40} />
        </button>
      </div>
      <p className="text-center text-xs text-slate-500">
        Joystick links = laufen, Knopf rechts = springen (Tastatur: Pfeile/WASD und Leertaste). Springt auf den Kopf des anderen für eine Räuberleiter, steht auf Platten, damit Türen und Brücken offen bleiben.
        {hud.linked ? '' : ' Verbindung zum Partner wird aufgebaut …'}
      </p>
    </div>
  )
}
