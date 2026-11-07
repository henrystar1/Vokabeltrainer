import { createTesseractEngine } from './engine'
import { parseWords } from './parse'
import { MAX_SIDE_ADVANCED, prepareCanvas, toFlatGray } from './preprocess'
import type { OcrEngine, OcrWord, ParsedPage } from './types'

/** Ergebnis einer Seite: Zeilen plus das Foto (Farbe, im Arbeitsspeicher) zum Markieren, was erkannt wurde. */
export interface ScanResult extends ParsedPage {
  image: HTMLCanvasElement
}

export interface Rect { x: number; y: number; w: number; h: number }

const overlap = (a: OcrWord, b: OcrWord): number => {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
  if (w <= 0 || h <= 0) return 0
  return (w * h) / Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0))
}

/** Wörter eines zweiten Durchgangs ergänzen, wenn sie an dieser Stelle noch kein Wort haben. */
export function mergeWords(base: OcrWord[], extra: OcrWord[]): OcrWord[] {
  const out = [...base]
  for (const w of extra) if (w.conf >= 50 && !base.some((b) => overlap(w, b) > 0.35)) out.push(w)
  return out
}

/** Streifen unter dem Text (dort steht die Seitenzahl) vergrößert ausschneiden. */
function numberStrip(gray: HTMLCanvasElement, words: OcrWord[]): HTMLCanvasElement | null {
  const good = words.filter((w) => w.conf >= 50)
  if (good.length < 10) return null
  const maxY = Math.max(...good.map((w) => w.y1))
  const x0 = Math.max(0, Math.min(...good.map((w) => w.x0)) - 0.05 * gray.width)
  const x1 = Math.min(gray.width, Math.max(...good.map((w) => w.x1)) + 0.05 * gray.width)
  const y0 = Math.max(0, maxY)
  const y1 = Math.min(gray.height, maxY + 0.12 * gray.height)
  if (x1 - x0 < 50 || y1 - y0 < 20) return null
  const k = 3
  const c = document.createElement('canvas')
  c.width = Math.round((x1 - x0) * k)
  c.height = Math.round((y1 - y0) * k)
  c.getContext('2d')?.drawImage(gray, x0, y0, x1 - x0, y1 - y0, 0, 0, c.width, c.height)
  return c
}

/**
 * Foto einer Wortlisten-Seite → erkannte Vokabelzeilen (zur Prüfung, noch nicht gespeichert).
 * Alles läuft lokal im Browser; das Foto wird nirgends hochgeladen.
 * `advanced`: höhere Auflösung und ein zweiter Durchgang, der übersehene Wörter nachträgt (dauert etwa doppelt so lange).
 */
export async function scanPage(
  file: Blob,
  onProgress?: (fraction: number, status: string) => void,
  language = 'fr',
  advanced = false,
  engine: OcrEngine = createTesseractEngine(language),
): Promise<ScanResult> {
  onProgress?.(0, 'Bild wird aufbereitet …')
  const { gray, color } = await prepareCanvas(file, advanced ? MAX_SIDE_ADVANCED : undefined)
  try {
    let words = await engine.recognize(gray, advanced ? (p, s) => onProgress?.(p / 2, s) : onProgress)
    if (advanced) {
      const second = await engine.recognize(gray, (p, s) => onProgress?.(0.5 + p / 2, `Zweiter Durchgang: ${s}`), 'sparse')
      words = mergeWords(words, second)
    }
    const parsed = parseWords(words, language)
    if (parsed.page === null && engine.recognizeNumber) {
      const strip = numberStrip(gray, words)
      if (strip) parsed.page = await engine.recognizeNumber(strip).catch(() => null)
    }
    return { ...parsed, image: color }
  } finally {
    gray.width = 0
    gray.height = 0
  }
}

/**
 * Nur einen markierten Bereich des Fotos noch einmal lesen: vergrößert, mit beiden Durchgängen.
 * Die Wortpositionen der Ergebnisse gelten wieder für das ganze Foto.
 */
export async function rescanRegion(
  color: HTMLCanvasElement,
  rect: Rect,
  language: string,
  onProgress?: (fraction: number, status: string) => void,
  engine: OcrEngine = createTesseractEngine(language),
): Promise<ParsedPage> {
  const pad = 6
  const x = Math.max(0, Math.floor(rect.x - pad))
  const y = Math.max(0, Math.floor(rect.y - pad))
  const w = Math.min(color.width - x, Math.ceil(rect.w + 2 * pad))
  const h = Math.min(color.height - y, Math.ceil(rect.h + 2 * pad))
  const k = Math.max(1, Math.min(3, 2600 / Math.max(w, h)))
  const crop = document.createElement('canvas')
  crop.width = Math.round(w * k)
  crop.height = Math.round(h * k)
  crop.getContext('2d')?.drawImage(color, x, y, w, h, 0, 0, crop.width, crop.height)
  const gray = toFlatGray(crop)
  crop.width = 0
  try {
    let words = await engine.recognize(gray, (p, s) => onProgress?.(p / 2, s))
    words = mergeWords(words, await engine.recognize(gray, (p, s) => onProgress?.(0.5 + p / 2, `Zweiter Durchgang: ${s}`), 'sparse'))
    const back = new Map<OcrWord, OcrWord>()
    const moved = words.map((w) => {
      const m = { ...w, x0: w.x0 / k + x, x1: w.x1 / k + x, y0: w.y0 / k + y, y1: w.y1 / k + y }
      back.set(w, m)
      return m
    })
    return parseWords(moved, language)
  } finally {
    gray.width = 0
    gray.height = 0
  }
}
