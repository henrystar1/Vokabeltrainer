import { describe, expect, it } from 'vitest'
import { chunkRows, exportAll, importAll, parseBackup, type BackupApi } from './backup'

function fakeApi(db: Record<string, Record<string, unknown>[]>, log: string[] = []): BackupApi {
  return {
    tables: async () => Object.keys(db).map((name) => ({ name, rows: db[name].length })),
    read: async (t, off, lim) => db[t].slice(off, off + lim),
    clear: async (t) => { log.push(`clear ${t}`); db[t] = [] },
    write: async (t, rows) => {
      for (const r of rows) { const i = db[t].findIndex((x) => x.id === r.id); if (i >= 0) db[t][i] = r; else db[t].push(r) }
      return { rows: rows.length, written: rows.length, skipped: 0 }
    },
  }
}

describe('Backup', () => {
  const mk = () => ({ a: Array.from({ length: 1203 }, (_, i) => ({ id: i, v: `x${i}` })), b: [{ id: 1, t: 'ä"\n' }], leer: [] as Record<string, unknown>[] })

  it('Export → Datei → Parse ergibt dieselben Daten (auch Sonderzeichen, leere Tabellen, >1 Seite)', async () => {
    const db = mk()
    const { parts, counts } = await exportAll(fakeApi(db), 104, () => undefined)
    expect(counts).toEqual({ a: 1203, b: 1, leer: 0 })
    const f = parseBackup(parts.join(''))
    expect(f.tables.a).toHaveLength(1203)
    expect(f.tables.b[0].t).toBe('ä"\n')
    expect(f.tables.leer).toEqual([])
    expect(f.app_update).toBe(104)
  })

  it('Import überschreibt geänderte Daten und ergänzt gelöschte', async () => {
    const src = mk()
    const { parts } = await exportAll(fakeApi(src), 104, () => undefined)
    const live = { a: [{ id: 0, v: 'KAPUTT' }, { id: 5000, v: 'neu' }], b: [], leer: [] as Record<string, unknown>[] }
    const rep = await importAll(fakeApi(live), parseBackup(parts.join('')), false, () => undefined)
    expect(live.a.find((r) => r.id === 0)?.v).toBe('x0')
    expect(live.a.find((r) => r.id === 5000)).toBeTruthy() // nicht ersetzen: Neues bleibt
    expect(live.a).toHaveLength(1204)
    expect(live.b).toHaveLength(1)
    expect(rep.every((r) => !r.error)).toBe(true)
  })

  it('Ersetzen leert vorher; unbekannte Tabellen werden gemeldet', async () => {
    const log: string[] = []
    const live = { a: [{ id: 5000, v: 'neu' }], b: [] as Record<string, unknown>[] }
    const file = parseBackup(JSON.stringify({ format: 'vt-backup-1', created: 'x', tables: { a: [{ id: 1, v: 'x' }], weg: [{ id: 1 }] } }))
    const rep = await importAll(fakeApi(live, log), file, true, () => undefined)
    expect(log).toEqual(['clear a'])
    expect(live.a).toEqual([{ id: 1, v: 'x' }])
    expect(rep.find((r) => r.table === 'weg')?.error).toMatch(/nicht mehr/)
  })

  it('Fehler einer Tabelle stoppen die anderen nicht', async () => {
    const api = fakeApi({ a: [], b: [] })
    const orig = api.write
    api.write = async (t, rows) => { if (t === 'a') throw new Error('kaputt'); return orig(t, rows) }
    const file = parseBackup(JSON.stringify({ format: 'vt-backup-1', created: 'x', tables: { a: [{ id: 1 }], b: [{ id: 2 }] } }))
    const rep = await importAll(api, file, false, () => undefined)
    expect(rep.find((r) => r.table === 'a')?.error).toBe('kaputt')
    expect(rep.find((r) => r.table === 'b')?.written).toBe(1)
  })

  it('weist fremde Dateien ab und teilt große Mengen in Pakete', () => {
    expect(() => parseBackup('kein json')).toThrow(/JSON/)
    expect(() => parseBackup('{"format":"x"}')).toThrow(/keine Backup-Datei/)
    expect(() => parseBackup('{"format":"vt-backup-1","tables":{"a":5}}')).toThrow(/beschädigt/)
    const rows = Array.from({ length: 2500 }, (_, i) => ({ id: i }))
    const ch = chunkRows(rows)
    expect(ch.reduce((a, c) => a + c.length, 0)).toBe(2500)
    expect(ch.every((c) => c.length <= 1000)).toBe(true)
    expect(chunkRows([{ s: 'x'.repeat(500) }, { s: 'y'.repeat(500) }], 600)).toHaveLength(2)
  })
})

describe('Backup mit Konten', () => {
  it('schreibt _auth ans Ende und parseBackup liest es', async () => {
    const db = { a: [{ id: 1 }] }
    const auth = { users: [{ id: 'u1', email: 'a@b.de' }], identities: [], admins: ['u1'] }
    const { parts, counts } = await exportAll(fakeApi(db), 107, () => undefined, async () => auth)
    const f = parseBackup(parts.join(''))
    expect(f._auth).toEqual(auth)
    expect(f.tables.a).toHaveLength(1)
    expect(counts._konten).toBe(1)
  })
  it('ohne Konten bleibt _auth leer; kaputter Konten-Teil wird abgelehnt', async () => {
    const { parts } = await exportAll(fakeApi({ a: [] }), 107, () => undefined)
    expect(parseBackup(parts.join(''))._auth).toBeUndefined()
    expect(() => parseBackup('{"format":"vt-backup-1","tables":{},"_auth":{"users":1}}')).toThrow()
  })
})
