import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import Button from '../../../components/ui/Button'
import { Field, TextInput } from '../../../components/ui/Field'
import { ErrorBox, Notice, Spinner } from '../../../components/ui/States'
import { QuoteBox } from '../../../components/print/parts'
import { errorMessage } from '../../../lib/errors'
import { fmtDuration } from '../../../lib/printShop'
import { useAsync } from '../../../lib/useAsync'
import { adminPrintGetSettings, adminPrintGoalReset, adminPrintSetSetting, getPrintQuote, type PrintQuote, type PrintSetting } from '../../../services/printShop'

const GROUPS: { title: string; text?: string; keys: string[] }[] = [
  { title: 'Shop', keys: ['orders_open', 'max_open_requests', 'max_orders_per_day', 'max_qty', 'max_volume_cm3'] },
  { title: 'Material und Druckzeit', text: 'Daraus wird für STL-Anfragen die Druckzeit geschätzt.', keys: ['filament_eur_per_kg', 'filament_density', 'material_share', 'extrude_cm3_per_h', 'setup_minutes'] },
  { title: 'Kosten', keys: ['power_watts', 'eur_per_kwh', 'machine_eur_per_h', 'base_fee_eur', 'margin_percent', 'min_price_eur'] },
  { title: 'Extras', keys: ['rush_fee_eur', 'discount_coins', 'discount_percent'] },
  { title: 'Verdienst-Anzeige', text: 'Der Balken zählt den Umsatz aller übergebenen Bestellungen. Nach dem Kauf des Abos kannst du ein neues Ziel beginnen.', keys: ['goal_visible', 'goal_eur', 'goal_offset_eur'] },
]

export default function PricesTab() {
  const settings = useAsync(adminPrintGetSettings, [])
  const [version, setVersion] = useState(0)
  if (settings.loading && !settings.data) return <Spinner />
  if (settings.error) return <ErrorBox message={settings.error} onRetry={settings.reload} />
  const byKey = new Map((settings.data ?? []).map((s) => [s.key, s]))
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="space-y-6">
        {GROUPS.map((g) => (
          <section key={g.title} className="glass space-y-3 rounded-2xl p-5">
            <h3 className="text-base font-semibold">{g.title}</h3>
            {g.text && <p className="text-sm text-slate-400">{g.text}</p>}
            {g.keys.map((k) => byKey.get(k)).filter((s): s is PrintSetting => !!s).map((s) => (
              <SettingRow key={s.key} s={s} onSaved={() => { setVersion((v) => v + 1); settings.reload() }} />
            ))}
            {g.title === 'Verdienst-Anzeige' && <GoalReset onDone={settings.reload} />}
          </section>
        ))}
      </div>
      <Example version={version} />
    </div>
  )
}

export interface SettingLike { key: string; value: number; label: string; unit: string; hint: string; min_value: number; max_value: number }

/** Eine Einstellung mit Eingabefeld; `save` entscheidet, wohin gespeichert wird (Standard: Druck-Einstellungen). */
export function SettingRow({ s, onSaved, save: saveFn = adminPrintSetSetting }: { s: SettingLike; onSaved: () => void; save?: (key: string, value: number) => Promise<unknown> }) {
  const [text, setText] = useState(String(s.value).replace('.', ','))
  const [state, setState] = useState<'idle' | 'busy' | 'ok' | string>('idle')
  useEffect(() => setText(String(s.value).replace('.', ',')), [s.value])
  const n = Number(text.replace(',', '.'))
  const valid = text.trim() !== '' && Number.isFinite(n) && n >= s.min_value && n <= s.max_value
  const dirty = valid && n !== Number(s.value)

  async function save() {
    setState('busy')
    try {
      await saveFn(s.key, n)
      setState('ok')
      onSaved()
      window.setTimeout(() => setState('idle'), 1500)
    } catch (e) {
      setState(errorMessage(e))
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-[12rem] flex-1 space-y-1">
          <span className="text-sm text-slate-200">{s.label}</span>
          <TextInput inputMode="decimal" value={text} onChange={(e) => { setText(e.target.value); setState('idle') }} onKeyDown={(e) => { if (e.key === 'Enter' && dirty) void save() }} aria-invalid={!valid} />
        </label>
        <span className="pb-3 text-xs text-slate-500">{s.unit}</span>
        <Button variant="secondary" busy={state === 'busy'} disabled={!dirty} onClick={() => void save()}>{state === 'ok' ? <Check size={16} /> : 'Speichern'}</Button>
      </div>
      {s.hint && <p className="mt-1 text-xs text-slate-500">{s.hint}</p>}
      {!valid && <p className="mt-1 text-xs text-amber-300">Erlaubt: {s.min_value} bis {s.max_value}</p>}
      {state !== 'idle' && state !== 'busy' && state !== 'ok' && <p className="mt-1 text-xs text-rose-300">{state}</p>}
    </div>
  )
}

function GoalReset({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function reset() {
    if (!window.confirm('Neues Ziel beginnen? Der bisherige Verdienst wird in der Anzeige auf 0 gesetzt (die Bestellungen bleiben).')) return
    setBusy(true)
    try { await adminPrintGoalReset(); onDone() } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  return (
    <div className="pt-2">
      <Button variant="secondary" busy={busy} onClick={() => void reset()}>Neues Ziel beginnen (Verdienst auf 0)</Button>
      {error && <div className="mt-2"><Notice tone="warn">{error}</Notice></div>}
    </div>
  )
}

/** Beispielrechnung, damit man beim Einstellen sofort sieht, was ein Teil kostet. */
function Example({ version }: { version: number }) {
  const [volume, setVolume] = useState('30')
  const [qty, setQty] = useState('1')
  const [quote, setQuote] = useState<PrintQuote | null>(null)
  const [error, setError] = useState<string | null>(null)
  const v = Number(volume.replace(',', '.'))
  const q = Math.round(Number(qty))
  useEffect(() => {
    if (!(v > 0) || !(q >= 1)) { setQuote(null); return }
    let alive = true
    const t = window.setTimeout(() => {
      getPrintQuote({ kind: 'custom', product: null, volume: v, color: null, qty: q, rush: false, discount: false }).then(
        (r) => { if (alive) { setQuote(r); setError(null) } },
        (e) => { if (alive) { setQuote(null); setError(errorMessage(e)) } },
      )
    }, 200)
    return () => { alive = false; window.clearTimeout(t) }
  }, [v, q, version])
  return (
    <aside className="glass h-fit space-y-3 rounded-2xl p-5 lg:sticky lg:top-4">
      <h3 className="text-base font-semibold">Beispielrechnung</h3>
      <p className="text-sm text-slate-400">So würde ein STL-Teil mit deinen Werten berechnet.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Volumen (cm³)"><TextInput inputMode="decimal" value={volume} onChange={(e) => setVolume(e.target.value)} /></Field>
        <Field label="Stückzahl"><TextInput inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
      </div>
      {error && <Notice tone="warn">{error}</Notice>}
      <QuoteBox quote={quote} />
      {quote?.minutes != null && <p className="text-xs text-slate-500">Geschätzte Druckzeit: {fmtDuration(quote.minutes)} · Filament: {quote.grams.toLocaleString('de-DE')} g</p>}
    </aside>
  )
}
