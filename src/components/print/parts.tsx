import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { STAGES, STATUS_LABEL, STATUS_TONE, adjustedNow, euro, fmtDuration, orderProgress, stageIndex, type PrintStatus, type Tone } from '../../lib/printShop'
import { parseStl, type StlMesh } from '../../lib/stl'
import { downloadPrintFile, type PrintColor, type PrintOrder, type PrintQuote } from '../../services/printShop'

/* ---------- Farben ---------- */

export function ColorSwatches({ colors, value, onChange, disabled }: { colors: PrintColor[]; value: string | null; onChange: (id: string) => void; disabled?: boolean }) {
  const sel = colors.find((c) => c.id === value)
  return (
    <div>
      <div className="flex flex-wrap gap-2.5" role="radiogroup" aria-label="Farbe">
        {colors.map((c) => {
          const on = c.id === value
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`${c.name}${c.extra_cents > 0 ? `, +${euro(c.extra_cents)}` : ''}`}
              title={c.name}
              disabled={disabled}
              onClick={() => onChange(c.id)}
              className={`relative h-10 w-10 rounded-full border-2 transition active:scale-95 disabled:opacity-50 ${on ? 'border-accent-cyan shadow-glow' : 'border-white/15 hover:border-white/40'}`}
              style={{ background: c.hex }}
            >
              {on && <Check size={16} className="absolute inset-0 m-auto drop-shadow" style={{ color: isLight(c.hex) ? '#0b1020' : '#fff' }} />}
            </button>
          )
        })}
      </div>
      <p className="mt-2 min-h-[20px] text-sm text-slate-300">
        {sel ? <>{sel.name}{sel.extra_cents > 0 && <span className="text-amber-300"> · Sonderfarbe +{euro(sel.extra_cents)}</span>}</> : <span className="text-slate-500">Bitte eine Farbe wählen</span>}
      </p>
    </div>
  )
}

function isLight(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return r * 0.299 + g * 0.587 + b * 0.114 > 160
}

/* ---------- Status ---------- */

const TONE_CLASS: Record<Tone, string> = {
  info: 'border-accent-cyan/30 bg-accent-cyan/10 text-cyan-200',
  warn: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
  ok: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
  bad: 'border-rose-500/30 bg-rose-500/10 text-rose-200',
  muted: 'border-white/10 bg-white/5 text-slate-400',
}

export function StatusChip({ status }: { status: PrintStatus }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${TONE_CLASS[STATUS_TONE[status]]}`}>{STATUS_LABEL[status]}</span>
}

/* ---------- Fortschritt ---------- */

/** Sekündlich aktualisierte Zeit, solange `active` gilt. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [active])
  return now
}

function Ring({ pct, size = 92, children }: { pct: number; size?: number; children?: ReactNode }) {
  const r = (size - 10) / 2
  const c = 2 * Math.PI * r
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <defs>
          <linearGradient id="print-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="rgb(var(--c-violet))" />
            <stop offset="100%" stopColor="rgb(var(--c-cyan))" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--s600))" strokeWidth="7" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke="url(#print-ring)" strokeWidth="7" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(100, Math.max(0, pct)) / 100)}
          style={{ transition: 'stroke-dashoffset 0.9s linear' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  )
}

/** Live-Anzeige: Ring, Balken und Stufen. `fetchedAt` ist der Zeitpunkt, an dem die Bestellung geladen wurde. */
export function OrderProgress({ order, fetchedAt }: { order: Pick<PrintOrder, 'status' | 'print_minutes' | 'print_started_at' | 'progress_override' | 'server_now'>; fetchedAt: number }) {
  const printing = order.status === 'druckt'
  const tick = useNow(printing)
  const p = orderProgress(order, adjustedNow(order.server_now, fetchedAt, tick))
  const idx = stageIndex(order.status)
  const pct = Math.round(p.pct)
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <Ring pct={p.pct}>
        <span className="text-xl font-semibold tabular-nums leading-none">{pct}<span className="text-xs text-slate-400"> %</span></span>
      </Ring>
      <div className="min-w-0 flex-1">
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-space-700" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Fortschritt">
          <div className="h-full rounded-full bg-gradient-to-r from-accent-violet to-accent-cyan transition-[width] duration-1000 ease-linear" style={{ width: `${p.pct}%` }} />
        </div>
        <ol className="mt-2.5 grid grid-cols-5 gap-1 text-center text-[10px] leading-tight sm:text-[11px]">
          {STAGES.map((s, i) => (
            <li key={s.status} className={i < idx ? 'text-accent-cyan' : i === idx ? 'font-semibold text-slate-100' : 'text-slate-500'}>
              <span className={`mx-auto mb-1 block h-2 w-2 rounded-full ${i <= idx ? 'bg-accent-cyan' : 'bg-space-600'} ${i === idx && printing ? 'animate-pulse' : ''}`} />
              {s.label}
            </li>
          ))}
        </ol>
        {printing && (
          <p className="mt-2 text-xs text-slate-400">
            {p.remainingMin != null && <>Noch ca. <b className="text-slate-200">{fmtDuration(p.remainingMin)}</b></>}
            {p.ratePerMin != null && <> · ≈ {p.ratePerMin.toLocaleString('de-DE', { maximumFractionDigits: 2 })} % pro Minute</>}
          </p>
        )}
        {order.status === 'lieferbereit' && <p className="mt-2 text-xs text-emerald-300">Fertig gedruckt – du bekommst es bei der nächsten Übergabe in der Schule.</p>}
      </div>
    </div>
  )
}

/* ---------- Preis ---------- */

export function QuoteBox({ quote, loading, note }: { quote: PrintQuote | null; loading?: boolean; note?: string }) {
  if (!quote) return <div className="rounded-xl border border-white/10 bg-space-900/50 p-4 text-sm text-slate-500">{loading ? 'Preis wird berechnet …' : note ?? 'Noch kein Preis.'}</div>
  return (
    <div className={`rounded-xl border border-white/10 bg-space-900/50 p-4 text-sm transition ${loading ? 'opacity-60' : ''}`}>
      <ul className="space-y-1.5">
        {quote.lines.map((l, i) => (
          <li key={i} className="flex justify-between gap-3 text-slate-300"><span>{l.label}</span><span className="tabular-nums">{euro(l.cents)}</span></li>
        ))}
        {quote.discount_cents ? (
          <li className="flex justify-between gap-3 text-emerald-300"><span>Rabatt {quote.discount_percent} %</span><span className="tabular-nums">−{euro(quote.discount_cents)}</span></li>
        ) : null}
        {quote.rush_cents > 0 && <li className="flex justify-between gap-3 text-amber-300"><span>Beschleunigt</span><span className="tabular-nums">+{euro(quote.rush_cents)}</span></li>}
      </ul>
      <div className="mt-3 flex items-baseline justify-between border-t border-white/10 pt-3">
        <span className="label-mono">Gesamt</span>
        <span className="text-2xl font-semibold tabular-nums">{euro(quote.final_cents)}</span>
      </div>
      <p className="mt-1 text-right text-[11px] text-slate-500">Bezahlt wird bei der Übergabe.</p>
    </div>
  )
}

/* ---------- STL laden ---------- */

/** Lädt und liest eine STL aus einer Datei oder einem Speicherpfad. */
export function useStlMesh(source: File | string | null): { mesh: StlMesh | null; loading: boolean; error: string | null } {
  const [state, setState] = useState<{ mesh: StlMesh | null; loading: boolean; error: string | null }>({ mesh: null, loading: false, error: null })
  const seq = useRef(0)
  useEffect(() => {
    const id = ++seq.current
    if (!source) { setState({ mesh: null, loading: false, error: null }); return }
    setState({ mesh: null, loading: true, error: null })
    ;(async () => {
      const buf = typeof source === 'string' ? await (await downloadPrintFile(source)).arrayBuffer() : await source.arrayBuffer()
      return parseStl(buf)
    })().then(
      (mesh) => id === seq.current && setState({ mesh, loading: false, error: null }),
      (e) => id === seq.current && setState({ mesh: null, loading: false, error: e instanceof Error ? e.message : 'Die Datei konnte nicht gelesen werden.' }),
    )
  }, [source])
  return state
}

export function Stepper({ value, min = 1, max, onChange, label }: { value: number; min?: number; max: number; onChange: (n: number) => void; label: string }) {
  const btn = 'flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-lg text-slate-100 transition hover:bg-white/10 active:scale-95 disabled:opacity-40'
  return (
    <div className="inline-flex items-center gap-3" role="group" aria-label={label}>
      <button type="button" className={btn} onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="Weniger">−</button>
      <span className="w-8 text-center text-lg font-semibold tabular-nums" aria-live="polite">{value}</span>
      <button type="button" className={btn} onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="Mehr">+</button>
    </div>
  )
}

/** Auswahlkasten mit Erklärung (Express, Rabatt). */
export function OptionCard({ checked, onChange, disabled, title, text, right }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; title: string; text: string; right: ReactNode }) {
  return (
    <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${checked ? 'border-accent-cyan/50 bg-accent-cyan/5' : 'border-white/10 bg-white/[0.02] hover:bg-white/5'} ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}>
      <input type="checkbox" className="mt-1 h-5 w-5 accent-cyan-400" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-slate-100">{title}</span>
        <span className="block text-xs text-slate-400">{text}</span>
      </span>
      <span className="shrink-0 text-sm font-medium text-slate-200">{right}</span>
    </label>
  )
}
