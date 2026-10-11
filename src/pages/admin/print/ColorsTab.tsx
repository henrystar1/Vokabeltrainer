import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import Button from '../../../components/ui/Button'
import { TextInput } from '../../../components/ui/Field'
import { ErrorBox, Notice, Spinner } from '../../../components/ui/States'
import { errorMessage } from '../../../lib/errors'
import { centsToInput, parseEuroToCents } from '../../../lib/printShop'
import { useAsync } from '../../../lib/useAsync'
import { adminPrintDeleteColor, adminPrintListColors, adminPrintSaveColor, type AdminColor } from '../../../services/printShop'

/** Filamentfarben, die Kunden wählen können (je Farbe optional ein Aufpreis). */
export default function ColorsTab() {
  const colors = useAsync(adminPrintListColors, [])
  const [adding, setAdding] = useState(false)
  if (colors.loading && !colors.data) return <Spinner />
  if (colors.error) return <ErrorBox message={colors.error} onRetry={colors.reload} />
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-slate-400">Nur Farben, die du wirklich da hast. „Aufpreis“ ist für Sonderfilament (z. B. Gold, Seide) pro Stück.</p>
        <Button onClick={() => setAdding(true)} disabled={adding}><Plus size={16} /> Farbe</Button>
      </div>
      <ul className="space-y-2">
        {adding && <Row key="new" color={null} onDone={() => { setAdding(false); colors.reload() }} onCancel={() => setAdding(false)} />}
        {colors.data?.map((c) => <Row key={c.id} color={c} onDone={colors.reload} />)}
      </ul>
    </div>
  )
}

function Row({ color, onDone, onCancel }: { color: AdminColor | null; onDone: () => void; onCancel?: () => void }) {
  const [name, setName] = useState(color?.name ?? '')
  const [hex, setHex] = useState(color?.hex ?? '#22d3ee')
  const [extra, setExtra] = useState(color ? centsToInput(color.extra_cents) : '0,00')
  const [active, setActive] = useState(color?.active ?? true)
  const [sort, setSort] = useState(String(color?.sort ?? 100))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const extraCents = parseEuroToCents(extra)
  const dirty = !color || name !== color.name || hex.toLowerCase() !== color.hex || extraCents !== color.extra_cents || active !== color.active || Number(sort) !== color.sort

  async function save() {
    if (extraCents == null) return
    setBusy(true)
    setError(null)
    try {
      await adminPrintSaveColor({ id: color?.id ?? null, name, hex, extra_cents: extraCents, active, sort: Math.round(Number(sort) || 100) })
      onDone()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!color || !window.confirm(`Farbe „${color.name}“ löschen?`)) return
    try {
      await adminPrintDeleteColor(color.id)
      onDone()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <li className={`glass rounded-2xl p-3 ${active ? '' : 'opacity-60'}`}>
      <div className="flex flex-wrap items-center gap-3">
        <input type="color" value={hex} onChange={(e) => setHex(e.target.value)} aria-label="Farbe" className="h-11 w-14 cursor-pointer rounded-lg border border-white/15 bg-transparent p-1" />
        <TextInput className="!w-40" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="Name" />
        <label className="flex items-center gap-2 text-sm text-slate-400">Aufpreis € <TextInput className="!w-24" inputMode="decimal" value={extra} onChange={(e) => setExtra(e.target.value)} aria-label="Aufpreis in Euro" /></label>
        <label className="flex items-center gap-2 text-sm text-slate-400">Reihenfolge <TextInput className="!w-20" inputMode="numeric" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Reihenfolge" /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5 accent-cyan-400" checked={active} onChange={(e) => setActive(e.target.checked)} /> aktiv</label>
        <span className="flex-1" />
        {onCancel && <Button variant="ghost" onClick={onCancel}>Abbrechen</Button>}
        <Button busy={busy} disabled={!dirty || !name.trim() || extraCents == null} onClick={() => void save()}>Speichern</Button>
        {color && <Button variant="ghost" aria-label="Löschen" className="text-rose-300" onClick={() => void remove()}><Trash2 size={16} /></Button>}
      </div>
      {error && <div className="mt-2"><Notice tone="warn">{error}</Notice></div>}
    </li>
  )
}
