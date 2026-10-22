/** Parkour-Cosmetics: Körperfarben und Hüte. Die IDs müssen mit `supabase/migrations/0047_parkour_shop.sql` übereinstimmen (Test prüft das). */
export interface ParkourColor { name: string; fill: string; premium?: boolean; rainbow?: boolean }
export interface ParkourHat { name: string; emoji: string; premium?: boolean }

export const PK_COLORS: Record<string, ParkourColor> = {
  rot: { name: 'Rot', fill: '#f87171' },
  orange: { name: 'Orange', fill: '#fb923c' },
  gelb: { name: 'Gelb', fill: '#facc15' },
  gruen: { name: 'Grün', fill: '#4ade80' },
  tuerkis: { name: 'Türkis', fill: '#22d3ee' },
  blau: { name: 'Blau', fill: '#60a5fa' },
  lila: { name: 'Lila', fill: '#a78bfa' },
  pink: { name: 'Pink', fill: '#f472b6' },
  weiss: { name: 'Weiß', fill: '#f1f5f9' },
  gold: { name: 'Gold', fill: '#fbbf24', premium: true },
  neon: { name: 'Neon', fill: '#a3e635', premium: true },
  regenbogen: { name: 'Regenbogen', fill: '#f472b6', premium: true, rainbow: true },
}

export const PK_HATS: Record<string, ParkourHat> = {
  kappe: { name: 'Kappe', emoji: '🧢' },
  zylinder: { name: 'Zylinder', emoji: '🎩' },
  abschluss: { name: 'Doktorhut', emoji: '🎓' },
  strohhut: { name: 'Strohhut', emoji: '👒' },
  schleife: { name: 'Schleife', emoji: '🎀' },
  krone: { name: 'Krone', emoji: '👑', premium: true },
  feuer: { name: 'Flamme', emoji: '🔥', premium: true },
}

/** Aktuelle Füllfarbe (Regenbogen wandert durch die Farben). */
export function pkFill(colorId: string | null | undefined, fallback: string, t: number): string {
  const c = colorId ? PK_COLORS[colorId] : undefined
  if (!c) return fallback
  return c.rainbow ? `hsl(${Math.round((t * 120) % 360)} 85% 65%)` : c.fill
}

export const PK_PREMIUM_FACTOR = 3
