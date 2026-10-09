import type { LockKey } from '../services/koins'
import { BookOpen, MessageSquarePlus, ShoppingBag, UserCircle, Brain, ClipboardCheck, Home, Search, Settings, ShieldCheck, Trophy, BarChart3, Gamepad2, MessagesSquare, Target, Swords, Zap, ListChecks, Languages, ArrowLeftRight, Dices, Users, Pin, PenLine, type LucideIcon } from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Wenn der Admin diese Funktion sperrt, verschwindet der Eintrag. */
  lock?: LockKey
}

export interface NavGroup {
  /** Überschrift im Menü (leer = ohne Überschrift). */
  title: string
  items: NavItem[]
}

const g = (title: string, items: NavItem[]): NavGroup => ({ title, items })

export const NAV_GROUPS: NavGroup[] = [
  g('', [
    { to: '/', label: 'Start', icon: Home },
    { to: '/brett', label: 'Schwarzes Brett', icon: Pin },
  ]),
  g('Lernen', [
    { to: '/buecher', label: 'Bücher', icon: BookOpen },
    { to: '/lernen', label: 'Lernen', icon: Brain },
    { to: '/abschreiben', label: 'Abschreiben', icon: PenLine },
    { to: '/test', label: 'Test', icon: ClipboardCheck },
    { to: '/ueben', label: 'Multiple Choice', icon: ListChecks },
    { to: '/konjugieren', label: 'Konjugieren (FR)', icon: Languages },
    { to: '/genus', label: 'le oder la?', icon: ArrowLeftRight },
    { to: '/suche', label: 'Suche', icon: Search },
  ]),
  g('Wettkampf', [
    { lock: 'quests', to: '/quests', label: 'Quests', icon: Target },
    { lock: 'sprint', to: '/sprint', label: 'Sprint', icon: Zap },
    { lock: 'duels', to: '/duell', label: 'Duelle', icon: Swords },
    { to: '/rangliste', label: 'Rangliste', icon: Trophy },
    { to: '/statistik', label: 'Statistik', icon: BarChart3 },
  ]),
  g('Spaß', [
    { lock: 'games', to: '/spiele', label: 'Spiele', icon: Gamepad2 },
    { lock: 'gambling', to: '/gambling', label: 'Gambling', icon: Dices },
    { lock: 'chat', to: '/chat', label: 'Chat', icon: MessagesSquare },
    { to: '/online', label: 'Wer ist da?', icon: Users },
    { lock: 'shop', to: '/shop', label: 'Shop', icon: ShoppingBag },
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

/** Gruppierte Menüeinträge; für Mods/Admins steht „Verwaltung“ in der Gruppe „Konto“. Gesperrte Funktionen fehlen. */
export function navGroupsFor(isStaff: boolean, locked: ReadonlySet<LockKey> = new Set()): NavGroup[] {
  const base = NAV_GROUPS.map((grp) => ({ ...grp, items: grp.items.filter((i) => !i.lock || !locked.has(i.lock)) })).filter((grp) => grp.items.length > 0)
  if (!isStaff) return base
  return base.map((grp) =>
    grp.title === 'Konto' ? { ...grp, items: [grp.items[0], STAFF_NAV_ITEM, ...grp.items.slice(1)] } : grp,
  )
}

export function navItemsFor(isStaff: boolean, locked: ReadonlySet<LockKey> = new Set()): NavItem[] {
  return navGroupsFor(isStaff, locked).flatMap((x) => x.items)
}
