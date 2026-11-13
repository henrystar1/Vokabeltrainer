import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { getChipStatus, type ChipStatus } from '../../services/chips'
import { nextLossRun } from './chipLogic'

/** Gleiche Form wie der Coin-Geldbeutel (balance/hold/release), damit die Spiele nur den Hook tauschen müssen. */
interface ChipsState {
  balance: number
  status: ChipStatus | null
  /** Zeitpunkt (ms, Date.now) bis zu dem das Portemonnaie leer geschüttelt ist; 0 = keine Sperre. */
  lockUntil: number
  refresh: () => Promise<ChipStatus | null>
  apply: (s: ChipStatus) => void
  setBalance: (n: number) => void
  hold: () => void
  release: (n?: number) => void
}

const ChipsContext = createContext<ChipsState | null>(null)

export function ChipsProvider({ children }: { children: ReactNode }) {
  const { user, profileReady, blocked } = useAuth()
  const userId = user?.id
  const [status, setStatus] = useState<ChipStatus | null>(null)
  const [balance, setBalanceState] = useState(0)
  const [lockUntil, setLockUntil] = useState(0)
  const holding = useRef(false)
  const pending = useRef<number | null>(null)
  const before = useRef(0)
  const run = useRef(0)
  const timer = useRef(0)
  const balanceRef = useRef(0)

  const setBalance = useCallback((n: number) => {
    balanceRef.current = n
    setBalanceState(n)
  }, [])

  const apply = useCallback((s: ChipStatus) => {
    setStatus(s)
    setBalance(s.chips)
    setLockUntil(s.lock_ms > 0 ? Date.now() + s.lock_ms : 0)
    if (s.lock_ms > 0) run.current = 0
  }, [setBalance])

  const refresh = useCallback(async () => {
    if (!userId) return null
    try {
      const s = await getChipStatus()
      apply(s)
      return s
    } catch {
      return null
    }
  }, [userId, apply])

  useEffect(() => {
    if (userId && profileReady && !blocked) void refresh()
  }, [userId, profileReady, blocked, refresh])

  const release = useCallback((n?: number) => {
    window.clearTimeout(timer.current)
    holding.current = false
    const v = n ?? pending.current
    pending.current = null
    if (v === null || v === undefined) return
    run.current = nextLossRun(run.current, before.current, v)
    setBalance(v)
    // Ab der dritten Niederlage in Folge fragt der Client den Server, ob jetzt gesperrt ist (der Server entscheidet).
    if (run.current >= 3) void refresh()
  }, [setBalance, refresh])

  const hold = useCallback(() => {
    holding.current = true
    pending.current = null
    before.current = balanceRef.current
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => release(), 20_000)
  }, [release])

  const setBalanceHeld = useCallback((n: number) => {
    if (holding.current) pending.current = n
    else setBalance(n)
  }, [setBalance])

  const value = useMemo(
    () => ({ balance, status, lockUntil, refresh, apply, setBalance: setBalanceHeld, hold, release }),
    [balance, status, lockUntil, refresh, apply, setBalanceHeld, hold, release],
  )
  return <ChipsContext.Provider value={value}>{children}</ChipsContext.Provider>
}

export function useChips(): ChipsState {
  const ctx = useContext(ChipsContext)
  if (!ctx) throw new Error('useChips muss innerhalb von ChipsProvider verwendet werden.')
  return ctx
}
