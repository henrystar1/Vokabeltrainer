import { useEffect, useState } from 'react'
import { getLang, initLang, setLang, subscribeLang } from './fr'

/** DE/FR-Umschalter für das Auto-Spiel. */
export default function LangToggle({ className = '' }: { className?: string }) {
  const [l, setL] = useState(getLang())
  useEffect(() => { const u = subscribeLang(() => setL(getLang())); initLang(); setL(getLang()); return u }, [])
  return <button type="button" onClick={() => setLang(l === 'fr' ? 'de' : 'fr')} aria-label={l === 'fr' ? 'Deutsch' : 'Français'} className={`min-h-[40px] rounded-xl border border-white/40 bg-slate-800/80 px-3 text-xs font-bold text-white ${className}`}>{l === 'fr' ? '🇩🇪 DE' : '🇫🇷 FR'}</button>
}
