/** Unterpunkte (Reiter) der Seiten: für #Rangliste/Pi im Chat und die Vorschläge dazu. */
export interface SubTab { id: string; label: string }

export const SUB_TABS: Record<string, SubTab[]> = {
  '/rangliste': [
    { id: 'week', label: 'Woche' }, { id: 'month', label: 'Monat' }, { id: 'all', label: 'Gesamt' }, { id: 'league', label: 'Liga' },
    { id: 'coins', label: 'Coins' }, { id: 'gambling', label: 'Gambling' }, { id: 'parkour', label: 'Parkour' }, { id: 'pi', label: 'Pi' }, { id: 'flags', label: 'Flaggen' },
  ],
  '/auswendig': [{ id: 'pi', label: 'Pi' }, { id: 'pow', label: 'Hochzahlen' }, { id: 'flags', label: 'Flaggen' }],
  '/gambling': [
    { id: 'slots', label: 'Automat' }, { id: 'roulette', label: 'Roulette' }, { id: 'dice', label: 'Würfeln' }, { id: 'wheel', label: 'Glücksrad' }, { id: 'blackjack', label: 'Black Jack' },
  ],
  '/shop': [
    { id: 'avatar', label: 'Profilbilder' }, { id: 'color', label: 'Namensfarben' }, { id: 'effect', label: 'Effekte' }, { id: 'tag', label: 'Tags' }, { id: 'theme', label: 'Designs' }, { id: 'parkour', label: 'Parkour' },
  ],
  '/einstellungen': [{ id: 'konto', label: 'Konto' }, { id: 'lernen', label: 'Lernen' }, { id: 'hinweise', label: 'Hinweise' }, { id: 'sicherheit', label: 'Passwort' }],
  '/verwaltung': [
    { id: 'reviews', label: 'Prüfanfragen' }, { id: 'feedback', label: 'Feedback' }, { id: 'online', label: 'Online & Nachrichten' }, { id: 'users', label: 'Benutzer' },
    { id: 'accounts', label: 'Konten anlegen' }, { id: 'staff', label: 'Einzelne Mods' }, { id: 'modrights', label: 'Standard-Rechte' }, { id: 'rules', label: 'Zahlen' },
    { id: 'shop', label: 'Shop-Preise' }, { id: 'codes', label: 'Codes' }, { id: 'grant', label: 'Coins schenken' }, { id: 'locks', label: 'Sperren' }, { id: 'gamedbs', label: 'Spiel-Datenbanken' },
    { id: 'pcatalog', label: 'Katalog' }, { id: 'pcolors', label: 'Farben' }, { id: 'pprices', label: 'Preise & Werte' }, { id: 'pbans', label: 'Gesperrt' }, { id: 'plusmoney', label: 'Preise & Verdienst' },
  ],
}

const key = (s: string) => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]/g, '')

/** Welcher Reiter ist gemeint? Passt auf Kennung oder Anzeigename (ohne Groß-/Kleinschreibung, Umlaute egal); sonst null. */
export function matchSubTab(path: string, sub: string | null | undefined): string | null {
  if (!sub) return null
  const k = key(sub)
  if (!k) return null
  const list = SUB_TABS[path] ?? []
  const exact = list.find((t) => key(t.id) === k || key(t.label) === k)
  if (exact) return exact.id
  return list.find((t) => key(t.label).startsWith(k))?.id ?? null
}
