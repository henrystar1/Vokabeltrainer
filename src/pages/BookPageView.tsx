import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Flag, Search } from 'lucide-react'
import ReportModal from '../components/books/ReportModal'
import { EmptyState, ErrorBox, Notice, Spinner } from '../components/ui/States'
import { useAsync } from '../lib/useAsync'
import { getOutline } from '../services/books'
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
          Vokabel auf die Flagge, dann prüft es jemand.{' '}
          <Link to={`/suche?buch=${bookId}`} className="inline-flex items-center gap-1 text-accent-cyan underline-offset-2 hover:underline">
            <Search size={14} /> Vokabel suchen und melden
          </Link>
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
