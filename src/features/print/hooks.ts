import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { adminPrintCounts, signedPrintUrls, type PrintCounts } from '../../services/printShop'

/** Bildadressen für Speicherpfade (leere Pfade werden übersprungen). */
export function useSignedUrls(paths: (string | null | undefined)[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const key = paths.filter(Boolean).join('|')
  useEffect(() => {
    const list = key ? key.split('|') : []
    if (list.length === 0) return
    let alive = true
    signedPrintUrls(list).then(
      (u) => alive && setUrls((prev) => ({ ...prev, ...u })),
      () => undefined,
    )
    return () => { alive = false }
  }, [key])
  return urls
}

/** Für den Admin: wie viele Druckaufträge warten? (Menü-Zeichen) Wird alle 30 Sekunden aktualisiert. */
export function usePrintTodo(): PrintCounts | null {
  const { isAdmin, user, profileReady } = useAuth()
  const [counts, setCounts] = useState<PrintCounts | null>(null)
  const userId = user?.id
  useEffect(() => {
    if (!isAdmin || !userId || !profileReady) { setCounts(null); return }
    let alive = true
    const load = () => {
      if (document.visibilityState !== 'visible') return
      adminPrintCounts().then((c) => alive && setCounts(c), () => undefined)
    }
    load()
    const t = window.setInterval(load, 30_000)
    document.addEventListener('visibilitychange', load)
    return () => { alive = false; window.clearInterval(t); document.removeEventListener('visibilitychange', load) }
  }, [isAdmin, userId, profileReady])
  return counts
}
