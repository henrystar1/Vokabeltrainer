import { useMemo, useState } from 'react'
import { Layers, Play } from 'lucide-react'
import { ErrorBox, Spinner } from '../../components/ui/States'
import { useAsync } from '../../lib/useAsync'
import { getCardBox } from '../../services/learning'
import { fachColor, groupByFach, hitRate, rateColor } from './cardBox'

interface Props {
  language: string | null
  bookId: string | null
  /** Ausgewähltes Fach (1–5) zum gezielten Lernen, null = alle. */
  fach: number | null
  onFach: (f: number | null) => void
}

/** Karteikasten: fünf Fächer (= Lernstufen), anklickbar; Kärtchen von Rot (oft falsch) bis Grün (oft richtig). */
export default function CardBoxPanel({ language, bookId, fach, onFach }: Props) {
  const box = useAsync(() => getCardBox(language, bookId), [language, bookId])
  const [open, setOpen] = useState<number>(1)
  const [flipped, setFlipped] = useState<string | null>(null)
  const groups = useMemo(() => groupByFach(box.data ?? []), [box.data])
  const total = box.data?.length ?? 0
  const cards = groups[open - 1] ?? []

  return (
    <div className="space-y-3 rounded-2xl border border-white/10 bg-space-900/50 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><Layers size={16} className="text-accent-cyan" /> Dein Karteikasten</h3>
        <span className="text-xs text-slate-500">{total} Karten</span>
      </div>
      {box.loading && !box.data && <Spinner />}
      {box.error && <ErrorBox message={box.error} onRetry={box.reload} />}
      {box.data && total === 0 && <p className="text-sm text-slate-400">Noch keine aktiven Karten.</p>}
      {total > 0 && (
        <>
          <div className="grid grid-cols-5 gap-2" role="tablist" aria-label="Fächer">
            {groups.map((g, i) => {
              const f = i + 1
              const share = total === 0 ? 0 : g.length / total
              return (
                <button key={f} type="button" role="tab" aria-selected={open === f} onClick={() => setOpen(f)}
                  className={`relative min-h-[76px] overflow-hidden rounded-xl border px-1 pb-2 pt-1.5 text-center transition ${open === f ? 'border-white/60 bg-white/10' : 'border-white/10 bg-white/[0.03] hover:bg-white/10'}`}
                  style={{ boxShadow: open === f ? `0 0 14px ${fachColor(f)}55` : undefined }}>
                  <span className="block text-[10px] uppercase tracking-wide text-slate-400">Fach {f}</span>
                  <span className="block text-xl font-bold leading-tight" style={{ color: fachColor(f) }}>{g.length}</span>
                  <span className="absolute inset-x-0 bottom-0 h-1.5 bg-white/5"><span className="block h-full" style={{ width: `${Math.max(share * 100, g.length ? 6 : 0)}%`, background: fachColor(f) }} /></span>
                </button>
              )
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
            <span>Fach 1 = neu/oft falsch, Fach 5 = gelernt.</span>
            <button type="button" onClick={() => onFach(fach === open ? null : open)}
              className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border px-3 text-sm ${fach === open ? 'border-accent-cyan/60 bg-accent-cyan/15 text-accent-cyan' : 'border-white/15 text-slate-200 hover:bg-white/10'}`}>
              <Play size={14} /> {fach === open ? `Nur Fach ${open} – aktiv` : `Nur Fach ${open} lernen`}
            </button>
          </div>
          {fach !== null && fach !== open && <p className="text-xs text-accent-cyan">Gerade eingestellt: nur Fach {fach} (<button type="button" className="underline" onClick={() => onFach(null)}>alle Fächer</button>).</p>}
          {cards.length === 0 ? (
            <p className="text-sm text-slate-500">Dieses Fach ist leer.</p>
          ) : (
            <ul className="grid max-h-80 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
              {cards.slice(0, 120).map((c) => {
                const r = hitRate(c)
                const show = flipped === c.vocabulary_id
                return (
                  <li key={c.vocabulary_id}>
                    <button type="button" onClick={() => setFlipped(show ? null : c.vocabulary_id)} aria-label={`Karte ${c.german}`}
                      className="relative min-h-[64px] w-full overflow-hidden rounded-lg border border-white/10 bg-white/5 py-2 pl-4 pr-3 text-left hover:bg-white/10">
                      <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: rateColor(c) }} />
                      <span className="block truncate text-sm font-medium">{show ? (c.translations.join(', ') || '–') : c.german}</span>
                      <span className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-400">
                        <span className="text-emerald-300">✓ {c.right}</span>
                        <span className="text-rose-300">✗ {c.wrong}</span>
                        {r !== null && <span>{Math.round(r * 100)} %</span>}
                        <span className="ml-auto text-slate-600">{show ? 'tippen: zurück' : 'tippen: umdrehen'}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {cards.length > 120 && <p className="text-xs text-slate-500">Es werden die ersten 120 Karten gezeigt.</p>}
        </>
      )}
    </div>
  )
}
