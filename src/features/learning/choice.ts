import type { ChoiceQuestion } from '../../components/quiz/ChoiceRunner'
import type { PoolVocab } from '../../types'
import { shuffle } from './random'

/** Baut Fragen mit vier Antworten: Vokabel → richtige Übersetzung + drei falsche aus demselben Pool. */
export function buildChoiceQuestions(pool: readonly PoolVocab[], count: number, rng: () => number = Math.random): ChoiceQuestion[] {
  const usable = pool.filter((v) => v.translations.length > 0)
  const pick = shuffle(usable, rng).slice(0, count)
  return pick.flatMap((v, n) => {
    const forward = rng() < 0.5
    const prompt = forward ? v.german : v.translations[0]
    const right = forward ? v.translations[0] : v.german
    const pool2 = usable.filter((o) => o.vocabulary_id !== v.vocabulary_id)
    const wrongs = new Set<string>()
    for (const o of shuffle(pool2, rng)) {
      const text = forward ? o.translations[0] : o.german
      if (text && text.toLowerCase() !== right.toLowerCase()) wrongs.add(text)
      if (wrongs.size >= 3) break
    }
    if (wrongs.size < 3) return []
    const options = shuffle([right, ...wrongs], rng)
    return [{ id: `${v.vocabulary_id}-${n}`, prompt, sub: forward ? 'Deutsch → Fremdsprache' : 'Fremdsprache → Deutsch', options, correct: options.indexOf(right), reveal: `${v.german} = ${v.translations.join(' / ')}` }]
  })
}

