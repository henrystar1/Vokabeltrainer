import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles, X } from 'lucide-react'
import { usePlus } from './PlusProvider'

const TEXTS: Record<string, string> = {
  dashboard: 'Mit Plus bekommst du Coins ×1,5, mehr Quests und Grammatik-Blätter mit KI.',
  learn: 'Mit Plus: Coins ×1,5 beim Lernen und gelernte Vokabeln sofort wieder fällig machen.',
  games: 'Mit Plus bekommst du schönere Spielgrafik und kannst nach dem Game over weiterspielen (ohne Rekord).',
  gambling: 'Mit Plus ist deine Gewinnchance beim Gambling höher.',
  quests: 'Plus schaltet zusätzliche Quests mit größeren Belohnungen frei.',
  shop: 'Plus-Artikel: animierte Profilbilder, Farben, Effekte und Designs.',
  league: 'Mit Plus zählen deine Ranglistenpunkte ×1,5.',
  profile: 'Mit Plus bekommst du ein „+“-Tag und besondere Profilbilder.',
}

const KEY = (ctx: string) => `plus-hint-${ctx}`
const DAY = 86_400_000

function dismissed(ctx: string): boolean {
  try {
    const t = Number(window.localStorage.getItem(KEY(ctx)))
    return Number.isFinite(t) && t > Date.now() - DAY
  } catch {
    return false
  }
}

/** Kleiner, unaufdringlicher Hinweis am Seitenende. Wird für 24 Stunden ausgeblendet, wenn man ihn wegklickt. Mit Plus erscheint er nie. */
export default function PlusHint({ ctx }: { ctx: keyof typeof TEXTS | string }) {
  const { status, active } = usePlus()
  const [hidden, setHidden] = useState(() => dismissed(ctx))
  if (!status || active || hidden) return null
  return (
    <aside className="no-print mt-8 flex items-center gap-3 rounded-xl border border-fuchsia-400/20 bg-fuchsia-400/[0.06] px-3 py-2 text-xs text-fuchsia-100/90" aria-label="Hinweis auf Vokabeltrainer Plus">
      <Sparkles size={14} className="shrink-0 text-fuchsia-300" aria-hidden />
      <span className="min-w-0 flex-1">{TEXTS[ctx] ?? TEXTS.dashboard}</span>
      <Link to="/plus" className="shrink-0 rounded-lg px-2 py-1 font-medium text-fuchsia-200 hover:bg-white/10">Ansehen</Link>
      <button
        type="button"
        aria-label="Hinweis ausblenden"
        className="shrink-0 rounded p-1 text-fuchsia-200/70 hover:bg-white/10"
        onClick={() => { try { window.localStorage.setItem(KEY(ctx), String(Date.now())) } catch { /* egal */ } setHidden(true) }}
      >
        <X size={14} />
      </button>
    </aside>
  )
}
