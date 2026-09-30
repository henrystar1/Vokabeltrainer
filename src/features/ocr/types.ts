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
  recognize(image: HTMLCanvasElement, onProgress?: (fraction: number, status: string) => void): Promise<OcrWord[]>
}
