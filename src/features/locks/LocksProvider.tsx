import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getLockedFeatures, type LockKey } from '../../services/koins'
import { useAuth } from '../auth/AuthProvider'

interface Ctx { locked: ReadonlySet<LockKey>; reload: () => void }
const LocksContext = createContext<Ctx>({ locked: new Set(), reload: () => undefined })

/** Welche Funktionen hat der Admin gerade abgeschaltet? Wird jede Minute neu geprüft. */
export function LocksProvider({ children }: { children: ReactNode }) {
  const { user, profileReady } = useAuth()
  const userId = user?.id
  const [locked, setLocked] = useState<ReadonlySet<LockKey>>(new Set())
  const reload = useCallback(() => {
    getLockedFeatures()
      .then((l) => setLocked((prev) => (prev.size === l.length && l.every((k) => prev.has(k)) ? prev : new Set(l))))
      .catch(() => undefined)
  }, [])
  useEffect(() => {
    if (!userId || !profileReady) { setLocked(new Set()); return }
    reload()
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') reload() }, 60_000)
    document.addEventListener('visibilitychange', reload)
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', reload) }
  }, [userId, profileReady, reload])
  const value = useMemo(() => ({ locked, reload }), [locked, reload])
  return <LocksContext.Provider value={value}>{children}</LocksContext.Provider>
}

export const useLocks = () => useContext(LocksContext)
