import type { BackupTable, WriteResult } from '../../services/backup'

export const BACKUP_FORMAT = 'vt-backup-1'
const READ_CHUNK = 500
const WRITE_BYTES = 700_000

export interface BackupApi {
  tables: () => Promise<BackupTable[]>
  read: (table: string, off: number, lim: number) => Promise<Record<string, unknown>[]>
  clear: (table: string) => Promise<void>
  write: (table: string, rows: Record<string, unknown>[]) => Promise<WriteResult>
}
export interface BackupFile { format: string; created: string; app_update?: number; tables: Record<string, Record<string, unknown>[]> }
export type Progress = (text: string, done: number, total: number) => void

/** Liest alle Tabellen seitenweise und baut daraus die Backup-Datei (als Blob-Teile, damit nichts riesig im Speicher liegt). */
export async function exportAll(api: BackupApi, appUpdate: number, onProgress: Progress): Promise<{ parts: string[]; counts: Record<string, number> }> {
  const tables = await api.tables()
  const total = tables.reduce((a, t) => a + t.rows, 0)
  let done = 0
  const counts: Record<string, number> = {}
  const parts: string[] = [`{"format":${JSON.stringify(BACKUP_FORMAT)},"created":${JSON.stringify(new Date().toISOString())},"app_update":${appUpdate},"tables":{`]
  let firstTable = true
  for (const t of tables) {
    parts.push(`${firstTable ? '' : ','}${JSON.stringify(t.name)}:[`)
    firstTable = false
    let off = 0
    let n = 0
    for (;;) {
      const rows = await api.read(t.name, off, READ_CHUNK)
      if (rows.length === 0) break
      parts.push((n ? ',' : '') + JSON.stringify(rows).slice(1, -1))
      n += rows.length; off += rows.length; done += rows.length
      onProgress(`${t.name}: ${n} / ${t.rows}`, done, total)
      if (rows.length < READ_CHUNK) break
    }
    counts[t.name] = n
    parts.push(']')
  }
  parts.push('}}')
  return { parts, counts }
}

export function parseBackup(text: string): BackupFile {
  let j: unknown
  try { j = JSON.parse(text) } catch { throw new Error('Die Datei ist kein gültiges Backup (kein lesbares JSON).') }
  const f = j as Partial<BackupFile> | null
  if (!f || f.format !== BACKUP_FORMAT || typeof f.tables !== 'object' || f.tables === null) throw new Error('Das ist keine Backup-Datei des Vokabeltrainers.')
  for (const [k, v] of Object.entries(f.tables)) if (!Array.isArray(v)) throw new Error(`Tabelle „${k}“ in der Datei ist beschädigt.`)
  return f as BackupFile
}

/** Teilt Zeilen in Pakete von ungefähr WRITE_BYTES. */
export function chunkRows(rows: Record<string, unknown>[], maxBytes = WRITE_BYTES): Record<string, unknown>[][] {
  const out: Record<string, unknown>[][] = []
  let cur: Record<string, unknown>[] = []
  let size = 0
  for (const r of rows) {
    const s = JSON.stringify(r).length
    if (cur.length > 0 && (size + s > maxBytes || cur.length >= 1000)) { out.push(cur); cur = []; size = 0 }
    cur.push(r); size += s
  }
  if (cur.length) out.push(cur)
  return out
}

export interface ImportReport { table: string; rows: number; written: number; skipped: number; error?: string }

/** Spielt die Datei ein. replace=true leert jede Tabelle vorher (komplett ersetzen), sonst werden Zeilen überschrieben/ergänzt. */
export async function importAll(api: BackupApi, file: BackupFile, replace: boolean, onProgress: Progress): Promise<ImportReport[]> {
  const known = await api.tables()
  const names = known.map((t) => t.name).filter((n) => n in file.tables)
  const total = names.reduce((a, n) => a + file.tables[n].length, 0)
  let done = 0
  const report: ImportReport[] = []
  for (const name of names) {
    const rows = file.tables[name]
    const rep: ImportReport = { table: name, rows: rows.length, written: 0, skipped: 0 }
    try {
      if (replace) await api.clear(name)
      for (const part of chunkRows(rows)) {
        const r = await api.write(name, part)
        rep.written += r.written; rep.skipped += r.skipped; done += part.length
        onProgress(`${name}: ${rep.written + rep.skipped} / ${rows.length}`, done, total)
      }
    } catch (e) {
      rep.error = e instanceof Error ? e.message : String(e)
    }
    report.push(rep)
  }
  for (const n of Object.keys(file.tables)) if (!names.includes(n)) report.push({ table: n, rows: file.tables[n].length, written: 0, skipped: file.tables[n].length, error: 'Tabelle gibt es nicht mehr (übersprungen).' })
  return report
}
