/** Minimap-Farbe je Spieler: stabil aus der Id; der Admin ist immer grün, alle anderen bekommen eine andere Farbe (nie grün). */
export const ADMIN_COLOR = '#22c55e'
const PALETTE = ['#22d3ee', '#f97316', '#e879f9', '#facc15', '#60a5fa', '#f472b6', '#a78bfa', '#fb7185', '#fbbf24', '#38bdf8', '#c084fc', '#f87171']
export const playerColor = (id: string, admin = false): string => {
  if (admin) return ADMIN_COLOR
  let h = 2166136261
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619) }
  return PALETTE[(h >>> 0) % PALETTE.length]
}
