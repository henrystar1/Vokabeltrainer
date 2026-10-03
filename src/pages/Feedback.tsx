import { useState, type FormEvent } from 'react'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import { Field, Select, TextArea } from '../components/ui/Field'
import PageHeader from '../components/ui/PageHeader'
import { ErrorBox, Notice, Spinner } from '../components/ui/States'
import { FEEDBACK_KIND_LABEL, FEEDBACK_STATUS_LABEL } from '../features/koins/labels'
import { formatDateTime } from '../lib/format'
import { errorMessage } from '../lib/errors'
import { useAsync } from '../lib/useAsync'
import { listMyFeedback, submitFeedback } from '../services/koins'
import type { FeedbackKind } from '../types'

export default function Feedback() {
  const mine = useAsync(listMyFeedback, [])
  const [kind, setKind] = useState<FeedbackKind>('idea')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function send(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setSent(false)
    try {
      await submitFeedback(kind, text)
      setText('')
      setSent(true)
      mine.reload()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader eyebrow="Mitmachen" title="Feedback" />
      <Card className="max-w-2xl">
        <p className="mb-4 text-sm text-slate-400">
          Hast du eine Idee oder einen Verbesserungsvorschlag? Schreib ihn hier auf – Admin und Mods lesen alles. Für besonders gute Vorschläge gibt es manchmal Coins.
          Bitte schreib keine privaten Daten (Adressen, Telefonnummern) hinein.
        </p>
        <form onSubmit={send} className="space-y-4">
          <Field label="Art">
            <Select value={kind} onChange={(e) => setKind(e.target.value as FeedbackKind)}>
              {Object.entries(FEEDBACK_KIND_LABEL).map(([k, l]) => (
                <option key={k} value={k}>{l}</option>
              ))}
            </Select>
          </Field>
          <Field label="Deine Nachricht" hint={`${text.length} / 2000`}>
            <TextArea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={5} required minLength={3} />
          </Field>
          {error && <ErrorBox message={error} />}
          {sent && <Notice tone="ok">Danke! Dein Feedback ist angekommen.</Notice>}
          <Button type="submit" busy={busy} disabled={text.trim().length < 3}>Absenden</Button>
        </form>
      </Card>

      <h2 className="mb-3 mt-8 text-lg font-semibold">Deine bisherigen Nachrichten</h2>
      {mine.loading && !mine.data && <Spinner />}
      {mine.error && <ErrorBox message={mine.error} onRetry={mine.reload} />}
      {mine.data && mine.data.length === 0 && <p className="text-sm text-slate-500">Noch nichts gesendet.</p>}
      <div className="space-y-3">
        {mine.data?.map((f) => (
          <Card key={f.id} className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="label-mono">{FEEDBACK_KIND_LABEL[f.kind]}</span>
              <span className="text-xs text-slate-500">{formatDateTime(f.created_at)} · {FEEDBACK_STATUS_LABEL[f.status]}</span>
            </div>
            <p className="whitespace-pre-wrap break-words text-sm">{f.message}</p>
            {f.staff_note && <p className="rounded-lg bg-accent-cyan/10 px-3 py-2 text-sm text-accent-cyan">Antwort: {f.staff_note}</p>}
          </Card>
        ))}
      </div>
    </div>
  )
}
