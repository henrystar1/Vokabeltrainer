import { useEffect, useRef } from 'react'

/** Mittelpunkt des Schwarzen Lochs: Mitte des Inhaltsbereichs (neben der Seitenleiste), etwas oberhalb der Mitte. */
export function holeCenter(vw: number, vh: number): { x: number; y: number; r: number } {
  const side = document.querySelector('aside')
  const sw = side && side.getBoundingClientRect().width > 0 && vw >= 768 ? side.getBoundingClientRect().right : 0
  return { x: sw + (vw - sw) / 2, y: vh * (vw >= 768 ? 0.46 : 0.38), r: Math.max(34, Math.min(vw - sw, vh) * 0.13) }
}

const reduced = (): boolean => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

interface Orb { a: number; r: number; w: number; s: number; c: number }

function makeOrbs(n: number): Orb[] {
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  return Array.from({ length: n }, () => {
    const r = 1.25 + Math.pow(rnd(), 1.6) * 2.4
    return { a: rnd() * Math.PI * 2, r, w: 1.6 / Math.pow(r, 1.5), s: 0.6 + rnd() * 1.4, c: rnd() }
  })
}

/** Hintergrund: Ereignishorizont mit Photonenring, kreisende Akkretionsscheibe und Sterne, die hineinspiralen. */
export function BlackHoleBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const scale = 0.6
    const orbs = makeOrbs(320)
    let seed = 3
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const stars = Array.from({ length: 70 }, () => ({ a: rnd() * Math.PI * 2, d: 0.25 + rnd() * 1.1, s: 0.4 + rnd() * 0.9 }))
    let raf = 0
    let last = performance.now()
    let t = 0
    const still = reduced()
    const resize = () => {
      cv.width = Math.round(window.innerWidth * scale)
      cv.height = Math.round(window.innerHeight * scale)
    }
    resize()
    window.addEventListener('resize', resize)
    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      if (document.visibilityState === 'visible') {
        t += still ? 0 : dt
        paint()
      }
      if (!still) raf = requestAnimationFrame(frame)
    }
    const paint = () => {
      const W = cv.width
      const H = cv.height
      const c = holeCenter(window.innerWidth, window.innerHeight)
      const hx = c.x * scale
      const hy = c.y * scale
      const R = c.r * scale
      ctx.clearRect(0, 0, W, H)
      // Linseneffekt: weiches Leuchten um das Loch
      const halo = ctx.createRadialGradient(hx, hy, R * 0.9, hx, hy, R * 6)
      halo.addColorStop(0, 'rgba(96,165,250,0.30)')
      halo.addColorStop(0.35, 'rgba(79,70,229,0.14)')
      halo.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = halo
      ctx.fillRect(0, 0, W, H)
      // hineinfallende Sterne (Spirale)
      ctx.globalCompositeOperation = 'lighter'
      for (const s of stars) {
        const u = (s.d - t * 0.045 * s.s) % 1.35
        const d = u < 0 ? u + 1.35 : u
        const rr = R * 1.1 + d * Math.max(W, H) * 0.62
        const ang = s.a + (1.35 - d) * 2.4 + t * 0.05
        const x = hx + Math.cos(ang) * rr
        const y = hy + Math.sin(ang) * rr * 0.72
        const k = Math.min(1, d * 2.2)
        ctx.fillStyle = `rgba(${200 + 40 * (1 - k) | 0},${220 + 30 * (1 - k) | 0},255,${0.15 + 0.6 * (1 - Math.min(1, d / 1.2))})`
        const sz = 0.7 + (1 - Math.min(1, d)) * 1.3
        ctx.fillRect(x, y, sz, sz)
      }
      // Scheibe, hintere Hälfte (hinter dem Horizont)
      const tilt = -0.28
      const drawOrbs = (front: boolean) => {
        for (const o of orbs) {
          const ph = o.a + t * o.w * 1.5
          const sinp = Math.sin(ph)
          if ((sinp > 0) !== front) continue
          const rx = o.r * R
          const ry = rx * 0.26
          const ex = Math.cos(ph) * rx
          const ey = sinp * ry
          const x = hx + ex * Math.cos(tilt) - ey * Math.sin(tilt)
          const y = hy + ex * Math.sin(tilt) + ey * Math.cos(tilt)
          const heat = 1 - Math.min(1, (o.r - 1.25) / 2.4)
          const g = 190 + 60 * heat
          ctx.fillStyle = `rgba(${120 + 135 * heat | 0},${g | 0},255,${0.28 + 0.55 * heat * o.c + (front ? 0.12 : 0)})`
          ctx.beginPath()
          ctx.arc(x, y, (0.5 + heat * 1.1) * o.s, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      // Scheibe als flacher, leuchtender Ring (hinten / vorn getrennt, damit sie den Horizont überquert)
      const disc = (front: boolean) => {
        ctx.save()
        ctx.translate(hx, hy)
        ctx.rotate(tilt)
        ctx.scale(1, 0.26)
        ctx.beginPath()
        ctx.rect(-W, front ? 0 : -H * 4, W * 2, H * 4)
        ctx.clip()
        const g = ctx.createRadialGradient(0, 0, R * 1.05, 0, 0, R * 3.5)
        g.addColorStop(0, 'rgba(255,255,255,0.95)')
        g.addColorStop(0.12, 'rgba(186,230,253,0.8)')
        g.addColorStop(0.4, 'rgba(59,130,246,0.38)')
        g.addColorStop(0.75, 'rgba(99,102,241,0.14)')
        g.addColorStop(1, 'rgba(99,102,241,0)')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(0, 0, R * 3.5, 0, Math.PI * 2)
        ctx.arc(0, 0, R * 1.05, 0, Math.PI * 2, true)
        ctx.fill('evenodd')
        ctx.restore()
      }
      disc(false)
      drawOrbs(false)
      ctx.globalCompositeOperation = 'source-over'
      // oberer Bogen der Scheibe, vom Loch verbogen
      ctx.globalCompositeOperation = 'lighter'
      for (const [k, w, a] of [[1.2, 0.07, 0.55], [1.4, 0.22, 0.2], [1.7, 0.4, 0.08]] as const) {
        ctx.strokeStyle = `rgba(186,230,253,${a})`
        ctx.lineWidth = Math.max(1, R * w)
        ctx.beginPath()
        ctx.ellipse(hx, hy, R * k, R * k, 0, Math.PI * 1.06, Math.PI * 1.94)
        ctx.stroke()
      }
      ctx.globalCompositeOperation = 'source-over'
      // Horizont
      const hz = ctx.createRadialGradient(hx, hy, R * 0.2, hx, hy, R)
      hz.addColorStop(0, '#000')
      hz.addColorStop(0.94, '#000')
      hz.addColorStop(1, 'rgba(0,0,0,0.9)')
      ctx.fillStyle = hz
      ctx.beginPath()
      ctx.arc(hx, hy, R, 0, Math.PI * 2)
      ctx.fill()
      // Photonenring
      const pulse = 0.8 + 0.2 * Math.sin(t * 1.7)
      ctx.globalCompositeOperation = 'lighter'
      ctx.strokeStyle = `rgba(224,242,254,${0.75 * pulse})`
      ctx.lineWidth = Math.max(1.2, R * 0.05)
      ctx.beginPath()
      ctx.arc(hx, hy, R * 1.02, 0, Math.PI * 2)
      ctx.stroke()
      ctx.strokeStyle = `rgba(59,130,246,${0.35 * pulse})`
      ctx.lineWidth = R * 0.22
      ctx.beginPath()
      ctx.arc(hx, hy, R * 1.12, 0, Math.PI * 2)
      ctx.stroke()
      disc(true)
      drawOrbs(true)
      ctx.globalCompositeOperation = 'source-over'
    }
    raf = requestAnimationFrame(frame)
    if (still) paint()
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])
  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 -z-10 h-full w-full" />
}

interface Beam { sx: number; sy: number; born: number; dur: number; spin: number; dx: number }

/** Lichtstrahlen: von zufälligen Menüpunkten wandern Lichtfunken spiralförmig ins Schwarze Loch. */
export function BlackHoleBeams() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv || reduced()) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    const resize = () => {
      cv.width = Math.round(window.innerWidth * dpr)
      cv.height = Math.round(window.innerHeight * dpr)
    }
    resize()
    window.addEventListener('resize', resize)
    const beams: Beam[] = []
    const impacts: { born: number }[] = []
    let raf = 0
    let nextSpawn = 400
    let t0 = performance.now()
    let lastT = 0
    const spawn = (t: number) => {
      const links = Array.from(document.querySelectorAll<HTMLElement>('aside a[href], nav a[href]')).filter((el) => {
        const r = el.getBoundingClientRect()
        return r.width > 8 && r.height > 8 && r.bottom > 0 && r.top < window.innerHeight && r.right > 0
      })
      if (!links.length) return
      const el = links[Math.floor(Math.random() * links.length)]
      const r = el.getBoundingClientRect()
      const bottomNav = r.top > window.innerHeight * 0.7
      const sx = bottomNav ? r.left + r.width / 2 : Math.min(r.right - 10, r.left + 150)
      const sy = bottomNav ? r.top + 6 : r.top + r.height / 2
      beams.push({ sx, sy, born: t, dur: 1.5 + Math.random() * 0.9, spin: (Math.random() < 0.5 ? -1 : 1) * (1.3 + Math.random() * 1.1), dx: Math.random() })
    }
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      if (document.visibilityState !== 'visible') return
      const t = (now - t0) / 1000
      const dt = t - lastT
      lastT = t
      void dt
      const W = cv.width
      const H = cv.height
      ctx.clearRect(0, 0, W, H)
      if (t * 1000 >= nextSpawn && beams.length < 5) {
        spawn(t)
        nextSpawn = t * 1000 + 450 + Math.random() * 900
      }
      const c = holeCenter(window.innerWidth, window.innerHeight)
      ctx.globalCompositeOperation = 'lighter'
      ctx.lineCap = 'round'
      for (let b = beams.length - 1; b >= 0; b--) {
        const bm = beams[b]
        const k = (t - bm.born) / bm.dur
        if (k > 1.15) {
          beams.splice(b, 1)
          continue
        }
        const dxh = bm.sx - c.x
        const dyh = bm.sy - c.y
        const r0 = Math.hypot(dxh, dyh)
        const th0 = Math.atan2(dyh, dxh)
        const at = (u: number) => {
          const e = Math.min(1, Math.max(0, u))
          const rr = c.r * 1.05 + (r0 - c.r * 1.05) * Math.pow(1 - e, 1.7)
          const th = th0 + bm.spin * Math.pow(e, 2.2)
          return { x: c.x + Math.cos(th) * rr, y: c.y + Math.sin(th) * rr * (0.55 + 0.45 * (1 - e)) }
        }
        const head = Math.min(1, k)
        const tail = Math.max(0, head - 0.42)
        // Startglühen am Menüpunkt
        if (k < 0.35) {
          const g = ctx.createRadialGradient(bm.sx * dpr, bm.sy * dpr, 0, bm.sx * dpr, bm.sy * dpr, 26 * dpr)
          const a = 0.5 * (1 - k / 0.35)
          g.addColorStop(0, `rgba(186,230,253,${a})`)
          g.addColorStop(1, 'rgba(186,230,253,0)')
          ctx.fillStyle = g
          ctx.fillRect((bm.sx - 28) * dpr, (bm.sy - 28) * dpr, 56 * dpr, 56 * dpr)
        }
        const N = 26
        let prev = at(tail)
        for (let i = 1; i <= N; i++) {
          const u = tail + ((head - tail) * i) / N
          const p = at(u)
          const f = i / N
          ctx.strokeStyle = `rgba(${150 + 105 * f | 0},${200 + 55 * f | 0},255,${0.04 + 0.7 * f * f * (k > 1 ? Math.max(0, 1.15 - k) / 0.15 : 1)})`
          ctx.lineWidth = (0.8 + 2.6 * f) * dpr
          ctx.beginPath()
          ctx.moveTo(prev.x * dpr, prev.y * dpr)
          ctx.lineTo(p.x * dpr, p.y * dpr)
          ctx.stroke()
          prev = p
        }
        if (k <= 1) {
          const hp = at(head)
          const g = ctx.createRadialGradient(hp.x * dpr, hp.y * dpr, 0, hp.x * dpr, hp.y * dpr, 9 * dpr)
          g.addColorStop(0, 'rgba(255,255,255,0.95)')
          g.addColorStop(0.4, 'rgba(147,197,253,0.5)')
          g.addColorStop(1, 'rgba(59,130,246,0)')
          ctx.fillStyle = g
          ctx.fillRect((hp.x - 10) * dpr, (hp.y - 10) * dpr, 20 * dpr, 20 * dpr)
        } else if (!(bm as Beam & { hit?: boolean }).hit) {
          ;(bm as Beam & { hit?: boolean }).hit = true
          impacts.push({ born: t })
        }
      }
      for (let i = impacts.length - 1; i >= 0; i--) {
        const k = (t - impacts[i].born) / 0.6
        if (k > 1) {
          impacts.splice(i, 1)
          continue
        }
        ctx.strokeStyle = `rgba(224,242,254,${0.6 * (1 - k)})`
        ctx.lineWidth = (2.2 * (1 - k) + 0.6) * dpr
        ctx.beginPath()
        ctx.arc(c.x * dpr, c.y * dpr, c.r * (1.05 + 0.7 * k) * dpr, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.globalCompositeOperation = 'source-over'
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])
  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 z-[35] h-full w-full" />
}
