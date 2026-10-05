import { memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ChevronUp, EyeOff, Send, Timer, Trash2 } from 'lucide-react'
import PlayerTag from '../components/profile/PlayerTag'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import PageHeader from '../components/ui/PageHeader'
import { ErrorBox } from '../components/ui/States'
import { useAuth } from '../features/auth/AuthProvider'
import { useChat } from '../features/chat/ChatProvider'
import { errorMessage } from '../lib/errors'
import { deleteChatMessage, getChat, postChat, searchPlayers, timeoutChatUser } from '../services/play'
import { getMyPermissions } from '../services/koins'
import type { ChatMessage } from '../types'

const POLL_MS = 4000
const PAGE = 60
/** Nur die neuesten Beiträge zeigen animierte Avatare/Namen – ältere stehen still (spart Rechenleistung). */
const LIVE_GROUPS = 10
const GROUP_GAP_MS = 5 * 60 * 1000

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

interface Group { key: number; head: ChatMessage; items: ChatMessage[] }

/** Aufeinanderfolgende Nachrichten derselben Person werden zusammengefasst: ein Avatar statt vieler. */
function group(messages: ChatMessage[]): Array<Group | ChatMessage> {
  const out: Array<Group | ChatMessage> = []
  for (const m of messages) {
    if (m.kind === 'pay') {
      out.push(m)
      continue
    }
    const last = out[out.length - 1]
    if (last && 'items' in last) {
      const prev = last.items[last.items.length - 1]
      const sameKind = prev.kind === m.kind && prev.recipient_name === m.recipient_name
      if (sameKind && prev.display_name === m.display_name && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < GROUP_GAP_MS) {
        last.items.push(m)
        continue
      }
    }
    out.push({ key: m.id, head: m, items: [m] })
  }
  return out
}

interface RowProps {
  g: Group
  live: boolean
  isStaff: boolean
  onDelete: (id: number) => void
  onTimeout: (m: ChatMessage) => void
}

const GroupRow = memo(function GroupRow({ g, live, isStaff, onDelete, onTimeout }: RowProps) {
  const h = g.head
  const whisper = h.kind === 'whisper'
  const toMe = whisper && !h.is_me
  return (
    <div className={`flex ${h.is_me ? 'justify-end' : 'justify-start'} [contain-intrinsic-size:auto_72px] [content-visibility:auto]`}>
      <div className={`max-w-[88%] rounded-2xl px-3 py-2 ${whisper ? 'border border-violet-400/30 bg-violet-500/10' : h.is_me ? 'bg-accent-cyan/15' : 'bg-white/5'}`}>
        <div className={`flex items-center gap-2 text-xs text-slate-400 ${live ? '' : 'av-still'}`}>
          <PlayerTag name={h.display_name} cosmetics={h} size={22} />
          {whisper && (
            <span className="inline-flex items-center gap-1 text-violet-300">
              <EyeOff size={12} /> {toMe ? 'flüstert dir zu' : `flüstert an ${h.recipient_name ?? '?'}`}
            </span>
          )}
        </div>
        <ul className="mt-1 space-y-1">
          {g.items.map((m) => {
            const canDelete = isStaff || m.is_me || (m.kind === 'whisper' && !m.is_me)
            const canMute = isStaff && !m.is_me && m.kind === 'text' && m.role === 'user'
            return (
              <li key={m.id} className="group flex items-start gap-2">
                <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm text-slate-100">{m.body}</p>
                <span className="mt-0.5 flex shrink-0 items-center gap-1.5 text-[11px] text-slate-500">
                  {time(m.created_at)}
                  {canMute && (
                    <button type="button" aria-label="Stummschalten" title="Stummschalten" onClick={() => onTimeout(m)} className="p-1 hover:text-amber-300">
                      <Timer size={14} />
                    </button>
                  )}
                  {canDelete && (
                    <button type="button" aria-label="Nachricht löschen" title="Löschen" onClick={() => onDelete(m.id)} className="p-1 hover:text-rose-300">
                      <Trash2 size={14} />
                    </button>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
})

/** Gemeinsamer Chat für alle; aktualisiert sich alle paar Sekunden, solange die Seite sichtbar ist. */
export default function Chat() {
  const { isStaff, canEditRules, displayName } = useAuth()
  const chat = useChat()
  const [typing, setTyping] = useState<Record<string, number>>({})
  const lastTypingSent = useRef(0)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [limit, setLimit] = useState(PAGE)
  const [loaded, setLoaded] = useState(false)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [muteFor, setMuteFor] = useState<ChatMessage | null>(null)
  const [maxMute, setMaxMute] = useState(1)
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null)
  const [remote, setRemote] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const sig = useRef('')

  const refresh = useCallback(async () => {
    try {
      const m = await getChat(limit)
      const s = m.map((x) => x.id).join(',')
      if (s !== sig.current) {
        sig.current = s
        setMessages(m)
      }
      setLoaded(true)
      if (m.length > 0 && document.visibilityState === 'visible') chat.markRead(m[m.length - 1].id)
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [limit, chat])

  useEffect(() => {
    void refresh()
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, POLL_MS)
    return () => window.clearInterval(t)
  }, [refresh])

  useEffect(() => {
    const offTyping = chat.on('typing', (p) => {
      const name = String(p.name ?? '')
      if (name) setTyping((t) => ({ ...t, [name]: Date.now() + 4500 }))
    })
    const offPosted = chat.on('posted', (p) => {
      const name = String(p.name ?? '')
      if (name) setTyping((t) => Object.fromEntries(Object.entries(t).filter(([n]) => n !== name)))
      void refresh()
    })
    const clean = window.setInterval(() => {
      setTyping((t) => {
        const now = Date.now()
        const keep = Object.entries(t).filter(([, until]) => until > now)
        return keep.length === Object.keys(t).length ? t : Object.fromEntries(keep)
      })
    }, 1000)
    return () => {
      offTyping()
      offPosted()
      window.clearInterval(clean)
    }
  }, [chat, refresh])

  useEffect(() => {
    if (isStaff) void getMyPermissions().then((p) => setMaxMute(p.timeout_max)).catch(() => undefined)
  }, [isStaff])

  // @-Vorschläge: erst Namen aus dem Chat, ab 2 Zeichen zusätzlich Spieler aus der Suche.
  useEffect(() => {
    if (!mention || mention.query.length < 2) {
      setRemote([])
      return
    }
    let stale = false
    const t = window.setTimeout(() => {
      searchPlayers(mention.query).then((r) => { if (!stale) setRemote(r.map((x) => x.display_name)) }).catch(() => undefined)
    }, 200)
    return () => {
      stale = true
      window.clearTimeout(t)
    }
  }, [mention])

  const suggestions = useMemo(() => {
    if (!mention) return []
    const q = mention.query.toLowerCase()
    const local = [...new Set(messages.filter((m) => m.display_name && m.display_name !== displayName).map((m) => m.display_name))].reverse()
    const names = [...local.filter((n) => n.toLowerCase().startsWith(q)), ...remote]
    return [...new Set(names)].filter((n) => n !== displayName).slice(0, 5)
  }, [mention, messages, remote, displayName])

  function onType(value: string, caret: number) {
    setText(value)
    const m = /@([^\s@]*)$/.exec(value.slice(0, caret))
    setMention(m ? { query: m[1], start: caret - m[0].length } : null)
    if (value.trim() && !value.startsWith('!whisper')) announceTyping()
  }

  function pick(name: string) {
    if (!mention) return
    const caret = mention.start + 1 + mention.query.length
    const next = `${text.slice(0, mention.start)}@${name} ${text.slice(caret)}`
    setText(next)
    setMention(null)
    setRemote([])
    const pos = mention.start + name.length + 2
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(pos, pos)
    })
  }

  function announceTyping() {
    const now = Date.now()
    if (!displayName || now - lastTypingSent.current < 2500) return
    lastTypingSent.current = now
    chat.send('typing', { name: displayName })
  }

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
      setText(''); setMention(null)
      stick.current = true
      if (!/^!whisper\b/i.test(body)) chat.send('posted', { name: displayName })
      await refresh()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSending(false)
    }
  }

  const remove = useCallback(async (id: number) => {
    try {
      await deleteChatMessage(id)
      sig.current = ''
      setMessages((m) => m.filter((x) => x.id !== id))
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [])

  async function mute(minutes: number) {
    if (!muteFor) return
    try {
      await timeoutChatUser(muteFor.id, minutes)
      setMuteFor(null)
    } catch (e) {
      setError(errorMessage(e))
      setMuteFor(null)
    }
  }

  const grouped = useMemo(() => group(messages), [messages])
  const liveFrom = Math.max(0, grouped.filter((x) => 'items' in x).length - LIVE_GROUPS)
  let seen = 0

  return (
    <div className="mx-auto flex max-w-3xl flex-col">
      <PageHeader eyebrow="Gemeinschaft" title="Chat" />
      <Card className="flex h-[62vh] min-h-[320px] flex-col gap-3 p-3 sm:p-4">
        <div
          ref={listRef}
          onScroll={(e) => {
            const el = e.currentTarget
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
          }}
          className="flex-1 space-y-2 overflow-y-auto pr-1"
          aria-live="polite"
        >
          {messages.length >= limit && limit < 200 && (
            <button type="button" onClick={() => { stick.current = false; setLimit((l) => Math.min(l + PAGE, 200)) }} className="mx-auto flex min-h-[40px] items-center gap-1 rounded-lg bg-white/5 px-3 text-xs text-slate-300 hover:bg-white/10">
              <ChevronUp size={14} /> Ältere Nachrichten laden
            </button>
          )}
          {loaded && messages.length === 0 && <p className="py-10 text-center text-sm text-slate-400">Noch nichts geschrieben – sag Hallo! 👋</p>}
          {grouped.map((x) => {
            if (!('items' in x)) {
              return (
                <div key={x.id} className="flex items-center justify-center gap-2 text-center text-xs text-amber-200">
                  <span className="rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1">{x.body}</span>
                  {isStaff && (
                    <button type="button" aria-label="Nachricht löschen" onClick={() => void remove(x.id)} className="text-slate-500 hover:text-rose-300">
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              )
            }
            const live = seen++ >= liveFrom
            return <GroupRow key={x.key} g={x} live={live} isStaff={isStaff} onDelete={(id) => void remove(id)} onTimeout={setMuteFor} />
          })}
        </div>
        <div className="h-5 px-1 text-xs text-slate-400" aria-live="polite">
          {Object.keys(typing).length > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <span className="typing-dots" aria-hidden><i /><i /><i /></span>
              {typingText(Object.keys(typing))}
            </span>
          )}
        </div>
        {error && <ErrorBox message={error} />}
        {mention && suggestions.length > 0 && (
          <ul className="mb-2 flex flex-wrap gap-2" role="listbox" aria-label="Namen vorschlagen">
            {suggestions.map((n) => (
              <li key={n}>
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(n)}
                  className="min-h-[40px] rounded-full border border-accent-cyan/30 bg-accent-cyan/10 px-4 text-sm text-accent-cyan hover:bg-accent-cyan/20"
                >
                  @{n}
                </button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={(e) => void send(e)} className="flex gap-2">
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => onType(e.target.value, e.target.selectionStart ?? e.target.value.length)}
            maxLength={500}
            placeholder="Nachricht schreiben …"
            aria-label="Nachricht"
            autoComplete="off"
            enterKeyHint="send"
            className="min-h-[48px] min-w-0 flex-1 rounded-xl border border-white/10 bg-space-900/70 px-4 outline-none focus:border-accent-cyan/60"
          />
          <Button type="submit" busy={sending} disabled={!text.trim()} aria-label="Senden">
            <Send size={18} />
          </Button>
        </form>
      </Card>
      <p className="mt-3 text-xs text-slate-500">
        Coins verschicken: <span className="font-mono text-slate-300">!pay @Anzeigename 100</span> · Heimlich schreiben:{' '}
        <span className="font-mono text-slate-300">!whisper @Anzeigename Text</span> (nur ihr beide seht es). Sei nett zueinander – Mods können Nachrichten löschen und kurz stummschalten.
      </p>

      {muteFor && (
        <Modal title={`${muteFor.display_name} stummschalten`} onClose={() => setMuteFor(null)}>
          <p className="text-sm text-slate-300">Die Person kann in dieser Zeit nichts im Chat schreiben.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {[...new Set([1, 5, 15, 60].filter((m) => m <= maxMute).concat(maxMute < 60 ? [maxMute] : []))].map((m) => (
              <Button key={m} variant="secondary" onClick={() => void mute(m)}>{m} Min.</Button>
            ))}
            {canEditRules && <Button variant="ghost" onClick={() => void mute(0)}>Aufheben</Button>}
          </div>
        </Modal>
      )}
    </div>
  )
}

function typingText(names: string[]): string {
  if (names.length === 1) return `${names[0]} schreibt …`
  if (names.length === 2) return `${names[0]} und ${names[1]} schreiben …`
  return 'Mehrere schreiben …'
}
