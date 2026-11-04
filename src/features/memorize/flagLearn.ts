import { COUNTRIES, type Country, type Rng } from './flags'

/**
 * Lernsystem für Flaggen (Karteikasten): Jedes Land liegt in einem Fach 0–5. Richtig = ein Fach weiter, falsch = zwei zurück.
 * Je höher das Fach, desto länger dauert es bis zur nächsten Abfrage. In niedrigen Fächern wählt man aus vier Ländern,
 * ab Fach 2 muss man den Namen eintippen. „Gemeistert“ ist ein Land ab Fach 4.
 */
export const MAX_BOX = 5
export const MASTERED_BOX = 4
/** Wartezeit bis zur nächsten Abfrage je Fach, in Minuten. */
export const BOX_MINUTES = [0, 10, 24 * 60, 3 * 24 * 60, 7 * 24 * 60, 21 * 24 * 60]
/** Ab diesem Fach wird getippt statt gewählt. */
export const TYPE_FROM_BOX = 2

export interface Card { box: number; due: number }
export type Cards = Record<string, Card>

export const mastered = (cards: Cards): number => COUNTRIES.filter((c) => (cards[c.code]?.box ?? 0) >= MASTERED_BOX).length

export function grade(card: Card | undefined, correct: boolean, now: number): Card {
  const box = card?.box ?? 0
  const next = correct ? Math.min(MAX_BOX, box + 1) : Math.max(0, box - 2)
  return { box: next, due: now + (correct ? BOX_MINUTES[next] : 0) * 60_000 }
}

export const isTyped = (card: Card | undefined): boolean => (card?.box ?? 0) >= TYPE_FROM_BOX

/** Eine Lernrunde: zuerst fällige Länder (niedrige Fächer, am längsten überfällig), dann neue, höchstens `newMax`. */
export function pickSession(pool: readonly Country[], cards: Cards, now: number, size = 10, newMax = 4, r: Rng = Math.random): Country[] {
  const due = pool
    .filter((c) => cards[c.code] && cards[c.code].due <= now)
    .sort((a, b) => cards[a.code].box - cards[b.code].box || cards[a.code].due - cards[b.code].due)
  const fresh = pool.filter((c) => !cards[c.code])
  for (let i = fresh.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [fresh[i], fresh[j]] = [fresh[j], fresh[i]] }
  const out: Country[] = due.slice(0, size)
  for (const c of fresh) { if (out.length >= size || out.filter((x) => !cards[x.code]).length >= newMax) break; out.push(c) }
  return out
}

// ---------------------------------------------------------------- Namen prüfen

const ALIASES: Record<string, string[]> = {
  us: ['usa', 'vereinigte staaten von amerika', 'amerika', 'vereinigtestaaten'],
  gb: ['england', 'grossbritannien', 'großbritannien', 'uk', 'vereinigtes königreich', 'britannien'],
  cz: ['tschechische republik', 'tschechei'],
  ci: ['cote divoire', "côte d'ivoire", 'elfenbeinküste'],
  cd: ['kongo', 'dr kongo', 'demokratische republik kongo'],
  ba: ['bosnien', 'bosnien herzegowina'],
  mk: ['mazedonien'],
  ae: ['vae', 'emirate', 'arabische emirate'],
  kr: ['korea', 'republik korea'],
  kp: ['nordkorea'],
  mm: ['burma'],
  ru: ['russische föderation'],
  by: ['weißrussland', 'weissrussland'],
  nl: ['holland'],
  sa: ['saudi arabien'],
  tr: ['turkei'],
  pg: ['papua neuguinea'],
  sz: ['eswatini', 'swasiland'],
  la: ['laos'],
  do: ['dom rep'],
}

/** Kleinbuchstaben, ä/ö/ü/ß ausgeschrieben, übrige Akzente weg, nur Buchstaben und Ziffern. */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = tmp
    }
  }
  return prev[b.length]
}

/** Stimmt die Eingabe? Alternative Namen sind erlaubt, bei längeren Namen auch ein kleiner Tippfehler. */
export function matchesName(input: string, country: Country): boolean {
  const typed = normalizeName(input)
  if (typed.length < 2) return false
  const names = [country.name, ...(ALIASES[country.code] ?? [])].map(normalizeName)
  return names.some((n) => {
    if (typed === n) return true
    const tol = n.length >= 9 ? 2 : n.length >= 5 ? 1 : 0
    return tol > 0 && levenshtein(typed, n) <= tol
  })
}

const KEY = 'flags-leitner-v1'
export function loadCards(): Cards {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as Cards
    const out: Cards = {}
    for (const [k, v] of Object.entries(raw)) if (v && typeof v.box === 'number' && typeof v.due === 'number') out[k] = { box: Math.max(0, Math.min(MAX_BOX, Math.floor(v.box))), due: v.due }
    return out
  } catch { return {} }
}
export function saveCards(c: Cards): void {
  try { window.localStorage.setItem(KEY, JSON.stringify(c)) } catch { /* egal */ }
}
