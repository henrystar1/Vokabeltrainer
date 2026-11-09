/** Brett von „Mensch ärgere dich nicht“ auf einem 11×11-Raster. Feld = [Spalte, Zeile]. */
export const TRACK: Array<[number, number]> = [
  [0, 4], [1, 4], [2, 4], [3, 4], [4, 4], [4, 3], [4, 2], [4, 1], [4, 0], [5, 0],
  [6, 0], [6, 1], [6, 2], [6, 3], [6, 4], [7, 4], [8, 4], [9, 4], [10, 4], [10, 5],
  [10, 6], [9, 6], [8, 6], [7, 6], [6, 6], [6, 7], [6, 8], [6, 9], [6, 10], [5, 10],
  [4, 10], [4, 9], [4, 8], [4, 7], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6], [0, 5],
]
/** Zielfelder je Platz (rel 40..43). */
export const HOME_LANE: Array<Array<[number, number]>> = [
  [[1, 5], [2, 5], [3, 5], [4, 5]],
  [[5, 1], [5, 2], [5, 3], [5, 4]],
  [[9, 5], [8, 5], [7, 5], [6, 5]],
  [[5, 9], [5, 8], [5, 7], [5, 6]],
]
/** Haus-Felder je Platz (rel −1, vier Figuren). */
export const HOUSE: Array<Array<[number, number]>> = [
  [[0, 0], [1, 0], [0, 1], [1, 1]],
  [[9, 0], [10, 0], [9, 1], [10, 1]],
  [[9, 9], [10, 9], [9, 10], [10, 10]],
  [[0, 9], [1, 9], [0, 10], [1, 10]],
]
export const SEAT_COLORS = ['#ef4444', '#3b82f6', '#eab308', '#22c55e']
export const SEAT_NAMES = ['Rot', 'Blau', 'Gelb', 'Grün']

/** Rasterfeld einer Figur: rel −1 = Haus (Nummer der Figur wählt das Hausfeld), 0..39 Rundweg, 40..43 Ziel. */
export function cellOf(seat: number, rel: number, piece: number): [number, number] {
  if (rel < 0) return HOUSE[seat][piece]
  if (rel >= 40) return HOME_LANE[seat][rel - 40]
  return TRACK[(rel + seat * 10) % 40]
}
