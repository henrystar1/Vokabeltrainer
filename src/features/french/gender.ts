import type { ChoiceQuestion } from '../../components/quiz/ChoiceRunner'
import type { PoolVocab } from '../../types'
import { shuffle } from '../learning/random'

export interface GenderWord { id: string; fr: string; de: string; g: 'le' | 'la' }

const ARTICLE = /^\s*(le|la|un|une)\s+(\S.*)$/i

/** Sucht in den Übersetzungen der eigenen Französisch-Vokabeln Wörter mit le/la (un/une zählen mit). l’-Wörter werden übersprungen. */
export function extractGenderWords(pool: readonly PoolVocab[]): GenderWord[] {
  const seen = new Set<string>()
  const out: GenderWord[] = []
  for (const v of pool) {
    for (const t of v.translations) {
      const m = ARTICLE.exec(t)
      if (!m) continue
      const word = m[2].trim()
      if (/[,;/]/.test(word) || word.split(/\s+/).length > 3) continue // Listen und lange Wendungen sind keine einfachen Nomen
      const g = /^(le|un)$/i.test(m[1]) ? 'le' : 'la'
      const key = `${g} ${word.toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ id: `${v.vocabulary_id}-${out.length}`, fr: word, de: v.german, g })
    }
  }
  return out
}

export function buildGenderQuestions(words: readonly GenderWord[], count: number, rng: () => number = Math.random): ChoiceQuestion[] {
  return shuffle(words, rng).slice(0, count).map((n) => ({
    id: n.id,
    prompt: `… ${n.fr}`,
    sub: n.de,
    options: ['le', 'la'],
    correct: n.g === 'le' ? 0 : 1,
    reveal: `${n.g} ${n.fr} – ${n.de}`,
  }))
}
