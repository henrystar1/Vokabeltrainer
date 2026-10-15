import { useEffect, useMemo, useState } from 'react'
import { Check, RotateCcw } from 'lucide-react'
import ReportModal from '../components/books/ReportModal'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import { Field, Select } from '../components/ui/Field'
import PageHeader from '../components/ui/PageHeader'
import ProgressBar from '../components/ui/ProgressBar'
import { ErrorBox, Spinner } from '../components/ui/States'
import { addHard, requeue } from '../features/cram/cram'
import FlipCard from '../features/cram/FlipCard'
import { ReportBtn, type Rep } from '../features/cram/ReportBtn'
import type { VocabLike } from '../features/learning/questions'
import { shuffle } from '../features/learning/random'
import { distinctVocabulary, selectRange } from '../features/test/range'
import { errorMessage } from '../lib/errors'
import { useAsync } from '../lib/useAsync'
import { getBookEntries, listBooks } from '../services/books'
import type { BookEntry } from '../types'

type Side = 'de' | 'fremd' | 'mix'

/** Karteikarten: eine Seite sehen, umdrehen, „Gewusst“ oder „Nochmal“. Unbekannte Karten kommen wieder. */
export default function Flashcards() {
  const books = useAsync(listBooks, [])
  const [bookId, setBookId] = useState('')
  const [entries, setEntries] = useState<BookEntry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [from, setFrom] = useState('all')
  const [to, setTo] = useState('all')
  const [side, setSide] = useState<Side>('de')
  const [mix, setMix] = useState(true)

  const [deck, setDeck] = useState<VocabLike[] | null>(null)
  const [queue, setQueue] = useState<string[]>([])
  const [total, setTotal] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [step, setStep] = useState(0)
  const [rev, setRev] = useState<Record<string, boolean>>({})
  const [hard, setHard] = useState<string[]>([])
  const [reporting, setReporting] = useState<VocabLike | null>(null)
  const [sent, setSent] = useState<ReadonlySet<string>>(new Set())
  const rep: Rep = { report: setReporting, sent }

  useEffect(() => {
    setEntries(null); setFrom('all'); setTo('all')
    if (!bookId) return
    let stale = false
    setLoading(true)
    getBookEntries(bookId)
      .then((e) => { if (!stale) setEntries(e) })
      .catch((e) => { if (!stale) setError(errorMessage(e)) })
      .finally(() => { if (!stale) setLoading(false) })
    return () => { stale = true }
  }, [bookId])

  const units = useMemo(() => [...new Set((entries ?? []).map((e) => e.unit_number))].sort((a, b) => a - b), [entries])
  const vocab = useMemo(() => {
    if (!entries) return []
    if (from === 'all') return distinctVocabulary(entries)
    return distinctVocabulary(selectRange(entries, { mode: 'unit', from: Number(from), to: Number(to === 'all' ? from : to) }))
  }, [entries, from, to])

  function start(only?: string[]) {
    const base = only ? vocab.filter((v) => only.includes(v.vocabulary_id)) : vocab
    const list = mix ? shuffle(base) : base
    const r: Record<string, boolean> = {}
    for (const v of list) r[v.vocabulary_id] = side === 'fremd' ? true : side === 'mix' ? Math.random() < 0.5 : false
    setDeck(list); setRev(r); setQueue(list.map((v) => v.vocabulary_id)); setTotal(list.length); setFlipped(false); setHard([])
  }

  const reportModal = reporting && (
    <ReportModal
      entry={reporting}
      onClose={() => setReporting(null)}
      onSent={() => { setSent((x) => new Set(x).add(reporting.vocabulary_id)); setReporting(null) }}
    />
  )

  if (!deck) {
    return (
      <div>
        <PageHeader eyebrow="Lernen" title="Karteikarten" />
        {error && <div className="mb-4"><ErrorBox message={error} /></div>}
        <Card className="max-w-xl space-y-4">
          <p className="text-sm text-slate-400">Die Karte zeigt eine Seite, tippe darauf und sie dreht sich um. Was du nicht wusstest, kommt später nochmal.</p>
          {books.loading && !books.data && <Spinner />}
          <Field label="Buch">
            <Select value={bookId} onChange={(e) => setBookId(e.target.value)}>
              <option value="">– Buch wählen –</option>
              {books.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
          {loading && <Spinner />}
          {entries && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Von Unit">
                  <Select value={from} onChange={(e) => { setFrom(e.target.value); setTo(e.target.value) }}>
                    <option value="all">Alle</option>
                    {units.map((u) => <option key={u} value={u}>Unit {u}</option>)}
                  </Select>
                </Field>
                <Field label="Bis Unit">
                  <Select value={to} disabled={from === 'all'} onChange={(e) => setTo(e.target.value)}>
                    {from === 'all' && <option value="all">Alle</option>}
                    {units.filter((u) => from === 'all' || u >= Number(from)).map((u) => <option key={u} value={u}>Unit {u}</option>)}
                  </Select>
                </Field>
              </div>
              <Field label="Vorderseite">
                <Select value={side} onChange={(e) => setSide(e.target.value as Side)}>
                  <option value="de">Deutsch</option>
                  <option value="fremd">Fremdsprache</option>
                  <option value="mix">Gemischt</option>
                </Select>
              </Field>
              <label className="flex min-h-[44px] items-center gap-3 text-sm"><input type="checkbox" className="h-4 w-4 accent-cyan-400" checked={mix} onChange={(e) => setMix(e.target.checked)} /> Reihenfolge mischen</label>
              <p className="text-sm text-slate-400">{vocab.length} Karten</p>
            </>
          )}
          <Button disabled={vocab.length === 0} onClick={() => start()}>Los geht's</Button>
        </Card>
      </div>
    )
  }

  const id = queue[0]
  const v = deck.find((x) => x.vocabulary_id === id)

  if (!v) {
    return (
      <div>
        <PageHeader eyebrow="Lernen" title="Karteikarten" />
        <Card className="max-w-xl space-y-3">
          <p>Alle {total} Karten geschafft.{hard.length > 0 ? ` ${hard.length} davon waren schwer.` : ''}</p>
          <div className="flex flex-wrap gap-2">
            {hard.length > 0 && <Button onClick={() => start(hard)}>Schwere nochmal</Button>}
            <Button variant="secondary" onClick={() => start()}>Alle nochmal</Button>
            <Button variant="ghost" onClick={() => setDeck(null)}>Andere Auswahl</Button>
          </div>
        </Card>
        {reportModal}
      </div>
    )
  }

  const foreign = v.translations.join(', ')
  const r = rev[id]
  function go(known: boolean) {
    setFlipped(false)
    setStep(step + 1)
    setQueue(known ? queue.slice(1) : requeue(queue, id))
    if (!known) setHard(addHard(hard, id))
  }

  return (
    <div>
      <PageHeader eyebrow="Lernen" title="Karteikarten" />
      <div className="max-w-xl space-y-4">
        <ProgressBar value={((total - new Set(queue).size) / total) * 100} label={`Noch ${queue.length} Karte(n)`} />
        <FlipCard key={step} front={r ? foreign : v.german} back={r ? v.german : foreign} flipped={flipped} onFlip={() => setFlipped((f) => !f)} />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={!flipped} onClick={() => go(false)}><RotateCcw size={16} /> Nochmal</Button>
          <Button disabled={!flipped} onClick={() => go(true)}><Check size={16} /> Gewusst</Button>
          <ReportBtn v={v} rep={rep} />
          <Button variant="ghost" onClick={() => setDeck(null)}>Beenden</Button>
        </div>
      </div>
      {reportModal}
    </div>
  )
}
