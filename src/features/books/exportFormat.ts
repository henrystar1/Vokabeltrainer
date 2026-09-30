import type { BookExport } from '../../types'

export const MAX_EXPORT_VOCAB = 20000

export interface ExportSummary {
  name: string
  language: string
  description: string | null
  unitCount: number
  pageCount: number
  entryCount: number
  distinctVocabCount: number
  /** Die ersten Einträge für die Vorschau. */
  preview: Array<{ unit: number; page: number; german: string; translations: string[] }>
}

export type ExportValidation =
  | { ok: true; data: BookExport; summary: ExportSummary }
  | { ok: false; errors: string[] }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isInt = (v: unknown, min: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= 999999
const key = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * Prüft eine Exportdatei vor dem Import (dieselben Regeln wie die Datenbankfunktion import_book,
 * damit die Vorschau Fehler früh und verständlich meldet). Sammelt bis zu 15 Fehler.
 */
export function validateBookExport(input: unknown, knownLanguages: readonly string[]): ExportValidation {
  const errors: string[] = []
  const add = (msg: string) => {
    if (errors.length < 15) errors.push(msg)
  }

  if (!isObject(input) || input.format !== 'vokabeltrainer-book') {
    return { ok: false, errors: ['Das ist keine gültige Vokabeltrainer-Datei.'] }
  }
  if (input.version !== 1) return { ok: false, errors: ['Diese Dateiversion wird nicht unterstützt.'] }

  const book = input.book
  if (!isObject(book)) return { ok: false, errors: ['Buchangaben fehlen.'] }
  const name = typeof book.name === 'string' ? book.name.trim() : ''
  if (name === '') add('Das Buch braucht einen Namen.')
  if (name.length > 120) add('Der Buchname ist zu lang (maximal 120 Zeichen).')
  const language = typeof book.language === 'string' ? book.language : ''
  if (!knownLanguages.includes(language)) add(`Unbekannte Sprache: ${language || '(leer)'}.`)
  if (!Array.isArray(input.units)) return { ok: false, errors: [...errors, 'Die Datei enthält keine Units.'] }

  const seenUnits = new Set<number>()
  const seenPages = new Set<number>()
  const vocabKeys = new Set<string>()
  const preview: ExportSummary['preview'] = []
  let entryCount = 0
  let pageCount = 0

  for (const unit of input.units as unknown[]) {
    if (!isObject(unit) || !isInt(unit.number, 0)) {
      add('Eine Unit hat keine gültige Nummer.')
      continue
    }
    if (seenUnits.has(unit.number)) add(`Unit ${unit.number} kommt mehrfach vor.`)
    seenUnits.add(unit.number)

    const pages = unit.pages ?? []
    if (!Array.isArray(pages)) {
      add(`Unit ${unit.number}: Seiten haben ein ungültiges Format.`)
      continue
    }
    for (const page of pages as unknown[]) {
      if (!isObject(page) || !isInt(page.number, 1)) {
        add(`Unit ${unit.number}: Eine Seite hat keine gültige Nummer.`)
        continue
      }
      if (seenPages.has(page.number)) add(`Seite ${page.number} kommt mehrfach vor.`)
      seenPages.add(page.number)
      pageCount++

      const vocab = page.vocabulary ?? []
      if (!Array.isArray(vocab)) {
        add(`Seite ${page.number}: Vokabeln haben ein ungültiges Format.`)
        continue
      }
      ;(vocab as unknown[]).forEach((entry, i) => {
        entryCount++
        if (
          !isObject(entry) ||
          typeof entry.german !== 'string' ||
          entry.german.trim() === '' ||
          entry.german.trim().length > 200 ||
          !Array.isArray(entry.translations)
        ) {
          add(`Seite ${page.number}: Ungültige Vokabel (Eintrag ${i + 1}).`)
          return
        }
        const german = entry.german.trim()
        const alts = entry.german_alts
        if (
          alts !== undefined &&
          alts !== null &&
          (!Array.isArray(alts) || alts.some((a) => typeof a !== 'string' || a.trim().length > 200))
        ) {
          add(`Seite ${page.number}: Die weiteren deutschen Lösungen von „${german}“ sind ungültig.`)
          return
        }
        const translations: string[] = []
        for (const t of entry.translations as unknown[]) {
          if (typeof t !== 'string') {
            add(`Seite ${page.number}: Übersetzungen von „${german}“ müssen Text sein.`)
            return
          }
          const tt = t.trim()
          if (tt.length > 200) {
            add(`Seite ${page.number}: Eine Übersetzung von „${german}“ ist zu lang.`)
            return
          }
          if (tt !== '' && !translations.some((x) => key(x) === key(tt))) translations.push(tt)
        }
        if (translations.length === 0) {
          add(`Seite ${page.number}: „${german}“ hat keine Übersetzung.`)
          return
        }
        vocabKeys.add(key(german))
        if (preview.length < 8) preview.push({ unit: unit.number as number, page: page.number as number, german, translations })
      })
    }
  }

  if (entryCount > MAX_EXPORT_VOCAB) add(`Die Datei enthält zu viele Vokabeln (Maximum ${MAX_EXPORT_VOCAB}).`)
  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    data: input as unknown as BookExport,
    summary: {
      name,
      language,
      description: typeof book.description === 'string' && book.description.trim() ? book.description.trim() : null,
      unitCount: seenUnits.size,
      pageCount,
      entryCount,
      distinctVocabCount: vocabKeys.size,
      preview,
    },
  }
}

/** Dateiname für den Download, z. B. "green-line-3.vokabeltrainer.json". */
export function exportFileName(bookName: string): string {
  const slug = bookName
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'buch'}.vokabeltrainer.json`
}
