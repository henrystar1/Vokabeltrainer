import { useEffect, useRef } from 'react'
import { PH, PW } from './engine'
import { LOOKS } from './lookFx'
import type { HoleAnim, Look } from './lookTypes'

const W = 260
const H = 230
const GROUND = 200

/** Kleine Endlosschleife: Auftritt, kurz stehen, Abgang. Für den Parkour-Shop. */
export default function EntrancePreview({ look, name }: { look: Look; name: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    const ctx = cv?.getContext('2d')
    if (!cv || !ctx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    cv.width = W * dpr; cv.height = H * dpr
    const def = LOOKS[look]
    const hold = 1.4
    const total = def.inDur + hold + def.outDur + 0.6
    let raf = 0
    let t0 = performance.now()
    const x = W / 2 - PW / 2
    const y = GROUND - PH
    const frame = (now: number) => {
      const t = (now - t0) / 1000
      const k = t % total
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0b1020'); g.addColorStop(1, '#1b2340')
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = '#334155'; ctx.fillRect(0, GROUND, W, H - GROUND)
      ctx.fillStyle = '#475569'; ctx.fillRect(0, GROUND, W, 3)
      const figure = () => { def.back(ctx, x, y, t); def.body(ctx, x, y, 1, t); def.label(ctx, x + PW / 2, y - 8, name, t) }
      if (k < def.inDur) {
        const h: HoleAnim = { x, y, t: k, kind: 'in', lv: 0, face: 1, look }
        def.anim(ctx, h, t)
        if (k >= def.appear) figure()
      } else if (k < def.inDur + hold) figure()
      else if (k < def.inDur + hold + def.outDur) {
        const h: HoleAnim = { x, y, t: k - def.inDur - hold, kind: 'out', lv: 0, face: 1, look }
        def.anim(ctx, h, t)
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); t0 = 0 }
  }, [look, name])
  return <canvas ref={ref} style={{ width: W, height: H }} className="max-w-full rounded-lg border border-white/10" aria-label={`Vorschau: ${LOOKS[look].name}`} />
}
