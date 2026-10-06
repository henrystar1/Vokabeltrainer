import { useState } from 'react'
import { Hammer, Lightbulb, Pencil, Plus, Trash2, CheckCircle2 } from 'lucide-react'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import { Field, Select, TextArea, TextInput } from '../components/ui/Field'
import Modal from '../components/ui/Modal'
import PageHeader from '../components/ui/PageHeader'
import { EmptyState, ErrorBox, Spinner } from '../components/ui/States'
import { useAuth } from '../features/auth/AuthProvider'
import { formatDate } from '../lib/format'
import { errorMessage } from '../lib/errors'
import { useAsync } from '../lib/useAsync'
import { deleteBoardPost, getBoard, saveBoardPost } from '../services/social'
import type { BoardPost } from '../types'

const STATUS = {
  doing: { label: 'In Arbeit', icon: Hammer, tone: 'text-amber-300 border-amber-300/40 bg-amber-500/10' },
  planned: { label: 'Geplant', icon: Lightbulb, tone: 'text-accent-cyan border-accent-cyan/40 bg-accent-cyan/10' },
  done: { label: 'Fertig', icon: CheckCircle2, tone: 'text-emerald-300 border-emerald-300/40 bg-emerald-500/10' },
} as const

/** Schwarzes Brett: was im nächsten Update kommt. Alle lesen, Admins schreiben. */
export default function Board() {
  const { isAdmin } = useAuth()
  const board = useAsync(getBoard, [])
  const [edit, setEdit] = useState<BoardPost | 'new' | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [status, setStatus] = useState<BoardPost['status']>('planned')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function open(p: BoardPost | 'new') {
    setEdit(p)
    setTitle(p === 'new' ? '' : p.title)
    setBody(p === 'new' ? '' : p.body)
    setStatus(p === 'new' ? 'planned' : p.status)
    setError(null)
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await saveBoardPost(edit === 'new' || edit === null ? null : edit.id, title, body, status)
      setEdit(null)
      board.reload()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Neuigkeiten"
        title="Schwarzes Brett"
        actions={isAdmin ? <Button variant="secondary" onClick={() => open('new')}><Plus size={16} /> Eintrag</Button> : undefined}
      />
      <p className="mb-5 max-w-2xl text-sm text-slate-400">Hier steht, was als Nächstes kommt: was gerade gebaut wird, was geplant ist und was schon fertig ist.</p>
      {board.loading && !board.data && <Spinner />}
      {board.error && <ErrorBox message={board.error} onRetry={board.reload} />}
      {board.data?.length === 0 && <EmptyState title="Noch nichts angeschlagen" text={isAdmin ? 'Mit „Eintrag“ schreibst du das Erste.' : 'Schau später noch einmal vorbei.'} />}
      <div className="space-y-3">
        {board.data?.map((p) => {
          const st = STATUS[p.status]
          const Icon = st.icon
          return (
            <Card key={p.id} className={`space-y-2 ${p.status === 'done' ? 'opacity-75' : ''}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h2 className="text-lg font-semibold">{p.title}</h2>
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${st.tone}`}><Icon size={13} /> {st.label}</span>
              </div>
              {p.body && <p className="whitespace-pre-wrap text-sm text-slate-300">{p.body}</p>}
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-slate-500">Stand {formatDate(p.updated_at)}</p>
                {isAdmin && (
                  <div className="flex gap-1">
                    <button type="button" aria-label="Bearbeiten" className="flex min-h-[40px] w-10 items-center justify-center rounded-lg text-slate-400 hover:text-white" onClick={() => open(p)}><Pencil size={16} /></button>
                    <button
                      type="button"
                      aria-label="Löschen"
                      className="flex min-h-[40px] w-10 items-center justify-center rounded-lg text-slate-400 hover:text-rose-300"
                      onClick={() => { if (window.confirm('Eintrag löschen?')) void deleteBoardPost(p.id).then(board.reload).catch((e) => setError(errorMessage(e))) }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}
              </div>
            </Card>
          )
        })}
      </div>
      {error && !edit && <div className="mt-3"><ErrorBox message={error} /></div>}

      {edit && (
        <Modal title={edit === 'new' ? 'Neuer Eintrag' : 'Eintrag bearbeiten'} onClose={() => setEdit(null)}>
          <div className="space-y-4">
            <Field label="Titel"><TextInput value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></Field>
            <Field label="Beschreibung (optional)"><TextArea value={body} rows={4} maxLength={2000} onChange={(e) => setBody(e.target.value)} /></Field>
            <Field label="Status">
              <Select value={status} onChange={(e) => setStatus(e.target.value as BoardPost['status'])}>
                <option value="planned">Geplant</option>
                <option value="doing">In Arbeit</option>
                <option value="done">Fertig</option>
              </Select>
            </Field>
            {error && <ErrorBox message={error} />}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEdit(null)}>Abbrechen</Button>
              <Button busy={busy} disabled={!title.trim()} onClick={() => void save()}>Speichern</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
