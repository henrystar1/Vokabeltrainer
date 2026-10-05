import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabaseClient'
import { getChatUnread, markChatRead } from '../../services/play'
import { useAuth } from '../auth/AuthProvider'

type Handler = (payload: Record<string, unknown>) => void

interface ChatState {
  /** Anzahl ungelesener Nachrichten (für den roten Punkt). */
  unread: number
  markRead: (lastId: number) => void
  send: (event: 'typing' | 'posted', payload: Record<string, unknown>) => void
  on: (event: 'typing' | 'posted', handler: Handler) => () => void
}

const ChatContext = createContext<ChatState | null>(null)
const POLL_MS = 20_000

/**
 * Hält die Echtzeit-Verbindung des Chats und zählt ungelesene Nachrichten – auch außerhalb der Chat-Seite,
 * damit am Menüpunkt „Chat“ ein roter Punkt erscheinen kann.
 */
export function ChatProvider({ children }: { children: ReactNode }) {
  const { user, profileReady, blocked } = useAuth()
  const userId = user?.id
  const [unread, setUnread] = useState(0)
  const channel = useRef<RealtimeChannel | null>(null)
  const handlers = useRef<Record<string, Set<Handler>>>({ typing: new Set(), posted: new Set() })
  const readUntil = useRef(0)

  const refresh = useCallback(async () => {
    try {
      setUnread(await getChatUnread())
    } catch {
      /* Punkt ist nicht kritisch */
    }
  }, [])

  useEffect(() => {
    if (!userId || !profileReady || blocked) {
      setUnread(0)
      return
    }
    void refresh()
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, POLL_MS)
    const ch = supabase
      .channel('vokabeltrainer-chat')
      .on('broadcast', { event: 'typing' }, ({ payload }) => handlers.current.typing.forEach((h) => h(payload ?? {})))
      .on('broadcast', { event: 'posted' }, ({ payload }) => {
        handlers.current.posted.forEach((h) => h(payload ?? {}))
        void refresh()
      })
      .subscribe()
    channel.current = ch
    const onVisible = () => document.visibilityState === 'visible' && void refresh()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisible)
      channel.current = null
      void supabase.removeChannel(ch)
    }
  }, [userId, profileReady, blocked, refresh])

  const markRead = useCallback((lastId: number) => {
    if (lastId <= readUntil.current) return
    readUntil.current = lastId
    setUnread(0)
    void markChatRead(lastId).catch(() => undefined)
  }, [])

  const send = useCallback((event: 'typing' | 'posted', payload: Record<string, unknown>) => {
    void channel.current?.send({ type: 'broadcast', event, payload })
  }, [])

  const on = useCallback((event: 'typing' | 'posted', handler: Handler) => {
    handlers.current[event].add(handler)
    return () => {
      handlers.current[event].delete(handler)
    }
  }, [])

  const value = useMemo(() => ({ unread, markRead, send, on }), [unread, markRead, send, on])
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

export function useChat(): ChatState {
  const c = useContext(ChatContext)
  if (!c) throw new Error('useChat braucht ChatProvider')
  return c
}
