/**
 * Französische Verben für den Konjugier-Trainer. Das Präsens steht von Hand ausgeschrieben (sicherer als Regeln);
 * Imparfait, Futur und Passé composé werden daraus abgeleitet.
 */
export const PRONOUNS = ['je', 'tu', 'il/elle', 'nous', 'vous', 'ils/elles'] as const
export type Tense = 'present' | 'imparfait' | 'futur' | 'passe'

export const TENSE_LABEL: Record<Tense, string> = {
  present: 'Présent',
  imparfait: 'Imparfait',
  futur: 'Futur simple',
  passe: 'Passé composé',
}

export interface Verb {
  inf: string
  de: string
  /** Präsens: je, tu, il, nous, vous, ils. */
  pres: [string, string, string, string, string, string]
  /** Partizip Perfekt (maskulin Singular). */
  pp: string
  aux: 'avoir' | 'être'
  /** Stamm fürs Futur (+ ai, as, a, ons, ez, ont). */
  fut: string
  /** Stamm fürs Imparfait, wenn er nicht aus „nous“ im Präsens folgt. */
  impStem?: string
  /** Komplette Imparfait-Formen, wenn die Regel nicht passt (z. B. manger). */
  imp?: [string, string, string, string, string, string]
}

const v = (inf: string, de: string, pres: Verb['pres'], pp: string, aux: Verb['aux'], fut: string, extra: Partial<Verb> = {}): Verb =>
  ({ inf, de, pres, pp, aux, fut, ...extra })

export const VERBS: Verb[] = [
  v('être', 'sein', ['suis', 'es', 'est', 'sommes', 'êtes', 'sont'], 'été', 'avoir', 'ser', { impStem: 'ét' }),
  v('avoir', 'haben', ['ai', 'as', 'a', 'avons', 'avez', 'ont'], 'eu', 'avoir', 'aur'),
  v('aller', 'gehen, fahren', ['vais', 'vas', 'va', 'allons', 'allez', 'vont'], 'allé', 'être', 'ir'),
  v('faire', 'machen, tun', ['fais', 'fais', 'fait', 'faisons', 'faites', 'font'], 'fait', 'avoir', 'fer'),
  v('dire', 'sagen', ['dis', 'dis', 'dit', 'disons', 'dites', 'disent'], 'dit', 'avoir', 'dir'),
  v('voir', 'sehen', ['vois', 'vois', 'voit', 'voyons', 'voyez', 'voient'], 'vu', 'avoir', 'verr'),
  v('pouvoir', 'können', ['peux', 'peux', 'peut', 'pouvons', 'pouvez', 'peuvent'], 'pu', 'avoir', 'pourr'),
  v('vouloir', 'wollen', ['veux', 'veux', 'veut', 'voulons', 'voulez', 'veulent'], 'voulu', 'avoir', 'voudr'),
  v('savoir', 'wissen', ['sais', 'sais', 'sait', 'savons', 'savez', 'savent'], 'su', 'avoir', 'saur'),
  v('devoir', 'müssen', ['dois', 'dois', 'doit', 'devons', 'devez', 'doivent'], 'dû', 'avoir', 'devr'),
  v('venir', 'kommen', ['viens', 'viens', 'vient', 'venons', 'venez', 'viennent'], 'venu', 'être', 'viendr'),
  v('prendre', 'nehmen', ['prends', 'prends', 'prend', 'prenons', 'prenez', 'prennent'], 'pris', 'avoir', 'prendr'),
  v('mettre', 'setzen, legen', ['mets', 'mets', 'met', 'mettons', 'mettez', 'mettent'], 'mis', 'avoir', 'mettr'),
  v('parler', 'sprechen', ['parle', 'parles', 'parle', 'parlons', 'parlez', 'parlent'], 'parlé', 'avoir', 'parler'),
  v('aimer', 'mögen, lieben', ['aime', 'aimes', 'aime', 'aimons', 'aimez', 'aiment'], 'aimé', 'avoir', 'aimer'),
  v('habiter', 'wohnen', ['habite', 'habites', 'habite', 'habitons', 'habitez', 'habitent'], 'habité', 'avoir', 'habiter'),
  v('regarder', 'anschauen', ['regarde', 'regardes', 'regarde', 'regardons', 'regardez', 'regardent'], 'regardé', 'avoir', 'regarder'),
  v('écouter', 'zuhören', ['écoute', 'écoutes', 'écoute', 'écoutons', 'écoutez', 'écoutent'], 'écouté', 'avoir', 'écouter'),
  v('travailler', 'arbeiten', ['travaille', 'travailles', 'travaille', 'travaillons', 'travaillez', 'travaillent'], 'travaillé', 'avoir', 'travailler'),
  v('jouer', 'spielen', ['joue', 'joues', 'joue', 'jouons', 'jouez', 'jouent'], 'joué', 'avoir', 'jouer'),
  v('donner', 'geben', ['donne', 'donnes', 'donne', 'donnons', 'donnez', 'donnent'], 'donné', 'avoir', 'donner'),
  v('manger', 'essen', ['mange', 'manges', 'mange', 'mangeons', 'mangez', 'mangent'], 'mangé', 'avoir', 'manger', {
    imp: ['mangeais', 'mangeais', 'mangeait', 'mangions', 'mangiez', 'mangeaient'],
  }),
  v('finir', 'beenden', ['finis', 'finis', 'finit', 'finissons', 'finissez', 'finissent'], 'fini', 'avoir', 'finir', { impStem: 'finiss' }),
  v('choisir', 'wählen', ['choisis', 'choisis', 'choisit', 'choisissons', 'choisissez', 'choisissent'], 'choisi', 'avoir', 'choisir', { impStem: 'choisiss' }),
  v('vendre', 'verkaufen', ['vends', 'vends', 'vend', 'vendons', 'vendez', 'vendent'], 'vendu', 'avoir', 'vendr'),
  v('attendre', 'warten', ['attends', 'attends', 'attend', 'attendons', 'attendez', 'attendent'], 'attendu', 'avoir', 'attendr'),
  v('partir', 'abfahren, weggehen', ['pars', 'pars', 'part', 'partons', 'partez', 'partent'], 'parti', 'être', 'partir'),
  v('sortir', 'ausgehen, hinausgehen', ['sors', 'sors', 'sort', 'sortons', 'sortez', 'sortent'], 'sorti', 'être', 'sortir'),
  v('dormir', 'schlafen', ['dors', 'dors', 'dort', 'dormons', 'dormez', 'dorment'], 'dormi', 'avoir', 'dormir'),
  v('ouvrir', 'öffnen', ['ouvre', 'ouvres', 'ouvre', 'ouvrons', 'ouvrez', 'ouvrent'], 'ouvert', 'avoir', 'ouvrir'),
  v('lire', 'lesen', ['lis', 'lis', 'lit', 'lisons', 'lisez', 'lisent'], 'lu', 'avoir', 'lir'),
  v('écrire', 'schreiben', ['écris', 'écris', 'écrit', 'écrivons', 'écrivez', 'écrivent'], 'écrit', 'avoir', 'écrir'),
  v('boire', 'trinken', ['bois', 'bois', 'boit', 'buvons', 'buvez', 'boivent'], 'bu', 'avoir', 'boir'),
  v('croire', 'glauben', ['crois', 'crois', 'croit', 'croyons', 'croyez', 'croient'], 'cru', 'avoir', 'croir'),
  v('connaître', 'kennen', ['connais', 'connais', 'connaît', 'connaissons', 'connaissez', 'connaissent'], 'connu', 'avoir', 'connaîtr', { impStem: 'connaiss' }),
]

const VOWEL = /^[aeiouyhàâéèêëîïôùû]/i

/** je + Vokal → j’ (Elision). */
export function withPronoun(i: number, form: string): string {
  if (i === 0) return VOWEL.test(form) ? `j'${form}` : `je ${form}`
  const p = PRONOUNS[i]
  return `${p === 'il/elle' ? 'il' : p === 'ils/elles' ? 'ils' : p} ${form}`
}

const IMP_END = ['ais', 'ais', 'ait', 'ions', 'iez', 'aient']
const FUT_END = ['ai', 'as', 'a', 'ons', 'ez', 'ont']
const AVOIR = ['ai', 'as', 'a', 'avons', 'avez', 'ont']
const ETRE = ['suis', 'es', 'est', 'sommes', 'êtes', 'sont']

/** Formen (ohne Pronomen) eines Verbs in einer Zeit. */
export function forms(verb: Verb, tense: Tense): string[] {
  switch (tense) {
    case 'present':
      return [...verb.pres]
    case 'imparfait': {
      if (verb.imp) return [...verb.imp]
      const stem = verb.impStem ?? verb.pres[3].replace(/ons$/, '')
      return IMP_END.map((e) => stem + e)
    }
    case 'futur':
      return FUT_END.map((e) => verb.fut + e)
    case 'passe': {
      const aux = verb.aux === 'être' ? ETRE : AVOIR
      // Mit être richtet sich das Partizip nach dem Subjekt (hier die männliche Form; weibliche Formen werden akzeptiert).
      return aux.map((a, i) => `${a} ${verb.pp}${verb.aux === 'être' && i >= 3 ? 's' : ''}`)
    }
  }
}

/** Alle akzeptierten Schreibweisen: nur die Form, oder mit Pronomen (il/elle und ils/elles beide möglich). */
export function accepted(verb: Verb, tense: Tense, i: number): string[] {
  const form = forms(verb, tense)[i]
  if (tense === 'passe' && verb.aux === 'être') {
    const aux = ETRE[i]
    const ends = i >= 3 ? ['s', 'es'] : ['', 'e']
    const base = ends.map((e) => `${aux} ${verb.pp}${e}`)
    const pron = i === 2 ? ['il', 'elle'] : i === 5 ? ['ils', 'elles'] : [PRONOUNS[i]]
    const out = pron.flatMap((p) => base.map((b) => (p === 'je' && VOWEL.test(b) ? `j'${b}` : `${p} ${b}`)))
    return [...new Set([...base, ...out])]
  }
  const withP = (p: string) => (i === 0 && VOWEL.test(form) ? `j'${form}` : `${p} ${form}`)
  const out = [form]
  if (i === 2) out.push(withP('il'), withP('elle'))
  else if (i === 5) out.push(withP('ils'), withP('elles'))
  else out.push(withPronoun(i, form))
  // Passé composé mit „je“ vor Vokal: j’ai / j’ai (Hilfsverb beginnt mit Vokal)
  return [...new Set(out)]
}
