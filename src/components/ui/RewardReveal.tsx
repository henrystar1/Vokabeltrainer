import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import ItemPreview, { type PreviewItem } from '../shop/ItemPreview'
import CoinIcon from './CoinIcon'
import { useAuth } from '../../features/auth/AuthProvider'

/** Eine Belohnung, die beim Öffnen gezeigt wird. */
export type Reward =
  | { type: 'coins'; amount: number }
  | { type: 'points'; amount: number }
  | { type: 'plus'; days: number }
  | { type: 'item'; item: PreviewItem }

export interface RevealProps {
  rewards: Reward[]
  /** Überschrift, z. B. „Türchen 5“ oder „Gekauft!“ */
  title: string
  /** Mit Geschenkbox (Aufmach-Animation) oder gleich offen (z. B. nach einem Kauf). */
  gift?: boolean
  onClose: () => void
}

const CSS = `
@keyframes rv-shake{0%,100%{transform:rotate(0)}20%{transform:rotate(-8deg) scale(1.05)}40%{transform:rotate(8deg) scale(1.08)}60%{transform:rotate(-6deg) scale(1.1)}80%{transform:rotate(6deg) scale(1.1)}}
@keyframes rv-lid{0%{transform:translateY(0) rotate(0);opacity:1}100%{transform:translateY(-90px) rotate(-25deg);opacity:0}}
@keyframes rv-pop{0%{transform:scale(.2) translateY(30px);opacity:0}60%{transform:scale(1.15) translateY(-6px);opacity:1}100%{transform:scale(1) translateY(0);opacity:1}}
@keyframes rv-spark{0%{transform:translate(0,0) scale(.4);opacity:1}100%{transform:translate(var(--dx),var(--dy)) scale(1);opacity:0}}
@keyframes rv-glow{0%,100%{box-shadow:0 0 30px 4px rgba(250,204,21,.35)}50%{box-shadow:0 0 60px 14px rgba(250,204,21,.6)}}
@media (prefers-reduced-motion: reduce){.rv-a{animation-duration:.01s!important;animation-delay:0s!important}}
`

const SPARKS = Array.from({ length: 18 }, (_, i) => {
  const a = (i / 18) * Math.PI * 2
  const r = 90 + (i % 3) * 30
  return { dx: Math.round(Math.cos(a) * r), dy: Math.round(Math.sin(a) * r), e: ['✨', '⭐', '🎉', '💫'][i % 4] }
})

function RewardCard({ r, delay }: { r: Reward; delay: number }) {
  const { displayName, cosmetics } = useAuth()
  const style = { animation: `rv-pop .6s cubic-bezier(.2,1.2,.4,1) ${delay}s both` }
  const base = 'rv-a flex min-w-[8rem] flex-col items-center gap-2 rounded-2xl border border-white/15 bg-white/5 p-4'
  if (r.type === 'coins') return <div className={base} style={style}><CoinIcon size={44} /><b className="text-xl text-yellow-300">+{r.amount.toLocaleString('de-DE')}</b><span className="text-xs text-slate-400">Coins</span></div>
  if (r.type === 'points') return <div className={base} style={style}><span className="text-4xl">🏆</span><b className="text-xl text-emerald-300">+{r.amount}</b><span className="text-xs text-slate-400">Punkte</span></div>
  if (r.type === 'plus') return <div className={base} style={style}><span className="text-4xl">💎</span><b className="text-xl text-violet-300">{r.days} {r.days === 1 ? 'Tag' : 'Tage'}</b><span className="text-xs text-slate-400">Plus</span></div>
  return (
    <div className={`${base} min-w-[10rem]`} style={style}>
      <ItemPreview item={r.item} name={displayName || 'Du'} cosmetics={cosmetics} />
      <b className="text-sm">{r.item.name ?? r.item.id}</b>
      <span className="text-xs text-slate-400">Neu im Besitz</span>
    </div>
  )
}

/** Vollbild-Animation: Geschenk wackelt, öffnet sich, die Belohnungen springen heraus. */
export default function RewardReveal({ rewards, title, gift = true, onClose }: RevealProps) {
  const [open, setOpen] = useState(!gift)
  useEffect(() => {
    if (open) return
    const t = window.setTimeout(() => setOpen(true), 1400)
    return () => window.clearTimeout(t)
  }, [open])
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" onMouseDown={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <style>{CSS}</style>
      <div className="relative flex w-full max-w-lg flex-col items-center gap-5 text-center" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="text-2xl font-bold text-white">{title}</h2>
        {!open ? (
          <button className="rv-a text-8xl" style={{ animation: 'rv-shake 1.4s ease-in-out both' }} onClick={() => setOpen(true)} aria-label="Geschenk öffnen">🎁</button>
        ) : (
          <>
            <div className="relative flex min-h-[3rem] items-center justify-center">
              {gift && <span className="rv-a absolute -top-4 text-7xl" style={{ animation: 'rv-lid .8s ease-out both' }}>🎁</span>}
              {SPARKS.map((s, i) => (
                <span key={i} aria-hidden className="rv-a pointer-events-none absolute text-xl" style={{ ['--dx' as string]: `${s.dx}px`, ['--dy' as string]: `${s.dy}px`, animation: `rv-spark 1.1s ease-out ${(i % 6) * 0.05}s both` }}>{s.e}</span>
              ))}
            </div>
            <div className="flex flex-wrap items-stretch justify-center gap-3">
              {rewards.map((r, i) => <RewardCard key={i} r={r} delay={0.15 + i * 0.25} />)}
            </div>
            <button className="rv-a mt-2 rounded-xl bg-accent-500/90 px-6 py-2 font-semibold text-white hover:bg-accent-500" style={{ animation: `rv-pop .4s ease-out ${0.4 + rewards.length * 0.25}s both` }} onClick={onClose}>Super!</button>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
