import { describe, expect, it } from 'vitest'
import { activityFor, activityLabel } from './activity'

describe('activity', () => {
  it('ordnet Seiten einer Tätigkeit zu', () => {
    expect(activityFor('/lernen')).toBe('learn')
    expect(activityFor('/spiele')).toBe('games')
    expect(activityFor('/gambling')).toBe('gambling')
    expect(activityFor('/chat')).toBe('chat')
    expect(activityFor('/duell/abc')).toBe('duel')
    expect(activityFor('/konjugieren')).toBe('practice')
    expect(activityFor('/')).toBe('app')
    expect(activityFor('/rangliste')).toBe('app')
  })
  it('hat für alles einen Text', () => {
    expect(activityLabel('learn')).toBe('lernt Vokabeln')
    expect(activityLabel(null)).toBe('ist in der App')
    expect(activityLabel('unbekannt')).toBe('ist in der App')
  })
})
