import { useMemo } from 'react'

/** Dezentes Sternenfeld – rein dekorativ, deterministisch (kein Flackern bei Re-Render). */
export default function StarField({ count = 60 }: { count?: number }) {
  const stars = useMemo(() => {
    let seed = 42
    const rnd = () => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    return Array.from({ length: count }, (_, i) => ({
      id: i,
      left: rnd() * 100,
      top: rnd() * 100,
      size: rnd() < 0.85 ? 1 : 2,
      delay: rnd() * 4,
    }))
  }, [count])

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="grid-lines absolute inset-0 opacity-60 [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
      {stars.map((s) => (
        <span
          key={s.id}
          className="absolute animate-twinkle rounded-full bg-slate-200"
          style={{
            left: `${s.left}%`,
            top: `${s.top}%`,
            width: s.size,
            height: s.size,
            animationDelay: `${s.delay}s`,
          }}
        />
      ))}
    </div>
  )
}
