import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Brain, ClipboardCheck, Download, Eye, Globe, Lock, Pencil, Plus, Trash2 } from 'lucide-react'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import { Field, Select, TextArea, TextInput } from '../components/ui/Field'
import Modal from '../components/ui/Modal'
import PageHeader from '../components/ui/PageHeader'
import { EmptyState, ErrorBox, Notice, Spinner } from '../components/ui/States'
import { useAuth } from '../features/auth/AuthProvider'
import { exportFileName } from '../features/books/exportFormat'
import { errorMessage } from '../lib/errors'
import { useAsync } from '../lib/useAsync'
import { adminDeleteBook } from '../services/admin'
import { deleteBook, deletePage, deleteUnit, getBook, getOutline, listBooks, listLanguages, updateBook } from '../services/books'
import { addToLibrary, publishBook, unpublishBook } from '../services/community'
import { exportBook } from '../services/exchange'

type Confirm =
  | { kind: 'page'; n: number }
  | { kind: 'unit'; n: number }
  | { kind: 'book' }
  | { kind: 'unpublish' }
  | { kind: 'publish' }
  | null

export default function BookDetail() {
  const { bookId = '' } = useParams()
  const navigate = useNavigate()
  const { user, isStaff, isAdmin } = useAuth()
  const book = useAsync(() => getBook(bookId), [bookId])
  const outline = useAsync(() => getOutline(bookId), [bookId])
  const library = useAsync(listBooks, [])
  const languages = useAsync(listLanguages, [])
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function runConfirm() {
    if (!confirm) return
    setBusy(true)
    setError(null)
    try {
      if (confirm.kind === 'page') await deletePage(bookId, confirm.n)
      if (confirm.kind === 'unit') await deleteUnit(bookId, confirm.n)
      if (confirm.kind === 'book') {
        await (book.data?.is_public ? adminDeleteBook(bookId) : deleteBook(bookId))
        navigate('/buecher', { replace: true })
        return
      }
      if (confirm.kind === 'publish') await publishBook(bookId)
      if (confirm.kind === 'unpublish') await unpublishBook(bookId)
      setConfirm(null)
      if (confirm.kind === 'publish' || confirm.kind === 'unpublish') {
        book.reload()
        library.reload()
        return
      }
      outline.reload()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function doExport() {
    setError(null)
    try {
      const data = await exportBook(bookId)
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = exportFileName(book.data?.name ?? 'buch')
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  if (book.loading && !book.data) return <Spinner />
  if (book.error) return <ErrorBox message={book.error} onRetry={book.reload} />
  if (!book.data) return <EmptyState title="Buch nicht gefunden" action={<Link to="/buecher" className="btn-primary">Zu den Büchern</Link>} />

  const isPublic = book.data.is_public
  const isOwner = book.data.owner_id === user?.id
  // Öffentliche Bücher dürfen nur Mods/Admins ändern, eigene private Bücher der Besitzer.
  const canEdit = isPublic ? isStaff : true
  const canDelete = isPublic ? isAdmin : true
  const canPublish = !isPublic && isStaff && isOwner
  const canUnpublish = isPublic && (isAdmin || (isStaff && isOwner))
  const inLibrary = library.data?.some((b) => b.id === bookId) ?? false

  async function useBook() {
    setBusy(true)
    setError(null)
    try {
      await addToLibrary(bookId)
      library.reload()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const units = outline.data ?? []
  const lastUnit = units.reduce((m, u) => Math.max(m, u.unit_number), 0)
  const lastPage = units.flatMap((u) => u.pages).reduce((m, p) => Math.max(m, p.page_number), 0)

  return (
    <div>
      <PageHeader
        eyebrow="Buch"
        title={book.data.name}
        actions={
          inLibrary ? (
            <>
              <Link to={`/lernen?buch=${bookId}`} className="btn-primary">
                <Brain size={18} /> Lernen
              </Link>
              <Link to={`/test?buch=${bookId}`} className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-5 font-medium hover:bg-white/10">
                <ClipboardCheck size={18} /> Test
              </Link>
            </>
          ) : (
            isPublic && (
              <Button busy={busy} onClick={() => void useBook()}>
                <Plus size={18} /> Dieses Buch verwenden
              </Button>
            )
          )
        }
      />
      {isPublic && (
        <div className="mb-4">
          <Notice tone="info">
            <span className="inline-flex items-center gap-2">
              <Globe size={15} /> Online-Buch.
            </span>{' '}
            {canEdit
              ? 'Du kannst die Vokabeln als Mod/Admin ändern – alle Nutzer sehen die Änderung sofort.'
              : 'Die Vokabeln sind vorgegeben. Fehler kannst du bei einer Seite zur Prüfung melden. Dein Lernfortschritt gehört dir allein.'}
          </Notice>
        </div>
      )}
      {book.data.description && <p className="-mt-3 mb-6 text-slate-400">{book.data.description}</p>}
      {error && <div className="mb-4"><ErrorBox message={error} /></div>}

      <div className="mb-6 flex flex-wrap gap-2">
        {canEdit && (
          <Link
            to={`/buecher/${bookId}/eingabe?unit=${lastUnit || 1}&seite=${lastPage ? lastPage : 1}`}
            className="btn-primary"
          >
            <Plus size={18} /> Vokabeln eingeben
          </Link>
        )}
        {canEdit && (
          <Button variant="secondary" onClick={() => setEditing(true)}>
            <Pencil size={16} /> Bearbeiten
          </Button>
        )}
        <Button variant="secondary" onClick={() => void doExport()}>
          <Download size={16} /> Export
        </Button>
        {canPublish && (
          <Button variant="secondary" onClick={() => setConfirm({ kind: 'publish' })}>
            <Globe size={16} /> Veröffentlichen
          </Button>
        )}
        {canUnpublish && (
          <Button variant="secondary" onClick={() => setConfirm({ kind: 'unpublish' })}>
            <Lock size={16} /> Zurücknehmen
          </Button>
        )}
        {canDelete && (
          <Button variant="danger" onClick={() => setConfirm({ kind: 'book' })}>
            <Trash2 size={16} /> Buch löschen
          </Button>
        )}
      </div>

      {outline.loading && !outline.data && <Spinner />}
      {outline.error && <ErrorBox message={outline.error} onRetry={outline.reload} />}
      {outline.data && units.length === 0 && (
        <EmptyState title="Noch keine Vokabeln" text="Beginne mit Unit 1 und der ersten Seite." />
      )}

      <div className="space-y-4">
        {units.map((u) => (
          <Card key={u.unit_id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">
                Unit {u.unit_number}
                {u.name ? ` – ${u.name}` : ''}
              </h2>
              {canEdit && (
                <Button variant="ghost" className="text-rose-300" onClick={() => setConfirm({ kind: 'unit', n: u.unit_number })}>
                  <Trash2 size={15} /> Unit löschen
                </Button>
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {u.pages.map((p) => (
                <div key={p.page_id} className="flex items-center overflow-hidden rounded-xl border border-white/10 bg-space-900/60">
                  <Link
                    to={`/buecher/${bookId}/eingabe?unit=${u.unit_number}&seite=${p.page_number}`}
                    className="flex min-h-[44px] items-center gap-2 px-3 text-sm hover:bg-white/5"
                  >
                    {!canEdit && <Eye size={14} className="text-slate-500" />}
                    Seite {p.page_number}
                    <span className="font-mono text-xs text-accent-cyan">{p.vocab_count}</span>
                  </Link>
                  {canEdit && (
                    <button
                      aria-label={`Seite ${p.page_number} löschen`}
                      onClick={() => setConfirm({ kind: 'page', n: p.page_number })}
                      className="flex min-h-[44px] w-10 items-center justify-center border-l border-white/10 text-slate-500 hover:text-rose-300"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
              {canEdit && (
                <Link
                  to={`/buecher/${bookId}/eingabe?unit=${u.unit_number}&seite=${(u.pages.at(-1)?.page_number ?? lastPage) + 1}`}
                  className="flex min-h-[44px] items-center gap-1 rounded-xl border border-dashed border-white/20 px-3 text-sm text-slate-400 hover:text-accent-cyan"
                >
                  <Plus size={14} /> Seite
                </Link>
              )}
            </div>
          </Card>
        ))}
      </div>

      {confirm && (
        <Modal title={confirm.kind === 'publish' ? 'Buch veröffentlichen?' : confirm.kind === 'unpublish' ? 'Buch zurücknehmen?' : 'Wirklich löschen?'} onClose={() => setConfirm(null)}>
          <Notice tone="warn">
            {confirm.kind === 'publish' &&
              'Das Buch wird für alle Nutzer unter „Online“ sichtbar. Danach können nur noch Mods und Admins die Vokabeln ändern. Nutzer behalten ihren eigenen Lernfortschritt.'}
            {confirm.kind === 'unpublish' &&
              'Das Buch wird wieder privat und verschwindet bei allen anderen Nutzern. Ihr Lernfortschritt bleibt gespeichert und ist wieder da, falls du es erneut veröffentlichst.'}
            {confirm.kind === 'book' && isPublic && 'Das öffentliche Buch wird für ALLE Nutzer endgültig gelöscht, samt aller Vokabeln und deren Lernfortschritt.'}
            {confirm.kind === 'book' && !isPublic && 'Das Buch mit allen Units, Seiten, Vokabeln und deinem Lernfortschritt dazu wird endgültig gelöscht.'}
            {confirm.kind === 'unit' && `Unit ${confirm.n} mit allen Seiten und Vokabeln wird gelöscht. Vokabeln, die nur dort vorkamen, verschwinden samt Lernstand.`}
            {confirm.kind === 'page' && `Seite ${confirm.n} mit allen Einträgen wird gelöscht. Vokabeln, die nur dort vorkamen, verschwinden samt Lernstand.`}
          </Notice>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Abbrechen
            </Button>
            <Button
              variant={confirm.kind === 'publish' || confirm.kind === 'unpublish' ? 'primary' : 'danger'}
              busy={busy}
              onClick={() => void runConfirm()}
            >
              {confirm.kind === 'publish' ? 'Veröffentlichen' : confirm.kind === 'unpublish' ? 'Zurücknehmen' : 'Endgültig löschen'}
            </Button>
          </div>
        </Modal>
      )}
      {editing && (
        <EditBookModal
          bookId={bookId}
          name={book.data.name}
          description={book.data.description ?? ''}
          language={book.data.language}
          languages={languages.data ?? []}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false)
            book.reload()
          }}
        />
      )}
    </div>
  )
}

function EditBookModal(props: {
  bookId: string
  name: string
  description: string
  language: string
  languages: { code: string; name: string }[]
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(props.name)
  const [description, setDescription] = useState(props.description)
  const [language, setLanguage] = useState(props.language)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (name.trim() === '') return setError('Bitte einen Namen eingeben.')
    setBusy(true)
    try {
      await updateBook(props.bookId, name, description, language)
      props.onSaved()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }
  return (
    <Modal title="Buch bearbeiten" onClose={props.onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name">
          <TextInput maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field
          label="Sprache"
          hint="Die Vokabeln bleiben unverändert – nur die Sprache des Buchs wird umgestellt (z. B. wenn du es versehentlich als Englisch angelegt hast)."
        >
          <Select value={language} onChange={(e) => setLanguage(e.target.value)}>
            {props.languages.map((l) => (
              <option key={l.code} value={l.code}>{l.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Beschreibung">
          <TextArea maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {error && <ErrorBox message={error} />}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={props.onClose}>Abbrechen</Button>
          <Button type="submit" busy={busy}>Speichern</Button>
        </div>
      </form>
    </Modal>
  )
}
