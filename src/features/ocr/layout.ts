import { cleanForeignText, cleanGermanText, isGrammarToken } from './clean'
import type { OcrWord, ParsedPage, ParsedRow } from './types'

/**
 * Ordnet die erkannten Wörter einer Seite "Liste des mots" zu:
 *  Spalte 1 = Französisch (mit Lautschrift), Spalte 2 = Deutsch, Spalte 3 = Beispielsatz (ignoriert).
 * Die blau hinterlegten Kästen (Wortfelder mit Bild) werden ausgelassen.
 */

const MIN_WORD_CONF = 60
const COLUMN_TOLERANCE = 50
const MIN_COLUMN_DISTANCE = 250

interface Line {
  y: number
  words: OcrWord[]
  text: string
}

type Kind = 'entry' | 'continuation' | 'skip'

interface FrLine extends Line {
  kind: Kind
  foreign: string[]
  hasBracket: boolean
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

const yc = (w: OcrWord): number => (w.y0 + w.y1) / 2
const hasLetter = (s: string): boolean => /\p{L}/u.test(s)

/**
 * Häufungen bei den Wortanfängen (x0) finden: Kandidat mit den meisten Wörtern im Umkreis von ±`radius`
 * Pixeln, dann Nachbarn im Abstand von mindestens `minGap` ausblenden, und so weiter.
 */
function findPeaks(values: number[], radius = 15, minGap = 100): Array<{ x: number; count: number }> {
  const sorted = [...values].sort((a, b) => a - b)
  const scored = sorted.map((v) => {
    const near = sorted.filter((u) => Math.abs(u - v) <= radius)
    return { x: median(near), count: near.length }
  })
  scored.sort((a, b) => b.count - a.count)
  const peaks: Array<{ x: number; count: number }> = []
  for (const c of scored) {
    if (peaks.every((p) => Math.abs(p.x - c.x) >= minGap)) peaks.push(c)
  }
  return peaks
}

/** Spaltenanfänge finden: Spalte 1 = stärkster linker Cluster, Spalte 2 = nächster starker Cluster rechts davon. */
export function detectColumns(words: OcrWord[]): { c1: number; c2: number; c3: number } | null {
  const starts = words.filter((w) => w.conf >= MIN_WORD_CONF && w.text.length >= 2 && hasLetter(w.text)).map((w) => w.x0)
  const clusters = findPeaks(starts).filter((c) => c.count >= 4)
  if (clusters.length < 2) return null
  const max = Math.max(...clusters.map((c) => c.count))
  const strong = clusters.filter((c) => c.count >= 0.3 * max).sort((a, b) => a.x - b.x)
  // Spalte 1: der häufigste Anfang unter den linken Kandidaten
  const c1 = strong.filter((c) => c.count >= 0.6 * max).sort((a, b) => a.x - b.x)[0] ?? strong[0]
  const right = strong.filter((c) => c.x - c1.x >= MIN_COLUMN_DISTANCE)
  if (right.length === 0) return null
  const c2 = right[0]
  const c3 = right.find((c) => c.x - c2.x >= MIN_COLUMN_DISTANCE)
  return { c1: c1.x, c2: c2.x, c3: c3 ? c3.x : c2.x + (c2.x - c1.x) }
}

/** Wörter zu Zeilen gruppieren (Mittelpunkt-Abstand kleiner als ~ eine halbe Zeilenhöhe). */
function groupLines(words: OcrWord[], lineHeight: number): Line[] {
  const sorted = [...words].sort((a, b) => yc(a) - yc(b))
  const groups: OcrWord[][] = []
  for (const w of sorted) {
    const g = groups[groups.length - 1]
    if (g) {
      const mean = g.reduce((s, x) => s + yc(x), 0) / g.length
      if (Math.abs(yc(w) - mean) <= 0.55 * lineHeight) {
        g.push(w)
        continue
      }
    }
    groups.push([w])
  }
  return groups.map((g) => {
    const ws = g.sort((a, b) => a.x0 - b.x0)
    return { y: ws.reduce((s, x) => s + yc(x), 0) / ws.length, words: ws, text: ws.map((w) => w.text).join(' ') }
  })
}

/** Text nach der schließenden Klammer der Lautschrift: Grammatik ist normal, andere Wörter = Kasten-Zeile. */
function hasInlineGerman(text: string): boolean {
  const m = /\]([^\[]*)$/.exec(text)
  if (!m) return false
  const rest = m[1]
    .split(/\s+/)
    .map((t) => t.replace(/[.,;:]+$/, ''))
    .filter((t) => (t.match(/\p{L}/gu)?.length ?? 0) >= 3 && !isGrammarToken(t))
  return rest.length > 0
}

function classify(line: Line): FrLine {
  const hasBracket = /[\[\]]/.test(line.text)
  const foreign = cleanForeignText(line.text)
  let kind: Kind = 'entry'
  if (/\|/.test(line.text)) kind = 'skip' // Überschrift eines blauen Kastens ("Le corps humain | Der menschliche Körper")
  else if (hasBracket && hasInlineGerman(line.text)) kind = 'skip' // Wortfeld-Zeile mit Deutsch direkt hinter der Lautschrift
  else if (foreign.length === 0) kind = 'continuation' // nur Lautschrift/Grammatik (Umbruch)
  return { ...line, kind, foreign, hasBracket }
}

const FR_NUMBER = /\b(cent|vingt|trente|quarante|cinquante|soixante|mille|dix|onze|douze|treize|quatorze|quinze|seize|deux|trois|quatre|cinq|six|sept|huit|neuf)/i

function detectUnit(words: OcrWord[], lineHeight: number): number | null {
  const sorted = [...words].sort((a, b) => yc(a) - yc(b) || a.x0 - b.x0)
  for (let i = 0; i < sorted.length; i++) {
    if (!/^Unit[eé]s?$/i.test(sorted[i].text)) continue
    const next = sorted
      .filter((w) => w !== sorted[i] && Math.abs(yc(w) - yc(sorted[i])) <= lineHeight && w.x0 >= sorted[i].x1 - lineHeight * 0.5 && w.x0 - sorted[i].x1 < lineHeight * 4)
      .sort((a, b) => a.x0 - b.x0)[0]
    const n = next && /^\d{1,2}$/.test(next.text) ? Number(next.text) : NaN
    if (Number.isInteger(n)) return n
  }
  return null
}

function detectPage(words: OcrWord[], lineHeight: number): number | null {
  const lines = groupLines(words.filter((w) => w.conf >= 40), lineHeight)
  const candidates = lines.filter((l) => FR_NUMBER.test(l.text) && /\d/.test(l.text) && l.text.length < 60)
  for (const l of candidates.sort((a, b) => b.y - a.y)) {
    // Ziffern (evtl. durch Leerzeichen getrennt, z. B. "1 64") direkt am Zeilenanfang oder -ende
    const m = /^\s*(\d(?:[\d ]{0,5}\d)?)\s+\D/.exec(l.text) ?? /\D\s(\d(?:[\d ]{0,5}\d)?)\s*$/.exec(l.text)
    if (!m) continue
    const n = Number(m[1].replace(/ /g, ''))
    if (Number.isInteger(n) && n >= 1 && n <= 9999) return n
  }
  return null
}

const avg = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length)

export function parsePage(allWords: OcrWord[]): ParsedPage {
  const words = allWords.filter((w) => w.text.trim() !== '')
  const warnings: string[] = []
  const heights = words.filter((w) => w.conf >= MIN_WORD_CONF && hasLetter(w.text)).map((w) => w.y1 - w.y0)
  const lineHeight = median(heights) || 25

  const unit = detectUnit(words, lineHeight)
  const page = detectPage(words, lineHeight)
  const cols = detectColumns(words)
  if (!cols) {
    return { unit, page, rows: [], warnings: ['Die Spalten der Wortliste wurden nicht erkannt. Bitte die ganze Seite gerade und gut beleuchtet fotografieren.'] }
  }

  const col1 = words.filter((w) => w.x0 >= cols.c1 - COLUMN_TOLERANCE && w.x0 < cols.c2 - COLUMN_TOLERANCE)
  const col2 = words.filter((w) => w.x0 >= cols.c2 - COLUMN_TOLERANCE && w.x0 < cols.c3 - COLUMN_TOLERANCE)
  const frLines = groupLines(col1, lineHeight).map(classify)
  const deLines = groupLines(col2, lineHeight)

  // Jede Zeile, die etwas Eigenes enthält (Eintrag, Kasten, Überschrift), begrenzt den Bereich der vorigen.
  const structural = frLines.filter((l) => l.kind !== 'continuation')
  const rows: ParsedRow[] = []
  // Ein blauer Kasten beginnt mit einer Überschrift ("Le corps humain | Der menschliche Körper") und
  // endet bei der ersten normalen Zeile: Lautschrift links und Deutsch sauber in Spalte 2 rechts daneben.
  let inBox = false
  structural.forEach((line, i) => {
    const from = line.y - 0.6 * lineHeight
    const to = structural[i + 1] ? structural[i + 1].y - 0.6 * lineHeight : Infinity
    const de = deLines.filter((l) => l.y >= from && l.y < to)
    const aligned = de.some((l) => Math.abs(l.words[0].x0 - cols.c2) <= 25 && hasLetter(l.text))

    if (line.kind === 'skip' && /\|/.test(line.text)) inBox = true
    else if (inBox && line.kind === 'entry' && line.hasBracket && aligned) inBox = false
    if (inBox || line.kind !== 'entry') return

    const german = cleanGermanText(de.map((l) => l.text).join(' '))
    // Ohne Lautschrift und ohne deutsche Entsprechung ist es keine Vokabelzeile (z. B. Seitenüberschrift).
    if (!line.hasBracket && german.length === 0) return

    const frWords = line.words.filter((w) => !/[\[\]]/.test(w.text) && !isGrammarToken(w.text) && hasLetter(w.text))
    const deWords = de.flatMap((l) => l.words).filter((w) => hasLetter(w.text))
    const notes: string[] = []
    if (german.length === 0) notes.push('Deutsch nicht erkannt')
    if (avg(frWords.map((w) => w.conf)) < 70) notes.push('Französisch unsicher erkannt')
    if (german.length > 0 && avg(deWords.map((w) => w.conf)) < 70) notes.push('Deutsch unsicher erkannt')
    rows.push({ foreign: line.foreign, german, uncertain: notes.length > 0, notes })
  })

  if (rows.length === 0) warnings.push('Es wurden keine Vokabeln erkannt.')
  return { unit, page, rows, warnings }
}
