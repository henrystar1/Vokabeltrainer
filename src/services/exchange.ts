import type { BookExport } from '../types'
import { rpc } from './rpc'

export const exportBook = (bookId: string) => rpc<BookExport>('export_book', { p_book_id: bookId })
export const importBook = (payload: BookExport, name: string | null) =>
  rpc<string>('import_book', { p_payload: payload, p_name: name })
