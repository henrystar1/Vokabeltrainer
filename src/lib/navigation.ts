import type { LockKey } from '../services/koins'
import { BookOpen, MessageSquarePlus, ShoppingBag, UserCircle, Brain, ClipboardCheck, Home, Search, Settings, ShieldCheck, Trophy, BarChart3, Gamepad2, MessagesSquare, Target, Swords, Zap, ListChecks, Languages, ArrowLeftRight, Dices, Users, Pin, PenLine, Printer, Sparkles, Crown, Calculator, Timer, Layers, Shuffle, Mountain, Skull, ClipboardList, Globe, Gift, Package, Puzzle, Binary, TrendingUp, ScanText, Car, type LucideIcon } from 'lucide-react'

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
  /** Kurzbeschreibung für die Kachel auf der Lernen-Seite */
  hub?: string
  /** false = nicht im Menü, nur als Kachel auf der Lernen-Seite */
  menu?: false
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
    { lock: 'board', to: '/brett', label: 'Schwarzes Brett', icon: Pin },
  ]),
  { ...g('Lernen', [
    { lock: 'learn', to: '/lernen', label: 'Lernen', icon: Brain },
    { lock: 'books', to: '/buecher', label: 'Bücher', icon: BookOpen },
    { lock: 'cards', to: '/karteikarten', label: 'Karteikarten', icon: Layers, hub: 'Karten umdrehen und sortieren' },
    { lock: 'test', to: '/test', label: 'Test', icon: ClipboardCheck, hub: 'Wissen prüfen, Auswertung am Ende' },
    { lock: 'homework', to: '/hausaufgaben', label: 'Hausaufgaben', icon: ClipboardList },
    { lock: 'copy', to: '/abschreiben', label: 'Abschreiben', icon: PenLine, menu: false, hub: 'Wörter abschreiben und einprägen' },
    { lock: 'cram', to: '/crashkurs', label: 'Crashkurs', icon: Timer, menu: false, hub: 'Schnell vor der Arbeit: ansehen, Karten, Test' },
    { lock: 'practice', to: '/ueben', label: 'Multiple Choice', icon: ListChecks, menu: false, hub: 'Antwort aus mehreren auswählen' },
    { lock: 'grammar', to: '/grammatik', label: 'Grammatik', icon: Sparkles, plus: true, menu: false, hub: 'Regeln üben' },
    { lock: 'irregular', to: '/unregelmaessig', label: 'Irreguläre Verben', icon: Shuffle, langs: ['en', 'fr'], menu: false, hub: 'Unregelmäßige Verbformen' },
    { lock: 'conjugate', to: '/konjugieren', label: 'Konjugieren', icon: Languages, langs: ['fr'], menu: false, hub: 'Verben beugen' },
    { lock: 'gender', to: '/genus', label: 'le oder la?', icon: ArrowLeftRight, langs: ['fr'], menu: false, hub: 'Das richtige Geschlecht' },
    { lock: 'search', to: '/suche', label: 'Suche', icon: Search, hub: 'Vokabel in allen Büchern finden' },
  ]), langPicker: true },
  g('Mehr üben', [
    { lock: 'math', to: '/mathe', label: 'Mathe', icon: Calculator },
    { to: '/schnelllesen', label: 'Schnelllesen', icon: ScanText },
    { lock: 'memorize', to: '/auswendig', label: 'Auswendig (Pi, Flaggen)', icon: Binary },
  ]),
  g('Wettkampf', [
    { lock: 'quests', to: '/quests', label: 'Quests', icon: Target },
    { lock: 'sprint', to: '/sprint', label: 'Sprint', icon: Zap },
    { lock: 'duels', to: '/duell', label: 'Duelle', icon: Swords },
    { lock: 'ranking', to: '/rangliste', label: 'Rangliste', icon: Trophy },
    { lock: 'stats', to: '/statistik', label: 'Statistik', icon: BarChart3 },
  ]),
  g('Spiele', [
    { lock: 'games', to: '/spiele', label: 'Spiele', icon: Gamepad2 },
    { lock: 'online', to: '/mehrspieler', label: 'Online-Spiele', icon: Puzzle },
    { lock: 'duels', to: '/deathrun', label: 'Offene Deathrun-Lobby', icon: Skull },
    { lock: 'parkour', to: '/parkour', label: 'Parkour', icon: Mountain },
    { lock: 'cars', to: '/autohaus', label: 'Autohaus & Rennen', icon: Car },
    { lock: 'gambling', to: '/gambling', label: 'Gambling', icon: Dices },
  ]),
  g('Coins & Belohnungen', [
    { lock: 'advent', to: '/advent', label: 'Adventskalender', icon: Gift },
    { lock: 'loot', to: '/loot', label: 'Loot Drop', icon: Package },
    { lock: 'stocks', to: '/boerse', label: 'Börse', icon: TrendingUp },
    { lock: 'shop', to: '/shop', label: 'Shop', icon: ShoppingBag },
    { lock: 'print', to: '/druckshop', label: '3D-Druck-Shop', icon: Printer },
    { lock: 'plus', to: '/plus', label: 'Plus & Pro', icon: Crown, brand: true },
  ]),
  g('Community', [
    { lock: 'chat', to: '/chat', label: 'Chat', icon: MessagesSquare },
    { lock: 'presence', to: '/online', label: 'Wer ist da?', icon: Users },
    { lock: 'websites', to: '/websites', label: 'Websites', icon: Globe },
  ]),
  g('Konto', [
    { to: '/profil', label: 'Profil', icon: UserCircle },
    { lock: 'feedback', to: '/feedback', label: 'Feedback', icon: MessageSquarePlus },
    { to: '/einstellungen', label: 'Einstellungen', icon: Settings },
  ]),
]

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((x) => x.items)

/** Nur für Mods und Admins sichtbar. */
export const STAFF_NAV_ITEM: NavItem = { to: '/verwaltung', label: 'Verwaltung', icon: ShieldCheck }

/** Gruppierte Menüeinträge; für Mods/Admins steht „Verwaltung“ in der Gruppe „Konto“. Gesperrte Funktionen fehlen. */
export function navGroupsFor(isStaff: boolean, locked: ReadonlySet<LockKey> = new Set(), language = 'en'): NavGroup[] {
  const base = NAV_GROUPS.map((grp) => ({ ...grp, items: grp.items.filter((i) => i.menu !== false && (!i.lock || !locked.has(i.lock)) && (!i.langs || i.langs.includes(language))) })).filter((grp) => grp.items.length > 0)
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

/** Kacheln auf der Lernen-Seite: alle Übungsarten (auch die, die nicht im Menü stehen). */
export function hubItemsFor(locked: ReadonlySet<LockKey> = new Set(), language = 'en'): NavItem[] {
  return NAV_ITEMS.filter((i) => i.hub && (!i.lock || !locked.has(i.lock)) && (!i.langs || i.langs.includes(language)))
}
