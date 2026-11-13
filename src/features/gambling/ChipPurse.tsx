import { useEffect, useMemo, useState } from 'react'
import { useChips } from './ChipsProvider'
import { lockSeconds } from './chipLogic'

const CSS = `
@keyframes purse-shake{0%,100%{transform:translateX(0) rotate(0)}10%{transform:translateX(-18px) rotate(-9deg)}25%{transform:translateX(16px) rotate(8deg)}40%{transform:translateX(-14px) rotate(-7deg)}55%{transform:translateX(12px) rotate(6deg)}70%{transform:translateX(-8px) rotate(-4deg)}85%{transform:translateX(5px) rotate(2deg)}}
@keyframes purse-in{from{transform:translateY(-60vh) scale(.7);opacity:0}to{transform:none;opacity:1}}
@keyframes purse-dust{0%{transform:translate(0,0) scale(.6);opacity:0}15%{opacity:.9}100%{transform:translate(var(--dx),150px) scale(1.3);opacity:0}}
.purse-in{animation:purse-in .5s cubic-bezier(.2,.9,.3,1.2) both}
.purse-shake{animation:purse-shake .9s ease-in-out .5s 4 both;transform-origin:50% 90%}
.purse-dust{animation:purse-dust 1.6s ease-out infinite both}
@media (prefers-reduced-motion: reduce){.purse-in,.purse-shake,.purse-dust{animation:none}}
`

/** Gag: Nach drei Verlusten in Folge erscheint ein Portemonnaie, wird geschüttelt und es fällt nur Staub heraus. Bleibt, solange gesperrt ist. */
export default function ChipPurse() {
  const { lockUntil, refresh } = useChips()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!lockUntil) return
    setNow(Date.now())
    const t = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(t)
  }, [lockUntil])
  const secs = lockSeconds(lockUntil, now)
  const active = lockUntil > 0 && secs > 0
  useEffect(() => {
    // Nach Ablauf den Serverstand holen (hebt die Sperre in der Anzeige auf).
    if (lockUntil > 0 && secs === 0) void refresh()
  }, [lockUntil, secs, refresh])
  const dust = useMemo(() => Array.from({ length: 16 }, (_, i) => ({ i, dx: Math.round((Math.random() - 0.5) * 70), delay: (i * 0.11) % 1.6, size: 3 + (i % 4) })), [])
  if (!active) return null
  return (
    <div role="alertdialog" aria-live="assertive" aria-label="Portemonnaie leer" className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-4 bg-black/75 px-6 text-center backdrop-blur-sm">
      <style>{CSS}</style>
      <div className="purse-in">
        <div className="purse-shake relative h-40 w-52">
          <svg viewBox="0 0 200 150" className="h-full w-full" aria-hidden>
            <rect x="12" y="34" width="176" height="104" rx="18" fill="#7c4a24" stroke="#4a2a12" strokeWidth="4" />
            <path d="M12 58 Q100 20 188 58" fill="none" stroke="#4a2a12" strokeWidth="4" />
            <rect x="12" y="34" width="176" height="30" rx="14" fill="#8f5a2e" stroke="#4a2a12" strokeWidth="4" />
            <rect x="136" y="70" width="60" height="38" rx="10" fill="#a8703b" stroke="#4a2a12" strokeWidth="4" />
            <circle cx="166" cy="89" r="6" fill="#e5c07b" stroke="#4a2a12" strokeWidth="2" />
            <path d="M30 50 H170" stroke="#c99a5b" strokeWidth="3" strokeDasharray="6 6" opacity=".6" />
          </svg>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center" aria-hidden>
            {dust.map((d) => (
              <span key={d.i} className="purse-dust absolute rounded-full bg-stone-400" style={{ width: d.size, height: d.size, left: `${42 + (d.i % 8) * 2}%`, bottom: 4, animationDelay: `${0.6 + d.delay}s`, ['--dx' as string]: `${d.dx}px` }} />
            ))}
          </div>
        </div>
      </div>
      <p className="text-xl font-bold text-amber-200">Dein Portemonnaie ist leer geschüttelt.</p>
      <p className="max-w-xs text-sm text-slate-300">Drei Verluste in Folge – da fällt nur noch Staub heraus. Kurz durchatmen.</p>
      <p className="font-mono text-3xl text-white" aria-label={`Noch ${secs} Sekunden`}>{secs} s</p>
    </div>
  )
}
