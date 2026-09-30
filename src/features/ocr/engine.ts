import type { OcrEngine, OcrWord } from './types'

const STATUS_DE: Record<string, string> = {
  'loading tesseract core': 'Erkennung wird geladen …',
  'initializing tesseract': 'Erkennung wird gestartet …',
  'loading language traineddata': 'Sprachdaten werden geladen …',
  'initializing api': 'Erkennung wird vorbereitet …',
  'recognizing text': 'Text wird erkannt …',
}

/**
 * Tesseract (WebAssembly) im Browser: kostenlos, kein API-Schlüssel, das Bild bleibt auf dem Gerät.
 * Die Sprachdaten (Französisch + Deutsch) liegen unter public/tessdata und werden vom Browser zwischengespeichert.
 * Die Bibliothek wird erst beim ersten Einlesen nachgeladen.
 */
export const tesseractEngine: OcrEngine = {
  id: 'tesseract',
  async recognize(image, onProgress) {
    const { createWorker, PSM } = await import('tesseract.js')
    const worker = await createWorker(['fra', 'deu'], 1, {
      langPath: `${import.meta.env.BASE_URL}tessdata`,
      gzip: false,
      logger: (m: { status: string; progress: number }) => onProgress?.(m.progress, STATUS_DE[m.status] ?? m.status),
    })
    try {
      await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: '1' })
      const { data } = await worker.recognize(image, {}, { blocks: true })
      const words: OcrWord[] = []
      for (const block of data.blocks ?? [])
        for (const para of block.paragraphs)
          for (const line of para.lines)
            for (const w of line.words)
              words.push({ text: w.text, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1, conf: w.confidence })
      return words
    } finally {
      await worker.terminate()
    }
  },
}
