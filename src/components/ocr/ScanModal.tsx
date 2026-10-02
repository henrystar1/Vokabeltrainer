import { useRef, useState } from 'react'
import { Camera, Plus, Trash2 } from 'lucide-react'
import AccentBar from '../ui/AccentBar'
import Button from '../ui/Button'
import { TextInput, inputClass } from '../ui/Field'
import Modal from '../ui/Modal'
import ProgressBar from '../ui/ProgressBar'
import { ErrorBox, Notice } from '../ui/States'
import { cleanList, toSavePayload } from '../../features/entry/rows'
import { scanPage } from '../../features/ocr/pipeline'
import type { ParsedPage } from '../../features/ocr/types'
import { errorMessage } from '../../lib/errors'
import { saveEntry } from '../../services/entry'

interface ReviewRow {
  key: number
  foreign: string
  german: string
  uncertain: boolean
  notes: string[]
}

const join = (list: string[]): string => list.join('; ')
const split = (text: string): string[] => cleanList(text.split(/[;\n]/))

interface ScanModalProps {
  bookId: string
  language: string
  defaultUnit: number
  defaultPage: number
  onClose: () => void
  /** Nach dem Speichern: Unit/Seite, auf der die Zeilen gelandet sind. */
  onSaved: (unit: number, page: number) => void
}

type Phase = 'pick' | 'scanning' | 'review' | 'saving'

/** Foto einer Wortlisten-Seite einlesen, in Ruhe prüfen/korrigieren und dann speichern. */
export default function ScanModal({ bookId, language, defaultUnit, defaultPage, onClose, onSaved }: ScanModalProps) {
  const foreignName = language === 'en' ? 'Englisch' : 'Französisch'
  const [phase, setPhase] = useState<Phase>('pick')
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<ReviewRow[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [unit, setUnit] = useState(String(defaultUnit))
  const [page, setPage] = useState(String(defaultPage))
  const [detected, setDetected] = useState<{ unit: number | null; page: number | null }>({ unit: null, page: null })
  const [saved, setSaved] = useState(0)
  const nextKey = useRef(1)
  const fileInput = useRef<HTMLInputElement>(null)

  function toRows(parsed: ParsedPage): ReviewRow[] {
    return parsed.rows.map((r) => ({
      key: nextKey.current++,
      foreign: join(r.foreign),
      german: join(r.german),
      uncertain: r.uncertain,
      notes: r.notes,
    }))
  }

  async function onFile(file: File | undefined) {
    if (!file) return
    setError(null)
    setPhase('scanning')
    setProgress(0)
    try {
      const parsed = await scanPage(
        file,
        (p, s) => {
          setProgress(p)
          setStatus(s)
        },
        language,
      )
      setRows(toRows(parsed))
      setWarnings(parsed.warnings)
      setDetected({ unit: parsed.unit, page: parsed.page })
      if (parsed.unit !== null) setUnit(String(parsed.unit))
      if (parsed.page !== null) setPage(String(parsed.page))
      setPhase('review')
    } catch (e) {
      setError(errorMessage(e))
      setPhase('pick')
    }
    if (fileInput.current) fileInput.current.value = ''
  }

  function patch(key: number, p: Partial<ReviewRow>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p, uncertain: false } : r)))
  }

  const unitN = Number.parseInt(unit, 10)
  const pageN = Number.parseInt(page, 10)
  const validTarget = Number.isInteger(unitN) && unitN >= 0 && Number.isInteger(pageN) && pageN >= 1
  const usable = rows.filter((r) => split(r.foreign).length > 0 && split(r.german).length > 0)
  const incomplete = rows.length - usable.length

  async function saveAll() {
    setError(null)
    setPhase('saving')
    setSaved(0)
    let done = 0
    const remaining: ReviewRow[] = []
    let failure: string | null = null
    for (const r of rows) {
      const complete = split(r.foreign).length > 0 && split(r.german).length > 0
      if (!complete) {
        remaining.push(r)
        continue
      }
      if (failure) {
        remaining.push(r)
        continue
      }
      try {
        const payload = toSavePayload({ foreign: split(r.foreign), german: split(r.german) })
        await saveEntry({ bookId, unit: unitN, page: pageN, placementId: null, position: null, ...payload })
        done++
        setSaved(done)
      } catch (e) {
        failure = errorMessage(e)
        remaining.push(r)
      }
    }
    if (failure) {
      setRows(remaining)
      setError(`Gespeichert: ${done}. Dann ist ein Fehler aufgetreten: ${failure} Die übrigen Zeilen stehen noch in der Liste.`)
      setPhase('review')
      return
    }
    if (remaining.length > 0) {
      setRows(remaining)
      setError(`${done} Zeilen gespeichert. ${remaining.length} unvollständige Zeile(n) bleiben zur Korrektur stehen.`)
      setPhase('review')
      return
    }
    onSaved(unitN, pageN)
  }

  return (
    <Modal title="Seite per Foto einlesen" onClose={phase === 'scanning' || phase === 'saving' ? () => undefined : onClose} wide>
      {phase === 'pick' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-300">
            Fotografiere die Wortliste-Seite des Buchs möglichst gerade und gut beleuchtet. Gelesen werden {foreignName} und
            Deutsch; die Beispielsätze und die blauen Kästen werden ausgelassen.
          </p>
          {language !== 'fr' && (
            <Notice tone="warn">
              Die Erkennung ist auf das französische Buch abgestimmt. Bei englischen Büchern klappt sie, wenn das Layout ähnlich ist
              (Wort links, Deutsch rechts) – prüfe das Ergebnis bitte besonders genau.
            </Notice>
          )}
          <Notice tone="info">
            Das Foto wird nur auf deinem Gerät ausgewertet und <strong>nicht gespeichert oder hochgeladen</strong>. Die Texterkennung ist
            kostenlos und braucht keinen Schlüssel – sie ist aber nicht perfekt, darum prüfst du das Ergebnis vor dem Speichern.
          </Notice>
          {error && <ErrorBox message={error} />}
          <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
          <Button className="w-full min-h-[52px]" onClick={() => fileInput.current?.click()}>
            <Camera size={18} /> Foto aufnehmen oder auswählen
          </Button>
        </div>
      )}

      {phase === 'scanning' && (
        <div className="space-y-4 py-6 text-center">
          <p className="text-slate-200">{status || 'Bild wird aufbereitet …'}</p>
          <ProgressBar value={progress * 100} label="Fortschritt der Texterkennung" />
          <p className="text-xs text-slate-500">Das dauert beim ersten Mal etwas länger (Sprachdaten werden geladen).</p>
        </div>
      )}

      {(phase === 'review' || phase === 'saving') && (
        <div className="space-y-4">
          {warnings.map((w) => (
            <Notice key={w} tone="warn">{w}</Notice>
          ))}
          {error && <ErrorBox message={error} />}

          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1.5">
              <span className="label-mono">Unit {detected.unit === null && '(nicht erkannt)'}</span>
              <TextInput inputMode="numeric" value={unit} onChange={(e) => setUnit(e.target.value)} />
            </label>
            <label className="block space-y-1.5">
              <span className="label-mono">Seite {detected.page === null && '(nicht erkannt)'}</span>
              <TextInput inputMode="numeric" value={page} onChange={(e) => setPage(e.target.value)} />
            </label>
          </div>

          <p className="text-xs text-slate-400">
            {rows.length} Zeilen erkannt. Mehrere Lösungen trennst du mit einem Semikolon (<code>;</code>). Gelb markierte Zeilen bitte
            besonders prüfen.
          </p>

          <div className="max-h-[45vh] space-y-2 overflow-y-auto pr-1">
            {rows.map((r, i) => (
              <div key={r.key} className={`rounded-xl border p-2 ${r.uncertain ? 'border-amber-400/50 bg-amber-400/5' : 'border-white/10'}`}>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
                  <input
                    aria-label={`Fremdsprache, Zeile ${i + 1}`}
                    className={inputClass}
                    value={r.foreign}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    onChange={(e) => patch(r.key, { foreign: e.target.value })}
                  />
                  <input
                    aria-label={`Deutsch, Zeile ${i + 1}`}
                    className={inputClass}
                    value={r.german}
                    autoCorrect="off"
                    spellCheck={false}
                    onChange={(e) => patch(r.key, { german: e.target.value })}
                  />
                  <button
                    type="button"
                    aria-label={`Zeile ${i + 1} entfernen`}
                    onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                    className="flex min-h-[44px] w-11 items-center justify-center rounded-lg text-slate-500 hover:text-rose-300"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                {r.uncertain && <p className="mt-1 px-1 text-xs text-amber-300">{r.notes.join(' · ')}</p>}
              </div>
            ))}
            <button
              type="button"
              onClick={() => setRows((rs) => [...rs, { key: nextKey.current++, foreign: '', german: '', uncertain: false, notes: [] }])}
              className="inline-flex min-h-[44px] items-center gap-1 px-2 text-sm text-slate-400 hover:text-accent-cyan"
            >
              <Plus size={14} /> Zeile hinzufügen
            </button>
          </div>

          {language === 'fr' && <AccentBar />}

          {incomplete > 0 && <p className="text-xs text-amber-300">{incomplete} Zeile(n) ohne {foreignName} oder Deutsch werden nicht gespeichert.</p>}

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={phase === 'saving'}>
              Abbrechen
            </Button>
            <Button variant="secondary" disabled={phase === 'saving'} onClick={() => { setRows([]); setPhase('pick') }}>
              Anderes Foto
            </Button>
            <Button busy={phase === 'saving'} disabled={!validTarget || usable.length === 0} onClick={() => void saveAll()}>
              {phase === 'saving' ? `Speichert … ${saved}/${usable.length}` : `${usable.length} Zeilen speichern`}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
