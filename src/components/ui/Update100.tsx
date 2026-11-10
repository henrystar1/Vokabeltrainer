import { useMemo } from 'react'

const BALLOON_COLORS = ['#f43f5e', '#f59e0b', '#22d3ee', '#a78bfa', '#34d399', '#f472b6', '#facc15']

const CSS = `
@keyframes u100-rise{0%{transform:translate3d(0,0,0) rotate(-3deg)}25%{transform:translate3d(18px,-30vh,0) rotate(3deg)}50%{transform:translate3d(-14px,-62vh,0) rotate(-3deg)}75%{transform:translate3d(16px,-96vh,0) rotate(3deg)}100%{transform:translate3d(0,-135vh,0) rotate(-2deg)}}
@keyframes u100-burst{0%{transform:translate(0,0) scale(1);opacity:0}6%{opacity:1}70%{opacity:1}100%{transform:translate(var(--bx),var(--by)) scale(.2);opacity:0}}
@keyframes u100-glow{0%,100%{opacity:.14;transform:scale(1)}50%{opacity:.3;transform:scale(1.04)}}
@keyframes u100-fall{0%{transform:translate3d(0,-10vh,0) rotate(0)}100%{transform:translate3d(var(--dx),110vh,0) rotate(var(--rot))}}
@keyframes u100-shine{0%{background-position:0% 50%}100%{background-position:200% 50%}}
@media (prefers-reduced-motion: reduce){.u100-a{animation:none!important}}
`

/** Design „Update 100“ für alle: bunte Luftballons steigen auf, auf manchen steht die 100. */
export function BalloonBackdrop() {
  const balloons = useMemo(() => {
    let seed = 100
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
    return Array.from({ length: 16 }, (_, i) => ({
      i, left: 4 + rnd() * 92, size: 46 + rnd() * 46, delay: -rnd() * 34, dur: 22 + rnd() * 16,
      color: BALLOON_COLORS[Math.floor(rnd() * BALLOON_COLORS.length)], with100: i % 3 === 0,
    }))
  }, [])
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <style>{CSS}</style>
      <div className="grid-lines absolute inset-0 opacity-40 [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
      {balloons.map((b) => (
        <div key={b.i} className="u100-a absolute" style={{ left: `${b.left}%`, bottom: '-18vh', animation: `u100-rise ${b.dur}s linear ${b.delay}s infinite` }}>
          <svg width={b.size} height={b.size * 1.55} viewBox="0 0 60 93">
            <path d="M30 86 C30 78 26 74 30 66" stroke="rgba(255,255,255,.35)" strokeWidth="1.2" fill="none" />
            <ellipse cx="30" cy="28" rx="25" ry="28" fill={b.color} opacity=".92" />
            <ellipse cx="21" cy="17" rx="6" ry="9" fill="#fff" opacity=".28" transform="rotate(-25 21 17)" />
            <path d="M30 56 L25 63 L35 63 Z" fill={b.color} />
            {b.with100 && <text x="30" y="35" textAnchor="middle" fontSize="19" fontWeight="800" fill="#fff" fontFamily="system-ui,sans-serif">100</text>}
          </svg>
        </div>
      ))}
    </div>
  )
}

/** Das begrenzte Design: goldenes Feuerwerk über einer riesigen schimmernden 100, dazu fallendes Konfetti. */
export function FireworksBackdrop() {
  const { bursts, confetti } = useMemo(() => {
    let seed = 7
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
    const colors = ['#fde047', '#fbbf24', '#f97316', '#fff7ed', '#f472b6', '#38bdf8']
    const bursts = Array.from({ length: 7 }, (_, b) => ({
      b, x: 10 + rnd() * 80, y: 12 + rnd() * 42, delay: b * 1.35 + rnd(), color: colors[b % colors.length],
      parts: Array.from({ length: 16 }, (_, p) => {
        const a = (p / 16) * Math.PI * 2
        const d = 70 + rnd() * 70
        return { p, bx: Math.cos(a) * d, by: Math.sin(a) * d }
      }),
    }))
    const confetti = Array.from({ length: 26 }, (_, i) => ({ i, left: rnd() * 100, delay: -rnd() * 20, dur: 10 + rnd() * 10, dx: (rnd() - 0.5) * 140, rot: 360 + rnd() * 540, color: colors[Math.floor(rnd() * colors.length)], w: 5 + rnd() * 5 }))
    return { bursts, confetti }
  }, [])
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <style>{CSS}</style>
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 50% 38%, rgba(250,204,21,.12), transparent 60%)' }} />
      <div className="u100-a absolute inset-0 flex items-center justify-center" style={{ animation: 'u100-glow 5s ease-in-out infinite' }}>
        <span className="select-none font-black leading-none" style={{
          fontSize: 'min(62vw, 70vh)', backgroundImage: 'linear-gradient(100deg,#78350f,#fde047,#fff7ed,#fbbf24,#78350f)', backgroundSize: '200% 100%',
          WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', animation: 'u100-shine 6s linear infinite', opacity: 0.9,
        }}>100</span>
      </div>
      {bursts.map((b) => (
        <div key={b.b} className="absolute" style={{ left: `${b.x}%`, top: `${b.y}%` }}>
          {b.parts.map((p) => (
            <span key={p.p} className="u100-a absolute h-1.5 w-1.5 rounded-full opacity-0" style={{
              background: b.color, boxShadow: `0 0 8px 2px ${b.color}`,
              ['--bx' as string]: `${p.bx}px`, ['--by' as string]: `${p.by}px`,
              animation: `u100-burst 2.2s ease-out ${b.delay}s infinite`, animationDuration: '2.2s',
            }} />
          ))}
        </div>
      ))}
      {confetti.map((c) => (
        <span key={c.i} className="u100-a absolute top-0 opacity-90" style={{
          left: `${c.left}%`, width: c.w, height: c.w * 1.8, background: c.color, borderRadius: 2,
          ['--dx' as string]: `${c.dx}px`, ['--rot' as string]: `${c.rot}deg`, animation: `u100-fall ${c.dur}s linear ${c.delay}s infinite`,
        }} />
      ))}
    </div>
  )
}
