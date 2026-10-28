import { APP_UPDATE } from '../../version'

/** Kleine Versionsanzeige unten auf der Seite (zum Prüfen, ob ein Update angekommen ist). */
export default function VersionTag({ className = '' }: { className?: string }) {
  return (
    <p className={`select-none text-center font-mono text-[11px] tracking-wide text-slate-500 ${className}`} data-testid="app-version">
      Vokabeltrainer · Update {APP_UPDATE}
    </p>
  )
}
