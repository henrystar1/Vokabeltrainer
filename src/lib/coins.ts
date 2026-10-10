/** Größte Menge, die ein Admin auf einmal buchen darf (1 Billiarde). */
export const MAX_GRANT = 1_000_000_000_000_000

const MULT: Record<string, number> = { k: 1e3, m: 1e6, mio: 1e6, mrd: 1e9, b: 1e12, bio: 1e12 }

/** Liest "1000", "1k", "2,5m", "3mrd", "1b" (b/bio = Billion = 10^12), auch mit Minus. NaN, wenn ungültig. */
export function parseCoins(text: string): number {
  let t = text.toLowerCase().replace(/[\s_]/g, '')
  if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '') // 1.000.000 = Tausenderpunkte
  const m = /^(-?)(\d{1,16}(?:[.,]\d{1,6})?)(k|mio|mrd|bio|m|b)?$/.exec(t.replace(',', '.'))
  if (!m) return Number.NaN
  const base = Number(m[2])
  const v = Math.round(base * (m[3] ? MULT[m[3]] : 1))
  return m[1] ? -v : v
}

/** Kurz anzeigen: ab 1 Milliarde als "5,2 Mrd.", "1,5 Bio.", "2 Brd." (Billiarde); darunter ausgeschrieben. */
export function shortCoins(n: number): string {
  const units: Array<[number, string]> = [[1e15, 'Brd.'], [1e12, 'Bio.'], [1e9, 'Mrd.']]
  for (const [v, l] of units) {
    if (Math.abs(n) >= v) return `${(n / v).toLocaleString('de-DE', { maximumFractionDigits: 2 })} ${l}`
  }
  return n.toLocaleString('de-DE')
}
