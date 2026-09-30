import { tesseractEngine } from './engine'
import { parsePage } from './layout'
import { prepareCanvas } from './preprocess'
import type { OcrEngine, ParsedPage } from './types'

/** Foto einer Wortlisten-Seite → erkannte Vokabelzeilen (zur Prüfung, noch nicht gespeichert). */
export async function scanPage(
  file: Blob,
  onProgress?: (fraction: number, status: string) => void,
  engine: OcrEngine = tesseractEngine,
): Promise<ParsedPage> {
  onProgress?.(0, 'Bild wird aufbereitet …')
  const canvas = await prepareCanvas(file)
  try {
    const words = await engine.recognize(canvas, onProgress)
    return parsePage(words)
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}
