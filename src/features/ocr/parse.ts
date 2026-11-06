import { parsePage } from './layout'
import { parseEnglishPage } from './layoutEn'
import { hasLetter, median } from './layout'
import type { OcrWord, ParsedPage } from './types'

/**
 * Doppelseite (zwei Buchseiten nebeneinander): größte leere senkrechte Lücke in der Bildmitte suchen.
 * Gibt die beiden Wortlisten zurück, sonst null.
 */
export function splitSpread(words: OcrWord[], lh: number): [OcrWord[], OcrWord[]] | null {
  if (words.length < 40) return null
  const minX = Math.min(...words.map((w) => w.x0))
  const maxX = Math.max(...words.map((w) => w.x1))
  const span = maxX - minX
  const lo = minX + 0.3 * span
  const hi = minX + 0.7 * span
  const mid = words.filter((w) => w.x1 > lo && w.x0 < hi).sort((a, b) => a.x0 - b.x0)
  let best = { gap: 0, x: 0 }
  let reach = lo
  for (const w of mid) {
    if (w.x0 - reach > best.gap) best = { gap: w.x0 - reach, x: (w.x0 + reach) / 2 }
    reach = Math.max(reach, w.x1)
  }
  if (hi - reach > best.gap) best = { gap: hi - reach, x: (hi + reach) / 2 }
  if (best.gap < 2.5 * lh) return null
  return [words.filter((w) => (w.x0 + w.x1) / 2 < best.x), words.filter((w) => (w.x0 + w.x1) / 2 >= best.x)]
}

/**
 * Neigung der Textzeilen schätzen (y-Verschiebung je Pixel nach rechts): Mittelpunkte der Wörter werden mit
 * verschiedenen Neigungen auf die senkrechte Achse projiziert; bei der richtigen Neigung bilden die Zeilen scharfe Spitzen.
 */
export function estimateSlope(words: OcrWord[], lh: number): number {
  const pts = words.filter((w) => w.conf >= 50 && hasLetter(w.text)).map((w) => ({ x: (w.x0 + w.x1) / 2, y: (w.y0 + w.y1) / 2 }))
  if (pts.length < 30) return 0
  const bin = Math.max(4, lh * 0.5)
  const minY = Math.min(...pts.map((p) => p.y))
  const score = (s: number): number => {
    const h = new Map<number, number>()
    for (const p of pts) {
      const k = Math.floor((p.y - s * p.x - minY + 1e5) / bin)
      h.set(k, (h.get(k) ?? 0) + 1)
    }
    let sum = 0
    for (const v of h.values()) sum += v * v
    return sum
  }
  let best = { s: 0, v: score(0) }
  for (let s = -0.12; s <= 0.12; s += 0.004) {
    const v = score(s)
    if (v > best.v * 1.02) best = { s, v }
  }
  for (let s = best.s - 0.004; s <= best.s + 0.004; s += 0.001) {
    const v = score(s)
    if (v > best.v) best = { s, v }
  }
  return best.s
}

/** Wörter mit ausgeglichener Neigung (Kopien) → Parser → Markierungen wieder auf die Original-Wörter zurückführen. */
export function parseLevelled(ws: OcrWord[], lh: number, parser: (w: OcrWord[]) => ParsedPage): ParsedPage {
  const s = estimateSlope(ws, lh)
  if (Math.abs(s) < 0.002) return parser(ws)
  const orig = new Map<OcrWord, OcrWord>()
  const moved = ws.map((w) => {
    const dy = s * ((w.x0 + w.x1) / 2)
    const m = { ...w, y0: w.y0 - dy, y1: w.y1 - dy }
    orig.set(m, w)
    return m
  })
  const r = parser(moved)
  const back = (list: OcrWord[]) => list.map((w) => orig.get(w) ?? w)
  return { ...r, rows: r.rows.map((x) => (x.boxes ? { ...x, boxes: { foreign: back(x.boxes.foreign), german: back(x.boxes.german) } } : x)) }
}

/** Foto-Wörter → Vokabelzeilen. Erkennt Doppelseiten und liest dann beide Seiten (die nähere/schärfere zuerst). */
export function parseWords(allWords: OcrWord[], language: string): ParsedPage {
  const lh = median(allWords.filter((w) => w.conf >= 60 && hasLetter(w.text)).map((w) => w.y1 - w.y0)) || 25
  const one = (ws: OcrWord[]) => parseLevelled(ws, lh, language === 'fr' ? parsePage : parseEnglishPage)
  const halves = splitSpread(allWords, lh)
  if (!halves) return one(allWords)
  const [l, r] = halves.map(one) as [ParsedPage, ParsedPage]
  const usable = (p: ParsedPage) => p.rows.length >= 4
  if (usable(l) && usable(r)) {
    return {
      unit: l.unit ?? r.unit,
      page: null,
      rows: [...l.rows, ...r.rows],
      warnings: [`Doppelseite erkannt${l.page && r.page ? ` (Seiten ${l.page} und ${r.page})` : ''}: beide Seiten stehen in der Liste. Besser ist ein Foto pro Seite, dann stimmen Seitenzahl und Unit sicher.`, ...l.warnings, ...r.warnings],
    }
  }
  return usable(l) || !usable(r) ? l : r
}
