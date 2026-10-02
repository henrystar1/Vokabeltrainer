import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Flag } from 'lucide-react'
import Button from '../components/ui/Button'
import { TextArea } from '../components/ui/Field'
import Modal from '../components/ui/Modal'
import { EmptyState, ErrorBox, Notice, Spinner } from '../components/ui/States'
import { errorMessage } from '../lib/errors'
import { useAsync } from '../lib/useAsync'
import { getOutline } from '../services/books'
import { requestReview } from '../services/community'
import { getPage } from '../services/entry'
import type { PageEntry } from '../types'

/** Schreibgeschützte Seitenansicht eines öffentlichen Buchs; einzelne Vokabeln lassen sich zur Prüfung melden. */
export default function BookPageView({ bookId, bookName }: { bookId: string; bookName: string }) {
  const [params, setParams] = useSearchParams()
  const outline = useAsync(() => getOutline(bookId), [bookId])
  const pages = (outline.data ?? []).flatMap((u) => u.pages.map((p) => ({ ...p, unit: u.unit_number })))
  const requested = Number.parseInt(params.get('seite') ?? '', 10)
  const page = Number.isInteger(requested) ? requested : (pages[0]?.page_number ?? 1)
  const data = useAsync(() => getPage(bookId, page), [bookId, page])
  const [reporting, setReporting] = useState<PageEntry | null>(null)
  const [sent, setSent] = useState<Set<string>>(new Set())

  return (
    <div>
      <Link to={`/buecher/${bookId}`} className="mb-4 inline-flex min-h-[44px] items-center gap-2 text-sm text-slate-400 hover:text-white">
        <ArrowLeft size={16} /> {bookName}
      </Link>

      <div className="mb-4">
        <Notice tone="info">
          Dieses Buch ist online bereitgestellt – nur Admins und Mods können Vokabeln ändern. Siehst du einen Fehler? Tippe bei der
          Vokabel auf die Flagge, dann prüft es jemand.
        </Notice>
      </div>

      {outline.loading && !outline.data && <Spinner />}
      {outline.error && <ErrorBox message={outline.error} onRetry={outline.reload} />}

      <div className="mb-4 flex flex-wrap gap-2">
        {pages.map((p) => (
          <button
            key={p.page_id}
            type="button"
            onClick={() => setParams({ seite: String(p.page_number) })}
            className={`min-h-[44px] rounded-xl border px-3 text-sm transition ${
              p.page_number === page
                ? 'border-accent-cyan/50 bg-accent-cyan/10 text-accent-cyan'
                : 'border-white/10 bg-space-900/60 text-slate-300 hover:bg-white/5'
            }`}
          >
            Seite {p.page_number}
          </button>
        ))}
      </div>

      {data.loading && !data.data && <Spinner />}
      {data.error && <ErrorBox message={data.error} onRetry={data.reload} />}
      {data.data && data.data.entries.length === 0 && <EmptyState title="Auf dieser Seite gibt es keine Vokabeln" />}

      <div className="space-y-2">
        {data.data?.entries.map((e) => (
          <div key={e.placement_id} className="glass grid grid-cols-[1fr_auto] items-center gap-3 rounded-xl p-3 md:grid-cols-[1fr_1fr_auto]">
            <div className="font-medium">{e.translations.join(' · ')}</div>
            <div className="col-span-2 text-slate-300 md:col-span-1 md:order-none">{[e.german, ...e.german_alts].join(' · ')}</div>
            <div className="col-start-2 row-start-1 md:col-start-3">
              {sent.has(e.vocabulary_id) ? (
                <span className="text-xs text-emerald-300">Gemeldet</span>
              ) : (
                <button
                  type="button"
                  aria-label="Zur Prüfung melden"
                  title="Zur Prüfung melden"
                  onClick={() => setReporting(e)}
                  className="flex min-h-[44px] w-11 items-center justify-center rounded-lg text-slate-500 hover:text-amber-300"
                >
                  <Flag size={16} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {reporting && (
        <ReportModal
          entry={reporting}
          onClose={() => setReporting(null)}
          onSent={() => {
            setSent((s) => new Set(s).add(reporting.vocabulary_id))
            setReporting(null)
          }}
        />
      )}
    </div>
  )
}

function ReportModal({ entry, onClose, onSent }: { entry: PageEntry; onClose: () => void; onSent: () => void }) {
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send() {
    setBusy(true)
    setError(null)
    try {
      await requestReview(entry.vocabulary_id, message)
      onSent()
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <Modal title="Überprüfung anfordern" onClose={onClose}>
      <div className="space-y-4">
        <p className="rounded-xl border border-white/10 bg-space-900/60 p-3 text-sm">
          <strong>{entry.translations.join(' · ')}</strong>
          <span className="text-slate-400"> = </span>
          {[entry.german, ...entry.german_alts].join(' · ')}
        </p>
        <label className="block space-y-1.5">
          <span className="label-mono">Was stimmt nicht? (optional)</span>
          <TextArea maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="z. B. Tippfehler, falsche Übersetzung, fehlende Lösung …" />
        </label>
        {error && <ErrorBox message={error} />}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Abbrechen</Button>
          <Button busy={busy} onClick={() => void send()}>Anfrage senden</Button>
        </div>
      </div>
    </Modal>
  )
}
