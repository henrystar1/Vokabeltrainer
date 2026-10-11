import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AtSign, Mail, MessageCircle, Printer, UserRound, X, type LucideIcon } from 'lucide-react'
import { notifyPoll } from '../../services/notify'
import { getUnreadMessages, markMessagesRead } from '../../services/koins'
import { useAuth } from '../auth/AuthProvider'
import { useSettings } from '../settings/SettingsProvider'

type Kind = 'mention' | 'chat' | 'print' | 'online' | 'dm'
/** `to` = null: kein Ziel (Nachricht vom Team); `until` = Infinity: bleibt, bis man sie wegklickt. */
interface Toast { key: string; kind: Kind; title: string; text: string; to: string | null; until: number; messageId?: string }

const POLL_MS = 8_000
const MAX_TOASTS = 3
const LIFETIME: Record<Kind, number> = { mention: 10_000, chat: 6_000, print: 12_000, online: 5_000, dm: Infinity }
const DM_MS = 7_000

const LOOK: Record<Kind, { icon: LucideIcon; box: string; icon_: string }> = {
  mention: { icon: AtSign, box: 'border-amber-300/40 bg-amber-300/15', icon_: 'text-amber-300' },
  chat: { icon: MessageCircle, box: 'border-white/15 bg-space-800/90', icon_: 'text-slate-300' },
  print: { icon: Printer, box: 'border-emerald-300/40 bg-emerald-300/10', icon_: 'text-emerald-300' },
  dm: { icon: Mail, box: 'border-accent-violet/50 bg-accent-violet/15', icon_: 'text-accent-violet' },
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

  const live = !!user && profileReady && !blocked && loaded
  const dmEdge = live && settings.notify_dm === 'edge'
  const enabled = live &&
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
      setToasts((prev) => prev.filter((t) => t.kind === 'dm'))
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

  // Nachrichten vom Team als Hinweis am Rand (nur wenn so eingestellt). Sie bleiben, bis man sie wegklickt.
  useEffect(() => {
    if (!dmEdge) return
    let alive = true
    const fetchDm = async () => {
      if (document.visibilityState !== 'visible') return
      const m = await getUnreadMessages().catch(() => null)
      if (!alive || !m) return
      push(m.map((x) => ({ key: `m${x.id}`, kind: 'dm' as const, title: `Nachricht von ${x.from_name}`, text: x.body.replace(/\bKoins\b/g, 'Coins'), to: null, messageId: x.id })))
    }
    void fetchDm()
    const timer = window.setInterval(() => void fetchDm(), DM_MS)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [dmEdge, push])

  const dismiss = useCallback((t: Toast) => {
    setToasts((prev) => prev.filter((x) => x.key !== t.key))
    if (t.messageId) void markMessagesRead([t.messageId]).catch(() => undefined)
  }, [])

  // Abgelaufene Hinweise entfernen.
  useEffect(() => {
    const finite = toasts.filter((t) => Number.isFinite(t.until))
    if (finite.length === 0) return
    const next = Math.min(...finite.map((t) => t.until)) - Date.now()
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
        className="pointer-events-none fixed inset-x-3 top-3 z-[70] flex flex-col items-end gap-2 sm:left-auto sm:right-4 sm:w-80"
      >
        {toasts.map((t) => {
          const { icon: Icon, box, icon_ } = LOOK[t.kind]
          return (
            <div key={t.key} className={`pointer-events-auto flex w-full animate-rise items-start gap-3 rounded-2xl border p-3 shadow-lg backdrop-blur ${box}`}>
              {(() => {
                const inner = (
                  <>
                    <Icon size={18} className={`mt-0.5 shrink-0 ${icon_}`} aria-hidden />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-slate-100">{t.title}</span>
                      <span className={`mt-0.5 break-words text-xs text-slate-300 ${t.kind === 'dm' ? 'line-clamp-6 whitespace-pre-wrap' : 'line-clamp-2'}`}>{t.text}</span>
                    </span>
                  </>
                )
                const to = t.to
                return to === null ? (
                  <div className="flex min-w-0 flex-1 items-start gap-3">{inner}</div>
                ) : (
                  <button type="button" onClick={() => { dismiss(t); navigate(to) }} className="flex min-w-0 flex-1 items-start gap-3 text-left">{inner}</button>
                )
              })()}
              <button
                type="button"
                aria-label={t.kind === 'dm' ? 'Gelesen' : 'Hinweis schließen'}
                onClick={() => dismiss(t)}
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
