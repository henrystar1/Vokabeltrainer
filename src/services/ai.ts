import { supabase } from '../lib/supabaseClient'
import type { GapItem } from '../lib/gaps'
import { rpc } from './rpc'

/** KI-Blätter: Erzeugen läuft über die Funktion „ai“ (dort liegt der OpenAI-Schlüssel), alles andere über die Datenbank. */

export type Level = 'einfach' | 'mittel' | 'schwer'
export type Lang = 'en' | 'fr' | 'la' | 'es'

export const LANG_NAMES: Record<Lang, string> = { en: 'Englisch', fr: 'Französisch', la: 'Latein', es: 'Spanisch' }
export const isLang = (x: string): x is Lang => x in LANG_NAMES
export const LEVELS: readonly Level[] = ['einfach', 'mittel', 'schwer']

export interface AiFail { ok: false; code: string; message: string }
export interface GrammarOk { ok: true; id: string; title: string; items: GapItem[] }
export interface SentenceRow { foreign: string; german: string; item: { text: string; answers: string[]; hint: string } | null }
export interface SentencesOk { ok: true; sentences: SentenceRow[]; partial: boolean }

async function callAi<T>(body: Record<string, unknown>): Promise<T | AiFail> {
  const { data, error } = await supabase.functions.invoke('ai', { body })
  if (error) {
    // Funktion nicht eingerichtet oder offline: freundlich erklären statt Technik zeigen.
    return { ok: false, code: 'unreachable', message: 'Die KI-Funktion ist noch nicht eingerichtet oder gerade nicht erreichbar.' }
  }
  return data as T | AiFail
}

export const generateGrammar = (p: { language: Lang; grade: number; topic: string; level: Level; count: number }) =>
  callAi<GrammarOk>({ action: 'grammar', ...p })

export const generateSentences = (p: { language: Lang; level: Level; vocab: Array<{ foreign: string; german: string }> }) =>
  callAi<SentencesOk>({ action: 'sentences', ...p })

/** Nur Admins: prüft den OpenAI-Schlüssel. */
export const checkAiKey = () => callAi<{ ok: true; message: string }>({ action: 'check' })

export interface SetSummary { id: string; title: string; topic: string; topic_key: string; level: Level; grade: number; items: number; uses: number; created_at: string; mine: boolean }
export interface StoredSet { id: string; title: string; topic: string; topic_key: string; level: Level; grade: number; language: Lang; items: GapItem[]; created_at: string }

export const listSets = (language: Lang, grade: number, topicKey: string | null, level: Level | null) =>
  rpc<SetSummary[]>('ai_list_sets', { p_language: language, p_grade: grade, p_topic_key: topicKey, p_level: level })
export const getSet = (id: string) => rpc<StoredSet>('ai_get_set', { p_id: id })

export type ResultKind = 'grammar' | 'test'
export interface ResultSummary { id: string; kind: ResultKind; title: string; language: string; level: string; score: number; total: number; created_at: string }
export interface StoredResult extends ResultSummary { ref: string | null; payload: Record<string, unknown> }

export const saveResult = (p: { kind: ResultKind; title: string; ref: string | null; language: string; level: string; score: number; total: number; payload: unknown }) =>
  rpc<string>('ai_save_result', { p_kind: p.kind, p_title: p.title, p_ref: p.ref, p_language: p.language, p_level: p.level, p_score: p.score, p_total: p.total, p_payload: p.payload })
export const myResults = (kind: ResultKind) => rpc<ResultSummary[]>('ai_my_results', { p_kind: kind })
export const getResult = (id: string) => rpc<StoredResult>('ai_get_result', { p_id: id })
export const deleteResult = (id: string) => rpc<void>('ai_delete_result', { p_id: id })

/** Beliebte Themen je Sprache (Vorschläge; man kann auch ein eigenes Thema eintippen). */
export const TOPICS: Record<Lang, string[]> = {
  en: ['Simple Past', 'Present Perfect', 'Past Perfect', 'Will-Future', 'Going-to-Future', 'Conditional I', 'Conditional II', 'Relative Clauses', 'Passive Voice', 'Reported Speech', 'Comparison of Adjectives', 'Gerund or Infinitive', 'Prepositions', 'Articles'],
  fr: ['Passé composé', 'Participe passé', 'Imparfait', 'Plus-que-parfait', 'Futur simple', 'Futur composé', 'Conditionnel', 'Subjonctif', 'Pronoms relatifs', 'Pronoms COD/COI', 'Articles partitifs', 'Adjectifs possessifs', 'Négation', 'Prépositions'],
  la: ['Konjugationen (Präsens)', 'Imperfekt', 'Perfekt', 'Plusquamperfekt', 'Futur I', 'Deklinationen (a-/o-Dekl.)', 'Konsonantische Deklination', 'Kasus und ihre Funktionen', 'Adjektive und Steigerung', 'Pronomen (is, hic, ille)', 'Ablativus absolutus', 'AcI', 'Partizipien (PPP, PPA)', 'Konjunktiv', 'Gerundium und Gerundivum', 'Deponentia'],
  es: ['Presente', 'Pretérito indefinido', 'Pretérito imperfecto', 'Pretérito perfecto', 'Futuro simple', 'Condicional', 'Subjuntivo presente', 'Imperativo', 'Ser y estar', 'Verbos irregulares', 'Pronombres de objeto', 'Verbos reflexivos', 'Por y para', 'Artículos y género'],
}

/** Nutzertext zu einem Fehlercode der Funktion. */
export function aiFailText(f: AiFail): string {
  return f.message || 'Das hat nicht geklappt.'
}
