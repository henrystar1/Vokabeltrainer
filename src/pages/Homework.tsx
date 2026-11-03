import { useState } from 'react'
import { CalendarDays, Check, Pencil, Plus, Trash2 } from 'lucide-react'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import { Field, TextArea, TextInput } from '../components/ui/Field'
import Modal from '../components/ui/Modal'
import PageHeader from '../components/ui/PageHeader'
import { EmptyState, ErrorBox, Spinner } from '../components/ui/States'
import { useAuth } from '../features/auth/AuthProvider'
import { errorMessage } from '../lib/errors'
import { formatDate } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { homeworkDelete, homeworkList, homeworkSave, homeworkSetDone, type Homework } from '../services/tasks'

const today = (): string => new Date().toLocaleDateString('sv-SE') // YYYY-MM-DD in Ortszeit

/** Hausaufgaben: Mods und Admins tragen sie ein, alle sehen sie und haken sie für sich selbst ab. */
export default function HomeworkPage() {
  const { isStaff } = useAuth()
  const list = useAsync(homeworkList, [])
  const [edit, setEdit] = useState<Homework | 'new' | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [subject, setSubject] = useState('')
  const [due, setDue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mine, setMine] = useState<Record<string, boolean>>({}) // sofortige Anzeige beim Abhaken

  function open(h: Homework | 'new') {
    setEdit(h)
    setTitle(h === 'new' ? '' : h.title)
    setBody(h === 'new' ? '' : h.body)
    setSubject(h === 'new' ? '' : h.subject)
    setDue(h === 'new' ? '' : h.due_date ?? '')
    setError(null)
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await homeworkSave(edit === 'new' || edit === null ? null : edit.id, title, body, subject, due || null)
      setEdit(null)
      list.reload()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  function toggle(h: Homework) {
    const next = !(mine[h.id] ?? h.done)
    setMine((m) => ({ ...m, [h.id]: next }))
    homeworkSetDone(h.id, next).then(() => list.reload()).catch((e) => { setError(errorMessage(e)); setMine((m) => ({ ...m, [h.id]: !next })) })
  }

  const isDone = (h: Homework) => mine[h.id] ?? h.done
  const open_ = (list.data ?? []).filter((h) => !isDone(h))
  const done_ = (list.data ?? []).filter(isDone)

  const row = (h: Homework) => {
    const d = isDone(h)
    const late = !d && h.due_date !== null && h.due_date < today()
    return (
      <Card key={h.id} className={`flex items-start gap-3 ${d ? 'opacity-60' : ''}`}>
        <button
          type="button"
          role="checkbox"
          aria-checked={d}
          aria-label={`${h.title} ${d ? 'wieder öffnen' : 'abhaken'}`}
          onClick={() => toggle(h)}
          className={`mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border-2 transition ${d ? 'border-emerald-400 bg-emerald-500/20 text-emerald-300' : 'border-white/25 text-transparent hover:border-accent-cyan'}`}
        >
          <Check size={22} />
        </button>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className={`text-lg font-semibold ${d ? 'line-through' : ''}`}>{h.title}</h2>
            {h.subject && <span className="rounded-full border border-accent-cyan/40 bg-accent-cyan/10 px-2.5 py-0.5 text-xs text-accent-cyan">{h.subject}</span>}
            {h.due_date && (
              <span className={`inline-flex items-center gap-1 text-xs ${late ? 'text-rose-300' : 'text-slate-400'}`}><CalendarDays size={13} /> {late ? 'überfällig seit ' : 'bis '}{formatDate(h.due_date)}</span>
            )}
          </div>
          {h.body && <p className="whitespace-pre-wrap text-sm text-slate-300">{h.body}</p>}
          <p className="text-xs text-slate-500">
            Eingetragen von {h.created_by_name ?? 'Unbekannt'} · {h.done_count} {h.done_count === 1 ? 'Person hat' : 'Personen haben'} sie erledigt
          </p>
        </div>
        {isStaff && (
          <div className="flex shrink-0 gap-1">
            <button type="button" aria-label="Bearbeiten" className="flex min-h-[40px] w-10 items-center justify-center rounded-lg text-slate-400 hover:text-white" onClick={() => open(h)}><Pencil size={16} /></button>
            <button type="button" aria-label="Löschen" className="flex min-h-[40px] w-10 items-center justify-center rounded-lg text-slate-400 hover:text-rose-300" onClick={() => { if (window.confirm('Hausaufgabe für alle löschen?')) void homeworkDelete(h.id).then(list.reload).catch((e) => setError(errorMessage(e))) }}><Trash2 size={16} /></button>
          </div>
        )}
      </Card>
    )
  }

  return (
    <div>
      <PageHeader eyebrow="Schule" title="Hausaufgaben" actions={isStaff ? <Button variant="secondary" onClick={() => open('new')}><Plus size={16} /> Eintragen</Button> : undefined} />
      <p className="mb-5 max-w-2xl text-sm text-slate-400">Hier stehen die Hausaufgaben. Das Häkchen siehst nur du: Es hilft dir, den Überblick zu behalten.</p>
      {list.loading && !list.data && <Spinner />}
      {list.error && <ErrorBox message={list.error} onRetry={list.reload} />}
      {error && !edit && <ErrorBox message={error} />}
      {list.data?.length === 0 && <EmptyState title="Keine Hausaufgaben" text={isStaff ? 'Mit „Eintragen“ legst du die erste an.' : 'Gerade ist nichts eingetragen.'} />}
      <div className="space-y-3">{open_.map(row)}</div>
      {done_.length > 0 && (
        <>
          <h2 className="label-mono mb-3 mt-8">Erledigt ({done_.length})</h2>
          <div className="space-y-3">{done_.map(row)}</div>
        </>
      )}
      {edit && (
        <Modal title={edit === 'new' ? 'Hausaufgabe eintragen' : 'Hausaufgabe bearbeiten'} onClose={() => setEdit(null)}>
          <div className="space-y-3">
            <Field label="Aufgabe"><TextInput value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="z. B. Vokabeln Unit 4 lernen" /></Field>
            <Field label="Fach (optional)"><TextInput value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={40} placeholder="z. B. Englisch" /></Field>
            <Field label="Bis wann (optional)"><TextInput type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
            <Field label="Genauer (optional)"><TextArea value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} /></Field>
            {error && <ErrorBox message={error} />}
            <Button busy={busy} disabled={title.trim() === ''} onClick={() => void save()}>Speichern</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
