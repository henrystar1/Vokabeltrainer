import type { CSSProperties } from 'react'
import type { Role, ShopKind } from '../../types'

/**
 * Aussehen der Shop-Artikel. Die Datenbank kennt nur ID, Name und Preis;
 * wie ein Artikel aussieht, steht hier (Schlüssel = Artikel-ID).
 */

export const AVATARS: Record<string, string> = {
  avatar_rocket: '🚀',
  avatar_cat: '🐱',
  avatar_fox: '🦊',
  avatar_panda: '🐼',
  avatar_owl: '🦉',
  avatar_robot: '🤖',
  avatar_alien: '👽',
  avatar_octopus: '🐙',
  avatar_ghost: '👻',
  avatar_unicorn: '🦄',
  avatar_lion: '🦁',
  avatar_dragon: '🐲',
  avatar_wizard: '🧙',
  avatar_ninja: '🥷',
  avatar_crown: '👑',
  avatar_diamond: '💎',
}

/** Namensfarben: Einzelfarbe oder Verlauf. */
export const NAME_COLORS: Record<string, { solid?: string; gradient?: string }> = {
  color_cyan: { solid: '#22d3ee' },
  color_pink: { solid: '#f472b6' },
  color_emerald: { solid: '#34d399' },
  color_orange: { solid: '#fb923c' },
  color_violet: { solid: '#a78bfa' },
  color_gold: { solid: '#fbbf24' },
  color_rose: { solid: '#fb7185' },
  color_lime: { solid: '#a3e635' },
  color_sunset: { gradient: 'linear-gradient(90deg,#f97316,#ec4899,#8b5cf6)' },
  color_ocean: { gradient: 'linear-gradient(90deg,#22d3ee,#3b82f6,#6366f1)' },
  color_candy: { gradient: 'linear-gradient(90deg,#f9a8d4,#c4b5fd,#93c5fd)' },
  color_void: { gradient: 'linear-gradient(90deg,#1d4ed8,#38bdf8,#e0f2fe,#38bdf8,#1d4ed8)' },
  color_aurora: { gradient: 'linear-gradient(90deg,#34d399,#22d3ee,#a78bfa,#f472b6)' },
}

/** Effekt-Artikel → CSS-Klasse (Definition in index.css). */
export const EFFECT_CLASSES: Record<string, string> = {
  effect_glow: 'fx-glow',
  effect_pulse: 'fx-pulse',
  effect_float: 'fx-float',
  effect_sparkle: 'fx-sparkle',
  effect_neon: 'fx-neon',
  effect_shimmer: 'fx-shimmer',
  effect_rainbow: 'fx-rainbow',
  effect_fire: 'fx-fire',
  // Nur für Mods/Admins
  effect_mod_aura: 'fx-mod-aura',
  effect_mod_bolt: 'fx-mod-bolt',
  effect_admin_royal: 'fx-admin-royal',
  effect_admin_void: 'fx-admin-void',
  effect_vortex: 'fx-vortex',
}

/** Spender-Tags aus dem Shop (Klasse in index.css). */
export const TAGS: Record<string, { label: string; className: string }> = {
  tag_supporter: { label: 'Unterstützer', className: 'tag-supporter' },
  tag_big: { label: 'Big Spender', className: 'tag-big' },
  tag_master: { label: 'Master Spender', className: 'tag-master' },
  tag_legend: { label: 'Legende', className: 'tag-legend' },
  tag_king: { label: 'Coin-König', className: 'tag-king' },
}

/** Automatische Rollen-Tags (nicht kaufbar). */
export const ROLE_TAGS: Partial<Record<Role, { label: string; className: string }>> = {
  mod: { label: 'MOD', className: 'tag-mod' },
  admin: { label: 'ADMIN', className: 'tag-admin' },
}

/** Rahmenfarbe um den Namen in der Rangliste = Hauptfarbe des gewählten Designs (Standarddesign: kein Rahmen). */
export function themeFrameColor(themeId: string | null | undefined): string | null {
  if (!themeId || themeId === DEFAULT_THEME) return null
  return THEMES[themeId]?.cyan ?? null
}

export function nameColorStyle(colorId: string | null | undefined): { className: string; style: CSSProperties } {
  const c = colorId ? NAME_COLORS[colorId] : undefined
  if (!c) return { className: '', style: {} }
  if (c.gradient) return { className: 'bg-clip-text text-transparent', style: { backgroundImage: c.gradient } }
  return { className: '', style: { color: c.solid } }
}

export type Decor = 'stars' | 'bubbles' | 'petals' | 'confetti' | 'fireflies' | 'code' | 'sparkles'

export interface ThemePalette {
  /** Hex-Werte der Hintergrundtöne (dunkel → heller). */
  s950: string
  s900: string
  s800: string
  s700: string
  s600: string
  cyan: string
  violet: string
  blue: string
  decor: Decor
  /** Farben der Dekoration. */
  decorColors: string[]
  /** Vorschau-Verlauf im Shop. */
  preview: string
}

export const DEFAULT_THEME = 'theme_space'

export const THEMES: Record<string, ThemePalette> = {
  theme_space: {
    s950: '#05070f', s900: '#080c1a', s800: '#0d1326', s700: '#141c36', s600: '#1d2747',
    cyan: '#22d3ee', violet: '#8b5cf6', blue: '#3b82f6',
    decor: 'stars', decorColors: ['#e2e8f0'], preview: 'linear-gradient(135deg,#05070f,#1d2747 60%,#8b5cf6)',
  },
  theme_mono: {
    s950: '#0a0a0a', s900: '#111111', s800: '#171717', s700: '#222222', s600: '#2e2e2e',
    cyan: '#e5e5e5', violet: '#a3a3a3', blue: '#d4d4d4',
    decor: 'stars', decorColors: ['#a3a3a3'], preview: 'linear-gradient(135deg,#0a0a0a,#2e2e2e 60%,#e5e5e5)',
  },
  theme_ocean: {
    s950: '#03121c', s900: '#061c2b', s800: '#0a2a40', s700: '#0f3a57', s600: '#164c70',
    cyan: '#2dd4bf', violet: '#38bdf8', blue: '#0ea5e9',
    decor: 'bubbles', decorColors: ['#7dd3fc', '#5eead4'], preview: 'linear-gradient(135deg,#03121c,#164c70 60%,#2dd4bf)',
  },
  theme_forest: {
    s950: '#06100a', s900: '#0a1a10', s800: '#0f2718', s700: '#163a24', s600: '#1f4f31',
    cyan: '#86efac', violet: '#4ade80', blue: '#a3e635',
    decor: 'fireflies', decorColors: ['#fde68a', '#bef264'], preview: 'linear-gradient(135deg,#06100a,#1f4f31 60%,#86efac)',
  },
  theme_sunset: {
    s950: '#150a10', s900: '#1f0e16', s800: '#2e1420', s700: '#431d2c', s600: '#5c2838',
    cyan: '#fb923c', violet: '#f43f5e', blue: '#f59e0b',
    decor: 'stars', decorColors: ['#fed7aa', '#fecdd3'], preview: 'linear-gradient(135deg,#150a10,#5c2838 55%,#fb923c)',
  },
  theme_sakura: {
    s950: '#140a12', s900: '#1d0f1a', s800: '#2b1626', s700: '#3f2038', s600: '#552b4c',
    cyan: '#f9a8d4', violet: '#d8b4fe', blue: '#fda4af',
    decor: 'petals', decorColors: ['#fbcfe8', '#f9a8d4', '#fecdd3'], preview: 'linear-gradient(135deg,#140a12,#552b4c 55%,#f9a8d4)',
  },
  theme_party: {
    s950: '#0f0720', s900: '#170b30', s800: '#221046', s700: '#321863', s600: '#44217f',
    cyan: '#22d3ee', violet: '#e879f9', blue: '#facc15',
    decor: 'confetti', decorColors: ['#f472b6', '#22d3ee', '#facc15', '#a3e635', '#c084fc'], preview: 'linear-gradient(135deg,#0f0720,#44217f 50%,#e879f9,#facc15)',
  },
  theme_candy: {
    s950: '#150b1c', s900: '#1e1028', s800: '#2c1639', s700: '#3f2053', s600: '#552b6e',
    cyan: '#f9a8d4', violet: '#a5b4fc', blue: '#7dd3fc',
    decor: 'bubbles', decorColors: ['#fbcfe8', '#c7d2fe', '#bae6fd'], preview: 'linear-gradient(135deg,#150b1c,#552b6e 50%,#f9a8d4,#7dd3fc)',
  },
  theme_neon: {
    s950: '#050510', s900: '#0a0a1c', s800: '#10102c', s700: '#1a1a45', s600: '#26266a',
    cyan: '#00f5ff', violet: '#ff2bd6', blue: '#7c3aed',
    decor: 'sparkles', decorColors: ['#00f5ff', '#ff2bd6'], preview: 'linear-gradient(135deg,#050510,#26266a 50%,#ff2bd6,#00f5ff)',
  },
  theme_matrix: {
    s950: '#010a04', s900: '#021208', s800: '#04200f', s700: '#07331a', s600: '#0b4a27',
    cyan: '#4ade80', violet: '#22c55e', blue: '#86efac',
    decor: 'code', decorColors: ['#22c55e'], preview: 'linear-gradient(135deg,#010a04,#0b4a27 60%,#4ade80)',
  },
  theme_aurora: {
    s950: '#04101a', s900: '#071a24', s800: '#0b2733', s700: '#10394a', s600: '#175066',
    cyan: '#34d399', violet: '#a78bfa', blue: '#22d3ee',
    decor: 'stars', decorColors: ['#a7f3d0', '#ddd6fe'], preview: 'linear-gradient(135deg,#04101a,#175066 45%,#34d399,#a78bfa)',
  },
  theme_gold: {
    s950: '#0e0b04', s900: '#171207', s800: '#241c0a', s700: '#37290e', s600: '#4d3a14',
    cyan: '#fbbf24', violet: '#f59e0b', blue: '#fcd34d',
    decor: 'sparkles', decorColors: ['#fde68a', '#fbbf24'], preview: 'linear-gradient(135deg,#0e0b04,#4d3a14 55%,#fbbf24)',
  },
}

export const KIND_LABEL: Record<ShopKind, string> = {
  avatar: 'Profilbilder',
  color: 'Namensfarben',
  effect: 'Effekte',
  theme: 'Designs',
  tag: 'Tags',
}

export function hexToTriplet(hex: string): string {
  const h = hex.replace('#', '')
  const n = parseInt(h, 16)
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`
}
