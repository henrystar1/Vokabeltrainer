import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { UserSettings } from '../../types'
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../../services/settings'
import { useAuth } from '../auth/AuthProvider'
import { normalizeSettings } from './rules'

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

  const update = useCallback(
    async (patch: Partial<UserSettings>) => {
      if (!userId) return
      const next = normalizeSettings({ ...settings, ...patch })
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
