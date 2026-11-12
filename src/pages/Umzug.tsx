import { useState } from 'react'
import { Link } from 'react-router-dom'
import { errorMessage } from '../lib/errors'
import { backendSource } from '../lib/supabaseClient'
import { resolveBackend } from '../lib/backendConfig'
import { migrationBootstrap } from '../services/backup'
import { parseBackup } from '../features/backup/backup'

/** Öffentlich: Konten aus der Backup-Datei in ein neues, leeres Projekt einspielen (nur möglich, solange dort noch niemand registriert ist). */
export default function Umzug() {
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const url = resolveBackend().url

  async function pick(f: File | undefined) {
    if (!f) return
    setBusy(true); setMsg(null)
    try {
      const b = parseBackup(await f.text())
      if (!b._auth) throw new Error('In dieser Datei sind keine Konten. Lade das Backup mit Häkchen „Konten mitnehmen“ herunter.')
      const r = await migrationBootstrap(b._auth)
      setDone(true)
      setMsg(`${r.users} Konten übernommen. Melde dich jetzt mit deiner alten Admin-E-Mail und deinem Passwort an und spiele unter Admin → Backup dieselbe Datei ein.`)
    } catch (e) { setMsg(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <main className="mx-auto max-w-xl space-y-4 p-4">
      <h1 className="text-xl font-bold">Umzug: Konten einspielen</h1>
      <p className="text-sm text-slate-300 break-all">Ziel-Projekt: {url || '(keins eingestellt)'} · Quelle: {backendSource}</p>
      <p className="text-sm text-slate-400">Das geht nur in einem neuen, leeren Projekt (nach dem Ausführen der SQL-Datei, ohne Registrierungen). Die Datei enthält Passwort-Hashes – nicht weitergeben.</p>
      <input type="file" accept=".json,application/json" disabled={busy || done} onChange={(e) => void pick(e.target.files?.[0])} aria-label="Backup-Datei mit Konten" className="block w-full text-sm" />
      {msg && <p className="text-sm text-slate-200" role="status">{msg}</p>}
      {done && <Link to="/anmelden" className="inline-flex min-h-[44px] items-center rounded-lg bg-accent-cyan px-4 font-semibold text-slate-950">Zur Anmeldung</Link>}
    </main>
  )
}
