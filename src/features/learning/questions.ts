import type { Direction, PoolVocab } from '../../types'
import { isDue, selectionWeight } from './algorithm'
import { normalizeAnswer } from './answer'
import { shuffle, type Rng } from './random'
import { weightedSample } from './selection'

export interface Question {
  id: string
  vocabularyId: string
  direction: Direction
  prompt: string
  /** Alle akzeptierten Antworten (bei mehreren Lösungen werden alle angezeigt). */
  accepted: string[]
}

export interface VocabLike {
  vocabulary_id: string
  german: string
  /** Weitere gleichwertige deutsche Lösungen. */
  german_alts: string[]
  translations: string[]
}

/** Alle deutschen Lösungen einer Vokabel (Hauptwort zuerst). */
export function germanVariants(v: Pick<VocabLike, 'german' | 'german_alts'>): string[] {
  return [v.german, ...(v.german_alts ?? [])]
}

export interface Indexes {
  /** Fremdsprachige Variante → alle deutschen Lösungen aller Vokabeln mit dieser Variante. */
  toGerman: Map<string, string[]>
  /** Deutsche Variante → alle fremdsprachigen Lösungen aller Vokabeln mit dieser Variante. */
  toForeign: Map<string, string[]>
}

/** Anzahl Vokabeln, die für die gewünschte Anzahl Abfragen nötig sind. */
export function vocabCountFor(questionCount: number, directions: readonly Direction[]): number {
  return directions.length >= 2 ? Math.floor(questionCount / 2) : questionCount
}

function addTo(map: Map<string, string[]>, key: string, values: readonly string[]): void {
  const list = map.get(key) ?? []
  for (const v of values) if (!list.includes(v)) list.push(v)
  map.set(key, list)
}

/**
 * Nachschlagetabellen für beide Richtungen. Haben zwei Vokabeln dieselbe Variante
 * (z. B. dieselbe Übersetzung), gelten die Lösungen beider als richtig.
 */
export function buildIndexes(vocab: readonly VocabLike[]): Indexes {
  const toGerman = new Map<string, string[]>()
  const toForeign = new Map<string, string[]>()
  for (const v of vocab) {
    const de = germanVariants(v)
    for (const t of v.translations) addTo(toGerman, normalizeAnswer(t, false), de)
    for (const g of de) addTo(toForeign, normalizeAnswer(g, false), v.translations)
  }
  return { toGerman, toForeign }
}

function pick<T>(list: readonly T[], rng: Rng): T {
  return list[Math.floor(rng() * list.length)]
}

/** Die eigenen Lösungen kommen zuerst, danach weitere aus dem Index. */
function acceptedFor(own: readonly string[], fromIndex: readonly string[] | undefined): string[] {
  const out = [...own]
  for (const x of fromIndex ?? []) if (!out.includes(x)) out.push(x)
  return out
}

/**
 * direction 'backward' = Fremdsprache → Deutsch, 'forward' = Deutsch → Fremdsprache.
 * Gezeigt wird jeweils eine zufällige Variante; akzeptiert werden alle Lösungen der Gegenseite.
 */
export function makeQuestion(vocab: VocabLike, direction: Direction, idx: Indexes, rng: Rng = Math.random): Question {
  const id = `${vocab.vocabulary_id}:${direction}`
  if (direction === 'forward') {
    const prompt = pick(germanVariants(vocab), rng)
    const accepted = acceptedFor(vocab.translations, idx.toForeign.get(normalizeAnswer(prompt, false)))
    return { id, vocabularyId: vocab.vocabulary_id, direction, prompt, accepted }
  }
  const prompt = pick(vocab.translations, rng)
  const accepted = acceptedFor(germanVariants(vocab), idx.toGerman.get(normalizeAnswer(prompt, false)))
  return { id, vocabularyId: vocab.vocabulary_id, direction, prompt, accepted }
}

/** Kleinster Abstand zwischen den beiden Abfragen derselben Vokabel (Infinity, wenn keine doppelt vorkommt). */
export function minPairGap(questions: readonly Question[]): number {
  const last = new Map<string, number>()
  let gap = Infinity
  questions.forEach((q, i) => {
    const prev = last.get(q.vocabularyId)
    if (prev !== undefined) gap = Math.min(gap, i - prev)
    last.set(q.vocabularyId, i)
  })
  return gap
}

/**
 * Mischt die Abfragen so, dass beide Richtungen derselben Vokabel möglichst weit auseinander
 * liegen (sonst verrät die erste Antwort die zweite) und die Richtungen durchmischt sind.
 */
export function orderQuestions(questions: readonly Question[], rng: Rng = Math.random): Question[] {
  const byVocab = new Map<string, Question[]>()
  for (const q of questions) byVocab.set(q.vocabularyId, [...(byVocab.get(q.vocabularyId) ?? []), q])
  const groups = [...byVocab.values()]
  const pairs = groups.filter((g) => g.length >= 2).length
  if (pairs === 0) return shuffle(questions, rng)

  const target = Math.min(4, pairs)
  let best: Question[] = []
  let bestGap = -1
  for (let attempt = 0; attempt < 80; attempt++) {
    // Immer zuerst Fremdsprache → Deutsch; die Gegenrichtung kommt erst später in der Runde.
    const firsts: Question[] = []
    const seconds: Question[] = []
    for (const g of groups) {
      const first = g.find((q) => q.direction === 'backward') ?? g[0]
      firsts.push(first)
      seconds.push(...g.filter((q) => q !== first))
    }
    const seq = [...shuffle(firsts, rng), ...shuffle(seconds, rng)]
    const gap = minPairGap(seq)
    if (gap > bestGap) {
      best = seq
      bestGap = gap
    }
    if (gap >= target) break
  }
  return best
}

export interface LearnBuildOptions {
  directions: readonly Direction[]
  questionCount: number
  rng?: Rng
}

/**
 * Lernrunde: wählt fällige Vokabeln gewichtet nach Lernstand (niedrig = häufiger, Stufe 5 nie),
 * fragt jede in allen aktiven Richtungen ab und mischt.
 */
export function buildLearningQuestions(pool: readonly PoolVocab[], opts: LearnBuildOptions): Question[] {
  const rng = opts.rng ?? Math.random
  const usable = pool.filter((v) => v.translations.length > 0)
  const due = usable.filter((v) => isDue(v.level))
  const picked = weightedSample(due, (v) => selectionWeight(v.level), vocabCountFor(opts.questionCount, opts.directions), rng)
  const idx = buildIndexes(usable)
  const questions = picked.flatMap((v) => opts.directions.map((d) => makeQuestion(v, d, idx, rng)))
  return orderQuestions(questions, rng)
}

export interface TestBuildOptions {
  directions: readonly Direction[]
  rng?: Rng
}

/**
 * Test: alle Vokabeln des Bereichs in Buchreihenfolge. Bei zwei Richtungen zuerst alle
 * Fremdsprache → Deutsch, danach alle Deutsch → Fremdsprache (jeweils in Buchreihenfolge).
 */
export function buildTestQuestions(
  inRange: readonly VocabLike[],
  reverseSource: readonly VocabLike[],
  opts: TestBuildOptions,
): Question[] {
  const rng = opts.rng ?? Math.random
  const idx = buildIndexes(reverseSource.filter((v) => v.translations.length > 0))
  const usable = inRange.filter((v) => v.translations.length > 0)
  const order: Direction[] = (['backward', 'forward'] as const).filter((d) => opts.directions.includes(d))
  return order.flatMap((d) => usable.map((v) => makeQuestion(v, d, idx, rng)))
}
