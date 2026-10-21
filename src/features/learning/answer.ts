/**
 * Antwortvergleich. Erlaubt sind nur Schreibweisen, die keine Tippfehler sind:
 *  - Groß-/Kleinschreibung (abschaltbar über "Groß-/Kleinschreibung beachten")
 *  - überzählige Leerzeichen
 *  - typografische Anführungszeichen/Apostrophe (iPad setzt ’ statt ')
 *  - Unicode-Normalform (é als ein Zeichen oder e + Akzent)
 * Tippfehler bleiben falsch, es gibt keine Fehlerkorrektur.
 *
 * Zusätzlich großzügig bei Vokabel-Schreibweisen (siehe `answerVariants`):
 *  - englisches „to“ vor dem Verb und Bindestriche sind egal („to be“ = „be“, „well-known“ = „well known“)
 *  - Alternativen mit Schrägstrich: „avoir qc/qn“ → auch „avoir qc“ oder „avoir qn“
 *  - Abkürzungen für „jemand/etwas“ (qc, qn, sth, sb, etw., jdn. …) dürfen fehlen
 *  - Klammern sind optional: „(se) lever“ → „se lever“ oder „lever“
 *  - Spanisch: Akzente, ñ, ü sowie ¿ und ¡ dürfen fehlen („cafe“ = „café“, „manana“ = „mañana“)
 *  - Leerzeichen dürfen ganz fehlen: „icecream“ = „ice cream“, „jetaime“ = „je t'aime“
 */
export function normalizeAnswer(text: string, caseSensitive: boolean): string {
  const t = text
    .normalize('NFC')
    .replace(/[‘’‛′ʼ]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[   ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return caseSensitive ? t : t.toLowerCase()
}

/** Kürzel für „jemand/etwas“, die man weglassen darf. */
const OPTIONAL_WORDS = new Set(['qc', 'qn', 'qch', 'qqn', 'qqch', 'sth', 'sb', 'sth.', 'sb.', 'etw', 'etw.', 'jdn', 'jdn.', 'jdm', 'jdm.', 'jmd', 'jmd.', 'one', "one's"])
const MAX_VARIANTS = 64

/** Zerlegt Text an Leerzeichen, ohne Klammergruppen zu trennen. */
function tokens(text: string): string[] {
  return text.match(/\([^)]*\)\S*|\S+/g) ?? []
}

/** Alle gleichwertigen Schreibweisen einer Lösung (immer inklusive der Originalschreibweise). */
export function answerVariants(accepted: string): string[] {
  let combos: string[][] = [[]]
  for (const tok of tokens(accepted)) {
    const options: string[][] = []
    const paren = /^\(([^)]*)\)(\S*)$/.exec(tok)
    if (paren) {
      options.push([paren[1] + paren[2]], paren[2] ? [paren[2]] : [])
    } else if (tok.includes('/') && !/^\d+\/\d+$/.test(tok) && tok.split('/').every((x) => x.length > 0)) {
      for (const alt of tok.split('/')) options.push([alt])
      options.push([tok])
      if (tok.split('/').every((x) => OPTIONAL_WORDS.has(x.toLowerCase()))) options.push([])
    } else {
      options.push([tok])
      if (OPTIONAL_WORDS.has(tok.toLowerCase())) options.push([])
    }
    const next: string[][] = []
    for (const c of combos) for (const o of options) {
      next.push([...c, ...o])
      if (next.length >= MAX_VARIANTS) break
    }
    combos = next.slice(0, MAX_VARIANTS)
  }
  const out = new Set<string>([accepted, ...combos.map((c) => c.join(' '))])
  return [...out].filter((x) => x.trim() !== '')
}

/** Vergleichsform: Bindestriche wie Leerzeichen, „to “ am Anfang weg (nur wenn noch ein Wort folgt). */
function canonical(text: string, caseSensitive: boolean): string {
  let t = normalizeAnswer(text.replace(/[‐‑‒–—−-]/g, ' '), caseSensitive)
  t = t.replace(/\.(?=\s|$)/g, '').replace(/\s+/g, ' ').trim()
  const m = /^to (.+)$/i.exec(t)
  return m ? m[1] : t
}

/** Sprache, in der gerade gelernt wird. Bei Spanisch dürfen Akzente, ñ, ü sowie ¿ ¡ ? ! fehlen. */
let answerLanguage: string | null = null
export function setAnswerLanguage(lang: string | null | undefined): void {
  answerLanguage = lang ?? null
}

/** Entfernt Akzente und spanische Satzzeichen (á→a, ñ→n, ü→u, ¿¡ weg). */
export function foldSpanish(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[¿¡?!]/g, '').normalize('NFC')
}

const noSpaces = (s: string) => s.replace(/\s+/g, '')

export function isAnswerCorrect(given: string, accepted: readonly string[], caseSensitive: boolean, lang: string | null = answerLanguage): boolean {
  const fold = (t: string) => (lang === 'es' ? foldSpanish(t) : t)
  const g = noSpaces(fold(canonical(given, caseSensitive)))
  if (g === '') return false
  return accepted.some((a) => answerVariants(a).some((v) => noSpaces(fold(canonical(v, caseSensitive))) === g))
}
