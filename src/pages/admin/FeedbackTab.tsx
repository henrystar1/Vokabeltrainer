import { useState } from 'react'
import { Check, Eye, X } from 'lucide-react'
import Button from '../../components/ui/Button'
import { Select, TextInput } from '../../components/ui/Field'
import { EmptyState, ErrorBox, Spinner } from '../../components/ui/States'
import { FEEDBACK_KIND_LABEL, FEEDBACK_STATUS_LABEL } from '../../features/koins/labels'
import { formatDateTime } from '../../lib/format'
import { errorMessage } from '../../lib/errors'
import { useAsync } from '../../lib/useAsync'
import { listFeedback, setFeedbackStatus } from '../../services/koins'
import type { FeedbackItem, FeedbackStatus } from '../../types'

/** Ideen und Verbesserungsvorschläge von allen Nutzern. */
export default function FeedbackTab() {
  const [status, setStatus] = useState<FeedbackStatus | 'all'>('new')
  const list = useAsync(() => listFeedback(status), [status])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-slate-400">
          Ideen und Verbesserungen der Nutzer. Du kannst eine Antwort notieren (der Nutzer sieht sie) und für gute Ideen bis zu 50 Coins schenken.
        </p>
        <Select className="!w-auto" value={status} onChange={(e) => setStatus(e.target.value as FeedbackStatus | 'all')} aria-label="Status filtern">
          <option value="new">Neu</option>
          <option value="seen">Gesehen</option>
          <option value="done">Umgesetzt</option>
          <option value="declined">Abgelehnt</option>
          <option value="all">Alle</option>
        </Select>
      </div>
      {list.loading && !list.data && <Spinner />}
      {list.error && <ErrorBox message={list.error} onRetry={list.reload} />}
      {list.data && list.data.length === 0 && <EmptyState title="Kein Feedback in dieser Ansicht" />}
      {list.data?.map((f) => (
        <FeedbackCard key={f.id} item={f} onChanged={list.reload} />
      ))}
    </div>
  )
}

function FeedbackCard({ item: f, onChanged }: { item: FeedbackItem; onChanged: () => void }) {
  const [note, setNote] = useState(f.staff_note ?? '')
  const [reward, setReward] = useState('0')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function set(status: Exclude<FeedbackStatus, 'new'>) {
    const r = Math.max(0, Math.min(50, Number.parseInt(reward, 10) || 0))
    setBusy(true)
    setError(null)
    try {
      await setFeedbackStatus(f.id, status, note, status === 'declined' ? 0 : r)
      onChanged()
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <div className="glass space-y-3 rounded-2xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
        <span>
          <strong className="text-slate-200">{FEEDBACK_KIND_LABEL[f.kind]}</strong> von {f.user_name ?? 'Unbekannt'}
        </span>
        <span>
          {formatDateTime(f.created_at)} · {FEEDBACK_STATUS_LABEL[f.status]}
          {f.handled_by_name && ` (${f.handled_by_name})`}
        </span>
      </div>
      <p className="whitespace-pre-wrap break-words text-sm">{f.message}</p>
      <div className="grid gap-2 sm:grid-cols-[1fr_140px]">
        <TextInput placeholder="Antwort/Notiz (der Nutzer sieht sie)" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Notiz" />
        <TextInput type="number" min={0} max={50} inputMode="numeric" value={reward} onChange={(e) => setReward(e.target.value)} aria-label="Belohnung in Coins (max. 50)" placeholder="Coins (0–50)" />
      </div>
      {error && <ErrorBox message={error} />}
      <div className="flex flex-wrap gap-2">
        {f.status === 'new' && (
          <Button variant="secondary" disabled={busy} onClick={() => void set('seen')}>
            <Eye size={16} /> Gesehen
          </Button>
        )}
        <Button busy={busy} onClick={() => void set('done')}>
          <Check size={16} /> Umgesetzt
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => void set('declined')}>
          <X size={16} /> Ablehnen
        </Button>
      </div>
    </div>
  )
}
