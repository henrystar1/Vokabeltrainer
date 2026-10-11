/** Kommt „@Name“ im Text vor? Wortgrenzen und Groß-/Kleinschreibung wie in der Datenbank (notify_poll). */
export function mentionsName(body: string, name: string | null | undefined): boolean {
  const n = name?.trim()
  if (!n) return false
  const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^\\p{L}\\p{N}_])@${escaped}(?![\\p{L}\\p{N}_])`, 'iu').test(body)
}
