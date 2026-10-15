import type { Direction } from '../../types'
import { isAnswerCorrect } from '../learning/answer'
import { buildIndexes, makeQuestion, type Question, type VocabLike } from '../learning/questions'
import { shuffle, type Rng } from '../learning/random'

/** Ablauf: Merken → Karteikarten → Abfrage (mit Verbesserung) → [Karteikarten der schweren Wörter] → Test → Ergebnis. */
export type CramPhase = 'merken' | 'karten' | 'abfrage' | 'test' | 'ergebnis'

export interface QueueItem { id: string; dir: Direction }

export interface CramSession {
  v: 1
  label: string
  bookId: string
  startedAt: number
  vocab: VocabLike[]
  phase: CramPhase
  /** Warteschlange der aktuellen Phase (Vokabel-IDs bzw. Fragen). */
  queue: string[]
  /** Abfrage-Schlange: Vokabel + Richtung. */
  quiz: QueueItem[]
  /** Vokabeln, die in der Abfrage falsch waren oder per Knopf markiert wurden. */
  hard: string[]
  /** Karteikarten-Durchgang nur für schwere Wörter (danach geht es zum Test). */
  hardOnly: boolean
  test: { id: string; dir: Direction; given: string | null }[]
  testPos: number
  /** Wie viele Abfragen insgesamt schon beantwortet wurden (Anzeige). */
  answered: number
}

export const TEST_SIZE = 10

export function newSession(label: string, bookId: string, vocab: VocabLike[], now = Date.now()): CramSession {
  return {
    v: 1, label, bookId, startedAt: now, vocab, phase: 'merken',
    queue: vocab.map((x) => x.vocabulary_id), quiz: [], hard: [], hardOnly: false,
    test: [], testPos: 0, answered: 0,
  }
}

/** „Nochmal“: Vokabel kommt am Ende der Schlange noch einmal (nur wenn sie nicht schon wartet). */
export function requeue<T extends string | QueueItem>(queue: readonly T[], current: T): T[] {
  const key = (x: T) => (typeof x === 'string' ? x : x.id)
  const rest = queue.slice(1)
  if (rest.some((x) => key(x) === key(current))) return rest
  return [...rest, current]
}

export function addHard(hard: readonly string[], id: string): string[] {
  return hard.includes(id) ? [...hard] : [...hard, id]
}

function byId(vocab: readonly VocabLike[]): Map<string, VocabLike> {
  return new Map(vocab.map((v) => [v.vocabulary_id, v]))
}

/** Frage zu einem Eintrag. Deterministisch (erste Variante), damit sie nach dem Neuladen gleich bleibt. */
export function questionFor(s: CramSession, id: string, dir: Direction): Question | null {
  const v = byId(s.vocab).get(id)
  if (!v) return null
  return makeQuestion(v, dir, buildIndexes(s.vocab), () => 0)
}

export function randomDir(rng: Rng = Math.random): Direction {
  return rng() < 0.5 ? 'forward' : 'backward'
}

export function startKarten(s: CramSession, onlyHard = false): CramSession {
  const ids = onlyHard ? s.hard : s.vocab.map((v) => v.vocabulary_id)
  return { ...s, phase: ids.length ? 'karten' : 'abfrage', hardOnly: onlyHard, queue: ids }
}

export function startAbfrage(s: CramSession, rng: Rng = Math.random): CramSession {
  const quiz = shuffle(s.vocab, rng).map((v) => ({ id: v.vocabulary_id, dir: randomDir(rng) }))
  return { ...s, phase: 'abfrage', hardOnly: false, quiz, queue: [] }
}

/** Nach der Abfrage: schwere Wörter nochmal als Karteikarten, sonst direkt Test. */
export function afterAbfrage(s: CramSession, rng: Rng = Math.random): CramSession {
  return s.hard.length > 0 ? startKarten(s, true) : startTest(s, rng)
}

export function startTest(s: CramSession, rng: Rng = Math.random): CramSession {
  const pick = shuffle(s.vocab, rng).slice(0, TEST_SIZE)
  return {
    ...s, phase: 'test', queue: [], quiz: [],
    test: pick.map((v) => ({ id: v.vocabulary_id, dir: randomDir(rng), given: null })),
    testPos: 0,
  }
}

/** Antwort in der Abfrage: richtig → weg, falsch → kommt nach 3 anderen wieder und wird als schwer gemerkt. */
export function answerAbfrage(s: CramSession, given: string): { s: CramSession; ok: boolean; q: Question } {
  const cur = s.quiz[0]
  const q = questionFor(s, cur.id, cur.dir)!
  const ok = isAnswerCorrect(given, q.accepted, false)
  return { s: advanceAbfrage(s, ok), ok, q }
}

export function advanceAbfrage(s: CramSession, ok: boolean): CramSession {
  const cur = s.quiz[0]
  const rest = s.quiz.slice(1)
  if (ok) return { ...s, quiz: rest, answered: s.answered + 1 }
  const at = Math.min(3, rest.length)
  const quiz = [...rest.slice(0, at), cur, ...rest.slice(at)]
  return { ...s, quiz, hard: addHard(s.hard, cur.id), answered: s.answered + 1 }
}

export function answerTest(s: CramSession, given: string): CramSession {
  const test = s.test.map((t, i) => (i === s.testPos ? { ...t, given } : t))
  const testPos = s.testPos + 1
  return { ...s, test, testPos, phase: testPos >= test.length ? 'ergebnis' : 'test' }
}

export interface TestResult { correct: number; total: number; rows: { q: Question; given: string; ok: boolean }[] }

export function testResult(s: CramSession): TestResult {
  const rows = s.test.map((t) => {
    const q = questionFor(s, t.id, t.dir)!
    const given = t.given ?? ''
    return { q, given, ok: isAnswerCorrect(given, q.accepted, false) }
  })
  return { correct: rows.filter((r) => r.ok).length, total: rows.length, rows }
}

const KEY = (userId: string) => `cram-session:${userId}`

export function loadSession(userId: string): CramSession | null {
  try {
    const raw = localStorage.getItem(KEY(userId))
    if (!raw) return null
    const s = JSON.parse(raw) as CramSession
    return s && s.v === 1 && Array.isArray(s.vocab) ? s : null
  } catch { return null }
}

export function saveSession(userId: string, s: CramSession | null): void {
  try {
    if (s) localStorage.setItem(KEY(userId), JSON.stringify(s))
    else localStorage.removeItem(KEY(userId))
  } catch { /* Speicher voll/gesperrt: Sitzung gilt dann nur bis zum Schließen */ }
}
