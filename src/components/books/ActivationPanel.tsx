import { useMemo, useState } from 'react'
import { ChevronsRight, Power, Sparkles } from 'lucide-react'
import Button from '../ui/Button'
import { Select } from '../ui/Field'
import ProgressBar from '../ui/ProgressBar'
import { ErrorBox, Notice } from '../ui/States'
import { errorMessage } from '../../lib/errors'
import { activateNextPage, activateUpTo, setVocabActive } from '../../services/community'
import type { OutlineUnit } from '../../types'

interface ActivationPanelProps {
  bookId: string
  units: OutlineUnit[]
  /** Nach jeder Änderung: Übersicht neu laden. */
  onChanged: () => void
}

/**
 * Vokabeln eines Buchs freischalten – in drei Stufen von einfach bis genau:
 * 1. "Nächste Seite" (Schritt für Schritt), 2. "Alles bis hierhin" (wo bist du im Buch?), 3. einzelne Seiten/Units unten.
 */
export default function ActivationPanel({ bookId, units, onChanged }: ActivationPanelProps) {
  const total = units.reduce((s, u) => s + u.pages.reduce((a, p) => a + p.vocab_count, 0), 0)
  const active = units.reduce((s, u) => s + u.pages.reduce((a, p) => a + p.active_count, 0), 0)
  const percent = total === 0 ? 0 : (active / total) * 100

  const [unit, setUnit] = useState<number | ''>('')
  const [page, setPage] = useState<number | ''>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const pages = useMemo(() => units.find((u) => u.unit_number === unit)?.pages ?? [], [units, unit])

  async function run(fn: () => Promise<string>) {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      setMessage(await fn())
      onChanged()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const next = () =>
    run(async () => {
      const r = await activateNextPage(bookId)
      return r ? `Unit ${r.unit_number}, Seite ${r.page_number}: ${r.count} Vokabeln freigeschaltet.` : 'Alle Vokabeln sind schon aktiv.'
    })

  const upTo = () =>
    run(async () => {
      if (unit === '' || page === '') throw new Error('Bitte Unit und Seite wählen.')
      const n = await activateUpTo(bookId, unit, page)
      return n === 0 ? 'Bis dahin war schon alles aktiv.' : `${n} Vokabeln bis Unit ${unit}, Seite ${page} freigeschaltet.`
    })

  const all = (on: boolean) =>
    run(async () => {
      await setVocabActive(bookId, on)
      return on ? 'Alle Vokabeln aktiviert.' : 'Alle Vokabeln deaktiviert.'
    })

  if (total === 0) return null

  return (
    <div className={`mb-5 space-y-4 rounded-2xl border p-5 ${active === 0 ? 'border-amber-300/40 bg-amber-300/5' : 'glass'}`}>
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Sparkles size={18} className="text-accent-cyan" /> Vokabeln freischalten
          </h2>
          <span className="font-mono text-sm text-accent-cyan">
            {active} / {total} aktiv
          </span>
        </div>
        <ProgressBar value={percent} label="Aktive Vokabeln" />
        <p className="text-sm text-slate-400">
          {active === 0
            ? 'Noch nichts aktiv – schalte die Vokabeln frei, die du gerade lernen willst. Nur aktive Vokabeln kommen beim Lernen dran.'
            : 'Nur aktive Vokabeln kommen beim Lernen dran. Schalte nach und nach weitere frei, sobald du im Buch weiter bist.'}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button busy={busy} onClick={() => void next()}>
          <ChevronsRight size={18} /> Nächste Seite freischalten
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => void all(true)}>
          <Power size={16} /> Alles aktivieren
        </Button>
        {active > 0 && (
          <Button variant="ghost" disabled={busy} onClick={() => void all(false)}>
            Alles deaktivieren
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-2 border-t border-white/10 pt-4">
        <span className="basis-full text-xs text-slate-400">Oder: Ich bin im Buch schon so weit – alles bis dahin aktivieren</span>
        <label className="space-y-1">
          <span className="label-mono">Unit</span>
          <Select
            className="!w-32"
            value={unit}
            onChange={(e) => {
              setUnit(e.target.value === '' ? '' : Number(e.target.value))
              setPage('')
            }}
          >
            <option value="">–</option>
            {units.map((u) => (
              <option key={u.unit_id} value={u.unit_number}>{u.unit_number}</option>
            ))}
          </Select>
        </label>
        <label className="space-y-1">
          <span className="label-mono">Seite</span>
          <Select className="!w-32" value={page} disabled={unit === ''} onChange={(e) => setPage(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">–</option>
            {pages.map((p) => (
              <option key={p.page_id} value={p.page_number}>{p.page_number}</option>
            ))}
          </Select>
        </label>
        <Button variant="secondary" disabled={busy || unit === '' || page === ''} onClick={() => void upTo()}>
          Bis hierhin aktivieren
        </Button>
      </div>

      {message && <Notice tone="ok">{message}</Notice>}
      {error && <ErrorBox message={error} />}
    </div>
  )
}
