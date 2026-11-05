import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { emptyLegal, loadLegal, type LegalInfo } from '../../lib/legalInfo'

/** Wert aus rechtliches.txt oder ein rotes Platzhalter-Feld, falls noch leer. */
export function V({ v, label }: { v: string; label: string }) {
  return v ? <>{v}</> : <mark className="rounded bg-rose-500/30 px-1 text-rose-200">[{label} fehlt in rechtliches.txt]</mark>
}

export function useLegal(): LegalInfo | null {
  const [info, setInfo] = useState<LegalInfo | null>(null)
  useEffect(() => { let c = false; void loadLegal().then((i) => !c && setInfo(i)).catch(() => !c && setInfo(emptyLegal())); return () => { c = true } }, [])
  return info
}

/** Rahmen für Seiten, die auch ohne Anmeldung erreichbar sind. */
export default function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <nav className="mb-6 flex flex-wrap gap-4 text-sm">
        <Link to="/" className="text-accent-cyan hover:underline">← Zur App</Link>
        <Link to="/impressum" className="text-slate-400 hover:text-white">Impressum</Link>
        <Link to="/datenschutz" className="text-slate-400 hover:text-white">Datenschutz</Link>
      </nav>
      <h1 className="mb-5 text-3xl font-semibold">{title}</h1>
      <div className="space-y-4 text-sm leading-relaxed text-slate-300 [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-white [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">{children}</div>
    </main>
  )
}

/** Kleine Links für Anmeldeseiten und Menü. */
export function LegalLinks({ className = '' }: { className?: string }) {
  return (
    <p className={`flex justify-center gap-4 text-xs text-slate-500 ${className}`}>
      <Link to="/impressum" className="hover:text-white">Impressum</Link>
      <Link to="/datenschutz" className="hover:text-white">Datenschutz</Link>
    </p>
  )
}
