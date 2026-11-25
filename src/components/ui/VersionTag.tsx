import { useState } from 'react'
import { APP_UPDATE } from '../../version'
import { forceUpdate } from '../../lib/serviceWorker'

/** Kleine Versionsanzeige unten auf der Seite (zum Prüfen, ob ein Update angekommen ist); mit Knopf, der die neueste Version erzwingt. */
export default function VersionTag({ className = '', withButton = false }: { className?: string; withButton?: boolean }) {
  const [busy, setBusy] = useState(false)
  return (
    <div className={`select-none text-center font-mono text-[11px] tracking-wide text-slate-500 ${className}`} data-testid="app-version">
      <p>Vokabeltrainer · Update {APP_UPDATE}</p>
      {withButton && (
        <button type="button" disabled={busy} onClick={() => { setBusy(true); void forceUpdate() }} className="pointer-events-auto mt-2 min-h-[36px] rounded-lg border border-white/20 px-3 font-sans text-xs text-slate-300 hover:bg-white/10">
          {busy ? 'Lädt neu …' : '↻ Auf Updates prüfen / Seite neu laden'}
        </button>
      )}
    </div>
  )
}
