import { NAV_ITEMS, STAFF_NAV_ITEM } from './navigation'
import { SUB_TABS, matchSubTab } from './subTabs'

/** Schlüssel zum Vergleichen: Kleinbuchstaben, ä/ö/ü/ß ausgeschrieben, nur Buchstaben und Ziffern. */
export function normKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

const ITEMS = [...NAV_ITEMS, STAFF_NAV_ITEM]
const ALIAS: Record<string, string> = { startseite: '/', home: '/', brett: '/brett', hausaufgabe: '/hausaufgaben', flaggen: '/auswendig', pi: '/auswendig', hochzahlen: '/auswendig', website: '/websites', advent: '/advent', loot: '/loot', online: '/mehrspieler', boerse: '/boerse', autohaus: '/autohaus', schnelllesen: '/schnelllesen', aktien: '/boerse', kalender: '/advent', admin: '/verwaltung' }

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
    const subName = sub.replace(/_/g, ' ')
    const to = target.to === '/websites' && sub ? `/websites?site=${encodeURIComponent(subName)}`
      : sub && matchSubTab(target.to, subName) ? `${target.to}?t=${encodeURIComponent(matchSubTab(target.to, subName) as string)}`
      : target.to
    out.push({ text: shown, to })
    last = start + shown.length
  }
  if (last < body.length) out.push({ text: body.slice(last) })
  return out.length > 0 ? out : [{ text: body }]
}

/** Namen für #Vorschläge: Menüpunkte (Leerzeichen als _), nach `Websites/` die Namen der eingetragenen Seiten. */
export function tagSuggestions(query: string, siteNames: string[] = [], max = 6): string[] {
  const slash = query.indexOf('/')
  if (slash >= 0) {
    const t = menuTarget(query.slice(0, slash))
    if (!t) return []
    if (t.to !== '/websites') {
      const q2 = normKey(query.slice(slash + 1))
      const subs = (SUB_TABS[t.to] ?? []).filter((x) => normKey(x.label).includes(q2) || normKey(x.id).includes(q2))
      subs.sort((a, b) => Number(normKey(b.label).startsWith(q2)) - Number(normKey(a.label).startsWith(q2)))
      return subs.slice(0, max).map((x) => `${query.slice(0, slash)}/${x.label.trim().replace(/\s+/g, '_')}`)
    }
    const q = normKey(query.slice(slash + 1))
    const base = query.slice(0, slash)
    const names = siteNames.map((n) => ({ n, k: normKey(n) })).filter((x) => x.k.includes(q))
    names.sort((a, b) => Number(b.k.startsWith(q)) - Number(a.k.startsWith(q)))
    return names.slice(0, max).map((x) => `${base}/${x.n.trim().replace(/\s+/g, '_')}`)
  }
  const q = normKey(query)
  const seen = new Set<string>()
  const scored: Array<{ name: string; rank: number }> = []
  const add = (name: string, keys: string[]) => {
    if (seen.has(name)) return
    const prefix = keys.some((k) => k.startsWith(q))
    const inside = keys.some((k) => k.includes(q))
    if (q && !inside) return
    seen.add(name)
    scored.push({ name, rank: prefix || !q ? 0 : 1 })
  }
  for (const it of ITEMS) {
    const label = it.label.split(' (')[0]
    add(label.trim().replace(/\s+/g, '_'), [normKey(label), it.to === '/' ? 'start' : normKey(it.to.slice(1))])
  }
  for (const [alias, to] of Object.entries(ALIAS)) {
    const it = ITEMS.find((x) => x.to === to)
    if (!it) continue
    const label = it.label.split(' (')[0].trim().replace(/\s+/g, '_')
    if (!seen.has(label)) add(alias.charAt(0).toUpperCase() + alias.slice(1), [alias])
  }
  return scored.sort((a, b) => a.rank - b.rank).slice(0, max).map((x) => x.name)
}
