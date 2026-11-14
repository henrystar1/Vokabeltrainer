/** Tuning: drei Teile je Auto, Stufe 0–5. Gleiche Formeln wie im SQL (car_upgrade). */
export const UP_PARTS = ['motor', 'reifen', 'bremse'] as const
export type UpPart = (typeof UP_PARTS)[number]
export const UP_MAX = 5
export interface Up { motor: number; reifen: number; bremse: number }
export const NO_UP: Up = { motor: 0, reifen: 0, bremse: 0 }
export const UP_LABEL: Record<UpPart, { name: string; text: string }> = {
  motor: { name: 'Motor', text: '+4 % Höchstgeschwindigkeit, +8 % Beschleunigung je Stufe' },
  reifen: { name: 'Reifen', text: '+4 % Lenkung und Grip je Stufe' },
  bremse: { name: 'Bremsen', text: '+6 % Bremskraft je Stufe' },
}
/** Preis der nächsten Stufe in Coins: ein Zehntel des Autopreises (mindestens 500) mal (Stufe + 1). */
export const upPrice = (carPrice: number, level: number): number => Math.max(500, Math.round(carPrice / 10)) * (level + 1)
/** Faktoren auf die Fahrwerte. */
export const upFactors = (u: Up) => ({ top: 1 + 0.04 * u.motor, acc: 1 + 0.08 * u.motor, turn: 1 + 0.04 * u.reifen, brake: 1 + 0.06 * u.bremse })
/** Aus dem kurzen Server-Format {m,r,b} (Online-Spielstand). */
export const upFromShort = (s?: { m?: number; r?: number; b?: number } | null): Up => ({ motor: s?.m ?? 0, reifen: s?.r ?? 0, bremse: s?.b ?? 0 })
