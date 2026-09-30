import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FileUp } from 'lucide-react'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import { Field, TextInput } from '../components/ui/Field'
import PageHeader from '../components/ui/PageHeader'
import { ErrorBox, Notice } from '../components/ui/States'
import { validateBookExport, type ExportSummary } from '../features/books/exportFormat'
import { errorMessage } from '../lib/errors'
import { useAsync } from '../lib/useAsync'
import { listLanguages } from '../services/books'
import { importBook } from '../services/exchange'
import type { BookExport } from '../types'

const MAX_FILE_BYTES = 10 * 1024 * 1024

export default function ImportBook() {
  const navigate = useNavigate()
  const languages = useAsync(listLanguages, [])
  const fileInput = useRef<HTMLInputElement>(null)
  const [data, setData] = useState<BookExport | null>(null)
  const [summary, setSummary] = useState<ExportSummary | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  async function onFile(file: File | undefined) {
    setData(null)
    setSummary(null)
    setErrors([])
    setFailure(null)
    if (!file) return
    if (file.size > MAX_FILE_BYTES) return setErrors(['Die Datei ist zu groß (maximal 10 MB).'])
    let parsed: unknown
    try {
      parsed = JSON.parse(await file.text())
    } catch {
      return setErrors(['Die Datei ist kein gültiges JSON.'])
    }
    const result = validateBookExport(parsed, (languages.data ?? []).map((l) => l.code))
    if (!result.ok) return setErrors(result.errors)
    setData(result.data)
    setSummary(result.summary)
    setName(result.summary.name)
  }

  async function doImport() {
    if (!data) return
    setBusy(true)
    setFailure(null)
    try {
      const id = await importBook(data, name.trim() || null)
      navigate(`/buecher/${id}`)
    } catch (e) {
      setFailure(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader eyebrow="Bibliothek" title="Buch importieren" />
      <div className="max-w-2xl space-y-4">
        <Card className="space-y-4">
          <p className="text-sm text-slate-300">
            Wähle eine zuvor exportierte Datei (<code className="font-mono text-accent-cyan">.vokabeltrainer.json</code>). Es werden nur Buchinhalte importiert – kein Lernfortschritt und keine Konten.
          </p>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          <Button variant="secondary" onClick={() => fileInput.current?.click()}>
            <FileUp size={18} /> Datei auswählen
          </Button>
        </Card>

        {errors.length > 0 && (
          <Notice tone="warn">
            <p className="font-medium">Die Datei kann nicht importiert werden:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </Notice>
        )}

        {summary && (
          <Card className="space-y-4">
            <p className="label-mono">Vorschau</p>
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Stat label="Units" value={summary.unitCount} />
              <Stat label="Seiten" value={summary.pageCount} />
              <Stat label="Einträge" value={summary.entryCount} />
              <Stat label="Verschiedene Vokabeln" value={summary.distinctVocabCount} />
            </div>
            <p className="text-sm text-slate-400">
              Sprache: {languages.data?.find((l) => l.code === summary.language)?.name ?? summary.language}
            </p>
            <ul className="divide-y divide-white/5 rounded-xl border border-white/10 text-sm">
              {summary.preview.map((p, i) => (
                <li key={i} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                  <span>{p.german}</span>
                  <span className="text-slate-400">{p.translations.join(' · ')}</span>
                </li>
              ))}
            </ul>
            <Field label="Name des neuen Buchs">
              <TextInput maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            {failure && <ErrorBox message={failure} />}
            <div className="flex gap-2">
              <Button busy={busy} disabled={name.trim() === ''} onClick={() => void doImport()}>
                Jetzt importieren
              </Button>
              <Link to="/buecher" className="inline-flex min-h-[44px] items-center px-4 text-slate-400 hover:text-white">
                Abbrechen
              </Link>
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-space-900/60 p-3">
      <p className="font-mono text-2xl text-accent-cyan">{value}</p>
      <p className="text-xs text-slate-400">{label}</p>
    </div>
  )
}
