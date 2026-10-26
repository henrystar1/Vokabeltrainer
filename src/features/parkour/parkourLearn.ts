import type { Direction } from '../../types'
import { getLearningPool } from '../../services/learning'
import { getBookEntries } from '../../services/books'
import { listPublicBooks } from '../../services/community'
import { buildIndexes, makeQuestion, type Indexes, type Question, type VocabLike } from '../learning/questions'
import { shuffle, type Rng } from '../learning/random'

/** Lernen im Parkour: Speedups verlangen 1 Vokabel, der Wechsel ins nächste Level 2. */
export const LEARN_PER_LEVEL = 2
export const LEARN_PER_OFFER = 1
/** Abstand zwischen zwei Speedup-Angeboten und wie lange ein Angebot sichtbar bleibt (Sekunden) */
export const OFFER_EVERY = 38
export const OFFER_LIFE = 14

export interface LearnPool { vocab: VocabLike[]; idx: Indexes }

const MAX_POOL = 300

export function makePool(vocab: readonly VocabLike[]): LearnPool {
  const usable = vocab.filter((v) => v.translations.length > 0 && v.german.trim() !== '')
  const vs = usable.length > MAX_POOL ? shuffle(usable, Math.random).slice(0, MAX_POOL) : [...usable]
  return { vocab: vs, idx: buildIndexes(vs) }
}

/** Eine zufällige Frage; `avoid` = schon gestellte Vokabeln (werden nur wiederholt, wenn der Pool sonst leer wäre). */
export function nextQuestion(pool: LearnPool, avoid: ReadonlySet<string>, rng: Rng = Math.random): Question | null {
  if (pool.vocab.length === 0) return null
  const fresh = pool.vocab.filter((v) => !avoid.has(v.vocabulary_id))
  const from = fresh.length > 0 ? fresh : pool.vocab
  const v = from[Math.floor(rng() * from.length)]
  const dir: Direction = rng() < 0.5 ? 'forward' : 'backward'
  return makeQuestion(v, dir, pool.idx, rng)
}

let cached: Promise<LearnPool> | null = null

/** Aktive Vokabeln; gibt es keine, irgendeine aus den öffentlichen Büchern. Fehler → leerer Pool (dann wird nicht gefragt). */
export function loadLearnPool(): Promise<LearnPool> {
  if (!cached) {
    cached = (async (): Promise<LearnPool> => {
      let vocab: VocabLike[] = []
      try { vocab = await getLearningPool(null, null) } catch { vocab = [] }
      if (vocab.filter((v) => v.translations.length > 0).length === 0) {
        try {
          const books = shuffle(await listPublicBooks(), Math.random).slice(0, 3)
          for (const b of books) {
            const es = await getBookEntries(b.id)
            vocab = vocab.concat(es.map((e) => ({ vocabulary_id: e.vocabulary_id, german: e.german, german_alts: e.german_alts ?? [], translations: e.translations })))
          }
        } catch { /* kein Netz o. Ä. */ }
      }
      return makePool(vocab)
    })()
    void cached.then((p) => { if (p.vocab.length === 0) cached = null })
  }
  return cached
}

export const resetLearnPool = (): void => { cached = null }
