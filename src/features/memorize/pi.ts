/** Pi auswendig lernen: die ersten 500 Nachkommastellen. */
export const PI_DIGITS = '14159265358979323846264338327950288419716939937510582097494459230781640628620899862803482534211706798214808651328230664709384460955058223172535940812848111745028410270193852110555964462294895493038196442881097566593344612847564823378678316527120190914564856692346034861045432664821339360726024914127372458700660631558817488152092096282925409171536436789259036001133053054882046652138414695194151160943305727036575959195309218611738193261179310511854807446237996274956735188575272489122793818301194912'

/** Stellen in Gruppen (5er-Blöcke) für die Anzeige, z. B. "14159 26535". */
export function groupDigits(digits: string, size = 5): string[] {
  const out: string[] = []
  for (let i = 0; i < digits.length; i += size) out.push(digits.slice(i, i + size))
  return out
}

export interface PiCheck { ok: boolean; /** Anzahl bis jetzt richtig getippter Stellen */ correct: number; expected: string }

/** Prüft die nächste getippte Ziffer. `typed` sind die bisher richtigen Stellen (ohne die neue). */
export function checkDigit(typed: string, digit: string, digits: string = PI_DIGITS): PiCheck {
  const expected = digits[typed.length] ?? ''
  const ok = expected !== '' && digit === expected
  return { ok, correct: typed.length + (ok ? 1 : 0), expected }
}
