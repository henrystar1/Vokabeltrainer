/** Speichergröße in lesbarer Form ("12,3 KB"). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} KB`
  return `${(bytes / (1024 * 1024)).toLocaleString('de-DE', { maximumFractionDigits: 2 })} MB`
}

export function formatDate(iso: string | null): string {
  if (!iso) return '–'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '–' : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '–'
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '–'
    : d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
