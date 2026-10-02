import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabaseClient'
import { loadProfile } from '../../services/settings'
import type { Cosmetics, Profile, Role } from '../../types'

interface AuthState {
  loading: boolean
  session: Session | null
  user: User | null
  displayName: string | null
  /** Rolle des Benutzers (Standard: "user", bis das Profil geladen ist). */
  role: Role
  isStaff: boolean
  isAdmin: boolean
  /** true, wenn ein Admin das Konto gesperrt hat. */
  blocked: boolean
  /** true, sobald das Profil (und damit die Rolle) geladen ist. */
  profileReady: boolean
  /** true, solange der Benutzer über den Link aus der Passwort-vergessen-Mail gekommen ist. */
  recovering: boolean
  /** Ausgewählte Shop-Artikel (Profilbild, Namensfarbe, Effekt). */
  cosmetics: Cosmetics
  /** Ausgewähltes Design der ganzen Website. */
  themeId: string | null
  /** Lädt das Profil neu (z. B. nach Kauf/Auswahl im Shop). */
  refreshProfile: () => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, displayName: string) => Promise<{ needsConfirmation: boolean }>
  signOut: () => Promise<void>
  sendReset: (email: string) => Promise<void>
  setNewPassword: (password: string) => Promise<void>
  setDisplayNameLocal: (name: string) => void
}

const NO_COSMETICS: Cosmetics = { avatar_id: null, color_id: null, effect_id: null }

const AuthContext = createContext<AuthState | null>(null)

/** Absolute URL innerhalb der App (berücksichtigt den Unterpfad von GitHub Pages). */
export function appUrl(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  return `${window.location.origin}${base}/${path.replace(/^\//, '')}`
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)
  const [displayName, setDisplayName] = useState<string | null>(null)
  const [role, setRole] = useState<Role>('user')
  const [blocked, setBlocked] = useState(false)
  const [profileReady, setProfileReady] = useState(false)
  const [cosmetics, setCosmetics] = useState<Cosmetics>(NO_COSMETICS)
  const [themeId, setThemeId] = useState<string | null>(null)
  const [recovering, setRecovering] = useState(false)

  useEffect(() => {
    let active = true
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return
        setSession(data.session)
        setLoading(false)
      })
      .catch(() => active && setLoading(false))
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
      if (event === 'SIGNED_OUT') {
        setRecovering(false)
        setDisplayName(null)
        setRole('user')
        setBlocked(false)
        setProfileReady(false)
        setCosmetics(NO_COSMETICS)
        setThemeId(null)
      }
    })
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  const userId = session?.user.id
  const applyProfile = useCallback((p: Profile) => {
    setDisplayName(p.display_name)
    setRole(p.role)
    setBlocked(p.blocked)
    setCosmetics({ avatar_id: p.avatar_id, color_id: p.color_id, effect_id: p.effect_id })
    setThemeId(p.theme_id)
  }, [])

  useEffect(() => {
    if (!userId) return
    let active = true
    loadProfile(userId)
      .then((p) => {
        if (active && p) applyProfile(p)
      })
      .catch(() => undefined)
      .finally(() => active && setProfileReady(true))
    return () => {
      active = false
    }
  }, [userId, applyProfile])

  const refreshProfile = useCallback(async () => {
    if (!userId) return
    const p = await loadProfile(userId)
    if (p) applyProfile(p)
  }, [userId, applyProfile])

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) throw error
  }, [])

  const signUp = useCallback(async (email: string, password: string, name: string) => {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { display_name: name.trim() }, emailRedirectTo: appUrl('/') },
    })
    if (error) throw error
    return { needsConfirmation: data.session === null }
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  const sendReset = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: appUrl('/passwort-neu') })
    if (error) throw error
  }, [])

  const setNewPassword = useCallback(async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password })
    if (error) throw error
    setRecovering(false)
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      loading,
      session,
      user: session?.user ?? null,
      displayName,
      role,
      isStaff: role === 'mod' || role === 'admin',
      isAdmin: role === 'admin',
      blocked,
      profileReady,
      cosmetics,
      themeId,
      refreshProfile,
      recovering,
      signIn,
      signUp,
      signOut,
      sendReset,
      setNewPassword,
      setDisplayNameLocal: setDisplayName,
    }),
    [loading, session, displayName, role, blocked, profileReady, cosmetics, themeId, refreshProfile, recovering, signIn, signUp, signOut, sendReset, setNewPassword],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth muss innerhalb von AuthProvider verwendet werden.')
  return ctx
}
