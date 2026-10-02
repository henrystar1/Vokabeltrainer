import { createContext, useContext, useEffect, type ReactNode } from 'react'

/**
 * Fokusmodus: Solange eine Lern- oder Testrunde läuft, werden Seitenleiste und Navigation
 * ausgeblendet, damit man nicht versehentlich wegklickt. Abbrechen geht nur über das "X".
 */
export const FocusContext = createContext<(on: boolean) => void>(() => undefined)

export function useFocusMode(active: boolean) {
  const set = useContext(FocusContext)
  useEffect(() => {
    set(active)
    return () => set(false)
  }, [active, set])
}

export function FocusProvider({ value, children }: { value: (on: boolean) => void; children: ReactNode }) {
  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>
}
