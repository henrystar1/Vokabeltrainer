import { cleanList } from '../entry/rows'

/** Grammatik-Kürzel hinter dem Stichwort: m./f. adj., f. pl., adv. … */
const GRAMMAR = /^(m|f|pl|ad[jli;]?|adv|inv|prép|prep|conj|pron)[.;,]?$/i
const GENDER_PAIR = /^[mf][.,]?\/[mf][.,]?$/i

export const isGrammarToken = (t: string): boolean => GRAMMAR.test(t) || GENDER_PAIR.test(t)

const hasLetter = (s: string): boolean => /\p{L}/u.test(s)

/** Lautschrift in eckigen Klammern entfernen (auch unvollständig erkannte). */
export function stripPhonetics(text: string): string {
  return text.replace(/\[[^\]]*\]/g, ' ').replace(/\[[^\]]*$/, ' ')
}

/**
 * Französische Seite bereinigen: Lautschrift und Grammatik-Kürzel entfernen, Aufzählzeichen vorne
 * weg, Formen wie "professionnel/professionnelle" in zwei Lösungen aufteilen.
 * Kürzel wie "qn/qc" bleiben unverändert (beide Teile sind sehr kurz).
 */
export function cleanForeignText(raw: string): string[] {
  let t = stripPhonetics(raw).replace(/\s+/g, ' ').trim()
  t = t.replace(/^[^\p{L}'’(]+/u, '')
  const tokens = t.split(' ').filter(Boolean)
  while (tokens.length > 0) {
    const last = tokens[tokens.length - 1]
    if (isGrammarToken(last) || !hasLetter(last)) tokens.pop()
    else break
  }
  if (tokens.length === 0) return []
  const i = tokens.findIndex((tok) => {
    const parts = tok.split('/')
    return parts.length === 2 && parts.every((p) => /^\p{L}[\p{L}'’-]{2,}$/u.test(p))
  })
  if (i === -1) return cleanList([tokens.join(' ')])
  const [left, right] = tokens[i].split('/')
  const make = (variant: string) => [...tokens.slice(0, i), variant, ...tokens.slice(i + 1)].join(' ')
  return cleanList([make(left), make(right)])
}

/** Komma/Semikolon außerhalb von Klammern als Trennstellen. */
function splitOutsideParens(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of text) {
    if (ch === '(') depth++
    if (ch === ')') depth = Math.max(0, depth - 1)
    if ((ch === ',' || ch === ';') && depth === 0) {
      parts.push(cur)
      cur = ''
    } else cur += ch
  }
  parts.push(cur)
  return parts
}

/**
 * Deutsche Seite bereinigen: Verweise ("▶ Verbes, p. 139") und Hinweise ("wird wie finir konjugiert")
 * entfernen, dann an Kommas und "auch:" in einzelne Lösungen teilen.
 */
export function cleanGermanText(raw: string): string[] {
  let t = raw.replace(/\s+/g, ' ').trim()
  t = t.replace(/\s*[▶►»>]\s*(Verbes|Méthodes|Methodes|Grammatik|Lektion|p\.?\s*\d).*$/i, '')
  t = t.replace(/\s*(Verbes|Méthodes),?\s*p\.?\s*\d+.*$/i, '')
  t = t.replace(/\bwird wie\b.*?\bkonjugiert\b/gi, ' ')
  t = t.replace(/\bauch\s*[:;.]\s*/gi, ', ')
  const parts = splitOutsideParens(t)
    .map((p) => p.replace(/^[\s\-–—|_]+|[\s|_]+$/g, '').replace(/[.:]+$/, '').trim())
    .filter((p) => hasLetter(p))
  return cleanList(parts)
}
