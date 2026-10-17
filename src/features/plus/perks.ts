import { AlarmClock, Coins, Dices, FileText, Gamepad2, HeartPulse, Orbit, Sparkles, Target, Trophy, type LucideIcon } from 'lucide-react'
import type { PlusStatus } from '../../services/plus'

/** Vorteile von Plus (für Plus-Seite und Fenster). Zahlen kommen aus den Einstellungen. */
export function plusPerks(s: PlusStatus | null): Array<{ icon: LucideIcon; title: string; text: string }> {
  const coin = s?.coin_mult ?? 1.5
  const pts = s?.points_mult ?? 1.5
  const revive = (s?.revive_price ?? 1000).toLocaleString('de-DE')
  const f = (n: number) => String(n).replace('.', ',')
  return [
    { icon: Sparkles, title: 'Grammatik mit KI', text: 'Lückentexte zu jedem Thema, in drei Schwierigkeiten. Alle erzeugten Blätter zum Üben.' },
    { icon: FileText, title: 'Test-Blatt mit Sätzen', text: 'Dein Test mit Satz-Aufgaben zu den Vokabeln, mit Note und Verlauf.' },
    { icon: Coins, title: `Coins ×${f(coin)}`, text: 'Mehr Coins beim Lernen, bei Quests, Spielen und Sprint.' },
    { icon: Trophy, title: `Ranglistenpunkte ×${f(pts)}`, text: 'Du steigst in der Wochenliga schneller auf.' },
    { icon: Dices, title: 'Bessere Gambling-Chance', text: `Deine Gewinnchance ist um ${f(s?.gamble_boost ?? 15)} % höher.` },
    { icon: HeartPulse, title: 'Wiederbeleben', text: `Im Spiel für ${revive} Coins weitermachen (zählt nicht für den Rekord).` },
    { icon: Gamepad2, title: 'Schönere Spielgrafik', text: 'Leuchteffekte, Spuren und bessere Farben in allen Spielen.' },
    { icon: Target, title: 'Mehr Quests', text: 'Zusätzliche Plus-Quests mit größeren Belohnungen.' },
    { icon: AlarmClock, title: 'Vokabeln sofort fällig', text: 'Gelernte Vokabeln mit einem Klick wieder zum Üben freigeben.' },
    { icon: Orbit, title: 'Animierte Profilbilder', text: 'Supernova, Portal, Galaxie und mehr, dazu Farben, Effekte, Designs und ein „+“-Tag.' },
  ]
}
