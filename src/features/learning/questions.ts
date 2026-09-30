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
  translations: string[]
}

/** Anzahl Vokabeln, die für die gewünschte Anzahl Abfragen nötig sind. */
export function vocabCountFor(questionCount: number, directions: readonly Direction[]): number {
  return directions.length >= 2 ? Math.floor(questionCount / 2) : questionCount
}

/** Übersetzung → alle deutschen Wörter, die diese Übersetzung haben (für die Rückrichtung). */
export function buildReverseIndex(vocab: readonly VocabLike[]): Map<string, string[]> {
  const index = new Map<string, string[]>()
  for (const v of vocab) {
    for (const t of v.translations) {
      const key = normalizeAnswer(t, false)
      const list = index.get(key) ?? []
      if (!list.includes(v.german)) list.push(v.german)
      index.set(key, list)
    }
  }
  return index
}

export function makeQuestion(
  vocab: VocabLike,
  direction: Direction,
  reverse: Map<string, string[]>,
  rng: Rng = Math.random,
): Question {
  const id = `${vocab.vocabulary_id}:${direction}`
  if (direction === 'forward') {
    return { id, vocabularyId: vocab.vocabulary_id, direction, prompt: vocab.german, accepted: [...vocab.translations] }
  }
  const prompt = vocab.translations[Math.floor(rng() * vocab.translations.length)]
  const germans = reverse.get(normalizeAnswer(prompt, false)) ?? [vocab.german]
  // Eigenes Wort zuerst, dann weitere deutsche Wörter mit derselben Übersetzung.
  const accepted = [vocab.german, ...germans.filter((g) => g !== vocab.german)]
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
    // Erste Abfrage jeder Vokabel: zufällige Richtung; alle ersten zuerst, dann alle zweiten.
    const firsts: Question[] = []
    const seconds: Question[] = []
    for (const g of groups) {
      const s = shuffle(g, rng)
      firsts.push(s[0])
      seconds.push(...s.slice(1))
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
  const reverse = buildReverseIndex(usable)
  const questions = picked.flatMap((v) => opts.directions.map((d) => makeQuestion(v, d, reverse, rng)))
  return orderQuestions(questions, rng)
}

export interface TestBuildOptions {
  directions: readonly Direction[]
  rng?: Rng
}

/**
 * Test: alle Vokabeln des Bereichs in Buchreihenfolge. Bei zwei Richtungen zuerst alle
 * Deutsch → Fremdsprache, danach alle Fremdsprache → Deutsch (jeweils in Buchreihenfolge).
 */
export function buildTestQuestions(
  inRange: readonly VocabLike[],
  reverseSource: readonly VocabLike[],
  opts: TestBuildOptions,
): Question[] {
  const rng = opts.rng ?? Math.random
  const reverse = buildReverseIndex(reverseSource.filter((v) => v.translations.length > 0))
  const usable = inRange.filter((v) => v.translations.length > 0)
  const order: Direction[] = (['forward', 'backward'] as const).filter((d) => opts.directions.includes(d))
  return order.flatMap((d) => usable.map((v) => makeQuestion(v, d, reverse, rng)))
}
