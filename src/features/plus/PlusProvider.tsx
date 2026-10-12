import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { getPlusStatus, type PlusStatus } from '../../services/plus'
import PlusDialog from './PlusDialog'

interface PlusState {
  status: PlusStatus | null
  /** Plus aktiv (Admins immer). */
  active: boolean
  reload: () => Promise<void>
  /** Öffnet das Fenster „Vokabeltrainer +“ (Anfrage, Tageskauf). */
  openDialog: () => void
}

const PlusContext = createContext<PlusState | null>(null)

export function PlusProvider({ children }: { children: ReactNode }) {
  const { user, profileReady, blocked } = useAuth()
  const [status, setStatus] = useState<PlusStatus | null>(null)
  const [open, setOpen] = useState(false)

  const reload = useCallback(async () => {
    try {
      setStatus(await getPlusStatus())
    } catch {
      /* Plus ist optional: bei Fehlern bleibt der letzte Stand */
    }
  }, [])

  useEffect(() => {
    if (!user || !profileReady || blocked) {
      setStatus(null)
      return
    }
    void reload()
    // Gelegentlich nachladen, damit Menü und Schloss nach dem Vergeben durch den Admin verschwinden.
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void reload() }, 60_000)
    return () => window.clearInterval(t)
  }, [user, profileReady, blocked, reload])

  const value = useMemo<PlusState>(() => ({ status, active: !!status?.active, reload, openDialog: () => setOpen(true) }), [status, reload])
  return (
    <PlusContext.Provider value={value}>
      {children}
      {open && <PlusDialog onClose={() => setOpen(false)} />}
    </PlusContext.Provider>
  )
}

export function usePlus(): PlusState {
  const c = useContext(PlusContext)
  if (!c) throw new Error('usePlus braucht den PlusProvider.')
  return c
}
