import type { AdminBook, AdminUser } from '../types'
import { rpc } from './rpc'

/** Nur für Admins (die Datenbank prüft die Berechtigung bei jedem Aufruf). */

export const adminListUsers = () => rpc<AdminUser[]>('admin_list_users')
export const adminListUserBooks = (userId: string) => rpc<AdminBook[]>('admin_list_user_books', { p_user: userId })
export const adminSetRole = (userId: string, role: 'user' | 'mod' | 'alphamod') => rpc<void>('admin_set_role', { p_user: userId, p_role: role })
export const adminSetBlocked = (userId: string, blocked: boolean) =>
  rpc<void>('admin_set_blocked', { p_user: userId, p_blocked: blocked })
export const adminResetProgress = (userId: string) => rpc<void>('admin_reset_progress', { p_user: userId })
export const adminDeleteBook = (bookId: string) => rpc<void>('admin_delete_book', { p_book_id: bookId })
export const adminDeleteUser = (userId: string) => rpc<void>('admin_delete_user', { p_user: userId })

export const adminAdjustPoints = (userId: string, points: number, reason: string) =>
  rpc<void>('admin_adjust_points', { p_user: userId, p_points: points, p_reason: reason })
export interface PointAdjustment { id: number; display_name: string | null; points: number; reason: string; created_at: string }
export const adminListPointAdjustments = () => rpc<PointAdjustment[]>('admin_list_point_adjustments')

// --- Konten ohne Bestätigungs-Mail ---
export interface NewAccount { email: string; password: string; name: string }
export interface NewAccountResult { email: string; ok: boolean; display_name?: string; error?: string }
export const adminCreateUser = (a: NewAccount) =>
  rpc<{ user_id: string; email: string; display_name: string }>('admin_create_user', { p_email: a.email, p_password: a.password, p_name: a.name })
export const adminCreateUsers = (rows: NewAccount[]) => rpc<NewAccountResult[]>('admin_create_users', { p_rows: rows })
export const adminSetPassword = (userId: string, password: string) => rpc<void>('admin_set_password', { p_user: userId, p_password: password })
