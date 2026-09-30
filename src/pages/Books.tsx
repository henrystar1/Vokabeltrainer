import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BookOpen, Brain, Plus, Upload } from 'lucide-react'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import { Field, Select, TextArea, TextInput } from '../components/ui/Field'
import Modal from '../components/ui/Modal'
import PageHeader from '../components/ui/PageHeader'
import ProgressBar from '../components/ui/ProgressBar'
import { EmptyState, ErrorBox, Spinner } from '../components/ui/States'
import { errorMessage } from '../lib/errors'
import { useAsync } from '../lib/useAsync'
import { createBook, listBooks, listLanguages } from '../services/books'
import { useSettings } from '../features/settings/SettingsProvider'

export default function Books() {
  const books = useAsync(listBooks, [])
  const languages = useAsync(listLanguages, [])
  const [creating, setCreating] = useState(false)
  const langName = (code: string) => languages.data?.find((l) => l.code === code)?.name ?? code

  return (
    <div>
      <PageHeader
        eyebrow="Bibliothek"
        title="Bücher"
        actions={
          <>
            <Link to="/buecher/import" className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-5 font-medium hover:bg-white/10">
              <Upload size={16} /> Import
            </Link>
            <Button onClick={() => setCreating(true)}>
              <Plus size={18} /> Neues Buch
            </Button>
          </>
        }
      />

      {books.loading && !books.data && <Spinner />}
      {books.error && <ErrorBox message={books.error} onRetry={books.reload} />}
      {books.data && books.data.length === 0 && (
        <EmptyState
          title="Noch kein Buch"
          text="Lege dein erstes Schulbuch an und trage die Vokabeln Seite für Seite ein – oder importiere eine Datei."
          action={<Button onClick={() => setCreating(true)}>Erstes Buch anlegen</Button>}
        />
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {books.data?.map((b) => (
          <Card key={b.id} interactive className="flex flex-col">
            <Link to={`/buecher/${b.id}`} className="flex-1">
              <div className="flex items-start justify-between gap-3">
                <BookOpen className="text-accent-violet" size={24} />
                <span className="label-mono">{langName(b.language)}</span>
              </div>
              <h2 className="mt-4 text-xl font-semibold">{b.name}</h2>
              <p className="mt-1 text-sm text-slate-400">
                {b.vocab_count} Vokabeln · {b.unit_count} Units · {b.page_count} Seiten
              </p>
              <div className="mt-4 space-y-1.5">
                <div className="flex justify-between text-xs text-slate-400">
                  <span>Gelernt</span>
                  <span className="font-mono text-accent-cyan">{Math.round(b.mastery_percent)}%</span>
                </div>
                <ProgressBar value={b.mastery_percent} label={`Fortschritt ${b.name}`} />
              </div>
            </Link>
            <Link to={`/lernen?buch=${b.id}`} className="btn-primary mt-5 w-full">
              <Brain size={18} /> Lernen
            </Link>
          </Card>
        ))}
      </div>

      {creating && <CreateBookModal onClose={() => setCreating(false)} languages={languages.data ?? []} />}
    </div>
  )
}

function CreateBookModal({ onClose, languages }: { onClose: () => void; languages: { code: string; name: string }[] }) {
  const navigate = useNavigate()
  const { settings } = useSettings()
  const [name, setName] = useState('')
  const [language, setLanguage] = useState(settings.learn_language)
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (name.trim() === '') return setError('Bitte einen Namen eingeben.')
    setBusy(true)
    setError(null)
    try {
      const id = await createBook(name, language, description)
      navigate(`/buecher/${id}`)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Modal title="Neues Buch" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name">
          <TextInput autoFocus maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Green Line 3" />
        </Field>
        <Field label="Sprache">
          <Select value={language} onChange={(e) => setLanguage(e.target.value)}>
            {languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Beschreibung (optional)">
          <TextArea maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {error && <ErrorBox message={error} />}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button type="submit" busy={busy}>
            Anlegen
          </Button>
        </div>
      </form>
    </Modal>
  )
}
