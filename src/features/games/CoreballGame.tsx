import { useEffect, useRef } from 'react'
import { BALL_R, CH, CORE_R, CW, CX, CY, FLIGHT, PIN_L, land, landingAngle, levelConfig, newCore, stepCore, type CoreState } from './coreball'
import { plusOverlay } from './plusfx'
import type { GameProps } from './SnakeGame'

const SHOOT_Y = CH - 70
const PIN_COLORS = ['#22d3ee', '#a78bfa', '#f472b6', '#34d399', '#fbbf24']

export default function CoreballGame({ onScore, onOver, plus }: GameProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const state = useRef<CoreState>(newCore())
  const flight = useRef<{ t: number; at: number } | null>(null)
  const fx = useRef({ flash: 0, shake: 0, banner: 0, hit: false })
  const cb = useRef({ onScore, onOver })
  cb.current = { onScore, onOver }
  const plusOn = useRef(!!plus)
  plusOn.current = !!plus

  const fire = () => {
    const s = state.current
    if (s.over || flight.current) return
    flight.current = { t: 0, at: landingAngle(s) }
  }

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    let done = false
    const s0 = () => state.current
    const draw = () => {
      const ctx = canvas.current?.getContext('2d')
      if (!ctx) return
      const s = s0()
      const f = fx.current
      ctx.save()
      if (f.shake > 0) ctx.translate((Math.random() - 0.5) * f.shake * 12, (Math.random() - 0.5) * f.shake * 12)
      const bg = ctx.createLinearGradient(0, 0, 0, CH)
      bg.addColorStop(0, '#05060f')
      bg.addColorStop(1, '#1b1038')
      ctx.fillStyle = bg
      ctx.fillRect(-20, -20, CW + 40, CH + 40)
      for (let i = 0; i < 40; i++) {
        const x = (Math.sin(i * 91.7) * 0.5 + 0.5) * CW
        const y = (Math.sin(i * 47.3) * 0.5 + 0.5) * CH
        ctx.fillStyle = `rgba(255,255,255,${0.15 + 0.3 * Math.abs(Math.sin(s.t + i))})`
        ctx.fillRect(x, y, 1.5, 1.5)
      }
      // Kern mit Leuchten
      const glow = ctx.createRadialGradient(CX, CY, CORE_R * 0.4, CX, CY, CORE_R * 2.6)
      glow.addColorStop(0, 'rgba(167,139,250,0.55)')
      glow.addColorStop(1, 'rgba(167,139,250,0)')
      ctx.fillStyle = glow
      ctx.fillRect(CX - 140, CY - 140, 280, 280)
      // Kugeln am Kern (Stab + Kopf)
      s.pins.forEach((p, i) => {
        const a = p + s.angle
        const x0 = CX + Math.cos(a) * CORE_R
        const y0 = CY + Math.sin(a) * CORE_R
        const x1 = CX + Math.cos(a) * (CORE_R + PIN_L - BALL_R)
        const y1 = CY + Math.sin(a) * (CORE_R + PIN_L - BALL_R)
        ctx.strokeStyle = 'rgba(226,232,240,0.7)'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(x0, y0)
        ctx.lineTo(x1, y1)
        ctx.stroke()
        ctx.fillStyle = PIN_COLORS[i % PIN_COLORS.length]
        ctx.beginPath()
        ctx.arc(x1 + Math.cos(a) * 0, y1 + Math.sin(a) * 0, BALL_R, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = 'rgba(255,255,255,0.5)'
        ctx.beginPath()
        ctx.arc(x1 - 2.5, y1 - 2.5, 2.5, 0, Math.PI * 2)
        ctx.fill()
      })
      const core = ctx.createRadialGradient(CX - 12, CY - 12, 4, CX, CY, CORE_R)
      core.addColorStop(0, '#c4b5fd')
      core.addColorStop(0.6, '#7c3aed')
      core.addColorStop(1, '#312e81')
      ctx.fillStyle = core
      ctx.beginPath()
      ctx.arc(CX, CY, CORE_R, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.9)'
      ctx.font = 'bold 26px ui-monospace, monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(s.level), CX, CY + 1)
      // Flug
      const fl = flight.current
      const tipY = CY + CORE_R + PIN_L - BALL_R
      if (fl) {
        const p = Math.min(1, fl.t / FLIGHT)
        const y = SHOOT_Y + (tipY - SHOOT_Y) * p
        ctx.fillStyle = '#f8fafc'
        ctx.beginPath()
        ctx.arc(CX, y, BALL_R, 0, Math.PI * 2)
        ctx.fill()
      }
      // Schütze + Vorrat
      ctx.fillStyle = '#e2e8f0'
      ctx.beginPath()
      ctx.arc(CX, SHOOT_Y, BALL_R, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'rgba(148,163,184,0.7)'
      ctx.beginPath()
      ctx.moveTo(CX - 22, CH - 28)
      ctx.lineTo(CX + 22, CH - 28)
      ctx.lineTo(CX, SHOOT_Y + 14)
      ctx.fill()
      const total = levelConfig(s.level).balls
      for (let i = 0; i < total; i++) {
        ctx.fillStyle = i < s.left ? '#22d3ee' : 'rgba(255,255,255,0.12)'
        ctx.beginPath()
        ctx.arc(CX - ((total - 1) * 9) + i * 18, CH - 12, 4, 0, Math.PI * 2)
        ctx.fill()
      }
      // Anzeige
      ctx.textAlign = 'left'
      ctx.textBaseline = 'alphabetic'
      ctx.fillStyle = '#fff'
      ctx.font = 'bold 22px ui-monospace, monospace'
      ctx.fillText(String(s.placed), 14, 32)
      ctx.fillStyle = 'rgba(203,213,225,0.7)'
      ctx.font = '12px ui-monospace, monospace'
      ctx.fillText(`Level ${s.level}`, 14, 50)
      if (f.banner > 0) {
        ctx.globalAlpha = Math.min(1, f.banner)
        ctx.fillStyle = '#fde68a'
        ctx.font = 'bold 28px ui-sans-serif, system-ui'
        ctx.textAlign = 'center'
        ctx.fillText(`Level ${s.level}!`, CX, 80)
        ctx.globalAlpha = 1
      }
      ctx.restore()
      if (f.flash > 0) {
        ctx.fillStyle = `rgba(244,63,94,${Math.min(0.55, f.flash)})`
        ctx.fillRect(0, 0, CW, CH)
      }
      if (plusOn.current) plusOverlay(ctx, CW, CH)
    }
    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.033)
      last = now
      const s = s0()
      const f = fx.current
      f.flash = Math.max(0, f.flash - dt * 1.4)
      f.shake = Math.max(0, f.shake - dt * 3)
      f.banner = Math.max(0, f.banner - dt * 0.9)
      if (!f.hit) stepCore(s, dt)
      const fl = flight.current
      if (fl && !f.hit) {
        fl.t += dt
        if (fl.t >= FLIGHT) {
          flight.current = null
          const r = land(s, fl.at)
          if (r === 'hit') {
            f.hit = true
            f.flash = 0.8
            f.shake = 1
            window.setTimeout(() => {
              if (!done) {
                done = true
                cb.current.onOver(s.placed)
              }
            }, 650)
          } else {
            cb.current.onScore(s.placed)
            if (r === 'level') f.banner = 1.6
          }
        }
      }
      draw()
      if (done) return
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    const key = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'Enter') {
        e.preventDefault()
        fire()
      }
    }
    window.addEventListener('keydown', key)
    return () => {
      done = true
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', key)
    }
  }, [])

  return (
    <div className="flex flex-col items-center gap-3">
      <canvas
        ref={canvas}
        width={CW}
        height={CH}
        onPointerDown={(e) => { e.preventDefault(); fire() }}
        className="w-full max-w-[360px] touch-none select-none rounded-2xl border border-white/10"
      />
      <p className="text-center text-xs text-slate-500">Tippe (oder Leertaste), um eine Kugel auf den Kern zu schießen. Triff keine andere Kugel! Jedes Level hat mehr Kugeln und dreht schneller, ab Level 3 wechselt die Richtung.</p>
    </div>
  )
}
