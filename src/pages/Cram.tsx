import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Check, ChevronLeft, ChevronRight, MessageCircle, RotateCcw, X } from 'lucide-react'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import { Field, Select, TextInput } from '../components/ui/Field'
import Modal from '../components/ui/Modal'
import PageHeader from '../components/ui/PageHeader'
import ProgressBar from '../components/ui/ProgressBar'
import { ErrorBox, Notice, Spinner } from '../components/ui/States'
import { useAuth } from '../features/auth/AuthProvider'
import { useChat } from '../features/chat/ChatProvider'
import { useLocks } from '../features/locks/LocksProvider'
import {
  addHard, afterAbfrage, forgiveAbfrage, forgiveTest, overridesLeft, MAX_OVERRIDES, answerAbfrage, answerTest, loadSession, newSession, questionFor, requeue, saveSession,
  startAbfrage, startKarten, startTest, testResult, TEST_SIZE, type CramPhase, type CramSession,
} from '../features/cram/cram'
import FlipCard from '../features/cram/FlipCard'
import { distinctVocabulary, selectRange } from '../features/test/range'
import { errorMessage } from '../lib/errors'
import { GRADE_WORD, gradeFromScore, percentOf } from '../lib/grade'
import { useAsync } from '../lib/useAsync'
import { getBookEntries, listBooks } from '../services/books'
import type { BookEntry } from '../types'
import Chat from './Chat'

const PHASE_LABEL: Record<CramPhase, string> = { merken: '1 · Merken', karten: 'Karteikarten', abfrage: '2 · Abfrage', test: '3 · Test', ergebnis: 'Ergebnis' }

/** „Morgen ist Test und ich habe noch nichts gelernt“: Merken → Karteikarten → Abfrage mit Verbesserung → Test mit Note. */
export default function Cram() {
  const { user } = useAuth()
  const uid = user?.id ?? ''
  const [s, setS] = useState<CramSession | null>(() => (uid ? loadSession(uid) : null))
  const [chatOpen, setChatOpen] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const { locked } = useLocks()
  const chat = useChat()

  // Jeder Schritt wird sofort gespeichert: Seite verlassen oder Neuladen verliert nichts.
  function update(next: CramSession | null) {
    setS(next)
    if (uid) saveSession(uid, next)
  }

  if (!s) return <Setup onStart={update} />

  return (
    <div>
      <PageHeader eyebrow="Lernen" title="Crashkurs" />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-accent-cyan/40 bg-accent-cyan/10 px-3 py-1 text-sm text-accent-cyan">{PHASE_LABEL[s.phase]}</span>
        <span className="text-sm text-slate-400">{s.label} · {s.vocab.length} Vokabeln</span>
        <div className="ml-auto flex gap-2">
          {!locked.has('chat') && (
            <Button variant="secondary" onClick={() => setChatOpen(true)} className="relative">
              <MessageCircle size={16} /> Chat
              {chat.unread > 0 && <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-rose-500" />}
            </Button>
          )}
          <Button variant="ghost" onClick={() => setConfirmCancel(true)}><X size={16} /> Abbrechen</Button>
        </div>
      </div>

      {s.phase !== 'ergebnis' && s.phase !== 'test' && (
        <div className="mb-4 flex flex-wrap gap-2 text-sm">
          <Button variant="ghost" onClick={() => update({ ...s, phase: 'merken', queue: s.vocab.map((v) => v.vocabulary_id) })}>Merken</Button>
          <Button variant="ghost" onClick={() => update(startKarten(s))}>Karteikarten</Button>
          <Button variant="ghost" onClick={() => update(startAbfrage(s))}>Abfrage</Button>
          <Button variant="ghost" onClick={() => update(startTest(s))}>Direkt zum Test</Button>
        </div>
      )}

      {s.phase === 'merken' && <Merken s={s} update={update} />}
      {s.phase === 'karten' && <Karten s={s} update={update} />}
      {s.phase === 'abfrage' && <Abfrage s={s} update={update} />}
      {s.phase === 'test' && <TestRun s={s} update={update} />}
      {s.phase === 'ergebnis' && <Ergebnis s={s} update={update} />}

      <p className="mt-6 text-xs text-slate-500">Dein Fortschritt wird automatisch gespeichert. Du kannst jederzeit etwas anderes machen und später hier weitermachen.</p>

      {chatOpen && <Modal title="Chat" wide onClose={() => setChatOpen(false)}><Chat /></Modal>}
      {confirmCancel && (
        <Modal title="Crashkurs abbrechen?" onClose={() => setConfirmCancel(false)}>
          <p className="mb-4 text-sm text-slate-300">Der gespeicherte Fortschritt wird gelöscht.</p>
          <div className="flex gap-2">
            <Button variant="danger" onClick={() => { setConfirmCancel(false); update(null) }}>Ja, abbrechen</Button>
            <Button variant="secondary" onClick={() => setConfirmCancel(false)}>Weitermachen</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Setup({ onStart }: { onStart: (s: CramSession) => void }) {
  const books = useAsync(listBooks, [])
  const [bookId, setBookId] = useState('')
  const [entries, setEntries] = useState<BookEntry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  useEffect(() => {
    setEntries(null); setFrom(''); setTo('')
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
    if (!entries || !from) return []
    return distinctVocabulary(selectRange(entries, { mode: 'unit', from: Number(from), to: Number(to || from) }))
  }, [entries, from, to])

  return (
    <div>
      <PageHeader eyebrow="Lernen" title="Crashkurs: Noch nichts gelernt" />
      {error && <div className="mb-4"><ErrorBox message={error} /></div>}
      <Card className="max-w-xl space-y-4">
        <p className="text-sm text-slate-400">Morgen ist Test? Erst alle Vokabeln zum Merken, dann Karteikarten, dann Abfrage mit Wiederholung der Fehler und am Ende ein Test mit 10 Wörtern und Note.</p>
        {books.loading && !books.data && <Spinner />}
        <Field label="Buch">
          <Select value={bookId} onChange={(e) => setBookId(e.target.value)}>
            <option value="">– Buch wählen –</option>
            {books.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </Field>
        {loading && <Spinner />}
        {entries && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Von Unit">
              <Select value={from} onChange={(e) => { setFrom(e.target.value); if (!to || Number(to) < Number(e.target.value)) setTo(e.target.value) }}>
                <option value="">–</option>
                {units.map((u) => <option key={u} value={u}>Unit {u}</option>)}
              </Select>
            </Field>
            <Field label="Bis Unit">
              <Select value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="">–</option>
                {units.filter((u) => !from || u >= Number(from)).map((u) => <option key={u} value={u}>Unit {u}</option>)}
              </Select>
            </Field>
          </div>
        )}
        {vocab.length > 0 && <Notice>{vocab.length} Vokabeln im gewählten Bereich.</Notice>}
        <Button
          disabled={vocab.length === 0}
          onClick={() => {
            const b = books.data?.find((x) => x.id === bookId)
            const f = Number(from), t = Number(to || from)
            onStart(newSession(`${b?.name ?? 'Buch'}, Unit ${f === t ? f : `${f}–${t}`}`, bookId, vocab))
          }}
        >
          Los geht's
        </Button>
      </Card>
    </div>
  )
}

const german = (v: { german: string }) => v.german

function Merken({ s, update }: { s: CramSession; update: (s: CramSession) => void }) {
  const [pos, setPos] = useState(0)
  const ids = s.queue
  const v = s.vocab.find((x) => x.vocabulary_id === ids[Math.min(pos, ids.length - 1)])
  const last = pos >= ids.length - 1
  if (!v) return null
  return (
    <div className="max-w-xl space-y-4">
      <ProgressBar value={((pos + 1) / ids.length) * 100} label={`${pos + 1} / ${ids.length}`} />
      <Card className="space-y-3 text-center">
        <div className="text-3xl font-semibold">{german(v)}</div>
        <div className="text-2xl text-accent-cyan">{v.translations.join(', ')}</div>
        <p className="text-xs text-slate-500">Sprich es laut aus und schreib es, wenn möglich, einmal auf.</p>
      </Card>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={pos === 0} onClick={() => setPos(pos - 1)}><ChevronLeft size={16} /></Button>
        <Button variant="secondary" onClick={() => { update({ ...s, queue: ids.slice(pos + 1).includes(v.vocabulary_id) ? ids : [...ids, v.vocabulary_id], hard: addHard(s.hard, v.vocabulary_id) }) }}>
          <RotateCcw size={16} /> Nochmal
        </Button>
        {!last
          ? <Button onClick={() => setPos(pos + 1)}>Weiter <ChevronRight size={16} /></Button>
          : <Button onClick={() => update(startKarten(s))}>Weiter zu den Karteikarten</Button>}
      </div>
    </div>
  )
}

function Karten({ s, update }: { s: CramSession; update: (s: CramSession) => void }) {
  const [flipped, setFlipped] = useState(false)
  const [reverse, setReverse] = useState(false)
  const id = s.queue[0]
  const v = s.vocab.find((x) => x.vocabulary_id === id)
  if (!v) {
    return (
      <Card className="max-w-xl space-y-3">
        <p>Alle Karten geschafft.</p>
        <Button onClick={() => update(s.hardOnly ? startTest(s) : startAbfrage(s))}>{s.hardOnly ? 'Weiter zum Test' : 'Weiter zur Abfrage'}</Button>
      </Card>
    )
  }
  const front = reverse ? v.translations.join(', ') : german(v)
  const back = reverse ? german(v) : v.translations.join(', ')
  function go(known: boolean) {
    setFlipped(false)
    update({ ...s, queue: known ? s.queue.slice(1) : requeue(s.queue, id), hard: known ? s.hard : addHard(s.hard, id) })
  }
  return (
    <div className="max-w-xl space-y-4">
      <p className="text-sm text-slate-400">{s.hardOnly ? 'Diese Wörter waren schwer – noch einmal als Karten. ' : ''}Noch {s.queue.length} Karte(n).</p>
      <FlipCard front={front} back={back} flipped={flipped} onFlip={() => setFlipped((f) => !f)} />
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => { setReverse(!reverse); setFlipped(false) }}>Seite tauschen</Button>
        <Button variant="secondary" disabled={!flipped} onClick={() => go(false)}><RotateCcw size={16} /> Nochmal</Button>
        <Button disabled={!flipped} onClick={() => go(true)}><Check size={16} /> Gewusst</Button>
      </div>
    </div>
  )
}

function Abfrage({ s, update }: { s: CramSession; update: (s: CramSession) => void }) {
  const [value, setValue] = useState('')
  const [fb, setFb] = useState<{ ok: boolean; accepted: string[]; next: CramSession } | null>(null)
  const [confirm, setConfirm] = useState(false)
  const done = s.quiz.length === 0
  const cur = s.quiz[0]
  const q = cur ? questionFor(s, cur.id, cur.dir) : null

  function submit(e: FormEvent) {
    e.preventDefault()
    if (fb) { update(fb.next); setFb(null); setValue(''); return }
    const r = answerAbfrage(s, value)
    setFb({ ok: r.ok, accepted: r.q.accepted, next: r.s })
  }

  if (done) {
    return (
      <Card className="max-w-xl space-y-3">
        <p>Alle Vokabeln richtig beantwortet.{s.hard.length > 0 ? ` ${s.hard.length} schwere Wörter üben wir noch einmal als Karteikarten, dann kommt der Test.` : ''}</p>
        <Button onClick={() => update(afterAbfrage(s))}>{s.hard.length > 0 ? 'Weiter zu den schweren Karten' : 'Weiter zum Test'}</Button>
      </Card>
    )
  }
  if (!q) return null
  return (
    <form onSubmit={submit} className="max-w-xl space-y-4">
      <p className="text-sm text-slate-400">Noch {s.quiz.length} offen. Falsche Wörter kommen wieder.</p>
      <Card className="space-y-3">
        <div className="text-2xl font-semibold">{q.prompt}</div>
        <TextInput key={`${s.quiz.length}-${s.answered}`} autoFocus autoComplete="off" autoCapitalize="none" value={value} readOnly={!!fb} onChange={(e) => setValue(e.target.value)} placeholder={cur.dir === 'forward' ? 'Übersetzung' : 'Deutsch'} />
        {fb && <div className={fb.ok ? 'text-emerald-400' : 'text-rose-400'}>{fb.ok ? 'Richtig!' : `Falsch – richtig: ${fb.accepted.join(' / ')}`}</div>}
      </Card>
      <div className="flex flex-wrap gap-2">
        <Button type="submit">{fb ? 'Weiter' : 'Prüfen'}</Button>
        {fb && !fb.ok && (
          <Button variant="secondary" disabled={overridesLeft(s) === 0} onClick={() => setConfirm(true)}>
            <Check size={16} /> Hab ich gewusst ({overridesLeft(s)}/{MAX_OVERRIDES})
          </Button>
        )}
      </div>
      {confirm && (
        <Modal title="Wirklich gewusst?" onClose={() => setConfirm(false)}>
          <p className="mb-4 text-sm text-slate-300">Nur ein Tippfehler? Dann zählt die Antwort als richtig. Das geht höchstens {MAX_OVERRIDES}-mal pro Crashkurs, du hast noch {overridesLeft(s)}.</p>
          <div className="flex gap-2">
            <Button onClick={() => { setConfirm(false); update(forgiveAbfrage(s)); setFb(null); setValue('') }}>Ja, als richtig werten</Button>
            <Button variant="secondary" onClick={() => setConfirm(false)}>Nein</Button>
          </div>
        </Modal>
      )}
    </form>
  )
}

function TestRun({ s, update }: { s: CramSession; update: (s: CramSession) => void }) {
  const [value, setValue] = useState('')
  const t = s.test[s.testPos]
  const q = t ? questionFor(s, t.id, t.dir) : null
  if (!q) return null
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); update(answerTest(s, value)); setValue('') }}
      className="max-w-xl space-y-4"
    >
      <ProgressBar value={(s.testPos / s.test.length) * 100} label={`Frage ${s.testPos + 1} / ${s.test.length}`} />
      <Card className="space-y-3">
        <div className="text-2xl font-semibold">{q.prompt}</div>
        <TextInput key={s.testPos} autoFocus autoComplete="off" autoCapitalize="none" value={value} onChange={(e) => setValue(e.target.value)} placeholder={t.dir === 'forward' ? 'Übersetzung' : 'Deutsch'} />
        <p className="text-xs text-slate-500">Im Test gibt es erst am Ende die Auswertung. ({TEST_SIZE} Wörter)</p>
      </Card>
      <Button type="submit">{s.testPos + 1 >= s.test.length ? 'Abgeben' : 'Weiter'}</Button>
    </form>
  )
}

function Ergebnis({ s, update }: { s: CramSession; update: (s: CramSession | null) => void }) {
  const r = useMemo(() => testResult(s), [s])
  const grade = gradeFromScore(r.correct, r.total)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const wrongIds = useRef(r.rows.filter((x) => !x.ok).map((x) => x.q.vocabularyId))
  return (
    <div className="max-w-xl space-y-4">
      <Card className="space-y-2 text-center">
        <div className="text-5xl font-bold text-accent-cyan">Note {grade}</div>
        <div className="text-slate-300">{GRADE_WORD[grade]} · {r.correct} von {r.total} richtig ({percentOf(r.correct, r.total)} %)</div>
      </Card>
      <Card className="space-y-2">
        {r.rows.map((x, i) => (
          <div key={i} className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className={x.ok ? 'text-emerald-400' : 'text-rose-400'}>{x.ok ? '✓' : '✗'}</span>
            <span className="font-medium">{x.q.prompt}</span>
            <span className="text-slate-400">{x.ok ? x.given : `${x.given || '–'} → ${x.q.accepted.join(' / ')}`}</span>
            {!x.ok && overridesLeft(s) > 0 && <button type="button" className="ml-auto text-xs text-accent-cyan underline" onClick={() => setConfirmId(x.q.vocabularyId)}>Hab ich gewusst</button>}
          </div>
        ))}
      </Card>
      {confirmId && (
        <Modal title="Wirklich gewusst?" onClose={() => setConfirmId(null)}>
          <p className="mb-4 text-sm text-slate-300">Nur ein Tippfehler? Dann zählt die Antwort als richtig. Noch {overridesLeft(s)} von {MAX_OVERRIDES} möglich.</p>
          <div className="flex gap-2">
            <Button onClick={() => { update(forgiveTest(s, confirmId)); setConfirmId(null) }}>Ja, als richtig werten</Button>
            <Button variant="secondary" onClick={() => setConfirmId(null)}>Nein</Button>
          </div>
        </Modal>
      )}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => update(startTest({ ...s, hard: Array.from(new Set([...s.hard, ...wrongIds.current])) }))}>Neuer Test</Button>
        {wrongIds.current.length > 0 && <Button variant="secondary" onClick={() => update(startKarten({ ...s, hard: wrongIds.current }, true))}>Fehler als Karteikarten</Button>}
        <Button variant="secondary" onClick={() => update(null)}>Fertig</Button>
      </div>
    </div>
  )
}
