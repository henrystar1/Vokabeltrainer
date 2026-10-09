import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Eye, RotateCcw } from 'lucide-react'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import { Field, Select } from '../components/ui/Field'
import PageHeader from '../components/ui/PageHeader'
import { ErrorBox, Notice, Spinner } from '../components/ui/States'
import { useWallet } from '../features/koins/WalletProvider'
import { errorMessage } from '../lib/errors'
import { useAsync } from '../lib/useAsync'
import { getBookEntries, listBooks } from '../services/books'
import { claimCopyReward } from '../services/koins'
import type { BookEntry } from '../types'

type Mode = 'abschreiben' | 'aufdecken'

function shuffled<T>(a: T[]): T[] {
  const r = [...a]
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[r[i], r[j]] = [r[j], r[i]]
  }
  return r
}

/** Vokabeln von Hand abschreiben: entweder alles sichtbar oder erst Deutsch, dann aufdecken. */
export default function Copy() {
  const wallet = useWallet()
  const books = useAsync(listBooks, [])
  const [bookId, setBookId] = useState('')
  const [unit, setUnit] = useState('all')
  const [mode, setMode] = useState<Mode>('abschreiben')
  const [mix, setMix] = useState(false)
  const [reverse, setReverse] = useState(false)
  const [entries, setEntries] = useState<BookEntry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [queue, setQueue] = useState<BookEntry[]>([])
  const [total, setTotal] = useState(0)
  const [pos, setPos] = useState(0)
  const [shown, setShown] = useState(false)
  const [again, setAgain] = useState<Set<string>>(new Set())
  const [done, setDone] = useState(false)
  const [rewardMsg, setRewardMsg] = useState<string | null>(null)

  // Vokabeln des Buchs laden, sobald eines gewählt ist.
  useEffect(() => {
    setEntries(null)
    setUnit('all')
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
  const pool = useMemo(() => (entries ?? []).filter((e) => unit === 'all' || e.unit_number === Number(unit)), [entries, unit])

  function start() {
    const q = mix ? shuffled(pool) : pool
    setQueue(q); setTotal(q.length); setPos(0); setShown(false); setAgain(new Set()); setDone(false); setRewardMsg(null)
  }

  const running = queue.length > 0 && !done
  const cur = running ? queue[pos] : null

  async function finish() {
    setDone(true)
    try {
      const r = await claimCopyReward(bookId, unit === 'all' ? 0 : Number(unit), total)
      if (r.reason === 'ok' && r.reward > 0) { setRewardMsg(`+${r.reward} Coins fürs Abschreiben!`); void wallet.refresh() }
      else if (r.reason === 'schon_heute') setRewardMsg('Für diese Lektion gab es heute schon Coins.')
      else if (r.reason === 'tageslimit') setRewardMsg('Das Tageslimit für Abschreib-Coins ist erreicht.')
    } catch { /* Belohnung ist nur ein Bonus */ }
  }

  function next(requeue = false) {
    if (!cur) return
    let q = queue
    if (requeue && !again.has(cur.placement_id)) {
      q = [...queue, cur]
      setQueue(q)
      setAgain(new Set(again).add(cur.placement_id))
    }
    setShown(false)
    if (pos + 1 >= q.length) void finish()
    else setPos(pos + 1)
  }

  useEffect(() => {
    if (!running) return
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return
      if (e.key === 'ArrowLeft' && pos > 0) { setShown(false); setPos(pos - 1) }
      if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); if (mode === 'abschreiben' || shown) next(); else setShown(true) }
      if (e.key === ' ') { e.preventDefault(); if (mode === 'aufdecken') setShown((s) => !s) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const front = (e: BookEntry) => (reverse ? e.translations.join(', ') : e.german)
  const back = (e: BookEntry) => (reverse ? e.german : e.translations.join(', '))

  return (
    <div>
      <PageHeader eyebrow="Lernen" title="Abschreiben" />
      {error && <div className="mb-4"><ErrorBox message={error} /></div>}

      {!running && !done && (
        <Card className="max-w-xl space-y-4">
          <p className="text-sm text-slate-400">Schreibe die Vokabeln von Hand auf Papier ab. Sie bleiben die ganze Zeit sichtbar, oder du deckst die Übersetzung erst auf.</p>
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
              <Field label="Lektion (Unit)">
                <Select value={unit} onChange={(e) => setUnit(e.target.value)}>
                  <option value="all">Alle Units ({entries.length} Vokabeln)</option>
                  {units.map((u) => <option key={u} value={u}>Unit {u} ({entries.filter((e) => e.unit_number === u).length})</option>)}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                {([['abschreiben', 'Alles sichtbar'], ['aufdecken', 'Erst Deutsch, dann aufdecken']] as const).map(([m, l]) => (
                  <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}
                    className={`min-h-[48px] rounded-xl border px-3 text-sm ${mode === m ? 'border-accent-cyan/60 bg-accent-cyan/10 text-accent-cyan' : 'border-white/10 text-slate-300'}`}>{l}</button>
                ))}
              </div>
              <label className="flex min-h-[44px] items-center gap-3 text-sm"><input type="checkbox" className="h-4 w-4 accent-cyan-400" checked={mix} onChange={(e) => setMix(e.target.checked)} /> Reihenfolge mischen</label>
              <label className="flex min-h-[44px] items-center gap-3 text-sm"><input type="checkbox" className="h-4 w-4 accent-cyan-400" checked={reverse} onChange={(e) => setReverse(e.target.checked)} /> Umgekehrt (erst Fremdsprache)</label>
              {pool.length === 0 && <Notice tone="info">In dieser Auswahl gibt es keine Vokabeln.</Notice>}
              <Button disabled={pool.length === 0} onClick={start}>{pool.length} Vokabeln starten</Button>
            </>
          )}
        </Card>
      )}

      {running && cur && (
        <div className="mx-auto max-w-2xl space-y-4">
          <div>
            <div className="mb-1 flex justify-between text-xs text-slate-400"><span>{Math.min(pos + 1, queue.length)} von {queue.length}</span><span>Unit {cur.unit_number} · Seite {cur.page_number}</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-accent-cyan transition-all" style={{ width: `${((pos + 1) / queue.length) * 100}%` }} /></div>
          </div>
          <Card className="flex min-h-[260px] flex-col items-center justify-center gap-6 p-8 text-center">
            <p className="break-words text-4xl font-semibold leading-tight sm:text-5xl">{front(cur)}</p>
            {mode === 'abschreiben' || shown ? (
              <p className="break-words text-3xl text-accent-cyan sm:text-4xl">{back(cur)}</p>
            ) : (
              <Button variant="secondary" onClick={() => setShown(true)}><Eye size={18} /> Aufdecken</Button>
            )}
          </Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="ghost" disabled={pos === 0} onClick={() => { setShown(false); setPos(pos - 1) }}><ChevronLeft size={18} /> Zurück</Button>
            {mode === 'abschreiben' ? (
              <Button onClick={() => next()}><Check size={18} /> Abgeschrieben</Button>
            ) : shown ? (
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => next(true)}><RotateCcw size={16} /> Nochmal</Button>
                <Button onClick={() => next()}><Check size={18} /> Gekonnt</Button>
              </div>
            ) : (
              <span className="text-xs text-slate-500">Leertaste = aufdecken</span>
            )}
            {mode === 'abschreiben' && <Button variant="ghost" onClick={() => next()}>Weiter <ChevronRight size={18} /></Button>}
          </div>
        </div>
      )}

      {done && (
        <Card className="mx-auto max-w-xl space-y-3 text-center">
          <p className="text-2xl font-semibold">Fertig! 🎉</p>
          <p className="text-slate-300">{total} Vokabeln abgeschrieben{again.size > 0 ? `, ${again.size} davon zweimal` : ''}.</p>
          {rewardMsg && <Notice tone="ok">{rewardMsg}</Notice>}
          <div className="flex justify-center gap-2">
            <Button variant="secondary" onClick={start}>Nochmal</Button>
            <Button onClick={() => { setDone(false); setQueue([]) }}>Andere Auswahl</Button>
          </div>
        </Card>
      )}
    </div>
  )
}
