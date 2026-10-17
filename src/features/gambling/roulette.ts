import type { RouletteBet } from '../../services/play'

/** Reihenfolge der Felder auf dem europäischen Rad (im Uhrzeigersinn). */
export const WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26]
export const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36])
export const colorOf = (n: number): 'green' | 'red' | 'black' => (n === 0 ? 'green' : RED.has(n) ? 'red' : 'black')

export const betKey = (b: Pick<RouletteBet, 't' | 'v'>): string => `${b.t}:${b.v ?? 0}`

/** Auszahlungsfaktor einer Wette inkl. Einsatz. */
export const betFactor = (t: RouletteBet['t']): number => (t === 'straight' ? 36 : t === 'dozen' || t === 'column' ? 3 : 2)

/** Gewinnt die Wette bei der Zahl n? (Lokal nur zur Vorschau; das Ergebnis kommt vom Server.) */
export function betWins(b: Pick<RouletteBet, 't' | 'v'>, n: number): boolean {
  if (b.t === 'straight') return n === b.v
  if (n === 0) return false
  switch (b.t) {
    case 'red': return RED.has(n)
    case 'black': return !RED.has(n)
    case 'even': return n % 2 === 0
    case 'odd': return n % 2 === 1
    case 'low': return n <= 18
    case 'high': return n >= 19
    case 'dozen': return Math.floor((n - 1) / 12) + 1 === b.v
    case 'column': return ((n - 1) % 3) + 1 === b.v
  }
}

/** Zeilen des Tischs: oben 3,6,…,36 – Mitte 2,5,… – unten 1,4,… */
export const TABLE_ROWS: number[][] = [0, 1, 2].map((r) => Array.from({ length: 12 }, (_, c) => c * 3 + (3 - r)))

/** Wetten ohne Duplikate zusammenfassen (gleiche Wette = Beträge addieren). */
export function addChip(bets: RouletteBet[], bet: Pick<RouletteBet, 't' | 'v'>, amount: number, maxBet: number): RouletteBet[] {
  const k = betKey(bet)
  const i = bets.findIndex((b) => betKey(b) === k)
  if (i >= 0) {
    const next = [...bets]
    next[i] = { ...next[i], a: Math.min(maxBet, next[i].a + amount) }
    return next
  }
  if (bets.length >= 10) return bets
  return [...bets, { t: bet.t, ...(bet.v !== undefined ? { v: bet.v } : {}), a: Math.min(maxBet, amount) }]
}

export const totalOf = (bets: RouletteBet[]): number => bets.reduce((s, b) => s + b.a, 0)
