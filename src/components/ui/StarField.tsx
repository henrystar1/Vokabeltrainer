import { useMemo } from 'react'
import { useAuth } from '../../features/auth/AuthProvider'
import { DEFAULT_THEME, THEMES, type Decor } from '../../features/shop/catalog'

interface Particle {
  id: number
  left: number
  top: number
  size: number
  delay: number
  duration: number
  dx: number
  rot: number
  color: string
  glyph: string
}

const GLYPHS = '01アイウエオカキクケコ'.split('')

function makeParticles(decor: Decor, colors: string[]): Particle[] {
  let seed = 42
  const rnd = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  const count = { stars: 60, bubbles: 22, petals: 22, confetti: 40, fireflies: 24, code: 26, sparkles: 34 }[decor]
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    left: rnd() * 100,
    top: rnd() * 100,
    size: decor === 'stars' ? (rnd() < 0.85 ? 1 : 2) : 6 + rnd() * 10,
    delay: rnd() * (decor === 'stars' ? 4 : 18),
    duration: 12 + rnd() * 14,
    dx: (rnd() - 0.5) * 160,
    rot: 180 + rnd() * 540,
    color: colors[Math.floor(rnd() * colors.length)],
    glyph: GLYPHS[Math.floor(rnd() * GLYPHS.length)],
  }))
}

/** Dezente Hintergrunddekoration passend zum Design (Sterne, Blasen, Blüten, Konfetti …) – rein dekorativ. */
export default function StarField() {
  const { themeId } = useAuth()
  const theme = THEMES[themeId && THEMES[themeId] ? themeId : DEFAULT_THEME]
  const particles = useMemo(() => makeParticles(theme.decor, theme.decorColors), [theme])
  const { decor } = theme

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="grid-lines absolute inset-0 opacity-60 [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
      {particles.map((p) => {
        if (decor === 'stars' || decor === 'sparkles') {
          return (
            <span
              key={p.id}
              className="absolute animate-twinkle rounded-full"
              style={{
                left: `${p.left}%`,
                top: `${p.top}%`,
                width: decor === 'sparkles' ? p.size / 2 : p.size,
                height: decor === 'sparkles' ? p.size / 2 : p.size,
                background: p.color,
                boxShadow: decor === 'sparkles' ? `0 0 8px ${p.color}` : undefined,
                animationDelay: `${p.delay}s`,
              }}
            />
          )
        }
        const common = {
          left: `${p.left}%`,
          top: 0,
          animationDelay: `-${p.delay}s`,
          animationDuration: `${p.duration}s`,
          animationIterationCount: 'infinite',
          animationTimingFunction: 'linear',
          ['--dx' as string]: `${p.dx}px`,
          ['--rot' as string]: `${p.rot}deg`,
        } as const
        if (decor === 'bubbles') {
          return (
            <span
              key={p.id}
              className="absolute rounded-full border opacity-0"
              style={{ ...common, top: 'auto', bottom: 0, width: p.size * 1.6, height: p.size * 1.6, borderColor: p.color, animationName: 'float' }}
            />
          )
        }
        if (decor === 'fireflies') {
          return (
            <span
              key={p.id}
              className="absolute rounded-full opacity-0"
              style={{ ...common, top: 'auto', bottom: 0, width: 4, height: 4, background: p.color, boxShadow: `0 0 10px 2px ${p.color}`, animationName: 'float' }}
            />
          )
        }
        if (decor === 'code') {
          return (
            <span key={p.id} className="absolute font-mono opacity-0" style={{ ...common, fontSize: 12 + p.size, color: p.color, animationName: 'fall' }}>
              {p.glyph}
            </span>
          )
        }
        // petals + confetti
        return (
          <span
            key={p.id}
            className="absolute opacity-0"
            style={{
              ...common,
              width: decor === 'petals' ? p.size : p.size * 0.7,
              height: decor === 'petals' ? p.size * 0.7 : p.size * 1.3,
              background: p.color,
              borderRadius: decor === 'petals' ? '70% 0 70% 0' : '2px',
              animationName: 'fall',
            }}
          />
        )
      })}
    </div>
  )
}
