import type { PageEntry } from '../../types'

/**
 * Eine Zeile der Eingabetabelle: links Fremdsprache, rechts Deutsch – beide Seiten können
 * mehrere gleichwertige Lösungen haben. Die erste deutsche Lösung ist das Hauptwort.
 */
export interface EntryRow {
  key: string
  placementId: string | null
  vocabularyId: string | null
  foreign: string[]
  german: string[]
  position: number | null
  status: 'idle' | 'dirty' | 'saving' | 'saved' | 'error'
  error?: string
  /** Stand, der zuletzt in der Datenbank steht (zum Erkennen von Änderungen). */
  savedSnapshot: string
  /** Die Vokabel war schon im Buch vorhanden und wurde zusammengeführt. */
  merged?: boolean
}

export type Side = 'foreign' | 'german'

/** Gleiche Normalisierung wie in der Datenbank (Kleinschreibung, Leerzeichen). */
export function normKey(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Leere Felder entfernen, doppelte Lösungen (ohne Beachtung der Schreibweise) zusammenfassen. */
export function cleanList(list: readonly string[]): string[] {
  const out: string[] = []
  for (const raw of list) {
    const t = raw.trim().replace(/\s+/g, ' ')
    if (t !== '' && !out.some((x) => normKey(x) === normKey(t))) out.push(t)
  }
  return out
}

type Sides = Pick<EntryRow, 'foreign' | 'german'>

export function isRowComplete(row: Sides): boolean {
  return cleanList(row.foreign).length > 0 && cleanList(row.german).length > 0
}

export function isRowEmpty(row: Sides): boolean {
  return cleanList(row.foreign).length === 0 && cleanList(row.german).length === 0
}

export function rowSnapshot(row: Sides): string {
  return JSON.stringify({ f: cleanList(row.foreign), g: cleanList(row.german) })
}

export function isRowDirty(row: EntryRow): boolean {
  return rowSnapshot(row) !== row.savedSnapshot
}

/** Inhalt der Zeile in der Form, in der er gespeichert wird. */
export function toSavePayload(row: Sides): { german: string; germanAlts: string[]; translations: string[] } {
  const [german = '', ...germanAlts] = cleanList(row.german)
  return { german, germanAlts, translations: cleanList(row.foreign) }
}

export function nextPosition(rows: readonly Pick<EntryRow, 'position'>[]): number {
  return rows.reduce((max, r) => Math.max(max, r.position ?? 0), 0) + 1
}

let counter = 0
export function newRowKey(): string {
  counter += 1
  return `row-${Date.now().toString(36)}-${counter}`
}

export function emptyRow(): EntryRow {
  const row: EntryRow = {
    key: newRowKey(),
    placementId: null,
    vocabularyId: null,
    foreign: [''],
    german: [''],
    position: null,
    status: 'idle',
    savedSnapshot: '',
  }
  row.savedSnapshot = rowSnapshot(row)
  return row
}

export function rowsFromEntries(entries: readonly PageEntry[]): EntryRow[] {
  return entries.map((e) => {
    const row: EntryRow = {
      key: newRowKey(),
      placementId: e.placement_id,
      vocabularyId: e.vocabulary_id,
      foreign: e.translations.length > 0 ? [...e.translations] : [''],
      german: [e.german, ...(e.german_alts ?? [])],
      position: e.position,
      status: 'idle',
      savedSnapshot: '',
    }
    row.savedSnapshot = rowSnapshot(row)
    return row
  })
}
