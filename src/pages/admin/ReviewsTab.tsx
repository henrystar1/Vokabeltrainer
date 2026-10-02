import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Pencil, X } from 'lucide-react'
import Button from '../../components/ui/Button'
import { Select, TextInput } from '../../components/ui/Field'
import { EmptyState, ErrorBox, Spinner } from '../../components/ui/States'
import { formatDateTime } from '../../lib/format'
import { errorMessage } from '../../lib/errors'
import { useAsync } from '../../lib/useAsync'
import { listReviewRequests, resolveReviewRequest } from '../../services/community'
import type { ReviewRequest, ReviewStatus, VocabSnapshot } from '../../types'

const STATUS_LABEL: Record<ReviewStatus, string> = { open: 'Offen', done: 'Erledigt', dismissed: 'Abgelehnt' }

const line = (v: VocabSnapshot) => `${v.translations.join(' · ')}  =  ${[v.german, ...v.german_alts].join(' · ')}`
const same = (a: VocabSnapshot, b: VocabSnapshot) => line(a) === line(b)

/** Von Nutzern gemeldete Vokabeln öffentlicher Bücher. */
export default function ReviewsTab() {
  const [status, setStatus] = useState<ReviewStatus | 'all'>('open')
  const list = useAsync(() => listReviewRequests(status), [status])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-slate-400">
          Hier landen Fehlermeldungen zu Vokabeln in Online-Büchern. Mit „Bearbeiten“ öffnest du die Seite im Eingabe-Modus; danach
          markierst du die Anfrage als erledigt.
        </p>
        <Select className="!w-auto" value={status} onChange={(e) => setStatus(e.target.value as ReviewStatus | 'all')} aria-label="Status filtern">
          <option value="open">Offen</option>
          <option value="done">Erledigt</option>
          <option value="dismissed">Abgelehnt</option>
          <option value="all">Alle</option>
        </Select>
      </div>

      {list.loading && !list.data && <Spinner />}
      {list.error && <ErrorBox message={list.error} onRetry={list.reload} />}
      {list.data && list.data.length === 0 && (
        <EmptyState title={status === 'open' ? 'Keine offenen Anfragen' : 'Nichts gefunden'} text={status === 'open' ? 'Alles geprüft – stark!' : undefined} />
      )}

      {list.data?.map((r) => (
        <ReviewCard key={r.id} request={r} onChanged={list.reload} />
      ))}
    </div>
  )
}

function ReviewCard({ request: r, onChanged }: { request: ReviewRequest; onChanged: () => void }) {
  const [note, setNote] = useState('')
  const [reward, setReward] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function resolve(status: 'done' | 'dismissed') {
    setBusy(true)
    setError(null)
    try {
      await resolveReviewRequest(r.id, status, note, reward)
      onChanged()
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  const changed = r.current !== null && !same(r.snapshot, r.current)
  const editUrl =
    r.unit_number !== null && r.page_number !== null ? `/buecher/${r.book_id}/eingabe?unit=${r.unit_number}&seite=${r.page_number}` : null

  return (
    <div className="glass space-y-3 rounded-2xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
        <span>
          <strong className="text-slate-200">{r.book_name}</strong>
          {r.unit_number !== null && ` · Unit ${r.unit_number} · Seite ${r.page_number}`}
        </span>
        <span>
          {r.requested_by_name ?? 'Unbekannt'} · {formatDateTime(r.created_at)}
        </span>
      </div>

      <div className="rounded-xl border border-white/10 bg-space-900/60 p-3 text-sm">
        <p className="label-mono mb-1">Gemeldet</p>
        {line(r.snapshot)}
        {changed && r.current && (
          <>
            <p className="label-mono mb-1 mt-3 text-emerald-300">Inzwischen geändert zu</p>
            {line(r.current)}
          </>
        )}
        {r.current === null && <p className="mt-2 text-xs text-amber-300">Diese Vokabel wurde inzwischen ersetzt oder gelöscht.</p>}
      </div>

      {r.message && <p className="text-sm text-slate-200">„{r.message}“</p>}

      {r.status === 'open' ? (
        <>
          <TextInput placeholder="Notiz (optional)" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Notiz" />
          <label className="flex min-h-[40px] cursor-pointer items-center gap-3 text-sm text-slate-300">
            <input type="checkbox" className="h-5 w-5 accent-cyan-400" checked={reward} onChange={(e) => setReward(e.target.checked)} />
            Beim Erledigen Koins an {r.requested_by_name ?? 'den Melder'} vergeben (sinnvolle Meldung)
          </label>
          {error && <ErrorBox message={error} />}
          <div className="flex flex-wrap gap-2">
            {editUrl && (
              <Link to={editUrl} className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-5 font-medium hover:bg-white/10">
                <Pencil size={16} /> Bearbeiten
              </Link>
            )}
            <Button busy={busy} onClick={() => void resolve('done')}>
              <Check size={16} /> Erledigt
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => void resolve('dismissed')}>
              <X size={16} /> Ablehnen
            </Button>
          </div>
        </>
      ) : (
        <p className="text-xs text-slate-400">
          {STATUS_LABEL[r.status]} von {r.resolved_by_name ?? 'Unbekannt'} · {formatDateTime(r.resolved_at)}
          {r.resolution_note && ` · „${r.resolution_note}“`}
        </p>
      )}
    </div>
  )
}
