import { useEffect, useState } from 'react'
import { BellRing, X } from 'lucide-react'
import Button from '../../components/ui/Button'
import { currentSubscription, enablePush, getPushStatus, pushSupport } from '../../services/push'
import { useAuth } from '../auth/AuthProvider'

const KEY = 'vt-push-ask'
const ASK_AGAIN_MS = 3 * 24 * 3600 * 1000

function askedRecently(): boolean {
  try {
    const t = Number(localStorage.getItem(KEY) ?? 0)
    return Date.now() - t < ASK_AGAIN_MS
  } catch {
    return false
  }
}
function markAsked(): void {
  try { localStorage.setItem(KEY, String(Date.now())) } catch { /* egal */ }
}

/**
 * Mitteilungen sollen standardmäßig an sein: Ist die Erlaubnis schon da, meldet sich das Gerät still an.
 * Sonst (Browser verlangt einen Klick) erscheint einmal alle paar Tage ein kleiner Hinweis zum Einschalten.
 */
export default function PushPrompt() {
  const { user, profileReady, blocked } = useAuth()
  const userId = user?.id
  const [mode, setMode] = useState<null | 'ask' | 'ios'>(null)
  const [key, setKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!userId || !profileReady || blocked) return
    let alive = true
    void (async () => {
      try {
        const support = pushSupport()
        if (support !== 'ok' && support !== 'ios-install') return
        const status = await getPushStatus()
        if (!alive || !status.configured || !status.public_key) return
        if (support === 'ios-install') {
          if (!askedRecently()) setMode('ios')
          return
        }
        if (await currentSubscription()) return
        if (Notification.permission === 'granted') {
          await enablePush(status.public_key) // ohne Nachfrage, die Erlaubnis liegt schon vor
          return
        }
        if (Notification.permission === 'default' && !askedRecently()) {
          setKey(status.public_key)
          setMode('ask')
        }
      } catch {
        /* Hinweis ist nicht kritisch */
      }
    })()
    return () => { alive = false }
  }, [userId, profileReady, blocked])

  if (!mode) return null
  const close = () => { markAsked(); setMode(null) }
  return (
    <div role="dialog" aria-label="Mitteilungen einschalten" className="fixed inset-x-3 bottom-24 z-50 mx-auto max-w-md rounded-2xl border border-accent-cyan/40 bg-space-800/95 p-4 shadow-glow backdrop-blur md:bottom-6 md:left-auto md:right-6">
      <button type="button" onClick={close} aria-label="Schließen" className="absolute right-2 top-2 rounded-lg p-2 text-slate-400 hover:bg-white/10"><X size={16} /></button>
      <p className="flex items-center gap-2 pr-8 font-semibold text-slate-100"><BellRing size={18} className="text-accent-cyan" /> Mitteilungen einschalten?</p>
      {mode === 'ask' ? (
        <>
          <p className="mt-1 text-sm text-slate-300">Dann kommen Nachrichten vom Team, @-Erwähnungen im Chat und Hinweise (z. B. „Druck fertig“) auch, wenn die App geschlossen ist.</p>
          <div className="mt-3 flex gap-2">
            <Button
              busy={busy}
              onClick={() => {
                if (!key) return
                setBusy(true)
                void enablePush(key).catch(() => undefined).finally(() => { setBusy(false); markAsked(); setMode(null) })
              }}
            >
              Einschalten
            </Button>
            <Button variant="ghost" onClick={close}>Später</Button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-slate-300">Auf dem iPad kommen Mitteilungen bei geschlossener App nur, wenn die App auf dem Home-Bildschirm liegt: In Safari auf „Teilen“ tippen, dann „Zum Home-Bildschirm“, und die App von dort öffnen.</p>
          <div className="mt-3"><Button variant="ghost" onClick={close}>Verstanden</Button></div>
        </>
      )}
    </div>
  )
}
