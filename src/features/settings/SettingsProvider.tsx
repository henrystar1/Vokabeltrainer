import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { UserSettings } from '../../types'
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../../services/settings'
import { useAuth } from '../auth/AuthProvider'
import { normalizeSettings, rememberLanguageDefaults, withLanguageDefaults } from './rules'
import { setAnswerLanguage } from '../learning/answer'

interface SettingsState {
  settings: UserSettings
  loaded: boolean
  update: (patch: Partial<UserSettings>) => Promise<void>
}

const SettingsContext = createContext<SettingsState | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!userId) {
      setSettings(DEFAULT_SETTINGS)
      setLoaded(false)
      return
    }
    let active = true
    loadSettings(userId)
      .then((s) => active && setSettings(normalizeSettings(s)))
      .catch(() => undefined)
      .finally(() => active && setLoaded(true))
    return () => {
      active = false
    }
  }, [userId])

  useEffect(() => {
    setAnswerLanguage(settings.learn_language)
  }, [settings.learn_language])

  const update = useCallback(
    async (patch: Partial<UserSettings>) => {
      if (!userId) return
      let next = { ...settings, ...patch }
      // Sprache gewechselt: Anzahl und Richtung dieser Sprache laden (falls gemerkt); sonst Werte merken, die geändert wurden.
      if (patch.learn_language && patch.learn_language !== settings.learn_language) next = withLanguageDefaults(next, patch.learn_language)
      next = normalizeSettings(next)
      if (patch.words_per_round !== undefined || patch.direction_to_foreign !== undefined || patch.direction_to_german !== undefined || !next.language_defaults?.[next.learn_language]) {
        next = rememberLanguageDefaults(next)
      }
      setSettings(next)
      await saveSettings(userId, next)
    },
    [settings, userId],
  )

  const value = useMemo(() => ({ settings, loaded, update }), [settings, loaded, update])
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings(): SettingsState {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings muss innerhalb von SettingsProvider verwendet werden.')
  return ctx
}
