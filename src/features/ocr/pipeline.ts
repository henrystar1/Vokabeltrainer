import { createTesseractEngine } from './engine'
import { parseWords } from './parse'
import { prepareCanvas } from './preprocess'
import type { OcrEngine, ParsedPage } from './types'

/** Ergebnis einer Seite: Zeilen plus das Foto (Farbe, im Arbeitsspeicher) zum Markieren, was erkannt wurde. */
export interface ScanResult extends ParsedPage {
  image: HTMLCanvasElement
}

/**
 * Foto einer Wortlisten-Seite → erkannte Vokabelzeilen (zur Prüfung, noch nicht gespeichert).
 * Alles läuft lokal im Browser; das Foto wird nirgends hochgeladen.
 */
export async function scanPage(
  file: Blob,
  onProgress?: (fraction: number, status: string) => void,
  language = 'fr',
  engine: OcrEngine = createTesseractEngine(language),
): Promise<ScanResult> {
  onProgress?.(0, 'Bild wird aufbereitet …')
  const { gray, color } = await prepareCanvas(file)
  try {
    const words = await engine.recognize(gray, onProgress)
    return { ...parseWords(words, language), image: color }
  } finally {
    gray.width = 0
    gray.height = 0
  }
}
