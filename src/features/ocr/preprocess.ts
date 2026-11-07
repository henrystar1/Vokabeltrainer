import { flattenGray } from './flatten'

/** Größte Kante nach dem Verkleinern (Fotos vom Handy sind oft 4000 px und mehr). */
const MAX_SIDE = 3000
/** Genau-Modus: mehr Auflösung (dauert länger). */
export const MAX_SIDE_ADVANCED = 4200

/**
 * Foto → Graubild auf einem Canvas. Die Datei wird nur im Arbeitsspeicher gelesen,
 * nichts wird hochgeladen oder gespeichert.
 */
export async function prepareCanvas(file: Blob, maxSide = MAX_SIDE): Promise<{ gray: HTMLCanvasElement; color: HTMLCanvasElement }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Das Bild kann in diesem Browser nicht verarbeitet werden.')
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  // Farbkopie für die Anzeige mit Markierungen (gleiche Größe, damit die Wortpositionen passen); bleibt im Arbeitsspeicher
  const color = document.createElement('canvas')
  color.width = w
  color.height = h
  color.getContext('2d')?.drawImage(canvas, 0, 0)

  return { gray: toFlatGray(canvas), color }
}

/** Farb-Canvas → ausgeglichenes Graubild (neues Canvas). */
export function toFlatGray(source: HTMLCanvasElement): HTMLCanvasElement {
  const w = source.width
  const h = source.height
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Das Bild kann in diesem Browser nicht verarbeitet werden.')
  ctx.drawImage(source, 0, 0)
  const img = ctx.getImageData(0, 0, w, h)
  const gray = new Uint8ClampedArray(w * h)
  // Grünkanal: rote/orange Wörter (z. B. Artikel) bleiben auf gelbem Grund gut lesbar
  for (let i = 0; i < gray.length; i++) gray[i] = img.data[i * 4 + 1]
  const flat = flattenGray(gray, w, h)
  for (let i = 0; i < flat.length; i++) {
    const v = flat[i]
    img.data[i * 4] = v
    img.data[i * 4 + 1] = v
    img.data[i * 4 + 2] = v
    img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}
