import { rpc } from './rpc'

export interface BackupTable { name: string; rows: number }
export interface WriteResult { rows: number; written: number; skipped: number }
export const backupTables = () => rpc<BackupTable[]>('admin_backup_tables')
export const backupRead = (table: string, off: number, lim: number) => rpc<Record<string, unknown>[]>('admin_backup_read', { p_table: table, p_off: off, p_lim: lim })
export const backupClear = (table: string) => rpc<void>('admin_backup_clear', { p_table: table })
export const backupWrite = (table: string, rows: Record<string, unknown>[]) => rpc<WriteResult>('admin_backup_write', { p_table: table, p_rows: rows })
