/**
 * Die EINZIGE Schnittstelle, über die Spiele (Auto-Spiel, Parkour, Minispiele …) an den Vokabel-Teil kommen.
 * Spiele importieren nichts direkt aus `features/learning`, `services/learning` oder `services/books` (prüft `src/boundary.test.ts`).
 * Ändert sich der Vokabel-Teil, muss nur diese Datei angepasst werden – die Spiele bleiben unberührt.
 */
export { getLearningPool } from '../services/learning'
export { getBookEntries } from '../services/books'
export { isAnswerCorrect } from './learning/answer'
export { buildIndexes, makeQuestion } from './learning/questions'
export type { Question, Indexes, VocabLike } from './learning/questions'
export { shuffle, mulberry32 } from './learning/random'
export type { Rng } from './learning/random'
