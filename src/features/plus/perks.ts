import { AlarmClock, Camera, Eye, Gift, Heart, Infinity as InfinityIcon, Shirt, Zap, GraduationCap, Coins, Dices, FileText, Gamepad2, HeartPulse, Orbit, Sparkles, Target, Trophy, type LucideIcon } from 'lucide-react'
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

/** Vorteile von Pro (zusätzlich zu allem von Plus). Zahlen kommen aus den Einstellungen. */
export function proPerks(s: PlusStatus | null): Array<{ icon: LucideIcon; title: string; text: string }> {
  const p = s?.pro_perks
  const f = (n: number | undefined, d: number) => String(n ?? d).replace('.', ',')
  return [
    { icon: Sparkles, title: 'Alles von Plus', text: 'Grammatik mit KI, Test-Blatt, Plus-Designs und alle anderen Plus-Vorteile sind enthalten.' },
    { icon: Camera, title: 'Foto-Scan', text: 'Vokabeln aus dem Buch fotografieren, mit Markierung im Bild und genauer Nachprüfung eines Bereichs.' },
    { icon: Coins, title: `Coins ×${f(p?.coin_mult, 2.5)}`, text: `Noch mehr Coins als mit Plus, dazu Ranglistenpunkte ×${f(p?.points_mult, 2.5)}.` },
    { icon: Dices, title: 'Noch bessere Gambling-Chance', text: `Deine Gewinnchance ist um ${f(p?.gamble_boost, 30)} % höher.` },
    { icon: Heart, title: `+${f(p?.hearts, 3)} Herzen im Parkour`, text: 'Zusätzlich zu den Herzen, die du gekauft hast.' },
    { icon: Zap, title: `${f(p?.jumps, 3)} Sprünge dauerhaft`, text: `Mit gekauftem Dreiersprung sind es ${(p?.jumps ?? 3) + 1}.` },
    { icon: GraduationCap, title: 'Parkour ohne Vokabeln', text: 'Du musst im Parkour nichts lernen.' },
    { icon: HeartPulse, title: 'Heilen im Parkour', text: `Bis zu ${f(p?.heal_per_run, 2)}× pro Runde Herzen auffüllen oder jemanden wiederbeleben.` },
    { icon: Eye, title: 'Zuschauen im Parkour', text: 'Anderen Spielern zuschauen, solange der Parkour nicht gesperrt ist.' },
    { icon: Gamepad2, title: `Parkour-Limit ×${f(p?.parkour_limit_mult, 2)}`, text: 'Du kannst deutlich länger spielen, wenn das Tageslimit knapp wird.' },
    { icon: Shirt, title: 'Alle Premium-Skins', text: 'Gold, Regenbogen, Galaxie, Lava, Kronen, Zauberer und alle Premium-Effekte, solange du Pro hast.' },
    { icon: Gift, title: `Bessere Türchen ×${f(p?.advent_mult, 2)}`, text: 'Im Adventskalender gibt es mehr Coins, Punkte und wertvollere Artikel.' },
    { icon: Target, title: 'Pro-Quests', text: 'Zusätzliche Quests mit höheren Zielen und größeren Belohnungen.' },
    { icon: InfinityIcon, title: 'Immer mehr', text: 'Neue Pro-Vorteile kommen automatisch dazu.' },
  ]
}
