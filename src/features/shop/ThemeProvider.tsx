import { useEffect } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { DEFAULT_THEME, THEMES, hexToTriplet, hslTriplet, resolveTheme } from './catalog'
import { useCustomVersion } from './custom'

/** Setzt die Farbvariablen der Website passend zum ausgewählten Design. Rendert nichts. */
export default function ThemeApplier() {
  const { themeId } = useAuth()
  const customVersion = useCustomVersion()
  useEffect(() => {
    const own = resolveTheme(themeId)
    const id = themeId && own ? themeId : DEFAULT_THEME
    const t = own ?? THEMES[DEFAULT_THEME]
    const root = document.documentElement
    const vars: Record<string, string> = {
      '--s950': t.s950,
      '--s900': t.s900,
      '--s800': t.s800,
      '--s700': t.s700,
      '--s600': t.s600,
      '--c-cyan': t.cyan,
      '--c-violet': t.violet,
      '--c-blue': t.blue,
    }
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, hexToTriplet(v))
    root.dataset.theme = id
    if (t.fx) root.dataset.fx = t.fx === 'hue' ? 'rainbow' : t.fx
    else delete root.dataset.fx
    if (t.fx !== 'hue') return
    // Farbwechsel-Design: die ganze Palette wandert langsam durch den Farbkreis.
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    let h = 200
    const paint = () => {
      const set = (k: string, v: string) => root.style.setProperty(k, v)
      set('--s950', hslTriplet(h, 55, 5))
      set('--s900', hslTriplet(h, 50, 8))
      set('--s800', hslTriplet(h, 45, 12))
      set('--s700', hslTriplet(h, 42, 18))
      set('--s600', hslTriplet(h, 40, 26))
      set('--c-cyan', hslTriplet(h, 85, 60))
      set('--c-violet', hslTriplet(h + 70, 80, 66))
      set('--c-blue', hslTriplet(h + 140, 85, 62))
    }
    paint()
    if (reduce) return
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      h = (h + 1.5) % 360
      paint()
    }, 120)
    return () => window.clearInterval(timer)
  }, [themeId, customVersion])
  return null
}
