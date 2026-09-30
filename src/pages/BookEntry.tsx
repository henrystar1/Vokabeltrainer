import { useCallback, useEffect, useRef, useState, type FocusEvent, type FormEvent, type KeyboardEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AlertCircle, ArrowLeft, Check, ChevronRight, Loader2, Plus, Trash2 } from 'lucide-react'
import Button from '../components/ui/Button'
import { inputClass } from '../components/ui/Field'
import { ErrorBox, Notice, Spinner } from '../components/ui/States'
import {
  cleanTranslations,
  emptyRow,
  isRowComplete,
  isRowDirty,
  rowSnapshot,
  rowsFromEntries,
  type EntryRow,
} from '../features/entry/rows'
import { errorHint, errorMessage } from '../lib/errors'
import { deleteEntry, getPage, saveEntry } from '../services/entry'
import { getBook, movePageToUnit } from '../services/books'

const posInt = (v: string | null, fallback: number, min: number) => {
  const n = Number.parseInt(v ?? '', 10)
  return Number.isInteger(n) && n >= min ? n : fallback
}

/** Tabellarische Eingabe im Stil einer Vokabelkartei: links Deutsch, rechts eine oder mehrere Lösungen. */
export default function BookEntry() {
  const { bookId = '' } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const unit = posInt(params.get('unit'), 1, 0)
  const page = posInt(params.get('seite'), 1, 1)

  const [bookName, setBookName] = useState('')
  const [rows, setRows] = useState<EntryRow[]>([emptyRow()])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pageUnit, setPageUnit] = useState<number | null>(null)
  const [conflict, setConflict] = useState<number | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [unitInput, setUnitInput] = useState(String(unit))
  const [pageInput, setPageInput] = useState(String(page))

  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const saving = useRef(new Set<string>())
  const pending = useRef(new Set<Promise<void>>())
  const generation = useRef(0)

  const patchRow = useCallback((key: string, patch: Partial<EntryRow> | ((r: EntryRow) => Partial<EntryRow>)) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...(typeof patch === 'function' ? patch(r) : patch) } : r)))
  }, [])

  useEffect(() => {
    getBook(bookId).then((b) => setBookName(b?.name ?? '')).catch(() => undefined)
  }, [bookId])

  useEffect(() => {
    setUnitInput(String(unit))
    setPageInput(String(page))
  }, [unit, page])

  // Seite laden
  useEffect(() => {
    const gen = ++generation.current
    setLoading(true)
    setLoadError(null)
    setConflict(null)
    setConfirmDelete(null)
    getPage(bookId, page).then(
      (data) => {
        if (gen !== generation.current) return
        const loaded = rowsFromEntries(data.entries)
        setRows([...loaded, emptyRow()])
        setPageUnit(data.page?.unit_number ?? null)
        if (data.page && data.page.unit_number !== unit) setConflict(data.page.unit_number)
        setLoading(false)
      },
      (e) => {
        if (gen !== generation.current) return
        setLoadError(errorMessage(e))
        setLoading(false)
      },
    )
  }, [bookId, page, unit])

  const focusField = useCallback((key: string, field: string) => {
    requestAnimationFrame(() => {
      document.querySelector<HTMLInputElement>(`[data-row="${key}"][data-field="${field}"]`)?.focus()
    })
  }, [])

  const saveRow = useCallback(
    async (key: string): Promise<void> => {
      if (conflict !== null) return
      if (saving.current.has(key)) return
      const row = rowsRef.current.find((r) => r.key === key)
      if (!row || !isRowDirty(row)) return
      if (!isRowComplete(row)) {
        if (row.german.trim() !== '' || cleanTranslations(row.translations).length > 0) {
          patchRow(key, { status: 'error', error: 'Deutsch und mindestens eine Lösung ausfüllen.' })
        }
        return
      }
      saving.current.add(key)
      patchRow(key, { status: 'saving', error: undefined })
      const gen = generation.current
      const snapshotAtSave = rowSnapshot(row)
      const job = (async () => {
        try {
          const res = await saveEntry({
            bookId,
            unit,
            page,
            placementId: row.placementId,
            german: row.german,
            translations: cleanTranslations(row.translations),
            position: row.placementId ? row.position : null,
          })
          if (gen !== generation.current) return
          setRows((rs) => {
            const duplicate = rs.some((r) => r.key !== key && r.placementId === res.placement_id)
            if (duplicate) return rs.filter((r) => r.key !== key)
            return rs.map((r) => {
              if (r.key !== key) return r
              const stillSame = rowSnapshot(r) === snapshotAtSave
              const updated: EntryRow = {
                ...r,
                placementId: res.placement_id,
                vocabularyId: res.vocabulary_id,
                position: res.position,
                merged: res.merged,
                status: stillSame ? 'saved' : 'dirty',
                error: undefined,
              }
              if (stillSame) {
                updated.german = res.german
                updated.translations = res.translations.length > 0 ? res.translations : r.translations
              }
              updated.savedSnapshot = stillSame
                ? rowSnapshot(updated)
                : JSON.stringify({ g: row.german.trim(), t: cleanTranslations(row.translations) })
              return updated
            })
          })
        } catch (e) {
          if (gen !== generation.current) return
          if (errorHint(e) === 'page_belongs_to_other_unit') {
            const m = /Unit (\d+)/.exec((e as { message?: string }).message ?? '')
            setConflict(m ? Number(m[1]) : (pageUnit ?? unit))
            patchRow(key, { status: 'error', error: 'Seite gehört zu einer anderen Unit.' })
          } else {
            patchRow(key, { status: 'error', error: errorMessage(e) })
          }
        } finally {
          saving.current.delete(key)
        }
      })()
      pending.current.add(job)
      await job
      pending.current.delete(job)
      // Wurde die Zeile währenddessen weiter bearbeitet, erneut speichern.
      const after = rowsRef.current.find((r) => r.key === key)
      if (after && after.status === 'dirty' && isRowComplete(after)) await saveRow(key)
    },
    [bookId, unit, page, conflict, pageUnit, patchRow],
  )

  /** Alle offenen Änderungen speichern (vor Seitenwechsel). Gibt false zurück, wenn etwas fehlschlug. */
  const flush = useCallback(async (): Promise<boolean> => {
    await Promise.all([...pending.current])
    for (const r of rowsRef.current) {
      if (isRowDirty(r) && isRowComplete(r)) await saveRow(r.key)
    }
    await Promise.all([...pending.current])
    return rowsRef.current.every((r) => r.status !== 'error' || !isRowComplete(r))
  }, [saveRow])

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (rowsRef.current.some((r) => isRowDirty(r) && isRowComplete(r))) e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  function update(key: string, patch: Partial<EntryRow>) {
    patchRow(key, (r) => {
      const next = { ...r, ...patch }
      return { ...patch, status: isRowDirty(next) ? 'dirty' : r.status === 'error' ? 'idle' : r.status, error: undefined }
    })
  }

  function setTranslation(row: EntryRow, i: number, value: string) {
    const t = [...row.translations]
    t[i] = value
    update(row.key, { translations: t })
  }

  function addTranslation(row: EntryRow) {
    update(row.key, { translations: [...row.translations, ''] })
    focusField(row.key, `tr-${row.translations.length}`)
  }

  function ensureTrailingEmpty() {
    setRows((rs) => {
      const last = rs[rs.length - 1]
      return last && last.german === '' && cleanTranslations(last.translations).length === 0 ? rs : [...rs, emptyRow()]
    })
  }

  function onRowBlur(row: EntryRow, e: FocusEvent<HTMLDivElement>) {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
    void saveRow(row.key).then(ensureTrailingEmpty)
  }

  function onKeyDown(row: EntryRow, index: number, field: string, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (e.ctrlKey || e.metaKey) {
      addTranslation(row)
      return
    }
    if (field === 'de') {
      focusField(row.key, 'tr-0')
      return
    }
    void saveRow(row.key).then(() => {
      const list = rowsRef.current
      const nextRow = list[index + 1]
      if (nextRow) focusField(nextRow.key, 'de')
      else {
        const fresh = emptyRow()
        setRows((rs) => [...rs, fresh])
        focusField(fresh.key, 'de')
      }
    })
  }

  async function removeRow(row: EntryRow) {
    if (confirmDelete !== row.key) {
      setConfirmDelete(row.key)
      return
    }
    setConfirmDelete(null)
    try {
      if (row.placementId) await deleteEntry(row.placementId)
      setRows((rs) => {
        const next = rs.filter((r) => r.key !== row.key)
        return next.length === 0 ? [emptyRow()] : next
      })
    } catch (e) {
      patchRow(row.key, { status: 'error', error: errorMessage(e) })
    }
  }

  async function go(nextUnit: number, nextPage: number) {
    if (!(await flush())) return
    setParams({ unit: String(nextUnit), seite: String(nextPage) })
  }

  async function nextPage() {
    await go(unit, page + 1)
  }

  async function nextUnit() {
    await go(unit + 1, page + 1)
  }

  async function jump(e: FormEvent) {
    e.preventDefault()
    await go(posInt(unitInput, unit, 0), posInt(pageInput, page, 1))
  }

  async function moveHere() {
    try {
      await movePageToUnit(bookId, page, unit)
      setConflict(null)
      setPageUnit(unit)
      // Blockierte Zeilen erneut speichern
      for (const r of rowsRef.current) if (r.status === 'error' && isRowComplete(r)) patchRow(r.key, { status: 'dirty', error: undefined })
      for (const r of rowsRef.current) if (isRowComplete(r) && isRowDirty(r)) void saveRow(r.key)
    } catch (e) {
      setLoadError(errorMessage(e))
    }
  }

  const savedCount = rows.filter((r) => r.placementId).length

  return (
    <div>
      <Link to={`/buecher/${bookId}`} className="mb-4 inline-flex min-h-[44px] items-center gap-2 text-sm text-slate-400 hover:text-white" onClick={(e) => { e.preventDefault(); void flush().then((ok) => ok && navigate(`/buecher/${bookId}`)) }}>
        <ArrowLeft size={16} /> {bookName || 'Zurück zum Buch'}
      </Link>

      <div className="glass sticky top-0 z-20 mb-4 flex flex-wrap items-end justify-between gap-3 rounded-2xl p-4">
        <form onSubmit={jump} className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="label-mono">Unit</span>
            <input inputMode="numeric" className={`${inputClass} mt-1 w-24`} value={unitInput} onChange={(e) => setUnitInput(e.target.value)} />
          </label>
          <label className="block">
            <span className="label-mono">Seite</span>
            <input inputMode="numeric" className={`${inputClass} mt-1 w-24`} value={pageInput} onChange={(e) => setPageInput(e.target.value)} />
          </label>
          <Button type="submit" variant="secondary">Gehe zu</Button>
        </form>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void nextPage()}>
            Nächste Seite <ChevronRight size={16} />
          </Button>
          <Button onClick={() => void nextUnit()}>
            Nächste Unit <ChevronRight size={16} />
          </Button>
        </div>
      </div>

      {conflict !== null && (
        <div className="mb-4">
          <Notice tone="warn">
            <p>
              Seite {page} gehört bereits zu <strong>Unit {conflict}</strong>. Eine Seite kann nur in einer Unit liegen.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setParams({ unit: String(conflict), seite: String(page) })}>
                Zu Unit {conflict} wechseln
              </Button>
              <Button variant="secondary" onClick={() => void moveHere()}>
                Seite {page} nach Unit {unit} verschieben
              </Button>
            </div>
          </Notice>
        </div>
      )}

      {loadError && <ErrorBox message={loadError} />}
      {loading ? (
        <Spinner />
      ) : (
        <div className="space-y-2">
          <p className="label-mono px-1">
            Unit {unit} · Seite {page} · {savedCount} gespeichert
          </p>
          <div className="hidden grid-cols-[2.5rem_1fr_1.4fr_5rem] gap-3 px-2 text-slate-500 md:grid">
            <span />
            <span className="label-mono">Deutsch</span>
            <span className="label-mono">Lösung(en)</span>
            <span />
          </div>

          {rows.map((row, index) => (
            <div
              key={row.key}
              onBlur={(e) => onRowBlur(row, e)}
              className={`glass grid grid-cols-[2rem_1fr] items-start gap-x-3 gap-y-2 rounded-xl p-3 md:grid-cols-[2.5rem_1fr_1.4fr_5rem] ${
                row.status === 'error' ? 'border-rose-500/50' : row.merged ? 'border-amber-400/40' : ''
              }`}
            >
              <span className="pt-3 text-center font-mono text-xs text-slate-500">{index + 1}</span>
              <input
                data-row={row.key}
                data-field="de"
                aria-label={`Deutsch, Zeile ${index + 1}`}
                className={inputClass}
                value={row.german}
                maxLength={200}
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="next"
                onChange={(e) => update(row.key, { german: e.target.value })}
                onKeyDown={(e) => onKeyDown(row, index, 'de', e)}
              />
              <div className="col-span-2 space-y-2 md:col-span-1">
                {row.translations.map((t, i) => (
                  <input
                    key={i}
                    data-row={row.key}
                    data-field={`tr-${i}`}
                    aria-label={`Lösung ${i + 1}, Zeile ${index + 1}`}
                    className={inputClass}
                    value={t}
                    maxLength={200}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    enterKeyHint="done"
                    onChange={(e) => setTranslation(row, i, e.target.value)}
                    onKeyDown={(e) => onKeyDown(row, index, `tr-${i}`, e)}
                  />
                ))}
                <button
                  type="button"
                  onClick={() => addTranslation(row)}
                  className="inline-flex min-h-[36px] items-center gap-1 text-xs text-slate-400 hover:text-accent-cyan"
                >
                  <Plus size={13} /> Lösung hinzufügen
                </button>
              </div>
              <div className="col-span-2 flex items-center justify-end gap-2 md:col-span-1 md:pt-1.5">
                <StatusIcon row={row} />
                {(row.placementId || row.german || row.translations.some((t) => t)) && (
                  <button
                    type="button"
                    aria-label={confirmDelete === row.key ? 'Löschen bestätigen' : 'Zeile löschen'}
                    onClick={() => void removeRow(row)}
                    className={`flex min-h-[44px] items-center justify-center rounded-lg px-2 text-xs transition ${
                      confirmDelete === row.key ? 'bg-rose-500/20 text-rose-300' : 'text-slate-500 hover:text-rose-300'
                    }`}
                  >
                    {confirmDelete === row.key ? 'Sicher?' : <Trash2 size={16} />}
                  </button>
                )}
              </div>
              {(row.error || row.merged) && (
                <p className={`col-span-2 text-xs md:col-start-2 md:col-span-3 ${row.error ? 'text-rose-300' : 'text-amber-300'}`}>
                  {row.error ?? 'Diese Vokabel gab es im Buch schon – die Lösungen wurden zusammengeführt.'}
                </p>
              )}
            </div>
          ))}
          <p className="px-1 pt-2 text-xs text-slate-500">
            Enter springt weiter und speichert · Strg/⌘+Enter fügt eine weitere Lösung hinzu · Änderungen werden automatisch gespeichert.
          </p>
        </div>
      )}
    </div>
  )
}

function StatusIcon({ row }: { row: EntryRow }) {
  if (row.status === 'saving') return <Loader2 size={16} className="animate-spin text-slate-400" aria-label="Speichert" />
  if (row.status === 'error') return <AlertCircle size={16} className="text-rose-400" aria-label="Fehler" />
  if (row.status === 'dirty') return <span className="h-2 w-2 rounded-full bg-amber-400" aria-label="Nicht gespeichert" />
  if (row.status === 'saved' || row.placementId) return <Check size={16} className="text-emerald-400" aria-label="Gespeichert" />
  return null
}
