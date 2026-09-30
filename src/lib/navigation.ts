import { BookOpen, Brain, ClipboardCheck, Home, Search, Settings, Trophy, BarChart3, type LucideIcon } from 'lucide-react'

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
