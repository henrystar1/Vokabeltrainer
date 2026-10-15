import { useRef } from 'react'
import { Check, X } from 'lucide-react'
import { splitGaps, type GapItem, type SheetGrade } from '../../lib/gaps'

interface GapSheetProps {
  items: readonly GapItem[]
  given: ReadonlyArray<readonly string[]>
  onChange?: (item: number, gap: number, value: string) => void
  /** Wenn gesetzt: Blatt ist abgegeben, richtig/falsch wird markiert und Lösungen erscheinen. */
  grade?: SheetGrade | null
  /** Überschriften vor bestimmten Aufgaben (Index → Text). */
  headings?: Record<number, string>
  title?: string
  subtitle?: string
  /** Buttons für é, è, ç … */
  /** Sprachcode der Sonderzeichenleiste (fr/es/la); true = Französisch. */
  accents?: boolean | string
}

const ACCENTS: Record<string, string[]> = {
  fr: ['é', 'è', 'ê', 'à', 'â', 'ç', 'î', 'ô', 'ù', 'û', 'œ', 'ë', 'ï'],
  es: ['á', 'é', 'í', 'ó', 'ú', 'ü', 'ñ', '¿', '¡'],
  la: ['ā', 'ē', 'ī', 'ō', 'ū'],
}

/** Aufgabenblatt wie auf Papier: nummerierte Sätze mit Textfeldern in den Lücken. */
export default function GapSheet({ items, given, onChange, grade = null, headings, title, subtitle, accents = false }: GapSheetProps) {
  const last = useRef<{ el: HTMLInputElement; item: number; gap: number } | null>(null)
  const done = grade !== null

  function insert(ch: string) {
    const l = last.current
    if (!l || !onChange) return
    const el = l.el
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? start
    const next = el.value.slice(0, start) + ch + el.value.slice(end)
    onChange(l.item, l.gap, next)
    window.requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + 1, start + 1) })
  }

  return (
    <div className="sheet-paper">
      {(title || subtitle) && (
        <header className="mb-5 border-b-2 border-slate-300 pb-3">
          {title && <h2 className="font-serif text-xl font-bold">{title}</h2>}
          {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
        </header>
      )}
      {accents && !done && (
        <div className="sheet-accents print:hidden" role="group" aria-label="Sonderzeichen">
          {ACCENTS[typeof accents === 'string' ? accents : 'fr'].map((c) => (
            <button key={c} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(c)} className="sheet-accent">{c}</button>
          ))}
        </div>
      )}
      <ol className="space-y-5">
        {items.map((item, i) => {
          const g = grade?.items[i]
          return (
            <li key={i} value={i + 1} className="sheet-item">
              {headings?.[i] && <p className="sheet-heading">{headings[i]}</p>}
              <p className="leading-[2.6rem]">
                {splitGaps(item.text).map((seg, k) => {
                  if (seg.type === 'text') return <span key={k}>{seg.value}</span>
                  const gi = seg.index
                  const value = given[i]?.[gi] ?? ''
                  const longest = Math.max(...(item.answers[gi] ?? ['xxxxxx']).map((a) => a.length), 4)
                  const state = g ? (g.gaps[gi] ? 'ok' : 'bad') : 'open'
                  return (
                    <span key={k} className="sheet-gap-wrap">
                      <input
                        value={value}
                        readOnly={done || !onChange}
                        onChange={(e) => onChange?.(i, gi, e.target.value)}
                        onFocus={(e) => { last.current = { el: e.currentTarget, item: i, gap: gi } }}
                        autoCapitalize="off"
                        autoCorrect="off"
                        autoComplete="off"
                        spellCheck={false}
                        aria-label={`Aufgabe ${i + 1}, Lücke ${gi + 1}`}
                        className={`sheet-gap sheet-gap-${state}`}
                        style={{ width: `${Math.min(Math.max(longest + 3, 7), 28)}ch` }}
                      />
                      {item.hints[gi] && <span className="sheet-hint">({item.hints[gi]})</span>}
                      {state === 'ok' && <Check size={15} className="ml-1 inline text-emerald-600" aria-label="richtig" />}
                      {state === 'bad' && <X size={15} className="ml-1 inline text-rose-600" aria-label="falsch" />}
                    </span>
                  )
                })}
              </p>
              {g && (g.correct < g.total || item.explanation) && (
                <div className="sheet-solution">
                  {g.correct < g.total && (
                    <p>
                      <span className="font-semibold text-emerald-700">Richtig: </span>
                      {item.answers.map((a, k) => (g.gaps[k] ? null : <span key={k} className="mr-3">{a.join(' / ')}</span>))}
                    </p>
                  )}
                  {item.explanation && <p className="italic text-slate-600">{item.explanation}</p>}
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
