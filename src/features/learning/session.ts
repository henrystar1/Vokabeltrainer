import { evaluatePair, nextLevel, type PairResult } from './algorithm'
import type { Direction } from '../../types'

export interface AnswerRecord {
  vocabulary_id: string
  direction: Direction
  given_answer: string
  is_correct: boolean
}

const BOTH: readonly Direction[] = ['forward', 'backward']

/**
 * Sammelt Antworten einer Lernrunde. Nur die Hauptrunde beeinflusst den Lernstand;
 * die Wiederholungsrunde („Fehler wiederholen“) dient ausschließlich zum Üben.
 *
 * Bewertet wird eine Vokabel erst, wenn alle aktiven Richtungen beantwortet sind:
 *  - zwei Richtungen: beide richtig +1, eine richtig +0,5, beide falsch −1
 *  - nur eine Richtung aktiv: richtig zählt wie „beide richtig“, falsch wie „beide falsch“
 */
export class LearningSession {
  private main = new Map<string, Partial<Record<Direction, AnswerRecord>>>()
  private repeat: AnswerRecord[] = []

  constructor(private readonly directions: readonly Direction[] = BOTH) {}

  recordMain(vocabId: string, direction: Direction, correct: boolean, given = ''): void {
    this.main.set(vocabId, {
      ...this.main.get(vocabId),
      [direction]: { vocabulary_id: vocabId, direction, given_answer: given, is_correct: correct },
    })
  }

  /** Wird bewusst gespeichert (Statistik/Protokoll), fließt aber nie in levelUpdates ein. */
  recordRepeat(vocabId: string, direction: Direction, correct: boolean, given = ''): void {
    this.repeat.push({ vocabulary_id: vocabId, direction, given_answer: given, is_correct: correct })
  }

  /** Alle Antworten der Hauptrunde (für das Speichern). */
  mainAnswers(): AnswerRecord[] {
    return [...this.main.values()].flatMap((r) => Object.values(r) as AnswerRecord[])
  }

  repeatAnswers(): AnswerRecord[] {
    return [...this.repeat]
  }

  /** Vokabeln mit mindestens einer falschen Antwort in der Hauptrunde. */
  vocabIdsToRepeat(): string[] {
    return [...this.main.entries()]
      .filter(([, r]) => Object.values(r).some((a) => a && !a.is_correct))
      .map(([id]) => id)
  }

  private resultOf(r: Partial<Record<Direction, AnswerRecord>>): PairResult | null {
    if (this.directions.some((d) => r[d] === undefined)) return null
    if (this.directions.length >= 2) return evaluatePair(r.forward!.is_correct, r.backward!.is_correct)
    return r[this.directions[0]]!.is_correct ? 'both' : 'none'
  }

  /** Neue Lernstände; nur Vokabeln, bei denen alle aktiven Richtungen beantwortet wurden. */
  levelUpdates(currentLevels: Record<string, number>): Record<string, number> {
    const updates: Record<string, number> = {}
    for (const [id, r] of this.main) {
      const result = this.resultOf(r)
      if (result) updates[id] = nextLevel(currentLevels[id] ?? 1, result)
    }
    return updates
  }
}
