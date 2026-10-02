import { supabase } from '../lib/supabaseClient'
import type { BookEntry, BookSummary, OutlineUnit } from '../types'
import { rpc } from './rpc'

export interface Language {
  code: string
  name: string
}

export const listLanguages = async (): Promise<Language[]> => {
  const { data, error } = await supabase.from('languages').select('code,name').order('name')
  if (error) throw error
  return data ?? []
}

export const listBooks = () => rpc<BookSummary[]>('get_book_summaries')

export async function getBook(id: string) {
  const { data, error } = await supabase.from('books').select('id,name,language,description,is_public,owner_id').eq('id', id).maybeSingle()
  if (error) throw error
  return data as { id: string; name: string; language: string; description: string | null; is_public: boolean; owner_id: string } | null
}

export async function createBook(name: string, language: string, description: string): Promise<string> {
  const { data, error } = await supabase
    .from('books')
    .insert({ name: name.trim(), language, description: description.trim() || null })
    .select('id')
    .single()
  if (error) throw error
  return data.id as string
}

export async function updateBook(id: string, name: string, description: string, language: string): Promise<void> {
  const { error } = await supabase
    .from('books')
    .update({ name: name.trim(), description: description.trim() || null, language })
    .eq('id', id)
  if (error) throw error
}

export async function deleteBook(id: string): Promise<void> {
  const { error } = await supabase.from('books').delete().eq('id', id)
  if (error) throw error
}

export const getOutline = (bookId: string) => rpc<OutlineUnit[]>('get_book_outline', { p_book_id: bookId })
export const getBookEntries = (bookId: string) => rpc<BookEntry[]>('get_book_entries', { p_book_id: bookId })

export const deletePage = (bookId: string, page: number) => rpc<void>('delete_page', { p_book_id: bookId, p_page_number: page })
export const deleteUnit = (bookId: string, unit: number) => rpc<void>('delete_unit', { p_book_id: bookId, p_unit_number: unit })
export const movePageToUnit = (bookId: string, page: number, unit: number) =>
  rpc<void>('move_page_to_unit', { p_book_id: bookId, p_page_number: page, p_unit_number: unit })
