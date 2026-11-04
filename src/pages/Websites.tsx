import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { normKey } from '../lib/chatLinks'
import { ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import { Field, TextInput } from '../components/ui/Field'
import Modal from '../components/ui/Modal'
import PageHeader from '../components/ui/PageHeader'
import { EmptyState, ErrorBox, Spinner } from '../components/ui/States'
import { useAuth } from '../features/auth/AuthProvider'
import { errorMessage } from '../lib/errors'
import { useAsync } from '../lib/useAsync'
import { siteLinkDelete, siteLinkSave, siteLinksList, type SiteLink } from '../services/tasks'

/** Vorschaufenster: ein Bild, wenn eines angegeben ist, sonst die Seite selbst verkleinert (nicht bedienbar). */
function Preview({ s }: { s: SiteLink }) {
  return (
    <div className="relative aspect-[16/10] w-full overflow-hidden rounded-xl border border-white/10 bg-space-900">
      {s.image_url ? (
        <img src={s.image_url} alt="" loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <iframe
          src={s.url}
          title={`Vorschau ${s.title}`}
          loading="lazy"
          tabIndex={-1}
          aria-hidden="true"
          sandbox="allow-scripts allow-same-origin"
          referrerPolicy="no-referrer"
          className="pointer-events-none absolute left-0 top-0 h-[400%] w-[400%] origin-top-left scale-[0.25] border-0 bg-white"
        />
      )}
    </div>
  )
}

/** Meine Websites: Karten mit Vorschau, ein Klick öffnet die Seite. Admins pflegen die Liste. */
export default function WebsitesPage() {
  const { isAdmin } = useAuth()
  const list = useAsync(siteLinksList, [])
  const [params] = useSearchParams()
  const wanted = params.get('site') // aus einem Chat-Link (#Websites/Name)
  const [lit, setLit] = useState<string | null>(null)
  useEffect(() => {
    if (!wanted || !list.data) return
    const k = normKey(wanted)
    const hit = list.data.find((s) => normKey(s.title) === k) ?? list.data.find((s) => normKey(s.title).includes(k))
    if (!hit) return
    setLit(hit.id)
    window.requestAnimationFrame(() => document.getElementById(`site-${hit.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
  }, [wanted, list.data])
  const [edit, setEdit] = useState<SiteLink | 'new' | null>(null)
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [desc, setDesc] = useState('')
  const [image, setImage] = useState('')
  const [sort, setSort] = useState('0')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function open(s: SiteLink | 'new') {
    setEdit(s)
    setTitle(s === 'new' ? '' : s.title)
    setUrl(s === 'new' ? 'https://' : s.url)
    setDesc(s === 'new' ? '' : s.description)
    setImage(s === 'new' ? '' : s.image_url)
    setSort(s === 'new' ? String((list.data?.length ?? 0) * 10 + 10) : String(s.sort))
    setError(null)
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await siteLinkSave(edit === 'new' || edit === null ? null : edit.id, title, url, desc, image, Number.parseInt(sort, 10) || 0)
      setEdit(null)
      list.reload()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader eyebrow="Mehr entdecken" title="Websites" actions={isAdmin ? <Button variant="secondary" onClick={() => open('new')}><Plus size={16} /> Website</Button> : undefined} />
      <p className="mb-5 max-w-2xl text-sm text-slate-400">Weitere Seiten und Spiele. Ein Klick öffnet sie in einem neuen Tab.</p>
      {list.loading && !list.data && <Spinner />}
      {list.error && <ErrorBox message={list.error} onRetry={list.reload} />}
      {error && !edit && <ErrorBox message={error} />}
      {list.data?.length === 0 && <EmptyState title="Noch keine Websites" text={isAdmin ? 'Mit „Website“ fügst du die erste hinzu.' : 'Hier kommt bald etwas.'} />}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {list.data?.map((s) => (
          <Card key={s.id} interactive className={`relative space-y-3 !p-3 ${lit === s.id ? 'ring-2 ring-accent-cyan' : ''}`} id={`site-${s.id}`}>
            <a href={s.url} target="_blank" rel="noopener noreferrer" className="block space-y-3" aria-label={`${s.title} öffnen`}>
              <Preview s={s} />
              <div className="px-1">
                <h2 className="flex items-center gap-2 text-lg font-semibold">{s.title} <ExternalLink size={14} className="text-slate-500" /></h2>
                {s.description && <p className="mt-1 text-sm text-slate-400">{s.description}</p>}
              </div>
            </a>
            {isAdmin && (
              <div className="flex justify-end gap-1">
                <button type="button" aria-label="Bearbeiten" className="flex min-h-[40px] w-10 items-center justify-center rounded-lg text-slate-400 hover:text-white" onClick={() => open(s)}><Pencil size={16} /></button>
                <button type="button" aria-label="Löschen" className="flex min-h-[40px] w-10 items-center justify-center rounded-lg text-slate-400 hover:text-rose-300" onClick={() => { if (window.confirm('Website entfernen?')) void siteLinkDelete(s.id).then(list.reload).catch((e) => setError(errorMessage(e))) }}><Trash2 size={16} /></button>
              </div>
            )}
          </Card>
        ))}
      </div>
      {edit && (
        <Modal title={edit === 'new' ? 'Website hinzufügen' : 'Website bearbeiten'} onClose={() => setEdit(null)}>
          <div className="space-y-3">
            <Field label="Name"><TextInput value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} /></Field>
            <Field label="Adresse" hint="Muss mit https:// beginnen."><TextInput value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" maxLength={500} /></Field>
            <Field label="Beschreibung (optional)"><TextInput value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={300} /></Field>
            <Field label="Vorschaubild (optional)" hint="Adresse eines Bildes. Leer = die Seite selbst wird verkleinert gezeigt (geht nur, wenn sie das erlaubt)."><TextInput value={image} onChange={(e) => setImage(e.target.value)} inputMode="url" maxLength={500} /></Field>
            <Field label="Reihenfolge" hint="Kleine Zahl = weiter vorn."><TextInput value={sort} onChange={(e) => setSort(e.target.value.replace(/[^\d-]/g, ''))} inputMode="numeric" /></Field>
            {error && <ErrorBox message={error} />}
            <Button busy={busy} disabled={title.trim() === '' || !/^https?:\/\//i.test(url.trim())} onClick={() => void save()}>Speichern</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
