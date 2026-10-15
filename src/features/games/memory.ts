import { shuffle, type Rng } from '../learning/random'

export const MEMORY_SYMBOLS = ['🍎', '🍌', '🍇', '🍓', '🍒', '🥝', '🍍', '🥕', '🌽', '🍄', '⭐', '🌙', '🔔', '🎈', '🎲', '🚀']

/** Anzahl Paare in Runde `level` (ab 1): 3, 4, 5 … höchstens 12. */
export const pairsForLevel = (level: number): number => Math.min(2 + Math.max(1, level), 12)

export interface MemoryCard { id: number; symbol: string }

export function makeDeck(pairs: number, rng: Rng = Math.random): MemoryCard[] {
  const symbols = shuffle(MEMORY_SYMBOLS, rng).slice(0, Math.min(pairs, MEMORY_SYMBOLS.length))
  const cards = symbols.flatMap((symbol) => [symbol, symbol])
  return shuffle(cards, rng).map((symbol, id) => ({ id, symbol }))
}

/** Fehlversuche, nach denen das Spiel endet. */
export const MEMORY_LIVES = 6
