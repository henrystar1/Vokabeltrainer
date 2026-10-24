/** Parkour-Cosmetics: Körperfarben, Hüte und Effekte. Die IDs müssen mit `supabase/migrations/0047_parkour_shop.sql` und `0050_open_deathrun.sql` übereinstimmen (Test prüft das). */
export interface ParkourColor { name: string; fill: string; premium?: boolean; rainbow?: boolean; anim?: 'galaxy' | 'lava' }
export interface ParkourFx { name: string; icon: string; blurb: string; premium?: boolean }
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
  mint: { name: 'Mint', fill: '#6ee7b7' },
  schiefer: { name: 'Schiefer', fill: '#64748b' },
  galaxie: { name: 'Galaxie', fill: '#6366f1', premium: true, anim: 'galaxy' },
  lava: { name: 'Lava', fill: '#ef4444', premium: true, anim: 'lava' },
}

export const PK_HATS: Record<string, ParkourHat> = {
  kappe: { name: 'Kappe', emoji: '🧢' },
  zylinder: { name: 'Zylinder', emoji: '🎩' },
  abschluss: { name: 'Doktorhut', emoji: '🎓' },
  strohhut: { name: 'Strohhut', emoji: '👒' },
  schleife: { name: 'Schleife', emoji: '🎀' },
  krone: { name: 'Krone', emoji: '👑', premium: true },
  feuer: { name: 'Flamme', emoji: '🔥', premium: true },
  cowboy: { name: 'Cowboy', emoji: '🤠' },
  party: { name: 'Partyhut', emoji: '🥳' },
  alien: { name: 'Alien', emoji: '👽' },
  zauberer: { name: 'Zauberer', emoji: '🧙', premium: true },
  einhorn: { name: 'Einhorn', emoji: '🦄', premium: true },
  heiligenschein: { name: 'Heiligenschein', emoji: '😇', premium: true },
}

/** Effekte hinter und um die Figur (werden mit Partikeln gezeichnet, siehe fx.ts). */
export const PK_FX: Record<string, ParkourFx> = {
  noten: { name: 'Notenstrahl', icon: '🎵', blurb: 'Ein Notenband zieht hinter dir her' },
  funken: { name: 'Funkenspur', icon: '✨', blurb: 'Goldene Funken' },
  herzen: { name: 'Herzchen', icon: '💖', blurb: 'Schwebende Herzen' },
  sterne: { name: 'Sternenstaub', icon: '⭐', blurb: 'Glitzernder Staub' },
  schnee: { name: 'Schneefall', icon: '❄️', blurb: 'Schneeflocken um dich' },
  blasen: { name: 'Seifenblasen', icon: '🫧', blurb: 'Blasen steigen auf' },
  schwarzesloch: { name: 'Schwarzes Loch', icon: '🕳️', blurb: 'Ein Strudel saugt Licht hinter dir ein', premium: true },
  blitz: { name: 'Blitze', icon: '⚡', blurb: 'Elektrische Blitze zucken', premium: true },
  feuerspur: { name: 'Feuerspur', icon: '🔥', blurb: 'Flammen hinter dir', premium: true },
  galaxiewirbel: { name: 'Galaxie-Wirbel', icon: '🌌', blurb: 'Kreisende Sterne', premium: true },
  regenbogenstrahl: { name: 'Regenbogenstrahl', icon: '🌈', blurb: 'Ein bunter Strahl folgt dir', premium: true },
}

/** Aktuelle Füllfarbe (Regenbogen wandert durch die Farben). */
export function pkFill(colorId: string | null | undefined, fallback: string, t: number): string {
  const c = colorId ? PK_COLORS[colorId] : undefined
  if (!c) return fallback
  if (c.rainbow) return `hsl(${Math.round((t * 120) % 360)} 85% 65%)`
  if (c.anim === 'galaxy') return `hsl(${Math.round(235 + 55 * Math.sin(t * 1.6))} 80% ${Math.round(48 + 10 * Math.sin(t * 2.3))}%)`
  if (c.anim === 'lava') return `hsl(${Math.round(8 + 22 * (0.5 + 0.5 * Math.sin(t * 3)))} 90% 52%)`
  return c.fill
}

export const PK_PREMIUM_FACTOR = 3
