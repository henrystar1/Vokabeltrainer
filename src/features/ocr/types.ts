/**
 * Foto-Einlesung der Wortlisten-Seiten (Buch: "Liste des mots", Französisch).
 *
 * Ablauf: Foto → Bild aufbereiten → Texterkennung im Browser (Tesseract, kostenlos, ohne API-Schlüssel)
 * → Spalten/Zeilen zuordnen → Prüfansicht → Speichern über save_vocab_entry.
 * Das Foto wird nur im Arbeitsspeicher verarbeitet und nirgends hochgeladen oder gespeichert.
 */

/** Ein erkanntes Wort mit Position (Pixel) und Sicherheit (0–100). */
export interface OcrWord {
  text: string
  x0: number
  y0: number
  x1: number
  y1: number
  conf: number
}

/** Eine eingelesene Vokabelzeile; beide Seiten können mehrere gleichwertige Lösungen haben. */
export interface ParsedRow {
  foreign: string[]
  german: string[]
  /** true, wenn die Zeile besonders geprüft werden sollte (fehlendes Deutsch, unsichere Erkennung). */
  uncertain: boolean
  notes: string[]
  /** Wörter auf dem Foto, aus denen die Zeile gelesen wurde (für die Markierung im Bild: Fremdsprache rot, Deutsch blau). */
  boxes?: { foreign: OcrWord[]; german: OcrWord[] }
}

export interface ParsedPage {
  /** Nummer aus der Überschrift "Unité N", falls auf der Seite vorhanden. */
  unit: number | null
  /** Seitenzahl unten auf der Seite ("164 cent-soixante-quatre"). */
  page: number | null
  rows: ParsedRow[]
  warnings: string[]
}

/** Austauschbare Erkennung: Bild → Wörter mit Positionen. */
export interface OcrEngine {
  readonly id: string
  /** `sparse`: zweiter Durchgang für verstreuten Text (findet Wörter, die der normale Durchgang übersieht). */
  recognize(image: HTMLCanvasElement, onProgress?: (fraction: number, status: string) => void, mode?: 'auto' | 'sparse'): Promise<OcrWord[]>
  /** Nur Ziffern in einem kleinen Bildstreifen (Seitenzahl); Zahl mit hoher Sicherheit oder null. */
  recognizeNumber?(image: HTMLCanvasElement): Promise<number | null>
}
