import type { PageEntry } from '../../types'

/** Eine Zeile der Eingabetabelle (Deutsch | Lösungen). */
export interface EntryRow {
  key: string
  placementId: string | null
  vocabularyId: string | null
  german: string
  translations: string[]
  position: number | null
  status: 'idle' | 'dirty' | 'saving' | 'saved' | 'error'
  error?: string
  /** Stand, der zuletzt in der Datenbank steht (zum Erkennen von Änderungen). */
  savedSnapshot: string
  /** Ausgabe nach dem Speichern: Vokabel war schon im Buch vorhanden und wurde zusammengeführt. */
  merged?: boolean
}

/** Gleiche Normalisierung wie in der Datenbank (Kleinschreibung, Leerzeichen). */
export function normKey(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Leere Felder entfernen, doppelte Lösungen (ohne Beachtung der Schreibweise) zusammenfassen. */
export function cleanTranslations(list: readonly string[]): string[] {
  const out: string[] = []
  for (const raw of list) {
    const t = raw.trim()
    if (t !== '' && !out.some((x) => normKey(x) === normKey(t))) out.push(t)
  }
  return out
}

export function isRowComplete(row: Pick<EntryRow, 'german' | 'translations'>): boolean {
  return row.german.trim() !== '' && cleanTranslations(row.translations).length > 0
}

export function rowSnapshot(row: Pick<EntryRow, 'german' | 'translations'>): string {
  return JSON.stringify({ g: row.german.trim(), t: cleanTranslations(row.translations) })
}

export function isRowDirty(row: EntryRow): boolean {
  return rowSnapshot(row) !== row.savedSnapshot
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
    german: '',
    translations: [''],
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
      german: e.german,
      translations: e.translations.length > 0 ? [...e.translations] : [''],
      position: e.position,
      status: 'idle',
      savedSnapshot: '',
    }
    row.savedSnapshot = rowSnapshot(row)
    return row
  })
}
