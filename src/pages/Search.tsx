import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Flag, Search as SearchIcon } from 'lucide-react'
import ReportModal from '../components/books/ReportModal'
import Card from '../components/ui/Card'
import { Field, Select, TextInput, inputClass } from '../components/ui/Field'
import PageHeader from '../components/ui/PageHeader'
import { EmptyState, ErrorBox, Spinner } from '../components/ui/States'
import { errorMessage } from '../lib/errors'
import { useAsync } from '../lib/useAsync'
import { listBooks, listLanguages } from '../services/books'
import { searchVocabulary } from '../services/search'
import type { SearchResult } from '../types'

const optInt = (v: string): number | undefined => {
  const n = Number.parseInt(v, 10)
  return Number.isInteger(n) ? n : undefined
}

export default function Search() {
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState(params.get('q') ?? '')
  const [bookId, setBookId] = useState(params.get('buch') ?? '')
  const [language, setLanguage] = useState('')
  const [unit, setUnit] = useState('')
  const [page, setPage] = useState('')
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const books = useAsync(listBooks, [])
  const [reporting, setReporting] = useState<SearchResult | null>(null)
  const [sent, setSent] = useState<Set<string>>(new Set())
  const isPublic = (bookId: string) => !!books.data?.find((b) => b.id === bookId)?.is_public
  const languages = useAsync(listLanguages, [])

  // Entprellte Suche
  useEffect(() => {
    const q = query.trim()
    if (q === '') {
      setResults(null)
      setError(null)
      return
    }
    let active = true
    setLoading(true)
    const t = setTimeout(() => {
      searchVocabulary({
        query: q,
        bookId: bookId || undefined,
        language: language || undefined,
        unit: optInt(unit),
        page: optInt(page),
      }).then(
        (r) => {
          if (!active) return
          setResults(r)
          setError(null)
          setLoading(false)
        },
        (e) => {
          if (!active) return
          setError(errorMessage(e))
          setLoading(false)
        },
      )
    }, 250)
    return () => {
      active = false
      clearTimeout(t)
    }
  }, [query, bookId, language, unit, page])

  useEffect(() => {
    const next = new URLSearchParams()
    if (query) next.set('q', query)
    if (bookId) next.set('buch', bookId)
    setParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, bookId])

  return (
    <div>
      <PageHeader eyebrow="Vokabeln" title="Suche" />
      <Card className="mb-6 space-y-4">
        <div className="relative">
          <SearchIcon size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            autoFocus
            type="search"
            className={`${inputClass} pl-10`}
            placeholder="Deutsch oder Fremdsprache suchen …"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Buch">
            <Select value={bookId} onChange={(e) => setBookId(e.target.value)}>
              <option value="">Alle Bücher</option>
              {books.data?.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Sprache">
            <Select value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="">Alle Sprachen</option>
              {languages.data?.map((l) => (
                <option key={l.code} value={l.code}>{l.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Unit">
            <TextInput inputMode="numeric" placeholder="alle" value={unit} onChange={(e) => setUnit(e.target.value)} />
          </Field>
          <Field label="Seite">
            <TextInput inputMode="numeric" placeholder="alle" value={page} onChange={(e) => setPage(e.target.value)} />
          </Field>
        </div>
      </Card>

      {error && <ErrorBox message={error} />}
      {loading && <Spinner label="Suche …" />}
      {!loading && results === null && !error && <EmptyState title="Wonach suchst du?" text="Die Suche findet deutsche Wörter und Übersetzungen." />}
      {!loading && results && results.length === 0 && <EmptyState title="Keine Treffer" text="Prüfe die Schreibweise oder lockere die Filter." />}
      {!loading && results && results.length > 0 && (
        <div className="space-y-2">
          <p className="label-mono">{results.length}{results.length >= 100 ? '+' : ''} Treffer</p>
          {results.map((r) => (
            <div key={r.placement_id} className="glass flex items-center gap-1 rounded-xl pr-2 transition hover:border-accent-cyan/40">
              <Link to={`/buecher/${r.book_id}/eingabe?unit=${r.unit_number}&seite=${r.page_number}`} className="flex min-h-[56px] flex-1 flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div>
                  <p className="font-medium">{r.translations.join(' · ')}</p>
                  <p className="text-sm text-slate-400">{[r.german, ...(r.german_alts ?? [])].join(' · ')}</p>
                </div>
                <p className="label-mono">{r.book_name} · U{r.unit_number} · S{r.page_number}</p>
              </Link>
              {isPublic(r.book_id) &&
                (sent.has(r.vocabulary_id) ? (
                  <span className="px-2 text-xs text-emerald-300">Gemeldet</span>
                ) : (
                  <button type="button" aria-label="Zur Prüfung melden" title="Zur Prüfung melden" onClick={() => setReporting(r)} className="flex min-h-[44px] w-11 items-center justify-center rounded-lg text-slate-500 hover:text-amber-300">
                    <Flag size={16} />
                  </button>
                ))}
            </div>
          ))}
        </div>
      )}
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
