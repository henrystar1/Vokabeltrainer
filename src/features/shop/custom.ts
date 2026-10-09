import { useSyncExternalStore, type CSSProperties } from 'react'
import type { CustomItem } from '../../types'
import { getCustomItems } from '../../services/koins'
import type { ThemePalette } from './catalog'

/**
 * Eigene Shop-Artikel (vom Admin angelegt). Alle Nutzer laden die Liste einmal; Profilbilder, Namen, Tags und
 * Designs schlagen hier nach, wenn eine ID nicht zu den eingebauten Artikeln gehört.
 */

let items = new Map<string, CustomItem>()
let version = 0
const listeners = new Set<() => void>()

function emit() {
  version++
  for (const l of listeners) l()
}

export async function refreshCustomItems(): Promise<void> {
  try {
    const list = await getCustomItems()
    items = new Map(list.map((i) => [i.id, i]))
    emit()
  } catch {
    // Ohne die neue Migration gibt es die Funktion noch nicht – dann bleibt es bei den eingebauten Artikeln.
  }
}

export function clearCustomItems() {
  items = new Map()
  emit()
}

export const getCustom = (id: string | null | undefined): CustomItem | undefined => (id ? items.get(id) : undefined)

/** Lässt eine Komponente neu zeichnen, wenn sich die eigenen Artikel ändern. */
export function useCustomVersion(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => version,
  )
}

/* ---------- Absicherung: nur klar geformte Werte kommen ins CSS ---------- */

export const safeHex = (v: unknown, fallback: string): string => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : fallback)
const num = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof v === 'number' ? v : Number.NaN
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

/** SVG als Bild: Skripte laufen darin nie, und fremde Adressen werden nicht geladen. */
export const svgDataUrl = (svg: string): string => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`

/** Namensfarbe: ein Wert = einfarbig, mehrere = Verlauf (optional laufend). */
export function customNameColor(item: CustomItem): { className: string; style: CSSProperties } {
  const st = item.style ?? {}
  const colors = (Array.isArray(st.colors) ? st.colors : []).slice(0, 5).map((c) => safeHex(c, '#22d3ee'))
  if (colors.length === 0) return { className: '', style: {} }
  if (colors.length === 1) return { className: '', style: { color: colors[0] } }
  const run = st.animate === true
  const list = run ? [...colors, colors[0]].join(',') : colors.join(',')
  return {
    className: `bg-clip-text text-transparent ${run ? 'cname-run' : ''}`,
    style: { backgroundImage: `linear-gradient(90deg,${list})`, backgroundSize: run ? '200% 100%' : undefined },
  }
}

export const EFFECT_PRESETS = ['glow', 'pulse', 'rainbow', 'shimmer', 'neon', 'float', 'dollar'] as const
export type EffectPreset = (typeof EFFECT_PRESETS)[number]

/** Effekt: Klasse und Variablen (Farbe, Dauer). */
export function customEffect(item: CustomItem): { className: string; style: CSSProperties } {
  const st = item.style ?? {}
  const preset = EFFECT_PRESETS.includes(st.preset as EffectPreset) ? (st.preset as EffectPreset) : 'glow'
  return {
    className: `fxc fxc-${preset}`,
    style: { '--fxc': safeHex(st.color, '#22d3ee'), '--fxs': `${num(st.speed, 0.5, 10, 2)}s` } as CSSProperties,
  }
}

export const TAG_ANIMS = ['none', 'shine', 'rainbow'] as const
export type TagAnim = (typeof TAG_ANIMS)[number]

export function customTag(item: CustomItem): { label: string; className: string; style: CSSProperties } {
  const st = item.style ?? {}
  const label = typeof st.label === 'string' && st.label.trim() ? st.label.trim().slice(0, 10) : item.name.slice(0, 10)
  const anim = TAG_ANIMS.includes(st.anim as TagAnim) ? (st.anim as TagAnim) : 'none'
  const a = safeHex(st.bg1, '#7c3aed')
  const b = safeHex(st.bg2, a)
  return {
    label,
    className: `tagc tagc-${anim}`,
    style: { color: safeHex(st.fg, '#ffffff'), background: `linear-gradient(90deg,${a},${b})`, backgroundSize: anim === 'none' ? undefined : '200% 100%' },
  }
}

/** Mischt zwei Hex-Farben (t = Anteil von b). */
export function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const ch = (shift: number) => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t)
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`
}

export const DECORS = ['stars', 'bubbles', 'petals', 'confetti', 'fireflies', 'code', 'sparkles'] as const

/** Design aus wenigen Farben: Hintergrund + zwei Akzente → komplette Palette. */
export function customTheme(item: CustomItem): ThemePalette {
  const st = item.style ?? {}
  const bg = safeHex(st.bg, '#0a0f24')
  const a1 = safeHex(st.a1, '#22d3ee')
  const a2 = safeHex(st.a2, '#8b5cf6')
  const a3 = safeHex(st.a3, '#3b82f6')
  const light = '#ffffff'
  const decor = (DECORS as readonly string[]).includes(st.decor as string) ? (st.decor as ThemePalette['decor']) : 'stars'
  const fx = st.fx === 'shine' || st.fx === 'rainbow' ? st.fx : undefined
  return {
    s950: mixHex(bg, '#000000', 0.45),
    s900: mixHex(bg, '#000000', 0.2),
    s800: bg,
    s700: mixHex(bg, light, 0.07),
    s600: mixHex(bg, light, 0.15),
    cyan: a1,
    violet: a2,
    blue: a3,
    decor,
    decorColors: [a1, a2],
    preview: `linear-gradient(135deg,${mixHex(bg, '#000000', 0.45)},${mixHex(bg, light, 0.15)} 55%,${a1},${a2})`,
    fx,
  }
}
