import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Send, Trash2 } from 'lucide-react'
import PlayerTag from '../components/profile/PlayerTag'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import PageHeader from '../components/ui/PageHeader'
import { ErrorBox } from '../components/ui/States'
import { useAuth } from '../features/auth/AuthProvider'
import { errorMessage } from '../lib/errors'
import { deleteChatMessage, getChat, postChat } from '../services/play'
import type { ChatMessage } from '../types'

const POLL_MS = 4000

function time(iso: string): string {
  const d = new Date(iso)
  const today = new Date().toDateString() === d.toDateString()
  return d.toLocaleString('de-DE', {
    ...(today ? {} : { day: '2-digit', month: '2-digit' }),
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Berlin',
  })
}

/** Gemeinsamer Chat für alle; aktualisiert sich alle paar Sekunden, solange die Seite sichtbar ist. */
export default function Chat() {
  const { isStaff } = useAuth()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loaded, setLoaded] = useState(false)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const m = await getChat(100)
      setMessages((old) => (old.length === m.length && old[old.length - 1]?.id === m[m.length - 1]?.id ? old : m))
      setLoaded(true)
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [])

  useEffect(() => {
    void refresh()
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, POLL_MS)
    return () => window.clearInterval(t)
  }, [refresh])

  useEffect(() => {
    const el = listRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [messages])

  async function send(e: FormEvent) {
    e.preventDefault()
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    setError(null)
    try {
      await postChat(body)
      setText('')
      stick.current = true
      await refresh()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSending(false)
    }
  }

  async function remove(id: number) {
    try {
      await deleteChatMessage(id)
      setMessages((m) => m.filter((x) => x.id !== id))
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col">
      <PageHeader eyebrow="Gemeinschaft" title="Chat" />
      <Card className="flex h-[60vh] min-h-[320px] flex-col gap-3 p-3 sm:p-4">
        <div
          ref={listRef}
          onScroll={(e) => {
            const el = e.currentTarget
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
          }}
          className="flex-1 space-y-3 overflow-y-auto pr-1"
          aria-live="polite"
        >
          {loaded && messages.length === 0 && <p className="py-10 text-center text-sm text-slate-400">Noch nichts geschrieben – sag Hallo! 👋</p>}
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.is_me ? 'justify-end' : 'justify-start'}`}>
              <div className={`group max-w-[85%] rounded-2xl px-3 py-2 ${m.is_me ? 'bg-accent-cyan/15' : 'bg-white/5'}`}>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <PlayerTag name={m.display_name} cosmetics={m} size={22} />
                  <span>{time(m.created_at)}</span>
                  {isStaff && (
                    <button type="button" aria-label="Nachricht löschen" onClick={() => void remove(m.id)} className="ml-auto text-slate-500 hover:text-rose-300">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-100">{m.body}</p>
              </div>
            </div>
          ))}
        </div>
        {error && <ErrorBox message={error} />}
        <form onSubmit={(e) => void send(e)} className="flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={500}
            placeholder="Nachricht schreiben …"
            aria-label="Nachricht"
            autoComplete="off"
            enterKeyHint="send"
            className="min-h-[48px] flex-1 rounded-xl border border-white/10 bg-space-900/70 px-4 outline-none focus:border-accent-cyan/60"
          />
          <Button type="submit" busy={sending} disabled={!text.trim()} aria-label="Senden">
            <Send size={18} />
          </Button>
        </form>
      </Card>
      <p className="mt-3 text-xs text-slate-500">Sei nett zueinander. Mods und Admins können Nachrichten löschen. Der Chat zeigt die letzten 100 Nachrichten.</p>
    </div>
  )
}
