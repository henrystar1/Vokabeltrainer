import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import CoinIcon from '../../components/ui/CoinIcon'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../auth/AuthProvider'
import { claimDailyBonus, getWallet } from '../../services/koins'

interface WalletState {
  balance: number
  /** Lädt das Guthaben neu (nach Kauf, Lernen, Code …). */
  refresh: () => Promise<void>
  setBalance: (n: number) => void
}

const WalletContext = createContext<WalletState | null>(null)

/** Wie oft das Guthaben zusätzlich zur Live-Verbindung nachgeladen wird. */
const POLL_MS = 45_000

export function WalletProvider({ children }: { children: ReactNode }) {
  const { user, profileReady, isStaff, blocked } = useAuth()
  const userId = user?.id
  const [balance, setBalanceState] = useState(0)
  const [toast, setToast] = useState<{ amount: number; key: number } | null>(null)
  const last = useRef<number | null>(null)

  // Einzige Stelle, an der das Guthaben gesetzt wird: zeigt bei einem Plus kurz "+N Coins".
  const setBalance = useCallback((n: number) => {
    const prev = last.current
    last.current = n
    setBalanceState(n)
    if (prev !== null && n > prev) setToast({ amount: n - prev, key: Date.now() })
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 3500)
    return () => window.clearTimeout(t)
  }, [toast])

  const refresh = useCallback(async () => {
    if (!userId) return
    try {
      setBalance(await getWallet())
    } catch {
      /* Anzeige ist nicht kritisch */
    }
  }, [userId, setBalance])

  useEffect(() => {
    if (!userId) {
      last.current = null
      setBalanceState(0)
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

    // Live: Änderungen am eigenen Guthaben kommen sofort (Supabase Realtime) …
    const channel = supabase
      .channel(`wallet-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'koin_wallets', filter: `user_id=eq.${userId}` }, (payload) => {
        const row = payload.new as { balance?: number } | null
        if (active && row && typeof row.balance === 'number') setBalance(row.balance)
      })
      .subscribe()

    // … und als Sicherheitsnetz regelmäßig sowie beim Zurückkehren zum Tab.
    const poll = () => {
      if (document.visibilityState === 'visible') void getWallet().then((b) => active && setBalance(b)).catch(() => undefined)
    }
    const timer = window.setInterval(poll, POLL_MS)
    document.addEventListener('visibilitychange', poll)
    return () => {
      active = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', poll)
      void supabase.removeChannel(channel)
    }
  }, [userId, profileReady, isStaff, blocked, setBalance])

  const value = useMemo(() => ({ balance, refresh, setBalance }), [balance, refresh, setBalance])
  return (
    <WalletContext.Provider value={value}>
      {children}
      {toast && (
        <div key={toast.key} role="status" className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex justify-center px-4">
          <div className="flex animate-rise items-center gap-2 rounded-full border border-amber-300/40 bg-space-800/95 px-5 py-2.5 font-mono text-amber-200 shadow-glow backdrop-blur">
            <CoinIcon size={18} /> +{toast.amount.toLocaleString('de-DE')} Coins
          </div>
        </div>
      )}
    </WalletContext.Provider>
  )
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error('useWallet muss innerhalb von WalletProvider verwendet werden.')
  return ctx
}
