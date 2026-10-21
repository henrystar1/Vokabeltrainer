import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { Mail, Trash2 } from 'lucide-react'
import Button from '../../components/ui/Button'
import Modal from '../../components/ui/Modal'
import { deleteMyMessages, getUnreadMessages, markMessagesRead, sendHeartbeat } from '../../services/koins'
import type { UserMessage } from '../../types'
import { useAuth } from '../auth/AuthProvider'
import { formatDateTime } from '../../lib/format'
import { activityFor } from '../../lib/activity'
import { useSettings } from '../settings/SettingsProvider'

const INTERVAL_MS = 30_000
/** Nachrichten vom Admin werden schneller abgeholt als der Online-Status gemeldet wird. */
const MESSAGE_MS = 7_000
/** Während dieser Seiten wird nichts eingeblendet (Sprint, Spiele, Duelle, Lernrunden); danach erscheint die Nachricht. */
const BUSY_PATHS = [/^\/sprint/, /^\/spiele/, /^\/gambling/, /^\/duell\/.+/, /^\/live-duell/, /^\/lernen/, /^\/test/, /^\/ueben/, /^\/konjugieren/, /^\/genus/]

/**
 * Meldet alle 30 Sekunden "ich bin online" (nur Admins sehen das) und holt Nachrichten vom Admin ab.
 * Ungelesene Nachrichten erscheinen als Fenster, bis man sie bestätigt.
 */
export default function PresenceProvider({ children }: { children: ReactNode }) {
  const { user, profileReady, blocked } = useAuth()
  const userId = user?.id
  const [messages, setMessages] = useState<UserMessage[]>([])
  const { pathname } = useLocation()
  const busyNow = BUSY_PATHS.some((r) => r.test(pathname))
  const { settings } = useSettings()
  /** „Am Rand“: Nachrichten vom Team zeigt dann NotifyProvider als Hinweis, hier kommt kein Fenster. */
  const edge = settings.notify_dm === 'edge'
  const activity = activityFor(pathname)
  const activityRef = useRef(activity)
  activityRef.current = activity

  const fetchMessages = useCallback(async () => {
    if (document.visibilityState !== 'visible' || edge) return
    const m = await getUnreadMessages().catch(() => null)
    if (m) setMessages((prev) => (prev.length === m.length && prev.every((p, i) => p.id === m[i].id) ? prev : m))
  }, [edge])

  const tick = useCallback(async () => {
    if (document.visibilityState !== 'visible') return
    await sendHeartbeat(activityRef.current).catch(() => undefined)
    await fetchMessages()
  }, [fetchMessages])

  useEffect(() => {
    if (!userId || !profileReady || blocked) {
      setMessages([])
      return
    }
    void tick()
    const timer = window.setInterval(() => void tick(), INTERVAL_MS)
    const fast = window.setInterval(() => void fetchMessages(), MESSAGE_MS)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(timer)
      window.clearInterval(fast)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [userId, profileReady, blocked, tick, fetchMessages])

  // Wechselt jemand die Seite, wird die Tätigkeit sofort (leicht verzögert) gemeldet – nicht erst nach einer Minute.
  useEffect(() => {
    if (!userId || !profileReady || blocked) return
    const t = window.setTimeout(() => {
      if (document.visibilityState === 'visible') void sendHeartbeat(activity).catch(() => undefined)
    }, 1500)
    return () => window.clearTimeout(t)
  }, [userId, profileReady, blocked, activity])

  async function confirm() {
    const ids = messages.map((m) => m.id)
    setMessages([])
    await markMessagesRead(ids).catch(() => undefined)
  }

  /** Löscht eine Nachricht endgültig (sie taucht nirgends wieder auf). */
  async function remove(id: string) {
    setMessages((prev) => prev.filter((m) => m.id !== id))
    await deleteMyMessages([id]).catch(() => undefined)
  }

  async function removeAll() {
    const ids = messages.map((m) => m.id)
    setMessages([])
    await deleteMyMessages(ids).catch(() => undefined)
  }

  return (
    <>
      {children}
      {messages.length > 0 && !busyNow && !edge && (
        <Modal title={messages.length === 1 ? 'Nachricht' : `${messages.length} Nachrichten`} onClose={() => void confirm()}>
          <div className="space-y-3">
            {messages.map((m) => (
              <div key={m.id} className="rounded-xl border border-accent-cyan/30 bg-accent-cyan/5 p-4">
                <p className="mb-1 flex items-center gap-2 text-xs text-slate-400">
                  <Mail size={13} /> {m.from_name} · {formatDateTime(m.created_at)}
                  <button type="button" onClick={() => void remove(m.id)} aria-label="Nachricht endgültig löschen" title="Endgültig löschen" className="ml-auto rounded-lg p-2 text-slate-500 hover:bg-white/10 hover:text-rose-300">
                    <Trash2 size={15} />
                  </button>
                </p>
                <p className="whitespace-pre-wrap break-words text-sm text-slate-100">{m.body.replace(/\bKoins\b/g, 'Coins')}</p>
              </div>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => void removeAll()}>
              <Trash2 size={15} /> {messages.length === 1 ? 'Löschen' : 'Alle löschen'}
            </Button>
            <Button onClick={() => void confirm()}>Gelesen</Button>
          </div>
        </Modal>
      )}
    </>
  )
}
