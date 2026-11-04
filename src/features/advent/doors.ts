import type { AdventReward } from '../../services/tasks'
import type { Reward } from '../../components/ui/RewardReveal'

/** Reihenfolge der 24 Türchen im Kalender: gemischt, aber pro Jahr immer gleich. */
export function doorOrder(year: number): number[] {
  const days = Array.from({ length: 24 }, (_, i) => i + 1)
  let s = (year * 2654435761) >>> 0
  const next = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 }
  for (let i = days.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [days[i], days[j]] = [days[j], days[i]]
  }
  return days
}

/** Serverbelohnung in Anzeige-Belohnung für die Animation. */
export function toReveal(rs: AdventReward[]): Reward[] {
  return rs.map((r): Reward => (r.type === 'item' ? { type: 'item', item: { id: r.id, kind: r.kind, name: r.name, price: r.price } } : r))
}

/** Kurztext fürs geöffnete Türchen. */
export function rewardEmoji(rs: AdventReward[]): string {
  return rs.map((r) => (r.type === 'coins' ? '💵' : r.type === 'points' ? '🏆' : r.type === 'plus' ? '💎' : '🎨')).join('')
}
