import { useEffect, useRef, useState } from 'react'
import type { Bld } from './city'
import { CITY } from './city'
import { FURNITURE, MAX_FURN, furnDef, type Furn, type StoredCar } from './house'
import { layoutOf } from './interior'
import { BUNKER } from './bunker'
import { MOUNTAINS, WORLD } from './mountains'

const box = 'absolute inset-0 z-30 grid place-items-center bg-black/65 p-3'
const card = 'max-h-full w-full overflow-auto rounded-2xl border border-white/30 bg-slate-900/95 p-4 text-white shadow-2xl'

/** Möbel-Editor: Grundriss des Erdgeschosses von oben, Möbel antippen oder aus der Leiste platzieren. */
export function FurnitureEditor({ b, furn, onChange, onClose }: { b: Bld; furn: Furn[]; onChange: (f: Furn[]) => void; onClose: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [tool, setTool] = useState<string | null>('sofa')
  const [sel, setSel] = useState<number | null>(null)
  const lay = layoutOf(b)
  const W = 640, H = Math.round(640 * (b.d / b.w))
  const sc = W / b.w
  const toPx = (x: number, z: number) => ({ x: (x - (b.x - b.w / 2)) * sc, y: (z - (b.z - b.d / 2)) * sc })
  useEffect(() => {
    const g = ref.current?.getContext('2d'); if (!g) return
    g.fillStyle = '#1e293b'; g.fillRect(0, 0, W, H)
    g.fillStyle = '#334155'; g.fillRect(0, 0, W, H)
    g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1
    for (let x = 0; x <= b.w; x += 1) { g.beginPath(); g.moveTo(x * sc, 0); g.lineTo(x * sc, H); g.stroke() }
    for (let z = 0; z <= b.d; z += 1) { g.beginPath(); g.moveTo(0, z * sc); g.lineTo(W, z * sc); g.stroke() }
    const rect = (r: { x0: number; x1: number; z0: number; z1: number }, col: string) => { const a = toPx(r.x0, r.z0), c = toPx(r.x1, r.z1); g.fillStyle = col; g.fillRect(a.x, a.y, c.x - a.x, c.y - a.y) }
    rect(lay.stairCell, 'rgba(250,204,21,0.25)')
    for (const r of lay.outerG) rect(r, '#e2e8f0')
    for (const r of lay.inner) rect(r, '#94a3b8')
    const d = toPx(lay.door.x, lay.door.z); g.fillStyle = '#22c55e'; g.beginPath(); g.arc(d.x, d.y, 8, 0, 7); g.fill()
    g.font = '12px sans-serif'; g.fillStyle = '#facc15'; g.fillText('Treppe', toPx(lay.stairCell.x0, lay.stairCell.z0).x + 4, toPx(lay.stairCell.x0, lay.stairCell.z0).y + 14)
    furn.forEach((f, i) => {
      const dd = furnDef(f.k); if (!dd) return
      const w = (f.r ? dd.d : dd.w) * sc, h = (f.r ? dd.w : dd.d) * sc, p = toPx(b.x + f.x, b.z + f.z)
      g.fillStyle = '#' + dd.color.toString(16).padStart(6, '0'); g.fillRect(p.x - w / 2, p.y - h / 2, w, h)
      g.strokeStyle = i === sel ? '#f87171' : 'rgba(0,0,0,0.5)'; g.lineWidth = i === sel ? 3 : 1; g.strokeRect(p.x - w / 2, p.y - h / 2, w, h)
      g.font = `${Math.max(12, Math.min(w, h) * 0.7)}px sans-serif`; g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(dd.icon, p.x, p.y); g.textAlign = 'start'; g.textBaseline = 'alphabetic'
    })
  }, [furn, sel, b, lay, sc, W, H])
  const tap = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cv = ref.current; if (!cv) return
    const r = cv.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W, py = ((e.clientY - r.top) / r.height) * H
    const wx = px / sc - b.w / 2, wz = py / sc - b.d / 2
    const snap = (v: number) => Math.round(v * 2) / 2
    const hit = furn.findIndex((f) => { const dd = furnDef(f.k); if (!dd) return false; const w = f.r ? dd.d : dd.w, h = f.r ? dd.w : dd.d; return Math.abs(wx - f.x) <= w / 2 + 0.2 && Math.abs(wz - f.z) <= h / 2 + 0.2 })
    if (hit >= 0) { setSel(hit); setTool(null); return }
    if (tool) { if (furn.length >= MAX_FURN) return; onChange([...furn, { k: tool, x: snap(wx), z: snap(wz), r: 0 }]); setSel(furn.length); setTool(null) }
    else if (sel !== null && furn[sel]) onChange(furn.map((f, i) => (i === sel ? { ...f, x: snap(wx), z: snap(wz) } : f)))
  }
  return (
    <div className={box} role="dialog" aria-label="Haus einrichten">
      <div className={`${card} max-w-3xl`}>
        <div className="mb-2 flex items-center justify-between"><h2 className="text-lg font-black text-amber-300">Haus einrichten (Erdgeschoss von oben)</h2><button type="button" onClick={onClose} className="min-h-[44px] rounded-lg bg-emerald-500 px-4 text-sm font-bold text-slate-950">Fertig &amp; speichern</button></div>
        <p className="mb-2 text-xs text-slate-300">Möbel unten wählen, dann in den Grundriss tippen. Tippe ein Möbelstück an, dann kannst du es drehen, löschen oder durch Tippen woanders hin versetzen. Grün = Haustür, gelb = Treppe.</p>
        <canvas ref={ref} width={W} height={H} onPointerDown={tap} className="mb-2 w-full touch-none rounded-xl border border-white/30" />
        <div className="mb-2 flex flex-wrap gap-1.5">
          {FURNITURE.map((f) => <button key={f.id} type="button" aria-pressed={tool === f.id} onClick={() => { setTool(tool === f.id ? null : f.id); setSel(null) }} className={`min-h-[44px] rounded-lg border px-2 text-xs font-bold ${tool === f.id ? 'border-amber-300 bg-sky-600' : 'border-white/30 bg-white/10'}`}>{f.icon} {f.name}</button>)}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={sel === null} onClick={() => sel !== null && onChange(furn.map((f, i) => (i === sel ? { ...f, r: f.r ? 0 : 1 } : f)))} className="min-h-[44px] rounded-lg bg-white/10 px-3 text-sm font-bold disabled:opacity-40">↻ Drehen</button>
          <button type="button" disabled={sel === null} onClick={() => { if (sel !== null) { onChange(furn.filter((_, i) => i !== sel)); setSel(null) } }} className="min-h-[44px] rounded-lg bg-red-500/70 px-3 text-sm font-bold disabled:opacity-40">🗑 Löschen</button>
          <span className="ml-auto self-center text-xs text-slate-300">{furn.length}/{MAX_FURN} Möbel</span>
        </div>
      </div>
    </div>
  )
}

/** Garage: hier ist man vor der Polizei versteckt; Autos abstellen und herausholen. */
export function GaragePanel({ cars, onTake, onFoot }: { cars: StoredCar[]; onTake: (i: number) => void; onFoot: () => void }) {
  return (
    <div className={box} role="dialog" aria-label="Garage">
      <div className={`${card} max-w-md`}>
        <h2 className="mb-1 text-lg font-black text-emerald-300">Deine Garage</h2>
        <p className="mb-3 text-sm text-slate-200">Das Tor ist zu – hier findet dich die Polizei nicht. Ihre Suche lässt nach, solange du drin bleibst.</p>
        <ul className="mb-3 grid gap-2">
          {cars.map((c, i) => (
            <li key={i} className="flex items-center gap-3 rounded-xl bg-white/10 p-2">
              <span className="h-8 w-8 rounded-full border border-white/50" style={{ background: c.color }} aria-hidden />
              <span className="flex-1 text-sm font-bold">{c.kind}</span>
              <button type="button" onClick={() => onTake(i)} className="min-h-[44px] rounded-lg bg-emerald-500 px-3 text-sm font-bold text-slate-950">Losfahren</button>
            </li>
          ))}
        </ul>
        <button type="button" onClick={onFoot} className="min-h-[48px] w-full rounded-xl bg-white/15 px-4 text-sm font-bold">Zu Fuß hinausgehen</button>
      </div>
    </div>
  )
}

/** KSK-Aufträge am Strategietisch */
export function MissionPanel({ active, onStart, onCancel, onClose }: { active: string | null; onStart: (k: 'kill' | 'car') => void; onCancel: () => void; onClose: () => void }) {
  return (
    <div className={box} role="dialog" aria-label="KSK-Aufträge">
      <div className={`${card} max-w-md`}>
        <div className="mb-2 flex items-center justify-between"><h2 className="text-lg font-black text-cyan-300">KSK-Aufträge</h2><button type="button" onClick={onClose} className="min-h-[44px] rounded-lg bg-white/10 px-4 text-sm font-bold">Schließen</button></div>
        {active ? (
          <>
            <p className="mb-3 rounded-lg bg-cyan-500/15 p-2 text-sm">Aktiver Auftrag: <b>{active}</b><br /><span className="text-xs text-slate-300">Das Ziel ist auf der Karte (roter Punkt) und mit einem roten Lichtstrahl markiert.</span></p>
            <button type="button" onClick={onCancel} className="min-h-[48px] w-full rounded-xl bg-red-500/70 px-4 text-sm font-bold">Auftrag abbrechen</button>
          </>
        ) : (
          <div className="grid gap-2">
            <button type="button" onClick={() => onStart('kill')} className="rounded-xl bg-white/10 p-3 text-left"><b className="block">🎯 Zielperson ausschalten</b><span className="text-xs text-slate-300">Eine Person irgendwo in der Stadt (roter Strahl). 400 Coins.</span></button>
            <button type="button" onClick={() => onStart('car')} className="rounded-xl bg-white/10 p-3 text-left"><b className="block">🚗 Bestimmtes Auto klauen</b><span className="text-xs text-slate-300">Ein markiertes Auto, das irgendwo geparkt steht – steig ein. 500 Coins.</span></button>
          </div>
        )}
      </div>
    </div>
  )
}

/** Flugzeug-Karte im Bunker: Punkt wählen, dann Absprung per Fallschirm */
export function PlaneMapPanel({ onGo, onClose }: { onGo: (x: number, z: number) => void; onClose: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [pt, setPt] = useState<{ x: number; z: number } | null>(null)
  const S = 480, k = S / (WORLD.x1 - WORLD.x0), H = Math.round((WORLD.z1 - WORLD.z0) * k)
  const X = (x: number) => (x - WORLD.x0) * k, Y = (z: number) => H - (z - WORLD.z0) * k
  useEffect(() => {
    const g = ref.current?.getContext('2d'); if (!g) return
    g.fillStyle = '#031017'; g.fillRect(0, 0, S, H)
    g.fillStyle = '#134e4a'; for (const m of MOUNTAINS) { g.beginPath(); g.arc(X(m.x), Y(m.z), m.R * k, 0, 7); g.fill() }
    g.strokeStyle = '#475569'; g.lineWidth = 1
    for (let i = -CITY.K; i <= CITY.K; i++) { g.beginPath(); g.moveTo(X(i * CITY.pitch), Y(-CITY.half)); g.lineTo(X(i * CITY.pitch), Y(CITY.half)); g.stroke(); g.beginPath(); g.moveTo(X(-CITY.half), Y(i * CITY.pitch)); g.lineTo(X(CITY.half), Y(i * CITY.pitch)); g.stroke() }
    g.strokeStyle = '#22d3ee'; g.lineWidth = 2; g.strokeRect(X(WORLD.x0), Y(WORLD.z1), S, H)
    g.fillStyle = '#facc15'; g.fillRect(X(BUNKER.ex) - 5, Y(BUNKER.ez) - 5, 10, 10)
    if (pt) { g.strokeStyle = '#f87171'; g.lineWidth = 3; g.beginPath(); g.arc(X(pt.x), Y(pt.z), 10, 0, 7); g.moveTo(X(pt.x) - 16, Y(pt.z)); g.lineTo(X(pt.x) + 16, Y(pt.z)); g.moveTo(X(pt.x), Y(pt.z) - 16); g.lineTo(X(pt.x), Y(pt.z) + 16); g.stroke() }
  }, [pt, S, H, k])
  const tap = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = ref.current!.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * S, py = ((e.clientY - r.top) / r.height) * H
    setPt({ x: WORLD.x0 + px / k, z: WORLD.z0 + (H - py) / k })
  }
  return (
    <div className={box} role="dialog" aria-label="Flugzeug-Karte">
      <div className={`${card} max-w-xl`}>
        <div className="mb-2 flex items-center justify-between"><h2 className="text-lg font-black text-cyan-300">Fallschirm-Einsatz</h2><button type="button" onClick={onClose} className="min-h-[44px] rounded-lg bg-white/10 px-4 text-sm font-bold">Schließen</button></div>
        <p className="mb-2 text-xs text-slate-300">Tippe auf der Karte den Zielpunkt an. Du wirst in ein Flugzeug über dem Bunker gebracht, das zum Ziel fliegt und dich dort mit dem Fallschirm abwirft (gelb = Bunker).</p>
        <canvas ref={ref} width={S} height={H} onPointerDown={tap} className="mb-2 w-full touch-none rounded-xl border border-cyan-500/50" />
        <button type="button" disabled={!pt} onClick={() => pt && onGo(pt.x, pt.z)} className="min-h-[52px] w-full rounded-xl bg-cyan-400 px-4 text-base font-bold text-slate-950 disabled:opacity-40">✈ Einsteigen und abfliegen</button>
      </div>
    </div>
  )
}
