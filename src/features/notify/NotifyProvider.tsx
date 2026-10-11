import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AtSign, MessageCircle, Printer, UserRound, X, type LucideIcon } from 'lucide-react'
import { notifyPoll } from '../../services/notify'
import { useAuth } from '../auth/AuthProvider'
import { useSettings } from '../settings/SettingsProvider'

type Kind = 'mention' | 'chat' | 'print' | 'online'
interface Toast { key: string; kind: Kind; title: string; text: string; to: string; until: number }

const POLL_MS = 8_000
const MAX_TOASTS = 3
const LIFETIME: Record<Kind, number> = { mention: 10_000, chat: 6_000, print: 12_000, online: 5_000 }

const LOOK: Record<Kind, { icon: LucideIcon; box: string; icon_: string }> = {
  mention: { icon: AtSign, box: 'border-amber-300/40 bg-amber-300/15', icon_: 'text-amber-300' },
  chat: { icon: MessageCircle, box: 'border-white/15 bg-space-800/90', icon_: 'text-slate-300' },
  print: { icon: Printer, box: 'border-emerald-300/40 bg-emerald-300/10', icon_: 'text-emerald-300' },
  online: { icon: UserRound, box: 'border-accent-cyan/40 bg-accent-cyan/10', icon_: 'text-accent-cyan' },
}

interface NotifyState {
  /** Zeigt einen Beispiel-Hinweis (für die Einstellungen). */
  preview: () => void
}
const NotifyContext = createContext<NotifyState | null>(null)

/**
 * Fragt alle paar Sekunden nach neuen Ereignissen und zeigt sie als kleine Hinweise am oberen Rand.
 * Die Hinweise nehmen keinen Fokus und blockieren nichts – sie erscheinen auch beim Lernen und Spielen.
 */
export function NotifyProvider({ children }: { children: ReactNode }) {
  const { user, profileReady, blocked } = useAuth()
  const { settings, loaded } = useSettings()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [toasts, setToasts] = useState<Toast[]>([])
  const chatAfter = useRef<number | null>(null)
  const since = useRef<string | null>(null)
  const path = useRef(pathname)
  path.current = pathname

  const enabled = !!user && profileReady && !blocked && loaded &&
    (settings.notify_mentions || settings.notify_chat || settings.notify_print || settings.notify_online !== 'off')

  const push = useCallback((items: Omit<Toast, 'until'>[]) => {
    if (items.length === 0) return
    const now = Date.now()
    setToasts((prev) => {
      const known = new Set(prev.map((t) => t.key))
      const fresh = items.filter((i) => !known.has(i.key)).map((i) => ({ ...i, until: now + LIFETIME[i.kind] }))
      return [...prev, ...fresh].slice(-MAX_TOASTS)
    })
  }, [])

  useEffect(() => {
    if (!enabled) {
      // Beim Wiedereinschalten neu starten, damit keine alten Nachrichten auf einmal kommen.
      chatAfter.current = null
      since.current = null
      setToasts([])
      return
    }
    let alive = true
    let busy = false
    const poll = async () => {
      if (busy || document.visibilityState !== 'visible') return
      busy = true
      try {
        const r = await notifyPoll(chatAfter.current, since.current)
        if (!alive) return
        const first = chatAfter.current === null
        chatAfter.current = r.chat_max
        since.current = r.now
        if (first) return
        const items: Omit<Toast, 'until'>[] = []
        const inChat = path.current.startsWith('/chat')
        for (const c of r.chat) {
          if (inChat && !c.whisper) continue
          items.push({
            key: `c${c.id}`,
            kind: c.mention ? 'mention' : 'chat',
            title: c.whisper ? `${c.from} flüstert dir zu` : c.mention ? `${c.from} hat dich erwähnt` : c.from,
            text: c.body,
            to: '/chat',
          })
        }
        for (const o of r.ready) items.push({ key: `p${o.id}`, kind: 'print', title: 'Dein Druck ist fertig', text: `„${o.title}“ liegt zur Übergabe bereit.`, to: '/druckshop?t=bestellungen' })
        for (const o of r.online) items.push({ key: `o${o.id}${r.now}`, kind: 'online', title: `${o.name} ist online`, text: 'Gerade eben dazugekommen.', to: '/online' })
        push(items)
      } catch {
        /* Hinweise sind nicht kritisch – beim nächsten Mal wieder */
      } finally {
        busy = false
      }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), POLL_MS)
    const onVisible = () => void poll()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, push])

  // Abgelaufene Hinweise entfernen.
  useEffect(() => {
    if (toasts.length === 0) return
    const next = Math.min(...toasts.map((t) => t.until)) - Date.now()
    const timer = window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.until > Date.now())), Math.max(next, 50) + 20)
    return () => window.clearTimeout(timer)
  }, [toasts])

  const preview = useCallback(() => {
    push([{ key: `test${Date.now()}`, kind: 'mention', title: 'So sieht ein Hinweis aus', text: 'Er erscheint am Rand und stört dich nicht beim Lernen oder Spielen.', to: '/einstellungen' }])
  }, [push])

  const value = useMemo(() => ({ preview }), [preview])

  return (
    <NotifyContext.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-3 top-3 z-[60] flex flex-col items-end gap-2 sm:left-auto sm:right-4 sm:w-80"
      >
        {toasts.map((t) => {
          const { icon: Icon, box, icon_ } = LOOK[t.kind]
          return (
            <div key={t.key} className={`pointer-events-auto flex w-full animate-rise items-start gap-3 rounded-2xl border p-3 shadow-lg backdrop-blur ${box}`}>
              <button
                type="button"
                onClick={() => { setToasts((prev) => prev.filter((x) => x.key !== t.key)); navigate(t.to) }}
                className="flex min-w-0 flex-1 items-start gap-3 text-left"
              >
                <Icon size={18} className={`mt-0.5 shrink-0 ${icon_}`} aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-100">{t.title}</span>
                  <span className="mt-0.5 line-clamp-2 break-words text-xs text-slate-300">{t.text}</span>
                </span>
              </button>
              <button
                type="button"
                aria-label="Hinweis schließen"
                onClick={() => setToasts((prev) => prev.filter((x) => x.key !== t.key))}
                className="-m-1 shrink-0 rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white"
              >
                <X size={14} />
              </button>
            </div>
          )
        })}
      </div>
    </NotifyContext.Provider>
  )
}

export function useNotify(): NotifyState {
  const c = useContext(NotifyContext)
  if (!c) throw new Error('useNotify braucht NotifyProvider')
  return c
}
