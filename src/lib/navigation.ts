import { BookOpen, Brain, ClipboardCheck, Home, Search, Settings, ShieldCheck, Trophy, BarChart3, type LucideIcon } from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Start', icon: Home },
  { to: '/buecher', label: 'Bücher', icon: BookOpen },
  { to: '/suche', label: 'Suche', icon: Search },
  { to: '/lernen', label: 'Lernen', icon: Brain },
  { to: '/test', label: 'Test', icon: ClipboardCheck },
  { to: '/statistik', label: 'Statistik', icon: BarChart3 },
  { to: '/rangliste', label: 'Rangliste', icon: Trophy },
  { to: '/einstellungen', label: 'Einstellungen', icon: Settings },
]

/** Nur für Mods und Admins sichtbar. */
export const STAFF_NAV_ITEM: NavItem = { to: '/verwaltung', label: 'Verwaltung', icon: ShieldCheck }

export function navItemsFor(isStaff: boolean): NavItem[] {
  if (!isStaff) return NAV_ITEMS
  const i = NAV_ITEMS.findIndex((n) => n.to === '/einstellungen')
  return [...NAV_ITEMS.slice(0, i), STAFF_NAV_ITEM, ...NAV_ITEMS.slice(i)]
}
