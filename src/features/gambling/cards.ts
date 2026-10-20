/** Spielkarten für Black Jack: Kartennummer 0..51, Rang = n % 13 (0 = Ass), Farbe = Math.floor(n / 13). */
export const SUITS = ['♠', '♥', '♦', '♣'] as const
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'B', 'D', 'K']

export function cardRank(n: number): string {
  return RANKS[((n % 13) + 13) % 13]
}
export function cardSuit(n: number): string {
  return SUITS[Math.floor(n / 13) % 4]
}
export function cardIsRed(n: number): boolean {
  const s = Math.floor(n / 13) % 4
  return s === 1 || s === 2
}
/** Wert wie auf dem Server (Ass zählt 11, solange es nicht über 21 geht). */
export function handTotal(cards: number[]): number {
  let s = 0
  let aces = 0
  for (const c of cards) {
    const r = c % 13
    if (r === 0) { aces++; s += 1 } else s += r >= 9 ? 10 : r + 1
  }
  return aces > 0 && s + 10 <= 21 ? s + 10 : s
}
