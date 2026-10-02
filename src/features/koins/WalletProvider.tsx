import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { claimDailyBonus, getWallet } from '../../services/koins'

interface WalletState {
  balance: number
  /** Lädt das Guthaben neu (nach Kauf, Lernen, Code …). */
  refresh: () => Promise<void>
  setBalance: (n: number) => void
}

const WalletContext = createContext<WalletState | null>(null)

export function WalletProvider({ children }: { children: ReactNode }) {
  const { user, profileReady, isStaff, blocked } = useAuth()
  const userId = user?.id
  const [balance, setBalance] = useState(0)

  const refresh = useCallback(async () => {
    if (!userId) return
    try {
      setBalance(await getWallet())
    } catch {
      /* Anzeige ist nicht kritisch */
    }
  }, [userId])

  useEffect(() => {
    if (!userId) {
      setBalance(0)
      return
    }
    if (!profileReady || blocked) return
    let active = true
    const run = async () => {
      // Mods/Admins bekommen einmal pro Tag ihren Bonus; die Funktion ist idempotent.
      if (isStaff) await claimDailyBonus().catch(() => undefined)
      const b = await getWallet().catch(() => null)
      if (active && b !== null) setBalance(b)
    }
    void run()
    return () => {
      active = false
    }
  }, [userId, profileReady, isStaff, blocked])

  const value = useMemo(() => ({ balance, refresh, setBalance }), [balance, refresh])
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error('useWallet muss innerhalb von WalletProvider verwendet werden.')
  return ctx
}
