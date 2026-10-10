import { useEffect, useRef } from 'react'
import type { GameProps } from './SnakeGame'
import { SPIKE_W, WAVE_R, WAVE_X, WH, WW, newWave, stepWave, type WaveState } from './wave'

export default function WaveGame({ onScore, onOver }: GameProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const state = useRef<WaveState>(newWave())
  const holding = useRef(false)
  const trail = useRef<Array<{ x: number; y: number }>>([])
  const cb = useRef({ onScore, onOver })
  cb.current = { onScore, onOver }

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    let done = false
    let lastScore = 0
    let scroll = 0
    const draw = () => {
      const ctx = canvas.current?.getContext('2d')
      if (!ctx) return
      const s = state.current
      const g = ctx.createLinearGradient(0, 0, 0, WH)
      g.addColorStop(0, '#12082e')
      g.addColorStop(1, '#0a1840')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, WW, WH)
      // Gitter, das mitläuft
      ctx.strokeStyle = 'rgba(148,163,184,0.08)'
      ctx.lineWidth = 1
      for (let x = -(scroll % 36); x < WW; x += 36) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WH); ctx.stroke() }
      for (let y = 0; y < WH; y += 36) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WW, y); ctx.stroke() }
      // Stacheln
      for (const c of s.cols) {
        const topH = c.c - c.g / 2
        const botH = WH - (c.c + c.g / 2)
        ctx.shadowColor = '#fb7185'
        ctx.shadowBlur = 10
        ctx.fillStyle = '#e11d48'
        ctx.beginPath(); ctx.moveTo(c.x - SPIKE_W / 2, 0); ctx.lineTo(c.x + SPIKE_W / 2, 0); ctx.lineTo(c.x, topH); ctx.closePath(); ctx.fill()
        ctx.beginPath(); ctx.moveTo(c.x - SPIKE_W / 2, WH); ctx.lineTo(c.x + SPIKE_W / 2, WH); ctx.lineTo(c.x, WH - botH); ctx.closePath(); ctx.fill()
        ctx.shadowBlur = 0
        ctx.fillStyle = '#fecdd3'
        ctx.beginPath(); ctx.arc(c.x, topH, 2, 0, Math.PI * 2); ctx.fill()
        ctx.beginPath(); ctx.arc(c.x, WH - botH, 2, 0, Math.PI * 2); ctx.fill()
      }
      // Decke und Boden
      ctx.fillStyle = '#be123c'
      ctx.fillRect(0, 0, WW, 3)
      ctx.fillRect(0, WH - 3, WW, 3)
      // Schweif
      const tr = trail.current
      if (tr.length > 1) {
        ctx.lineWidth = 4
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.shadowColor = '#22d3ee'
        ctx.shadowBlur = 12
        ctx.strokeStyle = '#22d3ee'
        ctx.beginPath()
        ctx.moveTo(tr[0].x, tr[0].y)
        for (const p of tr) ctx.lineTo(p.x, p.y)
        ctx.stroke()
        ctx.shadowBlur = 0
      }
      // Spitze (Pfeil im 45°-Winkel)
      ctx.save()
      ctx.translate(WAVE_X, s.y)
      ctx.rotate(holding.current || !s.started ? -Math.PI / 4 : Math.PI / 4)
      ctx.fillStyle = '#ecfeff'
      ctx.shadowColor = '#22d3ee'
      ctx.shadowBlur = 14
      ctx.beginPath(); ctx.moveTo(WAVE_R * 2, 0); ctx.lineTo(-WAVE_R * 1.4, -WAVE_R * 1.3); ctx.lineTo(-WAVE_R * 0.6, 0); ctx.lineTo(-WAVE_R * 1.4, WAVE_R * 1.3); ctx.closePath(); ctx.fill()
      ctx.restore()
      ctx.fillStyle = '#fff'
      ctx.font = 'bold 34px ui-monospace, monospace'
      ctx.textAlign = 'center'
      ctx.fillText(String(s.score), WW / 2, 56)
      if (!s.started) {
        ctx.font = '14px system-ui, sans-serif'
        ctx.fillStyle = '#cbd5e1'
        ctx.fillText('Halten = hoch, loslassen = runter', WW / 2, WH / 2 + 60)
      }
    }
    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      const prev = state.current
      state.current = stepWave(prev, dt, holding.current)
      const next = state.current
      if (next.started) {
        scroll += next.speed * dt
        trail.current = trail.current.map((p) => ({ x: p.x - next.speed * dt, y: p.y })).filter((p) => p.x > -10)
        trail.current.push({ x: WAVE_X, y: next.y })
      }
      draw()
      if (next.score !== lastScore) {
        lastScore = next.score
        cb.current.onScore(lastScore)
      }
      if (next.over && !done) {
        done = true
        cb.current.onOver(next.score)
        return
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    const isUp = (e: KeyboardEvent) => e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w'
    const onKeyDown = (e: KeyboardEvent) => { if (isUp(e)) { e.preventDefault(); holding.current = true } }
    const onKeyUp = (e: KeyboardEvent) => { if (isUp(e)) holding.current = false }
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null
      if (t?.closest('button, a, input, select, textarea, [role="dialog"], [data-no-flap]')) return
      holding.current = true
    }
    const release = () => { holding.current = false }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    window.addEventListener('blur', release)
    return () => {
      done = true
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
      window.removeEventListener('blur', release)
    }
  }, [])

  return (
    <div className="flex flex-col items-center gap-3">
      <canvas ref={canvas} width={WW} height={WH} className="max-h-[62vh] w-auto max-w-full touch-none select-none rounded-2xl border border-white/10" />
      <p className="text-xs text-slate-500">Halte den Bildschirm oder die Leertaste = die Spitze steigt. Loslassen = sie fällt. Weich den Stacheln aus, Decke und Boden sind tödlich.</p>
    </div>
  )
}
