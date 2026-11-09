import { useCallback, useEffect, useRef } from 'react'
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import { gameClientFor, getGameSlot, whenGameDbsReady } from '../../lib/gameRealtime'

/**
 * Echtzeit-Hinweis „es gibt etwas Neues“ für ein Online-Spiel. Der Spielstand selbst liegt in der Haupt-Datenbank
 * (dort prüft der Server alle Regeln); nur der Zuruf („hol dir den neuen Stand“) läuft über die Spiel-Datenbanken
 * (Broadcast), damit die Haupt-Datenbank dafür kein Realtime-Kontingent verbraucht. Als Netz und doppelter Boden fragt der Client
 * zusätzlich in größeren Abständen selbst nach (langsamer, wenn man selbst dran ist oder nichts passiert).
 */
export function useGameSync(id: string | undefined, onChange: () => void, active: boolean, pollMs = 9000): () => void {
  const cb = useRef(onChange)
  cb.current = onChange
  const chan = useRef<{ ch: RealtimeChannel; client: SupabaseClient } | null>(null)

  useEffect(() => {
    if (!id || !active) return
    let dead = false
    void whenGameDbsReady().then(() => {
      if (dead) return
      const client = gameClientFor(getGameSlot())
      const ch = client.channel(`og-${id}`, { config: { broadcast: { self: false } } })
      ch.on('broadcast', { event: 'u' }, () => cb.current()).subscribe()
      chan.current = { ch, client }
    })
    const poll = () => { if (document.visibilityState === 'visible') cb.current() }
    const t = window.setInterval(poll, pollMs)
    document.addEventListener('visibilitychange', poll)
    return () => {
      dead = true
      window.clearInterval(t)
      document.removeEventListener('visibilitychange', poll)
      const c = chan.current
      chan.current = null
      if (c) void c.client.removeChannel(c.ch)
    }
  }, [id, active, pollMs])

  /** Den anderen Bescheid geben (nach eigenem Zug). */
  return useCallback(() => {
    const c = chan.current
    if (c) void c.ch.send({ type: 'broadcast', event: 'u', payload: {} }).catch(() => undefined)
  }, [])
}
