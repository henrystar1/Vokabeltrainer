import { useEffect, useRef } from 'react'
import { ArrowUp } from 'lucide-react'
import { Joystick } from './joystick'
import { JH, JW, PH, PLAT_H, PW, jumpScore, newJump, stepJump, type JumpState } from './jump'
import { plusOverlay } from './plusfx'
import type { GameProps } from './SnakeGame'

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; r: number }

/** Pseudo-Zufall aus einer Zahl (für feste Deko, die beim Scrollen nicht flackert). */
const hash = (n: number): number => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

function drawSky(ctx: CanvasRenderingContext2D, cam: number, t: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, JH)
  g.addColorStop(0, '#0a0f2e')
  g.addColorStop(0.55, '#2b2a6b')
  g.addColorStop(1, '#c2527a')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, JW, JH)
  // Sterne
  for (let i = 0; i < 46; i++) {
    const x = (hash(i) * JW * 1.4 - cam * 0.04 + JW * 2) % JW
    const y = hash(i + 99) * JH * 0.55
    const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * 1.5 + i))
    ctx.fillStyle = `rgba(255,255,255,${0.25 + 0.55 * tw})`
    const r = hash(i + 7) > 0.85 ? 1.6 : 1
    ctx.fillRect(x, y, r, r)
  }
  // Mond mit Schein
  const mx = 390
  const my = 62
  const glow = ctx.createRadialGradient(mx, my, 6, mx, my, 60)
  glow.addColorStop(0, 'rgba(254,243,199,0.55)')
  glow.addColorStop(1, 'rgba(254,243,199,0)')
  ctx.fillStyle = glow
  ctx.fillRect(mx - 60, my - 60, 120, 120)
  ctx.fillStyle = '#fef3c7'
  ctx.beginPath()
  ctx.arc(mx, my, 20, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(217,119,6,0.18)'
  for (const [dx, dy, r] of [[-6, -4, 5], [7, 5, 4], [-2, 9, 3]]) {
    ctx.beginPath()
    ctx.arc(mx + dx, my + dy, r, 0, Math.PI * 2)
    ctx.fill()
  }
  // Wolken
  ctx.fillStyle = 'rgba(255,255,255,0.10)'
  for (let i = 0; i < 5; i++) {
    const w = 70 + hash(i + 40) * 50
    const x = ((hash(i + 20) * 900 - cam * 0.12 - t * 6) % 900 + 900) % 900 - 120
    const y = 40 + hash(i + 60) * 90
    rr(ctx, x, y, w, 14, 7)
    ctx.fill()
    rr(ctx, x + w * 0.2, y - 9, w * 0.45, 14, 7)
    ctx.fill()
  }
}

function ridge(ctx: CanvasRenderingContext2D, cam: number, speed: number, base: number, amp: number, step: number, color: string, seed: number): void {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(0, JH)
  const off = cam * speed
  for (let x = 0; x <= JW + step; x += step / 4) {
    const wx = x + off
    const y = base - amp * (0.5 + 0.5 * Math.sin(wx / step * 2.1 + seed)) - amp * 0.5 * Math.sin(wx / step * 0.7 + seed * 2)
    ctx.lineTo(x, y)
  }
  ctx.lineTo(JW + step, JH)
  ctx.closePath()
  ctx.fill()
}

function drawPlat(ctx: CanvasRenderingContext2D, x: number, y: number, w: number): void {
  const depth = PLAT_H + 10
  const dirt = ctx.createLinearGradient(0, y, 0, y + depth)
  dirt.addColorStop(0, '#7c4a2a')
  dirt.addColorStop(0.7, '#4a2b1a')
  dirt.addColorStop(1, 'rgba(40,22,14,0)')
  ctx.fillStyle = dirt
  rr(ctx, x, y + 2, w, depth, 5)
  ctx.fill()
  // Steinchen in der Erde
  ctx.fillStyle = 'rgba(255,255,255,0.12)'
  for (let i = 0; i < w / 18; i++) {
    const k = Math.floor(x) + i * 7
    ctx.fillRect(x + 6 + hash(k) * (w - 12), y + 8 + hash(k + 3) * 8, 2.5, 2)
  }
  // Gras
  const grass = ctx.createLinearGradient(0, y - 2, 0, y + 8)
  grass.addColorStop(0, '#6ee7a0')
  grass.addColorStop(1, '#16a34a')
  ctx.fillStyle = grass
  rr(ctx, x - 2, y - 2, w + 4, 9, 4)
  ctx.fill()
  // Halme und Blümchen
  for (let i = 0; i < w / 14; i++) {
    const k = Math.floor(x) + i * 13
    const gx = x + 4 + hash(k) * (w - 8)
    ctx.strokeStyle = '#4ade80'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(gx, y - 1)
    ctx.lineTo(gx - 1.5, y - 6 - hash(k + 1) * 3)
    ctx.stroke()
    if (hash(k + 5) > 0.82) {
      ctx.fillStyle = hash(k + 6) > 0.5 ? '#fde68a' : '#f9a8d4'
      ctx.beginPath()
      ctx.arc(gx + 2, y - 6, 2.2, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

function drawCoin(ctx: CanvasRenderingContext2D, x: number, y: number, t: number): void {
  const bob = Math.sin(t * 3 + x * 0.05) * 3
  const sx = Math.abs(Math.cos(t * 3.2 + x * 0.03))
  const cy = y + bob
  const glow = ctx.createRadialGradient(x, cy, 2, x, cy, 18)
  glow.addColorStop(0, 'rgba(251,191,36,0.45)')
  glow.addColorStop(1, 'rgba(251,191,36,0)')
  ctx.fillStyle = glow
  ctx.fillRect(x - 18, cy - 18, 36, 36)
  ctx.fillStyle = '#d97706'
  ctx.beginPath()
  ctx.ellipse(x, cy, Math.max(1.5, 8 * sx), 8, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#fcd34d'
  ctx.beginPath()
  ctx.ellipse(x, cy, Math.max(1, 6 * sx), 6, 0, 0, Math.PI * 2)
  ctx.fill()
  if (sx > 0.5) {
    ctx.fillStyle = 'rgba(255,255,255,0.7)'
    ctx.fillRect(x - 1, cy - 3.5, 2, 5)
  }
}

function drawHero(ctx: CanvasRenderingContext2D, s: JumpState, face: number, t: number): void {
  const cx = s.x + PW / 2
  const bottom = s.y + PH
  // Dehnen beim Springen, Stauchen beim Fallen
  const stretch = s.onGround ? 1 : Math.max(0.85, Math.min(1.18, 1 + Math.abs(s.vy) / 3500))
  const h = PH * stretch
  const w = PW / Math.sqrt(stretch)
  const run = s.onGround && Math.abs(s.vx) > 20 ? Math.sin(t * 22) : 0
  // Schatten
  ctx.fillStyle = 'rgba(0,0,0,0.25)'
  ctx.beginPath()
  ctx.ellipse(cx, bottom + 1, w * 0.55, 2.5, 0, 0, Math.PI * 2)
  ctx.fill()
  // Füße
  ctx.fillStyle = '#9d174d'
  const fy = bottom - 3
  rr(ctx, cx - w / 2 + 1 + run * 2, fy, 7, 4, 2)
  ctx.fill()
  rr(ctx, cx + w / 2 - 8 - run * 2, fy, 7, 4, 2)
  ctx.fill()
  // Körper
  const body = ctx.createLinearGradient(0, bottom - h, 0, bottom)
  body.addColorStop(0, '#f9a8d4')
  body.addColorStop(1, '#ec4899')
  ctx.fillStyle = body
  rr(ctx, cx - w / 2, bottom - h, w, h - 2, 8)
  ctx.fill()
  ctx.strokeStyle = 'rgba(131,24,67,0.55)'
  ctx.lineWidth = 1.5
  ctx.stroke()
  // Glanzpunkt
  ctx.fillStyle = 'rgba(255,255,255,0.35)'
  rr(ctx, cx - w / 2 + 3, bottom - h + 3, 4, 7, 2)
  ctx.fill()
  // Ohren
  ctx.fillStyle = '#ec4899'
  ctx.beginPath()
  ctx.moveTo(cx - w / 2 + 2, bottom - h + 3)
  ctx.lineTo(cx - w / 2 + 3, bottom - h - 5)
  ctx.lineTo(cx - w / 2 + 8, bottom - h + 1)
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(cx + w / 2 - 2, bottom - h + 3)
  ctx.lineTo(cx + w / 2 - 3, bottom - h - 5)
  ctx.lineTo(cx + w / 2 - 8, bottom - h + 1)
  ctx.fill()
  // Augen schauen in Laufrichtung
  const ex = cx + face * 2
  const ey = bottom - h + 9
  for (const dx of [-4, 4]) {
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.ellipse(ex + dx, ey, 3, 3.6, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#1e1b4b'
    ctx.beginPath()
    ctx.arc(ex + dx + face * 1.2, ey + (s.vy < -50 ? -0.8 : 0.4), 1.5, 0, Math.PI * 2)
    ctx.fill()
  }
  // Mund
  ctx.strokeStyle = '#831843'
  ctx.lineWidth = 1.2
  ctx.beginPath()
  if (s.onGround) ctx.arc(ex, ey + 7, 2.5, 0.15 * Math.PI, 0.85 * Math.PI)
  else ctx.ellipse(ex, ey + 8, 1.6, 2, 0, 0, Math.PI * 2)
  ctx.stroke()
}

export default function JumpGame({ onScore, onOver, plus }: GameProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const state = useRef<JumpState>(newJump())
  const input = useRef({ stick: 0, left: false, right: false, jump: false })
  const cb = useRef({ onScore, onOver })
  cb.current = { onScore, onOver }
  const plusOn = useRef(!!plus)
  plusOn.current = !!plus

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    let done = false
    let lastScore = 0
    let t = 0
    let face = 1
    let prevGround = true
    let prevCoins = 0
    let prevVy = 0
    let particles: Particle[] = []
    const burst = (x: number, y: number, n: number, color: string, spread: number, up: number): void => {
      for (let i = 0; i < n; i++) {
        particles.push({ x, y, vx: (Math.random() - 0.5) * spread, vy: -Math.random() * up, life: 0.45 + Math.random() * 0.3, max: 0.75, color, r: 1.5 + Math.random() * 2 })
      }
    }
    const draw = () => {
      const ctx = canvas.current?.getContext('2d')
      if (!ctx) return
      const s = state.current
      drawSky(ctx, s.cam, t)
      ridge(ctx, s.cam, 0.15, 250, 55, 170, '#2a2468', 1)
      ridge(ctx, s.cam, 0.3, 285, 40, 120, '#3a2a6e', 4)
      ridge(ctx, s.cam, 0.5, 310, 26, 90, '#1e1b4b', 7)
      ctx.save()
      ctx.translate(-s.cam, 0)
      for (const p of s.plats) if (p.x + p.w > s.cam - 20 && p.x < s.cam + JW + 20) drawPlat(ctx, p.x, p.y, p.w)
      for (const c of s.coins) if (!c.got && c.x > s.cam - 20 && c.x < s.cam + JW + 20) drawCoin(ctx, c.x, c.y, t)
      for (const p of particles) {
        ctx.globalAlpha = Math.max(0, p.life / p.max)
        ctx.fillStyle = p.color
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
      drawHero(ctx, s, face, t)
      ctx.restore()
      // Anzeige
      ctx.fillStyle = 'rgba(8,10,30,0.55)'
      rr(ctx, 10, 10, 104, 30, 15)
      ctx.fill()
      ctx.fillStyle = '#fcd34d'
      ctx.beginPath()
      ctx.arc(28, 25, 7, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#d97706'
      ctx.beginPath()
      ctx.arc(28, 25, 3.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.font = 'bold 18px ui-monospace, monospace'
      ctx.textAlign = 'left'
      ctx.fillText(String(jumpScore(s)), 42, 31)
      // Absturz-Warnung
      if (s.y > JH - 40 && !s.over) {
        ctx.fillStyle = `rgba(244,63,94,${Math.min(0.5, (s.y - (JH - 40)) / 120)})`
        ctx.fillRect(0, JH - 28, JW, 28)
      }
      if (plusOn.current) plusOverlay(ctx, JW, JH)
    }
    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.033)
      last = now
      const i = input.current
      const move = i.stick !== 0 ? i.stick : (i.right ? 1 : 0) - (i.left ? 1 : 0)
      state.current = stepJump(state.current, dt, { move, jump: i.jump }, Math.random)
      t += dt
      const st = state.current
      if (move !== 0) face = move > 0 ? 1 : -1
      if (st.onGround && !prevGround) burst(st.x + PW / 2, st.y + PH, Math.min(10, 3 + Math.round(prevVy / 250)), '#d1fae5', 90, 60)
      if (!st.onGround && prevGround && st.vy < 0) burst(st.x + PW / 2, st.y + PH, 5, '#e2e8f0', 60, 40)
      if (st.coinsGot > prevCoins) burst(st.x + PW / 2, st.y + 6, 14, '#fcd34d', 200, 160)
      prevGround = st.onGround
      prevCoins = st.coinsGot
      prevVy = st.vy
      particles = particles.filter((p) => (p.life -= dt) > 0)
      for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 500 * dt }
      draw()
      const sc = jumpScore(state.current)
      if (sc !== lastScore) {
        lastScore = sc
        cb.current.onScore(sc)
      }
      if (state.current.over && !done) {
        done = true
        cb.current.onOver(sc)
        return
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
      done = true
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', kd)
      window.removeEventListener('keyup', ku)
    }
  }, [])

  return (
    <div className="flex flex-col items-center gap-3">
      <canvas ref={canvas} width={JW} height={JH} className="w-full max-w-[640px] touch-none select-none rounded-2xl border border-white/10" />
      <div className="flex w-full max-w-[640px] items-center justify-between px-2">
        <Joystick onChange={(x) => { input.current.stick = x }} />
        <PadButtonHold label="Springen" onDown={() => { input.current.jump = true }} onUp={() => { input.current.jump = false }} />
      </div>
      <p className="text-xs text-slate-500">Joystick links = laufen, Knopf rechts = springen (Tastatur: Pfeile/WASD und Leertaste). Sammle Münzen (+5), jede 50 Pixel Strecke = 1 Punkt.</p>
    </div>
  )
}

/** Sprungknopf: gedrückt halten = aktiv. */
function PadButtonHold({ label, onDown, onUp }: { label: string; onDown: () => void; onUp: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); onDown() }}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onContextMenu={(e) => e.preventDefault()}
      className="flex h-28 w-28 touch-none select-none items-center justify-center rounded-full border border-white/25 bg-fuchsia-400/25 text-white shadow-lg active:scale-95 active:bg-fuchsia-400/45"
    >
      <ArrowUp size={40} />
    </button>
  )
}
