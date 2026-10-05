import { BookOpen, MessageSquarePlus, ShoppingBag, UserCircle, Brain, ClipboardCheck, Home, Search, Settings, ShieldCheck, Trophy, BarChart3, Gamepad2, MessagesSquare, Target, Swords, Zap, ListChecks, Languages, ArrowLeftRight, Dices, type LucideIcon } from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

export interface NavGroup {
  /** Überschrift im Menü (leer = ohne Überschrift). */
  title: string
  items: NavItem[]
}

const g = (title: string, items: NavItem[]): NavGroup => ({ title, items })

export const NAV_GROUPS: NavGroup[] = [
  g('', [{ to: '/', label: 'Start', icon: Home }]),
  g('Lernen', [
    { to: '/buecher', label: 'Bücher', icon: BookOpen },
    { to: '/lernen', label: 'Lernen', icon: Brain },
    { to: '/test', label: 'Test', icon: ClipboardCheck },
    { to: '/ueben', label: 'Multiple Choice', icon: ListChecks },
    { to: '/konjugieren', label: 'Konjugieren (FR)', icon: Languages },
    { to: '/genus', label: 'le oder la?', icon: ArrowLeftRight },
    { to: '/suche', label: 'Suche', icon: Search },
  ]),
  g('Wettkampf', [
    { to: '/quests', label: 'Quests', icon: Target },
    { to: '/sprint', label: 'Sprint', icon: Zap },
    { to: '/duell', label: 'Duelle', icon: Swords },
    { to: '/rangliste', label: 'Rangliste', icon: Trophy },
    { to: '/statistik', label: 'Statistik', icon: BarChart3 },
  ]),
  g('Spaß', [
    { to: '/spiele', label: 'Spiele', icon: Gamepad2 },
    { to: '/gambling', label: 'Gambling', icon: Dices },
    { to: '/chat', label: 'Chat', icon: MessagesSquare },
    { to: '/shop', label: 'Shop', icon: ShoppingBag },
  ]),
  g('Konto', [
    { to: '/profil', label: 'Profil', icon: UserCircle },
    { to: '/feedback', label: 'Feedback', icon: MessageSquarePlus },
    { to: '/einstellungen', label: 'Einstellungen', icon: Settings },
  ]),
]

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((x) => x.items)

/** Nur für Mods und Admins sichtbar. */
export const STAFF_NAV_ITEM: NavItem = { to: '/verwaltung', label: 'Verwaltung', icon: ShieldCheck }

/** Gruppierte Menüeinträge; für Mods/Admins steht „Verwaltung“ in der Gruppe „Konto“. */
export function navGroupsFor(isStaff: boolean): NavGroup[] {
  if (!isStaff) return NAV_GROUPS
  return NAV_GROUPS.map((grp) =>
    grp.title === 'Konto' ? { ...grp, items: [grp.items[0], STAFF_NAV_ITEM, ...grp.items.slice(1)] } : grp,
  )
}

export function navItemsFor(isStaff: boolean): NavItem[] {
  return navGroupsFor(isStaff).flatMap((x) => x.items)
}
