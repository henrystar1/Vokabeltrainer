import { useEffect } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { DEFAULT_THEME, THEMES, hexToTriplet, resolveTheme } from './catalog'
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
    if (t.fx) root.dataset.fx = t.fx
    else delete root.dataset.fx
  }, [themeId, customVersion])
  return null
}
