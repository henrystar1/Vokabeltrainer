import { useEffect, useRef, useState, type SyntheticEvent } from 'react'
import { ArrowBigUp } from 'lucide-react'

const LOWER = ['à', 'â', 'æ', 'ç', 'é', 'è', 'ê', 'ë', 'î', 'ï', 'ô', 'œ', 'ù', 'û', 'ü', 'ÿ', '’', '«', '»']
const UPPER = ['À', 'Â', 'Æ', 'Ç', 'É', 'È', 'Ê', 'Ë', 'Î', 'Ï', 'Ô', 'Œ', 'Ù', 'Û', 'Ü', 'Ÿ', '’', '«', '»']

type TextEl = HTMLInputElement | HTMLTextAreaElement

const isTextEl = (el: Element | null): el is TextEl =>
  el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && ['text', 'search', ''].includes(el.type))

/** Fügt Text an der Cursorposition ein und meldet die Änderung an React (kontrollierte Felder). */
export function insertAtCursor(el: TextEl, text: string): void {
  const start = el.selectionStart ?? el.value.length
  const end = el.selectionEnd ?? el.value.length
  const next = el.value.slice(0, start) + text + el.value.slice(end)
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, next)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  const pos = start + text.length
  el.setSelectionRange(pos, pos)
}

/**
 * Leiste mit französischen Sonderzeichen. Schreibt in das zuletzt fokussierte Textfeld;
 * die Tasten nehmen dem Feld den Fokus nicht weg (wichtig auf dem iPad).
 */
export default function AccentBar({ className = '' }: { className?: string }) {
  const [upper, setUpper] = useState(false)
  const last = useRef<TextEl | null>(null)
  const bar = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as Element | null
      if (isTextEl(t) && !bar.current?.contains(t)) last.current = t
    }
    document.addEventListener('focusin', onFocusIn)
    // Falls beim Einblenden schon ein Feld fokussiert ist
    if (isTextEl(document.activeElement)) last.current = document.activeElement
    return () => document.removeEventListener('focusin', onFocusIn)
  }, [])

  function press(ch: string) {
    const el = last.current
    if (!el || !el.isConnected || el.readOnly || el.disabled) return
    el.focus()
    insertAtCursor(el, ch)
    if (upper && /[A-ZÀ-Ÿ]/.test(ch)) setUpper(false)
  }

  const keep = (e: SyntheticEvent) => e.preventDefault()
  const chars = upper ? UPPER : LOWER

  return (
    <div
      ref={bar}
      role="toolbar"
      aria-label="Französische Sonderzeichen"
      className={`glass flex flex-wrap items-center justify-center gap-1.5 rounded-2xl p-2 ${className}`}
    >
      <button
        type="button"
        onPointerDown={keep}
        onMouseDown={keep}
        onClick={() => setUpper((u) => !u)}
        aria-pressed={upper}
        aria-label="Großbuchstaben"
        className={`flex h-11 w-11 items-center justify-center rounded-lg border text-slate-200 transition ${
          upper ? 'border-accent-cyan bg-accent-cyan/20 text-accent-cyan' : 'border-white/10 bg-space-900/60'
        }`}
      >
        <ArrowBigUp size={18} />
      </button>
      {chars.map((ch) => (
        <button
          key={ch}
          type="button"
          onPointerDown={keep}
          onMouseDown={keep}
          onClick={() => press(ch)}
          className="flex h-11 min-w-[2.75rem] items-center justify-center rounded-lg border border-white/10 bg-space-900/60 px-2 text-lg text-slate-100 transition hover:border-accent-cyan/50 hover:bg-accent-cyan/10 active:scale-95"
        >
          {ch}
        </button>
      ))}
    </div>
  )
}
