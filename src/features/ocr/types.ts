/**
 * OCR-Vorbereitung (noch NICHT umgesetzt).
 *
 * Geplanter Ablauf: Foto einer Buchseite → Texterkennung → Vorschlagsliste → Benutzer prüft und
 * korrigiert → erst dann werden die Zeilen wie bei der manuellen Eingabe gespeichert
 * (save_vocab_entry). Der OCR-Anbieter ist austauschbar, damit später z. B. ein Server-Dienst
 * oder eine Edge Function angebunden werden kann, ohne die Oberfläche zu ändern.
 */

/** Eine erkannte Zeile; `confidence` (0–1) hilft, unsichere Zeilen in der Prüfansicht hervorzuheben. */
export interface OcrLine {
  german: string
  translations: string[]
  confidence?: number
}

export interface OcrRequest {
  /** Bilddaten der Buchseite (JPEG/PNG). */
  image: Blob
  language: string
  /** Optionale Hinweise, in welche Unit/Seite das Ergebnis eingetragen werden soll. */
  unit?: number
  page?: number
}

export interface OcrResult {
  lines: OcrLine[]
  /** Vom Anbieter gemeldete Warnungen (z. B. „Bild unscharf“). */
  warnings: string[]
}

export interface OcrProvider {
  readonly id: string
  recognize(request: OcrRequest): Promise<OcrResult>
}
