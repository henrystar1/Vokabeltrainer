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
 * Die Sprachdaten (Fremdsprache + Deutsch) liegen unter public/tessdata und werden vom Browser zwischengespeichert.
 * Die Bibliothek wird erst beim ersten Einlesen nachgeladen.
 */
/** Sprachcode des Buchs → Tesseract-Sprachpaket der Fremdsprache. */
export const OCR_LANGUAGES: Record<string, string> = { fr: 'fra', en: 'eng', la: 'lat', es: 'spa' }

export function createTesseractEngine(languageCode: string): OcrEngine {
  const foreign = OCR_LANGUAGES[languageCode] ?? 'fra'
  return {
    id: `tesseract-${foreign}`,
    async recognize(image, onProgress, mode = 'auto') {
    const { createWorker, PSM } = await import('tesseract.js')
    const worker = await createWorker([foreign, 'deu'], 1, {
      langPath: `${import.meta.env.BASE_URL}tessdata`,
      gzip: false,
      logger: (m: { status: string; progress: number }) => onProgress?.(m.progress, STATUS_DE[m.status] ?? m.status),
    })
    try {
      await worker.setParameters({ tessedit_pageseg_mode: mode === 'sparse' ? PSM.SPARSE_TEXT : PSM.AUTO, preserve_interword_spaces: '1' })
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
    async recognizeNumber(image) {
      const { createWorker, PSM } = await import('tesseract.js')
      const worker = await createWorker('eng', 1, { langPath: `${import.meta.env.BASE_URL}tessdata`, gzip: false })
      try {
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, tessedit_char_whitelist: '0123456789' })
        const { data } = await worker.recognize(image, {}, { blocks: true })
        let best: { n: number; conf: number } | null = null
        for (const block of data.blocks ?? [])
          for (const para of block.paragraphs)
            for (const line of para.lines)
              for (const w of line.words) {
                const n = /^\d{1,4}$/.test(w.text) ? Number(w.text) : NaN
                if (Number.isInteger(n) && n >= 1 && w.confidence >= 85 && (!best || w.confidence > best.conf)) best = { n, conf: w.confidence }
              }
        return best ? best.n : null
      } finally {
        await worker.terminate()
      }
    },
  }
}
