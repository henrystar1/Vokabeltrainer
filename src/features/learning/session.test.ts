import { describe, expect, it } from 'vitest'
import { LearningSession } from './session'

describe('LearningSession – Wiederholungsrunde', () => {
  it('ändert den Lernstand nicht durch Antworten der Wiederholungsrunde', () => {
    const s = new LearningSession()
    s.recordMain('v1', 'forward', false)
    s.recordMain('v1', 'backward', false)
    const before = s.levelUpdates({ v1: 3 })
    expect(before).toEqual({ v1: 2 })

    // Wiederholung: richtig beantwortet, darf nichts verändern
    s.recordRepeat('v1', 'forward', true)
    s.recordRepeat('v1', 'backward', true)
    expect(s.levelUpdates({ v1: 3 })).toEqual({ v1: 2 })
  })

  it('merkt falsch beantwortete Vokabeln für die Wiederholung vor', () => {
    const s = new LearningSession()
    s.recordMain('v1', 'forward', true)
    s.recordMain('v1', 'backward', true)
    s.recordMain('v2', 'forward', false)
    s.recordMain('v2', 'backward', true)
    expect(s.vocabIdsToRepeat()).toEqual(['v2'])
  })

  it('bewertet Vokabeln mit nur einer abgefragten Richtung nicht', () => {
    const s = new LearningSession()
    s.recordMain('v1', 'forward', true)
    expect(s.levelUpdates({ v1: 1 })).toEqual({})
  })
})
