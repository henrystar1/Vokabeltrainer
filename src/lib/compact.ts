/** Kurzschreibweise für große Coin-Beträge: 1500 → "1,5k", 2 000 000 → "2M", 3e9 → "3Mrd", 1e12 → "1Bio", 1e15 → "1Brd". */
export function fmtCompact(n: number): string {
  const steps: Array<[number, string]> = [[1e15, 'Brd'], [1e12, 'Bio'], [1e9, 'Mrd'], [1e6, 'M'], [1e3, 'k']]
  for (const [v, s] of steps) {
    if (Math.abs(n) >= v) {
      const x = n / v
      return `${x.toLocaleString('de-DE', { maximumFractionDigits: x < 10 ? 1 : 0 })}${s}`
    }
  }
  return String(n)
}
