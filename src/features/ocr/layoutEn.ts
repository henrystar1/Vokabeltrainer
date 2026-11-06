import { cleanList } from '../entry/rows'
import { cleanGermanText } from './clean'
import { avg, detectColumns, groupLines, hasLetter, median, yc, type Line } from './layout'
import type { OcrWord, ParsedPage, ParsedRow } from './types'

/**
 * Wortlisten-Seite eines englischen Schulbuchs (Camden Town): Spalte 1 = Englisch mit Lautschrift /…/,
 * Spalte 2 = Deutsch, Spalte 3 = Beispielsatz (ignoriert). Zahlen-Kästchen links (1, A2 …), gelbe Hinweiskästen,
 * "Say it in English"-Kästen und Fließtext werden ausgelassen.
 * Die Spaltenränder werden als schräge Gerade angepasst (Fotos sind oft leicht verdreht oder perspektivisch verzerrt).
 */

const MIN_WORD_CONF = 60

interface Ref { a: number; b: number }
const at = (r: Ref, y: number): number => r.a + r.b * y

/** Linie x = a + b·y durch die Wortanfänge einer Spalte (kleinste Quadrate, Ausreißer werden verworfen). */
function fitRef(words: OcrWord[], c: number, lh: number): Ref {
  let pts = words.filter((w) => Math.abs(w.x0 - c) <= 1.5 * lh && w.text.length >= 2 && hasLetter(w.text)).map((w) => ({ x: w.x0, y: yc(w) }))
  let r: Ref = { a: c, b: 0 }
  for (let it = 0; it < 4 && pts.length >= 6; it++) {
    const n = pts.length
    const sx = pts.reduce((s, p) => s + p.x, 0)
    const sy = pts.reduce((s, p) => s + p.y, 0)
    const sxy = pts.reduce((s, p) => s + p.x * p.y, 0)
    const syy = pts.reduce((s, p) => s + p.y * p.y, 0)
    const den = n * syy - sy * sy
    const b = den === 0 ? 0 : Math.max(-0.08, Math.min(0.08, (n * sxy - sx * sy) / den))
    r = { a: (sx - b * sy) / n, b }
    const kept = pts.filter((p) => Math.abs(p.x - at(r, p.y)) <= 0.6 * lh)
    if (kept.length < 6 || kept.length === pts.length) break
    pts = kept
  }
  return r
}

/** Lautschrift /…/ (auch unvollständig erkannt), (irr)/(no pl)/(pl …)/(AE …) und lose Kästchen entfernen. */
export function cleanEnglishForeign(raw: string): string[] {
  let t = ` ${raw.replace(/\s+/g, ' ')} `
  t = t.replace(/\s\/[^/]*\/(?=\s)/g, ' ') // /ˈæbc/
  t = t.replace(/\s\/.*$/, ' ') // Lautschrift ohne schließenden Strich
  t = t.replace(/[({](?:irr|no p[lt1I]|p[lt1I]|sg|AE|BE)\b[^)}]*[)}]/gi, ' ')
  t = t.replace(/\s(?:irr|no pl)\)/gi, ' ')
  t = t
    .split(' ')
    .filter((tok) => !/\/$/.test(tok) || tok === '/') // Reste der Lautschrift wie "from/bai/"
    .join(' ')
  t = t.replace(/\s\d{1,4}\s*$/, ' ').replace(/^\s*(?:[A-C]?\d{1,2}\s+)?/, '').replace(/^[^\p{L}'’(]+/u, '')
  t = t.replace(/[\s.,;:_|/]+$/, '').replace(/\s+/g, ' ').trim()
  // Einzelne Buchstaben am Ende sind Reste der Lautschrift/Kästchen (außer "a" und "I")
  t = t.replace(/(\s[^\saAI(])+$/, (m) => (/^(\s\S)+$/.test(m) ? '' : m)).trim()
  return t && hasLetter(t) ? cleanList([t]) : []
}

const hasPhonetic = (text: string): boolean => /(^|\s)\/\S/.test(text) || /\S\/(\s|$)/.test(text)

/** Wörter der Zeile ohne Lautschrift und Kürzel: nur diese werden im Bild markiert. */
function contentWords(line: Line): OcrWord[] {
  const out: OcrWord[] = []
  let inPhon = false
  for (const w of line.words) {
    if (!inPhon && /^\//.test(w.text) && w.text.length > 0) inPhon = true
    if (inPhon) {
      if (/\/$/.test(w.text)) inPhon = false
      continue
    }
    if (/\/$/.test(w.text) && w.text.length > 1) continue
    if (/^\(?(?:irr|no|pl|AE|BE)\)?$/i.test(w.text) || !hasLetter(w.text)) continue
    out.push(w)
  }
  return out
}

/** Nummer aus "Theme 2: Teenage life". */
function detectTheme(words: OcrWord[], lh: number): number | null {
  const sorted = [...words].sort((a, b) => yc(a) - yc(b) || a.x0 - b.x0)
  for (const w of sorted) {
    if (!/^Theme$/i.test(w.text)) continue
    const next = sorted
      .filter((x) => x !== w && Math.abs(yc(x) - yc(w)) <= lh && x.x0 >= w.x1 - 0.5 * lh && x.x0 - w.x1 < 4 * lh)
      .sort((a, b) => a.x0 - b.x0)[0]
    const m = next ? /^(\d{1,2})[:.]?$/.exec(next.text) : null
    if (m) return Number(m[1])
  }
  return null
}

/** Seitenzahl: alleinstehende Zahl ganz unten auf der Seite (z. B. "204"). */
function detectPageNumber(words: OcrWord[], lh: number): number | null {
  const lines = groupLines(words.filter((w) => w.conf >= 40), lh)
  if (lines.length === 0) return null
  const bottom = Math.max(...lines.map((l) => l.y))
  const c = lines.filter((l) => /^\s*\d{1,4}\s*$/.test(l.text) && l.y >= bottom - 3 * lh).sort((a, b) => b.y - a.y)
  const n = c[0] ? Number(c[0].text.trim()) : NaN
  return Number.isInteger(n) && n >= 1 ? n : null
}

/** Unterschiede zwischen den Büchern: Lautschrift /…/ (Englisch) oder […] (Französisch). */
interface Dialect {
  name: string
  clean: (raw: string) => string[]
  phonetic: (text: string) => boolean
  content: (line: Line) => OcrWord[]
  unit: (words: OcrWord[], lh: number) => number | null
  page: (words: OcrWord[], lh: number) => number | null
}

const EN: Dialect = { name: 'Englisch', clean: cleanEnglishForeign, phonetic: hasPhonetic, content: contentWords, unit: detectTheme, page: detectPageNumber }

type Kind = 'entry' | 'cont' | 'skip'
interface ColLine extends Line {
  kind: Kind
  foreign: string[]
  german: Line | null
}

export const parseEnglishPage = (w: OcrWord[]): ParsedPage => parseColumns(w, EN)

function parseColumns(allWords: OcrWord[], d: Dialect): ParsedPage {
  const words = allWords.filter((w) => w.text.trim() !== '')
  const heights = words.filter((w) => w.conf >= MIN_WORD_CONF && hasLetter(w.text)).map((w) => w.y1 - w.y0)
  const lh = median(heights) || 25
  const unit = d.unit(words, lh)
  const page = d.page(words, lh)
  const cols = detectColumns(words, lh, true)
  if (!cols) {
    return { unit, page, rows: [], warnings: ['Die Spalten der Wortliste wurden nicht erkannt. Bitte die ganze Seite gerade und gut beleuchtet fotografieren.'] }
  }
  const ref1 = fitRef(words, cols.c1, lh)
  const ref2 = fitRef(words, cols.c2, lh)
  const ref3 = fitRef(words, cols.c3, lh)

  const col1 = words.filter((w) => {
    const y = yc(w)
    if (w.x0 >= at(ref2, y) - 1.5 * lh || w.x0 < at(ref1, y) - 3.5 * lh) return false
    // Zahlen-Kästchen (1, A2 …) links neben dem Stichwort
    return w.x0 >= at(ref1, y) - 0.6 * lh
  })
  const col2 = words.filter((w) => {
    const y = yc(w)
    return w.x0 >= at(ref2, y) - 1.5 * lh && w.x0 < at(ref3, y) - 1.5 * lh
  })
  // Deutsche Zeilen, die über die Spaltengrenze in den Beispielsatz-Bereich hineinlaufen (lückenloser Text), zusammenhalten
  const inCol2 = new Set(col2)
  const deLines = groupLines(col2, lh)
    .filter((l) => hasLetter(l.text))
    .map((l) => {
      const rest = words.filter((w) => !inCol2.has(w) && w.x0 >= at(ref3, yc(w)) - 1.5 * lh && Math.abs(yc(w) - l.y) <= 0.5 * lh).sort((a, b) => a.x0 - b.x0)
      const ext: OcrWord[] = []
      let reach = l.words[l.words.length - 1].x1
      for (const w of rest) {
        if (w.x0 - reach > 0.9 * lh) break
        ext.push(w)
        reach = w.x1
      }
      if (ext.length === 0) return l
      const ws = [...l.words, ...ext]
      return { ...l, words: ws, text: ws.map((w) => w.text).join(' ') }
    })

  const lines: ColLine[] = groupLines(col1, lh).map((line) => {
    const foreign = d.clean(line.text)
    const first = line.words[0]
    const last = line.words[line.words.length - 1]
    const indent = first.x0 - at(ref1, line.y)
    const near = deLines.filter((d) => Math.abs(d.y - line.y) <= 0.6 * lh)
    const german =
      near.find((d) => Math.abs(d.words[0].x0 - at(ref2, d.y)) <= 1.0 * lh && d.words[0].x0 - last.x1 >= 0.8 * lh) ?? null
    let kind: Kind
    // Umbruchzeile: eingerückt (ca. 1,5 Zeilenhöhen), enthält nur Rest des Stichworts und/oder Lautschrift
    const wrapped = indent >= 1.1 * lh && line.words.length <= 9
    if (foreign.length === 0 || (wrapped && !german)) kind = 'cont'
    else if (german && indent <= 1.0 * lh) kind = 'entry'
    else if (!german && near.length === 0 && indent <= 0.65 * lh && d.phonetic(line.text)) kind = 'entry' // Deutsch fehlt
    else kind = 'skip'
    return { ...line, kind, foreign, german }
  })

  const structural = lines.filter((l) => l.kind !== 'cont')
  const rows: ParsedRow[] = []
  structural.forEach((line, i) => {
    if (line.kind !== 'entry') return
    const from = line.y - 0.6 * lh
    const to = structural[i + 1] ? structural[i + 1].y - 0.6 * lh : Infinity
    const conts = lines.filter((l) => l.kind === 'cont' && l.y >= from && l.y < to && l !== line && avg(l.words.map((w) => w.conf)) >= 45)
    const de = deLines.filter((l) => l.y >= from && l.y < to)
    // Umbruchzeile aus reiner Lautschrift, bei der der erste Strich nicht erkannt wurde ("profit from/bai/"), ignorieren
    const frText = [line, ...conts.filter((l) => !(!/(^|\s)\//.test(l.text) && /\S\/\s*$/.test(l.text)))].map((l) => l.text).join(' ')
    const foreign = d.clean(frText)
    if (foreign.length === 0) return
    const german = cleanGermanText(de.map((l) => l.text).join(' '))
    const frBoxes = [line, ...conts.filter((l) => frText.includes(l.text))].flatMap(d.content)
    const deWords = de.flatMap((l) => l.words).filter((w) => hasLetter(w.text))
    const notes: string[] = []
    if (german.length === 0) notes.push('Deutsch nicht erkannt')
    if (avg(frBoxes.map((w) => w.conf)) < 70) notes.push(`${d.name} unsicher erkannt`)
    if (german.length > 0 && avg(deWords.map((w) => w.conf)) < 70) notes.push('Deutsch unsicher erkannt')
    if (/\//.test(foreign[0]) && /\/\s*$/.test(frText)) notes.push('Lautschrift im Wort?')
    rows.push({ foreign, german, uncertain: notes.length > 0, notes, boxes: { foreign: frBoxes, german: deWords } })
  })

  const warnings: string[] = rows.length === 0 ? ['Es wurden keine Vokabeln erkannt.'] : []
  return { unit, page, rows, warnings }
}
