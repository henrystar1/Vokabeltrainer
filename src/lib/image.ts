/** Verkleinert ein Foto im Browser (längste Seite höchstens `maxSide`) und gibt ein JPEG zurück. */
export async function resizeImage(file: Blob, maxSide = 1280, quality = 0.85): Promise<Blob> {
  const bmp = await createImageBitmap(file).catch(() => null)
  if (!bmp) throw new Error('Das Bild konnte nicht gelesen werden.')
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * scale))
  const h = Math.max(1, Math.round(bmp.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Das Bild konnte nicht verarbeitet werden.')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', quality))
  if (!blob) throw new Error('Das Bild konnte nicht verarbeitet werden.')
  return blob
}
