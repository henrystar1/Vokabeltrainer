import { NAV_ITEMS, STAFF_NAV_ITEM } from './navigation'

/** Schlüssel zum Vergleichen: Kleinbuchstaben, ä/ö/ü/ß ausgeschrieben, nur Buchstaben und Ziffern. */
export function normKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

const ITEMS = [...NAV_ITEMS, STAFF_NAV_ITEM]
const ALIAS: Record<string, string> = { startseite: '/', home: '/', brett: '/brett', hausaufgabe: '/hausaufgaben', flaggen: '/auswendig', pi: '/auswendig', hochzahlen: '/auswendig', website: '/websites', admin: '/verwaltung' }

/** Welche Seite meint #Name? Passt auf Menünamen (ohne Klammerzusatz) und auf den Pfad. */
export function menuTarget(name: string): { to: string; label: string } | null {
  const k = normKey(name)
  if (!k) return null
  for (const it of ITEMS) {
    const keys = [normKey(it.label), normKey(it.label.split(' (')[0]), it.to === '/' ? 'start' : normKey(it.to.slice(1))]
    if (keys.includes(k)) return { to: it.to, label: it.label.split(' (')[0] }
  }
  const al = ALIAS[k]
  const it = al ? ITEMS.find((x) => x.to === al) : undefined
  return it ? { to: it.to, label: it.label.split(' (')[0] } : null
}

export type ChatPart = { text: string } | { text: string; to: string }

/** Zerlegt eine Nachricht: #Websites, #Start, #Websites/Name werden zu Links auf den Menüpunkt (bei Websites mit Name). */
export function chatParts(body: string): ChatPart[] {
  const out: ChatPart[] = []
  const re = /(^|[\s(])#([\p{L}\p{N}_?-]+)(?:\/([^\s#]+))?/gu
  let last = 0
  for (const m of body.matchAll(re)) {
    const start = (m.index ?? 0) + m[1].length
    const sub = (m[3] ?? '').replace(/[.,;:!?)]+$/u, '')
    const target = menuTarget(m[2])
    if (!target) continue
    const raw = `#${m[2]}${m[3] !== undefined ? '/' + (m[3]) : ''}`
    const shown = m[3] !== undefined ? `#${m[2]}/${sub}` : raw
    if (start > last) out.push({ text: body.slice(last, start) })
    const to = target.to === '/websites' && sub ? `/websites?site=${encodeURIComponent(sub.replace(/_/g, ' '))}` : target.to
    out.push({ text: shown, to })
    last = start + shown.length
  }
  if (last < body.length) out.push({ text: body.slice(last) })
  return out.length > 0 ? out : [{ text: body }]
}
