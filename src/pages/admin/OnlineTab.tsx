import { useEffect, useState } from 'react'
import { Send } from 'lucide-react'
import Button from '../../components/ui/Button'
import { Field, Select, TextArea } from '../../components/ui/Field'
import { ErrorBox, Notice, Spinner } from '../../components/ui/States'
import PlayerTag from '../../components/profile/PlayerTag'
import { formatDateTime } from '../../lib/format'
import { errorMessage } from '../../lib/errors'
import { useAsync } from '../../lib/useAsync'
import { adminListUsers } from '../../services/admin'
import { adminListMessages, adminListOnline, adminSendMessage } from '../../services/koins'

function secondsAgo(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  return s < 60 ? 'gerade eben' : `vor ${Math.round(s / 60)} Min.`
}

/** Nur für Admins: wer ist gerade online, und Nachrichten an einzelne Nutzer oder alle. */
export default function OnlineTab() {
  const online = useAsync(adminListOnline, [])
  const users = useAsync(adminListUsers, [])
  const sent = useAsync(adminListMessages, [])
  const [to, setTo] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  // Online-Liste aktualisiert sich selbst.
  useEffect(() => {
    const t = window.setInterval(() => online.reload(), 30_000)
    return () => window.clearInterval(t)
  }, [online.reload])

  async function send() {
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const n = await adminSendMessage(to === '' ? null : to, text)
      setDone(n === 1 ? 'Nachricht gesendet.' : `Nachricht an ${n} Nutzer gesendet.`)
      setText('')
      sent.reload()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-8">
      <section className="glass space-y-3 rounded-2xl p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">
            Gerade online <span className="font-mono text-emerald-300">{online.data?.length ?? 0}</span>
          </h2>
          <Button variant="ghost" onClick={online.reload}>Aktualisieren</Button>
        </div>
        <p className="text-xs text-slate-500">Als online gilt, wer in den letzten 3 Minuten die App geöffnet hatte. Nur Admins sehen diese Liste.</p>
        {online.loading && !online.data && <Spinner />}
        {online.error && <ErrorBox message={online.error} onRetry={online.reload} />}
        {online.data?.length === 0 && <p className="text-sm text-slate-500">Gerade ist niemand online.</p>}
        <ul className="grid gap-2 sm:grid-cols-2">
          {online.data?.map((u) => (
            <li key={u.user_id} className="flex min-h-[48px] items-center justify-between gap-2 rounded-lg bg-white/5 px-3">
              <span className="flex min-w-0 items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
                <PlayerTag name={u.display_name} cosmetics={{ avatar_id: u.avatar_id, color_id: u.color_id, effect_id: u.effect_id, role: u.role }} size={28} />
              </span>
              <span className="shrink-0 text-xs text-slate-500">{secondsAgo(u.last_seen_at)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="glass space-y-4 rounded-2xl p-5">
        <h2 className="text-lg font-semibold">Nachricht senden</h2>
        <p className="text-sm text-slate-400">Der Empfänger sieht die Nachricht beim nächsten Öffnen der App (spätestens nach einer Minute) als Fenster, bis er sie bestätigt.</p>
        <Field label="An">
          <Select value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Alle Nutzer</option>
            {users.data?.map((u) => (
              <option key={u.user_id} value={u.user_id}>{u.display_name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Nachricht" hint={`${text.length} / 1000`}>
          <TextArea rows={4} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
        {error && <ErrorBox message={error} />}
        {done && <Notice tone="ok">{done}</Notice>}
        <Button busy={busy} disabled={text.trim() === ''} onClick={() => void send()}>
          <Send size={16} /> Senden
        </Button>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Zuletzt gesendet</h2>
        {sent.loading && !sent.data && <Spinner />}
        {sent.data?.length === 0 && <p className="text-sm text-slate-500">Noch nichts gesendet.</p>}
        <ul className="space-y-1">
          {sent.data?.slice(0, 30).map((m) => (
            <li key={m.id} className="rounded-lg bg-white/5 px-3 py-2 text-sm">
              <span className="text-xs text-slate-500">
                an {m.to_name ?? 'gelöscht'} · {formatDateTime(m.created_at)} · {m.read_at ? 'gelesen' : 'ungelesen'}
              </span>
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
