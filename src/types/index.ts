/** Domain-Typen. Die Feldnamen folgen den Antworten der Datenbankfunktionen (snake_case). */

export type Direction = 'forward' | 'backward' // forward = Deutsch → Fremdsprache

export interface BookSummary {
  id: string
  name: string
  language: string
  description: string | null
  created_at: string
  unit_count: number
  page_count: number
  vocab_count: number
  mastery_percent: number
  is_public: boolean
  is_mine: boolean
}

/** Öffentliches ("Online") Buch, das Admins/Mods veröffentlicht haben. */
export interface PublicBook {
  id: string
  name: string
  language: string
  description: string | null
  created_at: string
  published_at: string | null
  published_by_name: string | null
  unit_count: number
  page_count: number
  vocab_count: number
  mastery_percent: number
  in_library: boolean
  is_mine: boolean
}

export type Role = 'user' | 'mod' | 'admin'

export interface Profile {
  display_name: string
  role: Role
  blocked: boolean
}

export type ReviewStatus = 'open' | 'done' | 'dismissed'

export interface VocabSnapshot {
  german: string
  german_alts: string[]
  translations: string[]
}

export interface ReviewRequest {
  id: string
  status: ReviewStatus
  message: string
  created_at: string
  book_id: string
  book_name: string
  language: string
  vocabulary_id: string | null
  requested_by_name: string | null
  /** Stand der Vokabel zum Zeitpunkt der Anfrage. */
  snapshot: VocabSnapshot
  /** Aktueller Stand; null, wenn die Vokabel inzwischen ersetzt oder gelöscht wurde. */
  current: VocabSnapshot | null
  unit_number: number | null
  page_number: number | null
  resolved_by_name: string | null
  resolved_at: string | null
  resolution_note: string | null
}

export interface AdminUser {
  user_id: string
  display_name: string
  email: string | null
  role: Role
  blocked: boolean
  created_at: string
  last_sign_in_at: string | null
  book_count: number
  public_book_count: number
  vocab_count: number
  progress_count: number
  session_count: number
  answer_count: number
  approx_bytes: number
}

export interface AdminBook {
  id: string
  name: string
  language: string
  is_public: boolean
  created_at: string
  page_count: number
  vocab_count: number
  approx_bytes: number
}

export interface OutlinePage {
  page_id: string
  page_number: number
  vocab_count: number
}

export interface OutlineUnit {
  unit_id: string
  unit_number: number
  name: string | null
  pages: OutlinePage[]
}

/** Eine Vokabel an einer Stelle im Buch (dieselbe Vokabel kann mehrfach vorkommen). */
export interface BookEntry {
  placement_id: string
  vocabulary_id: string
  german: string
  /** Weitere gleichwertige deutsche Lösungen. */
  german_alts: string[]
  translations: string[]
  unit_number: number
  page_number: number
  position: number
  order: number
}

export interface PageEntry {
  placement_id: string
  vocabulary_id: string
  german: string
  german_alts: string[]
  position: number
  translations: string[]
}

export interface PageData {
  page: { page_id: string; unit_number: number } | null
  entries: PageEntry[]
}

export interface SaveEntryResult {
  placement_id: string
  vocabulary_id: string
  german: string
  german_alts: string[]
  merged: boolean
  position: number
  translations: string[]
}

export interface PoolVocab {
  vocabulary_id: string
  book_id: string
  german: string
  german_alts: string[]
  translations: string[]
  level: number
}

export interface SearchResult {
  placement_id: string
  vocabulary_id: string
  german: string
  german_alts: string[]
  translations: string[]
  book_id: string
  book_name: string
  language: string
  unit_number: number
  page_number: number
}

export interface UserSettings {
  learn_language: string
  direction_to_foreign: boolean
  direction_to_german: boolean
  words_per_round: number
  case_sensitive: boolean
}

export interface HistoryDay {
  day: string
  total: number
  correct: number
}

export interface MyStats {
  level_counts: Record<'1' | '2' | '3' | '4' | '5', number>
  vocab_total: number
  learned: number
  mastery_percent: number
  due_problem: number
  answers_total: number
  answers_correct: number
  accuracy_percent: number | null
  today_vocab: number
  today_answers: number
  week_vocab: number
  week_answers: number
  history: HistoryDay[]
}

export interface LeaderboardRow {
  rank: number
  display_name: string
  points: number
  is_me: boolean
}

export interface CommunityAverages {
  avg_accuracy_percent: number | null
  avg_learned_vocabulary: number | null
  learners: number
}

export type LeaderboardPeriod = 'week' | 'month' | 'all'

export interface RecentSession {
  id: string
  mode: 'learn' | 'test'
  started_at: string
  answers_total: number
  answers_correct: number
  book_id: string | null
}

/** Austauschformat für Bücher (Version 1). Die Reihenfolge in "vocabulary" ist die Position auf der Seite. */
export interface BookExport {
  format: 'vokabeltrainer-book'
  version: 1
  book: { name: string; language: string; description?: string | null }
  units: Array<{
    number: number
    name?: string | null
    pages: Array<{
      number: number
      vocabulary: Array<{ german: string; german_alts?: string[]; translations: string[] }>
    }>
  }>
}
