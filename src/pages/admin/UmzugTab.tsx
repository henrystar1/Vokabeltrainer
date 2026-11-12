import { useState } from 'react'
import { Download } from 'lucide-react'
import { backendSource } from '../../lib/supabaseClient'
import { cleanBackend, hasBackendOverride, looksSecret, resolveBackend, setBackendOverride } from '../../lib/backendConfig'

/** Admin: Zugang zu einem anderen Supabase-Projekt eintragen (Umzug). */
export default function UmzugTab() {
  const cur = resolveBackend()
  const [url, setUrl] = useState('')
  const [key, setKey] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  function check() {
    if (looksSecret(key)) { setMsg('Das ist ein geheimer Key (secret/service_role). Der darf nie in die Website. Nimm den „Publishable“-/anon-Key.'); return null }
    const b = cleanBackend({ url, key })
    if (!b) { setMsg('URL (https://…supabase.co) oder Key sehen nicht richtig aus.'); return null }
    return b
  }
  function useHere() {
    const b = check(); if (!b) return
    setBackendOverride(b)
    window.location.reload()
  }
  function downloadFile() {
    const b = check(); if (!b) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([JSON.stringify(b, null, 2) + '\n'], { type: 'application/json' }))
    a.download = 'backend.json'
    document.body.appendChild(a); a.click(); a.remove()
    setMsg('backend.json heruntergeladen. Lege sie ins Repository unter public/backend.json (ersetzt die vorhandene), dann nutzen nach dem Deploy alle das neue Projekt.')
  }
  function reset() { setBackendOverride(null); window.location.reload() }

  return (
    <div className="max-w-2xl space-y-5">
      <section className="glass space-y-2 rounded-2xl p-4">
        <h2 className="font-semibold">Aktuelles Projekt</h2>
        <p className="text-sm text-slate-300 break-all">{cur.url || '(keins)'} · Quelle: {backendSource === 'browser' ? 'nur dieser Browser' : backendSource === 'datei' ? 'public/backend.json' : 'Build-Einstellung'}</p>
        {hasBackendOverride() && <button type="button" onClick={reset} className="min-h-[44px] rounded-lg bg-white/10 px-4 text-sm">Browser-Einstellung entfernen</button>}
      </section>
      <section className="glass space-y-3 rounded-2xl p-4">
        <h2 className="font-semibold">Neues Projekt eintragen</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-400">
          <li>Backup mit Häkchen „Konten mitnehmen“ herunterladen (Tab Backup).</li>
          <li>Im neuen Supabase-Projekt <b>ALLE_MIGRATIONEN_in_einem.sql</b> im SQL-Editor ausführen.</li>
          <li>Hier URL und Publishable Key des neuen Projekts eintragen und übernehmen.</li>
          <li>Die Seite öffnet sich neu; geh auf <b>/umzug</b>, wähle die Backup-Datei (Konten einspielen), melde dich als Admin an und spiele unter Backup alles ein.</li>
        </ol>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxxx.supabase.co" aria-label="Projekt-URL" className="min-h-[44px] w-full rounded-lg border border-white/15 bg-space-900/60 px-3" />
        <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="Publishable Key (sb_publishable_…)" aria-label="Publishable Key" className="min-h-[44px] w-full rounded-lg border border-white/15 bg-space-900/60 px-3" />
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={useHere} className="min-h-[44px] rounded-lg bg-accent-cyan px-4 font-semibold text-slate-950">Nur in diesem Browser nutzen</button>
          <button type="button" onClick={downloadFile} className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-white/10 px-4"><Download size={16} />backend.json für GitHub</button>
        </div>
        {msg && <p className="text-sm text-amber-300" role="status">{msg}</p>}
      </section>
    </div>
  )
}
