import { flattenGray } from './flatten'

/** Größte Kante nach dem Verkleinern (Fotos vom Handy sind oft 4000 px und mehr). */
const MAX_SIDE = 3000

/**
 * Foto → Graubild auf einem Canvas. Die Datei wird nur im Arbeitsspeicher gelesen,
 * nichts wird hochgeladen oder gespeichert.
 */
export async function prepareCanvas(file: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Das Bild kann in diesem Browser nicht verarbeitet werden.')
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()

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
