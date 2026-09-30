/**
 * Bildaufbereitung für die Texterkennung: Fotos von Buchseiten sind oft ungleichmäßig beleuchtet
 * (Schatten, Verlauf). Der Hintergrund wird geschätzt (stark geglättetes Bild) und herausgerechnet,
 * danach der Kontrast gespreizt. Reine Funktion auf Grauwerten, damit sie testbar ist.
 */

const BLOCK = 8

function boxBlur(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  // horizontal
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0
      let n = 0
      for (let k = -radius; k <= radius; k++) {
        const xx = x + k
        if (xx >= 0 && xx < w) {
          sum += src[y * w + xx]
          n++
        }
      }
      tmp[y * w + x] = sum / n
    }
  }
  // vertikal
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0
      let n = 0
      for (let k = -radius; k <= radius; k++) {
        const yy = y + k
        if (yy >= 0 && yy < h) {
          sum += tmp[yy * w + x]
          n++
        }
      }
      out[y * w + x] = sum / n
    }
  }
  return out
}

/** gray: Werte 0–255, Länge w*h. Liefert das aufbereitete Graubild (0–255). */
export function flattenGray(gray: ArrayLike<number>, w: number, h: number): Uint8ClampedArray {
  const sw = Math.ceil(w / BLOCK)
  const sh = Math.ceil(h / BLOCK)
  let small: Float32Array = new Float32Array(sw * sh)
  const counts = new Float32Array(sw * sh)
  for (let y = 0; y < h; y++) {
    const sy = Math.min(sh - 1, Math.floor(y / BLOCK))
    for (let x = 0; x < w; x++) {
      const i = sy * sw + Math.min(sw - 1, Math.floor(x / BLOCK))
      small[i] += gray[y * w + x]
      counts[i] += 1
    }
  }
  for (let i = 0; i < small.length; i++) small[i] /= Math.max(1, counts[i])
  // Zwei Durchgänge Mittelwertfilter ≈ Gauß mit Radius von etwa 35 Pixeln im Originalbild
  small = boxBlur(boxBlur(small, sw, sh, 5), sw, sh, 5)

  const norm = new Float32Array(w * h)
  const hist = new Uint32Array(256)
  for (let y = 0; y < h; y++) {
    // bilinear zwischen den Blockmittelpunkten
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) / BLOCK - 0.5))
    const y0 = Math.floor(fy)
    const y1 = Math.min(sh - 1, y0 + 1)
    const ty = fy - y0
    for (let x = 0; x < w; x++) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) / BLOCK - 0.5))
      const x0 = Math.floor(fx)
      const x1 = Math.min(sw - 1, x0 + 1)
      const tx = fx - x0
      const bg =
        (small[y0 * sw + x0] * (1 - tx) + small[y0 * sw + x1] * tx) * (1 - ty) +
        (small[y1 * sw + x0] * (1 - tx) + small[y1 * sw + x1] * tx) * ty
      const v = Math.min(255, Math.max(0, (gray[y * w + x] / Math.max(1, bg)) * 235))
      norm[y * w + x] = v
      hist[Math.round(v)]++
    }
  }

  // Kontrast spreizen: 2. bis 99. Perzentil
  const total = w * h
  const percentile = (p: number) => {
    let acc = 0
    for (let v = 0; v < 256; v++) {
      acc += hist[v]
      if (acc >= p * total) return v
    }
    return 255
  }
  const lo = percentile(0.02)
  const hi = Math.max(lo + 1, percentile(0.99))
  const out = new Uint8ClampedArray(w * h)
  for (let i = 0; i < out.length; i++) out[i] = ((norm[i] - lo) / (hi - lo)) * 255
  return out
}
