export type LootState = 'closed' | 'opening' | 'open' | 'taken'

interface Props {
  tone: 'gold' | 'green'
  state: LootState
  onOpen?: () => void
  label: string
  disabled?: boolean
}

const COLORS = {
  gold: { body: '#b45309', body2: '#f59e0b', lid: '#fbbf24', lid2: '#d97706', ribbon: '#dc2626', glow: '250,204,21' },
  green: { body: '#047857', body2: '#10b981', lid: '#34d399', lid2: '#059669', ribbon: '#2563eb', glow: '52,211,153' },
}

const CSS = `
@keyframes lb-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
@keyframes lb-shake{0%,100%{transform:rotate(0)}15%{transform:rotate(-7deg) scale(1.04)}30%{transform:rotate(7deg) scale(1.07)}45%{transform:rotate(-6deg) scale(1.09)}60%{transform:rotate(6deg) scale(1.1)}80%{transform:rotate(-3deg) scale(1.1)}}
@keyframes lb-lid{0%{transform:translateY(0) rotate(0);opacity:1}100%{transform:translateY(-120px) rotate(-28deg);opacity:0}}
@keyframes lb-burst{0%{opacity:0;transform:scale(.2)}35%{opacity:1}100%{opacity:0;transform:scale(2.2)}}
@keyframes lb-ray{0%{opacity:0}40%{opacity:.9}100%{opacity:0;transform:scaleY(1.6)}}
@keyframes lb-glow{0%,100%{opacity:.35}50%{opacity:.8}}
.lb-a{transform-box:fill-box;transform-origin:center}
@media (prefers-reduced-motion: reduce){.lb-a{animation-duration:.01s!important;animation-delay:0s!important}}
`

/** Ein Paket (SVG): wartet schwebend, schüttelt sich beim Öffnen, der Deckel fliegt weg und Licht bricht heraus. */
export default function LootBox({ tone, state, onOpen, label, disabled }: Props) {
  const c = COLORS[tone]
  const id = `lb-${tone}`
  const opening = state === 'opening'
  const open = state === 'open' || state === 'taken'
  const clickable = state === 'closed' && !disabled
  return (
    <button
      type="button"
      onClick={clickable ? onOpen : undefined}
      disabled={!clickable}
      aria-label={label}
      className={`relative mx-auto block w-full max-w-[220px] select-none rounded-3xl p-2 outline-none transition focus-visible:ring-2 focus-visible:ring-yellow-300 ${clickable ? 'cursor-pointer hover:scale-105' : 'cursor-default'} ${state === 'taken' ? 'opacity-50 grayscale' : ''}`}
    >
      <style>{CSS}</style>
      <svg viewBox="0 0 200 200" className="w-full overflow-visible" aria-hidden>
        <defs>
          <linearGradient id={`${id}-b`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={c.body2} /><stop offset="1" stopColor={c.body} /></linearGradient>
          <linearGradient id={`${id}-l`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={c.lid} /><stop offset="1" stopColor={c.lid2} /></linearGradient>
          <radialGradient id={`${id}-g`}><stop offset="0" stopColor={`rgb(${c.glow})`} stopOpacity=".9" /><stop offset="1" stopColor={`rgb(${c.glow})`} stopOpacity="0" /></radialGradient>
        </defs>
        {/* Leuchten hinter dem Paket */}
        <circle cx="100" cy="110" r="92" fill={`url(#${id}-g)`} className="lb-a" style={{ animation: state === 'closed' && !disabled ? 'lb-glow 2.4s ease-in-out infinite' : undefined, opacity: state === 'closed' ? 0.4 : 0 }} />
        <g className="lb-a" style={{ animation: opening ? 'lb-shake 1.1s ease-in-out both' : state === 'closed' && !disabled ? 'lb-float 3s ease-in-out infinite' : undefined }}>
          {/* Strahlen beim Öffnen */}
          {(opening || open) && [-50, -25, 0, 25, 50].map((a, i) => (
            <rect key={a} x="96" y="-10" width="8" height="90" rx="4" fill={`rgb(${c.glow})`} className="lb-a" transform={`rotate(${a} 100 90)`}
              style={{ opacity: 0, animation: `lb-ray 1.3s ease-out ${1 + i * 0.04}s both` }} />
          ))}
          {/* Körper */}
          <rect x="35" y="88" width="130" height="86" rx="10" fill={`url(#${id}-b)`} stroke="rgba(0,0,0,.25)" strokeWidth="2" />
          <rect x="91" y="88" width="18" height="86" fill={c.ribbon} />
          <rect x="35" y="124" width="130" height="10" fill="rgba(255,255,255,.12)" />
          {/* Deckel */}
          <g className="lb-a" style={{ animation: opening ? 'lb-lid .9s ease-in 1.1s both' : undefined, opacity: open ? 0 : 1 }}>
            <rect x="26" y="66" width="148" height="30" rx="9" fill={`url(#${id}-l)`} stroke="rgba(0,0,0,.25)" strokeWidth="2" />
            <rect x="91" y="66" width="18" height="30" fill={c.ribbon} />
            {/* Schleife */}
            <path d="M100 66 C70 30 50 52 82 64 Z" fill={c.ribbon} stroke="rgba(0,0,0,.25)" strokeWidth="2" />
            <path d="M100 66 C130 30 150 52 118 64 Z" fill={c.ribbon} stroke="rgba(0,0,0,.25)" strokeWidth="2" />
            <circle cx="100" cy="65" r="8" fill={c.ribbon} stroke="rgba(0,0,0,.25)" strokeWidth="2" />
          </g>
          {tone === 'gold' && !open && <path d="M104 100 L92 124 H101 L96 148 L112 118 H102 Z" fill="rgba(255,255,255,.55)" />}
          {open && <ellipse cx="100" cy="90" rx="56" ry="9" fill="rgba(0,0,0,.35)" />}
        </g>
        {/* Lichtblitz beim Aufspringen */}
        {(opening || open) && <circle cx="100" cy="86" r="50" fill={`rgb(${c.glow})`} className="lb-a" style={{ opacity: 0, animation: 'lb-burst .9s ease-out 1.1s both' }} />}
      </svg>
    </button>
  )
}
