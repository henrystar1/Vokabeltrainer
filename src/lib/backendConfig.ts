/**
 * Welches Supabase-Projekt die App benutzt. Reihenfolge:
 * 1. im Browser gespeicherte Werte (Admin → Umzug / Seite /umzug),
 * 2. Datei public/backend.json (für alle Besucher, z. B. nach dem Umzug auf GitHub),
 * 3. Build-Variablen VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY.
 * Es kommen nur öffentliche Werte vor (URL und Publishable Key), niemals ein Secret-Key.
 */
export interface Backend { url: string; key: string }
export const BACKEND_STORAGE_KEY = 'vt-backend'

/** Prüft und bereinigt eine Eingabe; null, wenn sie nicht brauchbar ist. */
export function cleanBackend(v: unknown): Backend | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const url = typeof o.url === 'string' ? o.url.trim().replace(/\/+$/, '') : ''
  const key = typeof o.key === 'string' ? o.key.trim() : ''
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(url) || key.length < 20) return null
  return { url, key }
}

/** Ein Secret-/service_role-Key darf nie ins Frontend. */
export function looksSecret(key: string): boolean {
  const k = key.trim()
  if (k.startsWith('sb_secret_')) return true
  try {
    const p = JSON.parse(atob(k.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { role?: string }
    return p.role === 'service_role'
  } catch { return false }
}

function fromStorage(): Backend | null {
  try { const s = localStorage.getItem(BACKEND_STORAGE_KEY); return s ? cleanBackend(JSON.parse(s)) : null } catch { return null }
}

function fromFile(): Backend | null {
  try {
    const x = new XMLHttpRequest()
    x.open('GET', `${import.meta.env.BASE_URL}backend.json`, false)
    x.send()
    if (x.status !== 200) return null
    return cleanBackend(JSON.parse(x.responseText))
  } catch { return null }
}

export function setBackendOverride(b: Backend | null): void {
  try { if (b) localStorage.setItem(BACKEND_STORAGE_KEY, JSON.stringify(b)); else localStorage.removeItem(BACKEND_STORAGE_KEY) } catch { /* ignorieren */ }
}

export function hasBackendOverride(): boolean { return fromStorage() !== null }

export function resolveBackend(): { url: string; key: string; source: 'browser' | 'datei' | 'build' } {
  const s = fromStorage()
  if (s) return { ...s, source: 'browser' }
  const f = fromFile()
  if (f) return { ...f, source: 'datei' }
  return {
    url: (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || '',
    key: (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim() || '',
    source: 'build',
  }
}
