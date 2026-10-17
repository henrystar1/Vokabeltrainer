import { shuffle, type Rng } from '../learning/random'

/** Kartenmotive (Symbole werden in MemoryGame als farbige Kacheln mit Icon gezeichnet). */
export const MEMORY_SYMBOLS = ['cherry', 'citrus', 'clover', 'bell', 'gem', 'star', 'rocket', 'moon', 'flame', 'heart', 'anchor', 'leaf', 'crown', 'zap', 'cat', 'fish']

/** Anzahl Paare in Runde `level` (ab 1): 3, 4, 5 … höchstens 12. */
export const pairsForLevel = (level: number): number => Math.min(2 + Math.max(1, level), 12)

export interface MemoryCard { id: number; symbol: string }

export function makeDeck(pairs: number, rng: Rng = Math.random): MemoryCard[] {
  const symbols = shuffle(MEMORY_SYMBOLS, rng).slice(0, Math.min(pairs, MEMORY_SYMBOLS.length))
  const cards = symbols.flatMap((symbol) => [symbol, symbol])
  return shuffle(cards, rng).map((symbol, id) => ({ id, symbol }))
}

/** Herzen am Start und Höchstzahl. */
export const MEMORY_LIVES = 5

/**
 * Ein Fehlversuch kostet nur dann ein Herz, wenn er vermeidbar war: Mindestens eine der beiden Karten
 * war in dieser Runde schon einmal aufgedeckt (man hätte sie sich merken können). Reines Aufdecken
 * unbekannter Karten ist frei – das ist Zufall und kein Können.
 */
export const isAvoidableMiss = (seen: ReadonlySet<number>, a: number, b: number): boolean => seen.has(a) || seen.has(b)

/** Eine Runde ganz ohne Herzverlust gibt ein Herz zurück. */
export const heartsAfterRound = (hearts: number, lostInRound: boolean): number => (lostInRound ? hearts : Math.min(MEMORY_LIVES, hearts + 1))
