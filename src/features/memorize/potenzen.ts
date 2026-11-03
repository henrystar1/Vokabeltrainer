/** Hochzahlen (Potenzen) lernen: Quadrate, Kuben, Zweier-Potenzen und mehr, in vier Stufen. */
export type Rng = () => number
export type PowLevel = 1 | 2 | 3 | 4

export interface PowProblem {
  /** Aufgabe als Teile für die Anzeige: Basis, Hochzahl (null = gesucht) */
  base: number
  exp: number | null
  /** gesuchter Wert: Ergebnis oder Hochzahl */
  answer: number
  /** Ergebnis der Potenz (immer bekannt) */
  value: number
  kind: 'value' | 'exp'
}

export const POW_LEVELS: Array<{ level: PowLevel; name: string; hint: string }> = [
  { level: 1, name: 'Quadrate', hint: '1² bis 15²' },
  { level: 2, name: 'Quadrate und Kuben', hint: 'Quadrate bis 20², Kuben bis 10³, Zweierpotenzen bis 2⁸' },
  { level: 3, name: 'Fortgeschritten', hint: 'Quadrate bis 30², Kuben bis 15³, Zweier bis 2¹⁶, 3er bis 3⁶, 10er' },
  { level: 4, name: 'Profi', hint: 'wie Stufe 3, dazu „Welche Hochzahl?“ (z. B. 2? = 1024)' },
]

const int = (r: Rng, a: number, b: number) => a + Math.floor(r() * (b - a + 1))

/** Alle möglichen Basis/Hochzahl-Paare der Stufe. */
export function pairsFor(level: PowLevel): Array<[number, number]> {
  const out: Array<[number, number]> = []
  const add = (bases: number[], exps: number[]) => { for (const b of bases) for (const e of exps) out.push([b, e]) }
  const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i)
  if (level === 1) add(range(1, 15), [2])
  else if (level === 2) { add(range(2, 20), [2]); add(range(2, 10), [3]); add([2], range(3, 8)) }
  else {
    add(range(2, 30), [2]); add(range(2, 15), [3]); add([2], range(3, 16)); add([3], range(3, 6)); add([5], [3, 4]); add([10], range(2, 6))
    add([4], [3, 4, 5]); add(range(6, 9), [4])
  }
  // doppelte Paare entfernen
  const seen = new Set<string>()
  return out.filter(([b, e]) => { const k = `${b}^${e}`; if (seen.has(k)) return false; seen.add(k); return true })
}

export function makeProblem(level: PowLevel, r: Rng = Math.random): PowProblem {
  const pairs = pairsFor(level)
  const [base, exp] = pairs[int(r, 0, pairs.length - 1)]
  const value = base ** exp
  if (level === 4 && exp >= 3 && r() < 0.4) return { base, exp: null, answer: exp, value, kind: 'exp' }
  return { base, exp, answer: value, value, kind: 'value' }
}

export function makeProblems(level: PowLevel, count: number, r: Rng = Math.random): PowProblem[] {
  const out: PowProblem[] = []
  let guard = 0
  while (out.length < count && guard++ < count * 20) {
    const p = makeProblem(level, r)
    const same = out.some((q) => q.base === p.base && q.value === p.value && q.kind === p.kind)
    if (!same || guard > count * 10) out.push(p)
  }
  return out
}

const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' }
export const superscript = (n: number): string => String(n).split('').map((c) => SUP[c] ?? c).join('')

/** Aufgabentext, z. B. "7² = ?" oder "2? = 1024". */
export function problemText(p: PowProblem): string {
  return p.kind === 'exp' ? `${p.base}? = ${p.value}` : `${p.base}${superscript(p.exp ?? 0)} = ?`
}

export function parseNumber(s: string): number | null {
  const t = s.trim().replace(/[.\s]/g, '')
  return /^-?\d+$/.test(t) ? Number(t) : null
}

/** Lösung als Text, z. B. "2¹⁰ = 1024". */
export function solutionText(p: PowProblem): string {
  return `${p.base}${superscript(p.kind === 'exp' ? p.answer : p.exp ?? 0)} = ${p.value}`
}
