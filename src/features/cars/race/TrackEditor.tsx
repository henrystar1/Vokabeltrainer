import { useMemo, useRef, useState } from 'react'
import { errorMessage } from '../../../lib/errors'
import { raceTrackSave } from '../../../services/cars'
import { TrackPreview } from './RaceMenu'
import { customTrackDef, type TrackDef } from './track'
import { fitDrawing, type Pt } from './trackDraw'

/** Strecke mit dem Finger oder der Maus malen: eine Runde zeichnen, Länge wählen, ausprobieren, speichern. */
export default function TrackEditor({ onClose, onTest, onSaved }: { onClose: () => void; onTest: (def: TrackDef) => void; onSaved: () => void }) {
  const svg = useRef<SVGSVGElement>(null)
  const [raw, setRaw] = useState<Pt[]>([])
  const drawing = useRef(false)
  const [km, setKm] = useState(3)
  const [width, setWidth] = useState(16)
  const [name, setName] = useState('')
  const [isPublic, setIsPublic] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [stroke, setStroke] = useState(false)
  const fit = useMemo(() => (raw.length && !stroke ? fitDrawing(raw, km * 1000, width) : null), [raw, km, width, stroke])
  const def = useMemo(() => (fit && !fit.error ? customTrackDef(name.trim() || 'Eigene Strecke', fit.pts, width, 'c:preview') : null), [fit, name, width])

  const at = (e: React.PointerEvent): Pt => {
    const r = svg.current!.getBoundingClientRect()
    return [((e.clientX - r.left) / r.width) * 400, ((e.clientY - r.top) / r.height) * 300]
  }
  const down = (e: React.PointerEvent) => { e.preventDefault(); (e.currentTarget as Element).setPointerCapture?.(e.pointerId); drawing.current = true; setStroke(true); setMsg(null); setRaw([at(e)]) }
  const move = (e: React.PointerEvent) => { if (!drawing.current) return; const p = at(e); setRaw((r) => { const l = r[r.length - 1]; return l && Math.hypot(l[0] - p[0], l[1] - p[1]) < 3 ? r : [...r, p] }) }
  const up = () => { if (!drawing.current) return; drawing.current = false; setStroke(false) }

  async function save() {
    if (!def || !fit) return
    if (name.trim().length < 2) { setMsg('Gib der Strecke einen Namen (mindestens 2 Zeichen).'); return }
    setBusy(true); setMsg(null)
    try { await raceTrackSave(name.trim(), fit.pts, width, isPublic); onSaved() } catch (e) { setMsg(errorMessage(e)) } finally { setBusy(false) }
  }
  const btn = 'min-h-[44px] rounded-lg px-4 font-semibold disabled:opacity-40'
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between"><h3 className="font-semibold">Strecke malen</h3><button type="button" onClick={onClose} className="min-h-[44px] rounded-lg bg-white/10 px-4">Zurück</button></div>
      <p className="text-sm text-slate-300">Male mit dem Finger oder der Maus eine Runde. Sie wird automatisch geschlossen, geglättet und auf die gewählte Länge gebracht. Der Start liegt am Anfang deiner Linie.</p>
      <svg ref={svg} viewBox="0 0 400 300" className="w-full touch-none rounded-xl border border-white/15 bg-slate-800/60" style={{ touchAction: 'none', cursor: 'crosshair' }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} role="img" aria-label="Zeichenfläche für die Strecke">
        {(!fit || fit.error) && raw.length > 1 && <polyline points={raw.map((p) => p.join(',')).join(' ')} fill="none" stroke="#22d3ee" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />}
        {raw.length === 0 && <text x="200" y="150" textAnchor="middle" fill="#94a3b8" fontSize="16">Hier eine Runde malen</text>}
      </svg>
      {def && <div className="flex items-center gap-3"><TrackPreview def={def} className="h-28 rounded-lg bg-slate-800/60" /><p className="text-sm text-slate-300">So wird deine Strecke: <b>{(fit!.length / 1000).toFixed(1)} km</b>. Der türkise Punkt ist der Start.</p></div>}
      {fit?.error && <p className="text-sm text-amber-200" role="alert">{fit.error}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Länge: <b>{km} km</b><input type="range" min={1} max={12} step={0.5} value={km} onChange={(e) => setKm(Number(e.target.value))} className="mt-1 block w-full" /></label>
        <label className="text-sm">Breite: <b>{width} m</b><input type="range" min={12} max={30} step={2} value={width} onChange={(e) => setWidth(Number(e.target.value))} className="mt-1 block w-full" /></label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <input aria-label="Name der Strecke" placeholder="Name der Strecke" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-white/15 bg-space-900/60 px-3" />
        <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} className="h-5 w-5" />für alle sichtbar</label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => { setRaw([]); setMsg(null) }} className={`${btn} bg-white/10`}>Neu malen</button>
        <button type="button" disabled={!def} onClick={() => def && onTest(def)} className={`${btn} bg-white/10`}>Probefahrt</button>
        <button type="button" disabled={!def || busy} onClick={() => void save()} className={`${btn} bg-accent-cyan text-slate-950`}>Speichern</button>
      </div>
      {msg && <p className="text-sm text-amber-200" role="status">{msg}</p>}
    </div>
  )
}
