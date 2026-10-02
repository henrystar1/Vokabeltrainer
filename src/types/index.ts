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
  /** Anzahl der für mich aktivierten Vokabeln. */
  active_count: number
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
  /** Preis in Koins (0 = kostenlos). */
  price: number
  /** Schon gekauft bzw. frei verfügbar. */
  purchased: boolean
}

export type Role = 'user' | 'mod' | 'admin'

export interface Cosmetics {
  avatar_id: string | null
  color_id: string | null
  effect_id: string | null
}

/** Alles, was bei einem Namen zusätzlich angezeigt wird (Rangliste, Profil, Seitenleiste). */
export interface Flair extends Cosmetics {
  role?: Role
  tag_id?: string | null
  theme_id?: string | null
}

export interface Profile extends Cosmetics {
  display_name: string
  role: Role
  blocked: boolean
  theme_id: string | null
  tag_id: string | null
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
  koins: number
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
  active_count: number
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

export interface LeaderboardRow extends Flair {
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


/* ---------- Koins, Shop, Feedback ---------- */

export type ShopKind = 'avatar' | 'color' | 'effect' | 'theme' | 'tag'

export interface ShopItem {
  id: string
  kind: ShopKind
  name: string
  price: number
  sort: number
  owned: boolean
  equipped: boolean
  /** Nur für Mods bzw. Admins (nicht kaufbar). */
  required_role: 'mod' | 'admin' | null
}

export interface LedgerEntry {
  id: number
  amount: number
  reason: string
  ref: string | null
  created_at: string
}

export type RedeemResult =
  | { ok: true; amount: number; balance: number }
  | { ok: false; message: string }

export interface KoinCode {
  code: string
  amount: number
  note: string | null
  created_at: string
  created_by_name: string | null
}

export type FeedbackKind = 'idea' | 'improvement' | 'bug' | 'other'
export type FeedbackStatus = 'new' | 'seen' | 'done' | 'declined'

export interface FeedbackItem {
  id: string
  kind: FeedbackKind
  message: string
  status: FeedbackStatus
  staff_note: string | null
  created_at: string
  user_name?: string | null
  handled_by_name?: string | null
  handled_at?: string | null
}

export type AppSettings = Record<string, number>

export interface OnlineUser {
  user_id: string
  display_name: string
  role: Role
  last_seen_at: string
  avatar_id: string | null
  color_id: string | null
  effect_id: string | null
}

export interface UserMessage {
  id: string
  body: string
  created_at: string
  from_name: string
}

export interface SentMessage {
  id: string
  to_name: string | null
  body: string
  created_at: string
  read_at: string | null
}

export interface NextPageResult {
  unit_number: number
  page_number: number
  count: number
}
