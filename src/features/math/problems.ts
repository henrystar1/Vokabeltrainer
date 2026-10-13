/** Kopfrechen-Aufgaben: + − × ÷ in fünf Schwierigkeitsstufen. Division geht immer ohne Rest auf. */

export type Op = '+' | '-' | '*' | '/'
export type Level = 1 | 2 | 3 | 4 | 5

export const OPS: { op: Op; sign: string; name: string }[] = [
  { op: '+', sign: '+', name: 'Plus' },
  { op: '-', sign: '−', name: 'Minus' },
  { op: '*', sign: '×', name: 'Mal' },
  { op: '/', sign: '÷', name: 'Geteilt' },
]

export const LEVELS: { level: Level; name: string; hint: Record<Op, string> }[] = [
  { level: 1, name: 'Sehr leicht', hint: { '+': 'bis 20', '-': 'bis 20', '*': 'kleines 1×1', '/': 'kleines 1×1' } },
  { level: 2, name: 'Leicht', hint: { '+': 'bis 100', '-': 'bis 100', '*': 'großes 1×1', '/': 'großes 1×1' } },
  { level: 3, name: 'Mittel', hint: { '+': 'bis 1000', '-': 'bis 1000', '*': 'zweistellig × einstellig', '/': 'Ergebnis zweistellig' } },
  { level: 4, name: 'Schwer', hint: { '+': 'bis 10 000', '-': 'bis 10 000', '*': 'zweistellig × zweistellig', '/': 'Teiler 11 bis 30' } },
  { level: 5, name: 'Profi', hint: { '+': 'bis 100 000', '-': 'auch negativ', '*': 'dreistellig × zweistellig', '/': 'dreistelliges Ergebnis' } },
]

export interface Problem { text: string; answer: number; op: Op }

export type Rng = () => number

const int = (r: Rng, a: number, b: number) => a + Math.floor(r() * (b - a + 1))

function make(op: Op, level: Level, r: Rng): Problem {
  const sign = OPS.find((o) => o.op === op)!.sign
  let a = 0
  let b = 0
  let answer = 0
  switch (op) {
    case '+': {
      const max = [0, 20, 100, 1000, 10000, 100000][level]
      a = int(r, level === 1 ? 1 : Math.floor(max / 10), max - 1)
      b = int(r, 1, max - a > 1 ? max - a : 1)
      if (level >= 3) b = int(r, Math.floor(max / 20), max - 1)
      answer = a + b
      break
    }
    case '-': {
      const max = [0, 20, 100, 1000, 10000, 100000][level]
      a = int(r, Math.floor(max / 10) + 1, max)
      b = int(r, 1, level === 5 ? max : a)
      answer = a - b
      break
    }
    case '*': {
      if (level === 1) { a = int(r, 2, 5); b = int(r, 2, 10) }
      else if (level === 2) { a = int(r, 2, 10); b = int(r, 2, 10) }
      else if (level === 3) { a = int(r, 12, 99); b = int(r, 2, 9) }
      else if (level === 4) { a = int(r, 12, 99); b = int(r, 11, 99) }
      else { a = int(r, 100, 999); b = int(r, 11, 99) }
      answer = a * b
      break
    }
    case '/': {
      let q = 0
      let d = 0
      if (level === 1) { d = int(r, 2, 5); q = int(r, 2, 10) }
      else if (level === 2) { d = int(r, 2, 10); q = int(r, 2, 12) }
      else if (level === 3) { d = int(r, 2, 9); q = int(r, 10, 99) }
      else if (level === 4) { d = int(r, 11, 30); q = int(r, 10, 99) }
      else { d = int(r, 12, 50); q = int(r, 100, 999) }
      a = q * d
      b = d
      answer = q
      break
    }
  }
  return { text: `${a.toLocaleString('de-DE')} ${sign} ${b.toLocaleString('de-DE')}`, answer, op }
}

/** Erzeugt `count` verschiedene Aufgaben; die gewählten Rechenarten wechseln sich zufällig ab. */
export function generateProblems(ops: Op[], level: Level, count: number, rng: Rng = Math.random): Problem[] {
  if (ops.length === 0 || count <= 0) return []
  const out: Problem[] = []
  const seen = new Set<string>()
  let guard = 0
  while (out.length < count && guard++ < count * 50) {
    const p = make(ops[Math.floor(rng() * ops.length)], level, rng)
    if (seen.has(p.text)) continue
    seen.add(p.text)
    out.push(p)
  }
  return out
}

/** Liest eine eingegebene Zahl (Komma/Punkt, Minus-Zeichen, Tausenderpunkte, Leerzeichen). Ungültig = null. */
export function parseAnswer(input: string): number | null {
  const s = input.trim().replace(/\s/g, '').replace(/[−–]/g, '-')
  if (!/^-?\d+$/.test(s.replace(/\./g, ''))) return null
  const n = Number(s.replace(/\./g, ''))
  return Number.isSafeInteger(n) ? n : null
}
