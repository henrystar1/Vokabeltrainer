import { useMemo, useState } from 'react'
import { errorMessage } from '../../lib/errors'
import { adminCarCustomSave } from '../../services/cars'
import { Turntable } from './Showroom'
import { SAMPLE_SPEC, carPrompt, parseCarSpec, registerCustom } from './customCar'

/** Nur für den Admin: eigenes Auto per KI-Bauplan (JSON) anlegen, ansehen, Werte und Preis setzen, speichern. */
export default function AdminCarBuilder({ onSaved }: { onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [wish, setWish] = useState('')
  const [text, setText] = useState('')
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [price, setPrice] = useState(20000)
  const [kmh, setKmh] = useState(260)
  const [acc, setAcc] = useState(24)
  const [turn, setTurn] = useState(2)
  const [brake, setBrake] = useState(42)
  const [fly, setFly] = useState(false)
  const [bike, setBike] = useState(false)
  const [color, setColor] = useState('#ef4444')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const parsed = useMemo(() => (text.trim() ? parseCarSpec(text) : null), [text])
  const spec = useMemo(() => {
    if (!parsed?.ok) return null
    const s = { ...parsed.spec, fly, bike, kmh, acc, turn, brake }
    registerCustom('c_preview', s, kmh)
    return s
  }, [parsed, fly, bike, kmh, acc, turn, brake])
  const copy = async () => { try { await navigator.clipboard.writeText(carPrompt(wish)); setMsg('Anweisung kopiert – in die KI einfügen, das JSON-Ergebnis unten einfügen.') } catch { setMsg('Kopieren nicht möglich – markiere den Text unten von Hand.') } }
  async function save() {
    if (!spec) return
    setBusy(true); setMsg(null)
    try { await adminCarCustomSave(id.trim(), name.trim(), price, kmh, color, spec); await onSaved(); setMsg(`„${name}“ ist im Autohaus.`) } catch (e) { setMsg(errorMessage(e)) } finally { setBusy(false) }
  }
  const inp = 'min-h-[40px] w-full rounded-lg border border-white/15 bg-black/30 px-2 text-sm'
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="min-h-[44px] rounded-lg border border-dashed border-accent-cyan/60 px-4 text-sm text-accent-cyan hover:bg-accent-cyan/10">＋ Neues Auto per KI-Bauplan (Admin)</button>
  return (
    <div className="space-y-3 rounded-2xl border border-accent-cyan/40 bg-white/5 p-4">
      <div className="flex items-center justify-between"><h3 className="font-semibold">Neues Auto (Admin)</h3><button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-white/15 px-3 py-1 text-sm hover:bg-white/10">Schließen</button></div>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-300">
        <li>Beschreibe das Auto und kopiere die Anweisung für die KI.</li>
        <li>Füge die Antwort der KI (JSON) unten ein – das Auto erscheint sofort.</li>
        <li>Stelle Fliegen, Tempo und Preis ein und speichere.</li>
      </ol>
      <div className="flex flex-wrap gap-2"><input value={wish} onChange={(e) => setWish(e.target.value)} placeholder="z. B. futuristischer gelber Sportwagen mit großem Spoiler" className={`${inp} flex-1`} aria-label="Autobeschreibung" /><button type="button" onClick={() => void copy()} className="min-h-[40px] rounded-lg bg-accent-cyan px-4 font-semibold text-slate-950">Anweisung kopieren</button></div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} placeholder='JSON der KI hier einfügen: {"len": 4.5, "wid": 1.9, "wheels": [...], "parts": [...]}' className={`${inp} font-mono text-xs`} aria-label="Bauplan (JSON)" />
      <div className="flex flex-wrap items-center gap-2"><button type="button" onClick={() => setText(SAMPLE_SPEC)} className="rounded-lg border border-white/15 px-3 py-1 text-xs hover:bg-white/10">Beispiel einfügen</button>{parsed && !parsed.ok && <p className="text-sm text-rose-300" role="alert">{parsed.error}</p>}{parsed?.ok && <p className="text-sm text-emerald-300">Bauplan ok · {parsed.spec.parts.length} Teile, {parsed.spec.wheels.length} Räder</p>}</div>
      {spec && <div className="overflow-hidden rounded-xl border border-white/10 bg-[radial-gradient(ellipse_at_50%_20%,#1e3a5f_0%,#0b1220_70%)]"><Turntable kind="c_preview" color={color} /></div>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="text-xs text-slate-300">ID (a–z, 0–9, _)<input value={id} onChange={(e) => setId(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} className={inp} /></label>
        <label className="text-xs text-slate-300">Name<input value={name} onChange={(e) => setName(e.target.value)} className={inp} /></label>
        <label className="text-xs text-slate-300">Preis (Coins)<input type="number" min={0} value={price} onChange={(e) => setPrice(Math.max(0, Number(e.target.value) || 0))} className={inp} /></label>
        <label className="text-xs text-slate-300">Grundfarbe<input type="color" value={color} onChange={(e) => setColor(e.target.value)} className={`${inp} p-0`} /></label>
        <label className="text-xs text-slate-300">Höchstgeschw. km/h<input type="number" min={50} max={400} value={kmh} onChange={(e) => setKmh(Math.min(400, Math.max(50, Number(e.target.value) || 50)))} className={inp} /></label>
        <label className="text-xs text-slate-300">Beschleunigung<input type="number" min={5} max={45} value={acc} onChange={(e) => setAcc(Number(e.target.value) || 20)} className={inp} /></label>
        <label className="text-xs text-slate-300">Lenkung<input type="number" step={0.1} min={0.8} max={3} value={turn} onChange={(e) => setTurn(Number(e.target.value) || 2)} className={inp} /></label>
        <label className="text-xs text-slate-300">Bremsen<input type="number" min={15} max={60} value={brake} onChange={(e) => setBrake(Number(e.target.value) || 40)} className={inp} /></label>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={fly} onChange={(e) => setFly(e.target.checked)} /> kann fliegen</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={bike} onChange={(e) => setBike(e.target.checked)} /> Motorrad</label>
        <button type="button" disabled={!spec || !id || !name.trim() || busy} onClick={() => void save()} className="ml-auto min-h-[44px] rounded-lg bg-accent-cyan px-6 font-bold text-slate-950 disabled:opacity-40">{busy ? '…' : 'Speichern'}</button>
      </div>
      {msg && <p className="text-sm text-slate-200" role="status">{msg}</p>}
    </div>
  )
}
