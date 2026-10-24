import type { LockKey } from '../services/koins'
import { BookOpen, MessageSquarePlus, ShoppingBag, UserCircle, Brain, ClipboardCheck, Home, Search, Settings, ShieldCheck, Trophy, BarChart3, Gamepad2, MessagesSquare, Target, Swords, Zap, ListChecks, Languages, ArrowLeftRight, Dices, Users, Pin, PenLine, Printer, Sparkles, Crown, Calculator, Timer, Layers, Shuffle, Mountain, Skull, type LucideIcon } from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Wenn der Admin diese Funktion sperrt, verschwindet der Eintrag. */
  lock?: LockKey
  /** Vokabeltrainer +: ohne Plus farbig mit Schloss, mit Plus normal. */
  plus?: boolean
  /** Immer in Plus-Farbe (Menüpunkt „Plus“ selbst). */
  brand?: boolean
  /** Nur für diese Lernsprachen sichtbar (leer = alle). */
  langs?: string[]
}

export interface NavGroup {
  /** Zeigt oben die Sprachauswahl (Englisch, Französisch, Spanisch, Latein). */
  langPicker?: boolean
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
  { ...g('Lernen', [
    { to: '/lernen', label: 'Lernen', icon: Brain },
    { to: '/abschreiben', label: 'Abschreiben', icon: PenLine },
    { to: '/karteikarten', label: 'Karteikarten', icon: Layers },
    { to: '/crashkurs', label: 'Crashkurs', icon: Timer },
    { to: '/test', label: 'Test', icon: ClipboardCheck },
    { to: '/ueben', label: 'Multiple Choice', icon: ListChecks },
    { to: '/grammatik', label: 'Grammatik', icon: Sparkles, plus: true },
    { to: '/unregelmaessig', label: 'Irreguläre Verben', icon: Shuffle, langs: ['en', 'fr'] },
    { to: '/konjugieren', label: 'Konjugieren', icon: Languages, langs: ['fr'] },
    { to: '/genus', label: 'le oder la?', icon: ArrowLeftRight, langs: ['fr'] },
    { to: '/buecher', label: 'Bücher', icon: BookOpen },
    { to: '/suche', label: 'Suche', icon: Search },
    { to: '/mathe', label: 'Mathe', icon: Calculator },
  ]), langPicker: true },
  g('Wettkampf', [
    { lock: 'quests', to: '/quests', label: 'Quests', icon: Target },
    { lock: 'sprint', to: '/sprint', label: 'Sprint', icon: Zap },
    { lock: 'duels', to: '/duell', label: 'Duelle', icon: Swords },
    { to: '/rangliste', label: 'Rangliste', icon: Trophy },
    { to: '/statistik', label: 'Statistik', icon: BarChart3 },
  ]),
  g('Spaß', [
    { lock: 'games', to: '/spiele', label: 'Spiele', icon: Gamepad2 },
    { lock: 'duels', to: '/parkour', label: 'Parkour', icon: Mountain },
    { lock: 'duels', to: '/deathrun', label: 'Offene Deathrun-Lobby', icon: Skull },
    { lock: 'gambling', to: '/gambling', label: 'Gambling', icon: Dices },
    { lock: 'chat', to: '/chat', label: 'Chat', icon: MessagesSquare },
    { to: '/online', label: 'Wer ist da?', icon: Users },
    { lock: 'shop', to: '/shop', label: 'Shop', icon: ShoppingBag },
    { to: '/plus', label: 'Plus', icon: Crown, brand: true },
    { lock: 'print', to: '/druckshop', label: '3D-Druck-Shop', icon: Printer },
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
export function navGroupsFor(isStaff: boolean, locked: ReadonlySet<LockKey> = new Set(), language = 'en'): NavGroup[] {
  const base = NAV_GROUPS.map((grp) => ({ ...grp, items: grp.items.filter((i) => (!i.lock || !locked.has(i.lock)) && (!i.langs || i.langs.includes(language))) })).filter((grp) => grp.items.length > 0)
  if (!isStaff) return base
  return base.map((grp) =>
    grp.title === 'Konto' ? { ...grp, items: [grp.items[0], STAFF_NAV_ITEM, ...grp.items.slice(1)] } : grp,
  )
}

export function navItemsFor(isStaff: boolean, locked: ReadonlySet<LockKey> = new Set(), language = 'en'): NavItem[] {
  return navGroupsFor(isStaff, locked, language).flatMap((x) => x.items)
}

/** Reihenfolge der Sprachen im Menü: Englisch und Französisch oben. */
export const NAV_LANGS: { id: string; label: string; short: string }[] = [
  { id: 'en', label: 'Englisch', short: 'EN' },
  { id: 'fr', label: 'Französisch', short: 'FR' },
  { id: 'es', label: 'Spanisch', short: 'ES' },
  { id: 'la', label: 'Latein', short: 'LA' },
]
