import { useRef, useState } from 'react'
import { Download, Upload } from 'lucide-react'
import { errorMessage } from '../../lib/errors'
import { APP_UPDATE } from '../../version'
import { backupClear, backupRead, backupTables, backupWrite } from '../../services/backup'
import { exportAll, importAll, parseBackup, type BackupApi, type BackupFile, type ImportReport } from '../../features/backup/backup'

const api: BackupApi = { tables: backupTables, read: backupRead, clear: backupClear, write: backupWrite }

/** Admin: Komplett-Backup herunterladen und wiederherstellen. */
export default function BackupTab() {
  const [busy, setBusy] = useState(false)
  const [prog, setProg] = useState<{ text: string; done: number; total: number } | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [file, setFile] = useState<{ name: string; data: BackupFile } | null>(null)
  const [replace, setReplace] = useState(false)
  const [confirm, setConfirm] = useState('')
  const [report, setReport] = useState<ImportReport[] | null>(null)
  const input = useRef<HTMLInputElement>(null)

  async function download() {
    setBusy(true); setMsg(null); setReport(null)
    try {
      const { parts, counts } = await exportAll(api, APP_UPDATE, (text, done, total) => setProg({ text, done, total }))
      const blob = new Blob(parts, { type: 'application/json' })
      const a = document.createElement('a')
      const day = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-')
      a.href = URL.createObjectURL(blob); a.download = `vokabeltrainer-backup-${day}.json`
      document.body.appendChild(a); a.click(); a.remove()
      window.setTimeout(() => URL.revokeObjectURL(a.href), 60_000)
      const n = Object.values(counts).reduce((x, y) => x + y, 0)
      setMsg(`Backup erstellt: ${Object.keys(counts).length} Tabellen, ${n.toLocaleString('de-DE')} Zeilen, ${(blob.size / 1024 / 1024).toFixed(1).replace('.', ',')} MB. Bewahre die Datei sicher auf.`)
    } catch (e) { setMsg(errorMessage(e)) } finally { setBusy(false); setProg(null) }
  }

  async function pick(f: File | undefined) {
    setMsg(null); setReport(null); setFile(null); setConfirm('')
    if (!f) return
    try { setFile({ name: f.name, data: parseBackup(await f.text()) }) } catch (e) { setMsg(errorMessage(e)) }
  }

  async function restore() {
    if (!file) return
    setBusy(true); setMsg(null); setReport(null)
    try {
      const rep = await importAll(api, file.data, replace, (text, done, total) => setProg({ text, done, total }))
      setReport(rep)
      const bad = rep.filter((r) => r.error).length
      setMsg(bad ? `Fertig, aber ${bad} Tabelle(n) mit Fehlern (siehe unten).` : 'Wiederherstellung abgeschlossen. Lade die Seite neu.')
    } catch (e) { setMsg(errorMessage(e)) } finally { setBusy(false); setProg(null) }
  }

  const total = file ? Object.values(file.data.tables).reduce((a, r) => a + r.length, 0) : 0
  const ok = !replace || confirm.trim() === 'WIEDERHERSTELLEN'
  return (
    <div className="max-w-2xl space-y-5">
      <section className="glass space-y-2 rounded-2xl p-4">
        <h2 className="font-semibold">Backup herunterladen</h2>
        <p className="text-sm text-slate-400">Eine Datei mit allem, was in der Datenbank steht: Bücher, Vokabeln, Fortschritt, Coins, Shop, Chat, Einstellungen, Online-Spiele und mehr (neue Tabellen sind automatisch dabei). Nicht enthalten sind die Anmeldedaten (E-Mail und Passwort), die bleiben bei Supabase. Hebe die Datei zusätzlich außerhalb des Browsers auf, z. B. in der Cloud.</p>
        <button type="button" disabled={busy} onClick={() => void download()} className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-accent-cyan px-4 font-semibold text-slate-950 disabled:opacity-40"><Download size={16} />Backup jetzt herunterladen</button>
      </section>
      <section className="glass space-y-3 rounded-2xl p-4">
        <h2 className="font-semibold">Backup wiederherstellen</h2>
        <p className="text-sm text-slate-400">Vorhandene Zeilen werden mit dem Stand aus der Datei überschrieben, fehlende werden ergänzt. Zeilen für Konten, die es nicht mehr gibt, werden übersprungen. Lade vorher ein neues Backup herunter, falls der aktuelle Stand noch wichtig ist.</p>
        <input ref={input} type="file" accept=".json,application/json" onChange={(e) => void pick(e.target.files?.[0])} className="block w-full text-sm" aria-label="Backup-Datei wählen" />
        {file && (
          <div className="space-y-2 rounded-xl bg-white/5 p-3 text-sm">
            <p><b>{file.name}</b> · erstellt {new Date(file.data.created).toLocaleString('de-DE')} · {Object.keys(file.data.tables).length} Tabellen · {total.toLocaleString('de-DE')} Zeilen</p>
            <label className="flex min-h-[44px] items-center gap-2"><input type="checkbox" checked={replace} onChange={(e) => { setReplace(e.target.checked); setConfirm('') }} className="h-5 w-5" /><span>Komplett ersetzen: Tabellen vorher leeren (Zeilen, die nicht im Backup stehen, gehen verloren)</span></label>
            {replace && <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Zur Bestätigung WIEDERHERSTELLEN tippen" className="min-h-[44px] w-full rounded-lg border border-white/15 bg-space-900/60 px-3" aria-label="Bestätigung" />}
            <button type="button" disabled={busy || !ok} onClick={() => { if (confirmRestore(replace)) void restore() }} className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-amber-500 px-4 font-semibold text-slate-950 disabled:opacity-40"><Upload size={16} />Jetzt wiederherstellen</button>
          </div>
        )}
      </section>
      {prog && (
        <div role="status" aria-live="polite">
          <div className="h-2 overflow-hidden rounded bg-white/10"><div className="h-full bg-accent-cyan" style={{ width: `${prog.total ? (prog.done / prog.total) * 100 : 0}%` }} /></div>
          <p className="mt-1 text-xs text-slate-400">{prog.text}</p>
        </div>
      )}
      {msg && <p className="text-sm text-slate-200" role="status">{msg}</p>}
      {report && (
        <ul className="max-h-72 space-y-0.5 overflow-y-auto rounded-xl bg-black/30 p-3 text-xs">
          {report.map((r) => <li key={r.table} className={r.error ? 'text-rose-300' : 'text-slate-300'}>{r.table}: {r.written} geschrieben{r.skipped ? `, ${r.skipped} übersprungen` : ''}{r.error ? ` – Fehler: ${r.error}` : ''}</li>)}
        </ul>
      )}
    </div>
  )
}

function confirmRestore(replace: boolean): boolean {
  return window.confirm(replace ? 'Wirklich KOMPLETT ersetzen? Daten, die nicht im Backup stehen, gehen verloren.' : 'Backup jetzt einspielen und vorhandene Daten überschreiben?')
}
