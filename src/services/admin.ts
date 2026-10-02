import type { AdminBook, AdminUser } from '../types'
import { rpc } from './rpc'

/** Nur für Admins (die Datenbank prüft die Berechtigung bei jedem Aufruf). */

export const adminListUsers = () => rpc<AdminUser[]>('admin_list_users')
export const adminListUserBooks = (userId: string) => rpc<AdminBook[]>('admin_list_user_books', { p_user: userId })
export const adminSetRole = (userId: string, role: 'user' | 'mod') => rpc<void>('admin_set_role', { p_user: userId, p_role: role })
export const adminSetBlocked = (userId: string, blocked: boolean) =>
  rpc<void>('admin_set_blocked', { p_user: userId, p_blocked: blocked })
export const adminResetProgress = (userId: string) => rpc<void>('admin_reset_progress', { p_user: userId })
export const adminDeleteBook = (bookId: string) => rpc<void>('admin_delete_book', { p_book_id: bookId })
export const adminDeleteUser = (userId: string) => rpc<void>('admin_delete_user', { p_user: userId })
