import { evaluatePair, nextLevel } from './algorithm'

export type Direction = 'forward' | 'backward'

/**
 * Sammelt Antworten einer Lernrunde. Nur die Hauptrunde beeinflusst den Lernstand;
 * die Wiederholungsrunde („Fehler wiederholen“) dient ausschließlich zum Üben.
 */
export class LearningSession {
  private main = new Map<string, Partial<Record<Direction, boolean>>>()
  private repeat = new Map<string, Partial<Record<Direction, boolean>>>()

  recordMain(vocabId: string, direction: Direction, correct: boolean): void {
    this.main.set(vocabId, { ...this.main.get(vocabId), [direction]: correct })
  }

  /** Wird bewusst gespeichert (z. B. für Statistik), fließt aber nie in levelUpdates ein. */
  recordRepeat(vocabId: string, direction: Direction, correct: boolean): void {
    this.repeat.set(vocabId, { ...this.repeat.get(vocabId), [direction]: correct })
  }

  /** Vokabeln mit mindestens einer falschen Antwort in der Hauptrunde. */
  vocabIdsToRepeat(): string[] {
    return [...this.main.entries()]
      .filter(([, r]) => r.forward === false || r.backward === false)
      .map(([id]) => id)
  }

  /** Neue Lernstände; nur Vokabeln, die in beiden Richtungen abgefragt wurden. */
  levelUpdates(currentLevels: Record<string, number>): Record<string, number> {
    const updates: Record<string, number> = {}
    for (const [id, r] of this.main) {
      if (r.forward === undefined || r.backward === undefined) continue
      updates[id] = nextLevel(currentLevels[id] ?? 1, evaluatePair(r.forward, r.backward))
    }
    return updates
  }
}
