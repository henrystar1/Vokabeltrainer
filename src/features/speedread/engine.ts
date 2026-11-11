/** Schnelllesen: Text zerlegen, zählen und die Anzeigedauer pro Wortgruppe berechnen. */

export interface TextStats { chars: number; charsNoSpaces: number; words: number; sentences: number; minutesAt: (wpm: number) => number }

export function textStats(text: string): TextStats {
  const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length
  const sentences = (text.match(/[.!?…]+(\s|$)/g) ?? []).length
  return {
    chars: [...text].length,
    charsNoSpaces: [...text.replace(/\s/g, '')].length,
    words, sentences,
    minutesAt: (wpm) => (wpm > 0 ? words / wpm : 0),
  }
}

export const tokenize = (text: string): string[] => (text.trim() === '' ? [] : text.trim().split(/\s+/))

/** Fasst Wörter zu Gruppen (1–3 Wörter pro Blitz) zusammen. */
export function groupWords(words: string[], size: number): string[] {
  const n = Math.min(Math.max(Math.floor(size), 1), 3)
  const out: string[] = []
  for (let i = 0; i < words.length; i += n) out.push(words.slice(i, i + n).join(' '))
  return out
}

/** Index des Buchstabens, der in der Mitte (rot) stehen soll (ungefähr das erste Drittel des Wortes). */
export function pivotIndex(word: string): number {
  const len = [...word].length
  if (len <= 1) return 0
  if (len <= 5) return 1
  if (len <= 9) return 2
  if (len <= 13) return 3
  return 4
}

/** Anzeigedauer in Millisekunden. Variabel: lange Wörter und Satzzeichen bekommen mehr Zeit, kurze weniger. */
export function delayMs(group: string, wpm: number, variable: boolean): number {
  const w = Math.min(Math.max(wpm, 50), 2000)
  const wordsInGroup = Math.max(1, group.split(' ').length)
  const base = (60000 / w) * wordsInGroup
  if (!variable) return base
  const len = [...group.replace(/\s/g, '')].length
  const avg = 5 * wordsInGroup
  let f = 0.6 + 0.4 * Math.min(len / avg, 2.2)
  if (/[.!?…]$/.test(group)) f += 0.9
  else if (/[,;:]$/.test(group)) f += 0.4
  return Math.round(base * Math.min(Math.max(f, 0.5), 3))
}
