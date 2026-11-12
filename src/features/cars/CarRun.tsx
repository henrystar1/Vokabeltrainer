import { useCallback, useEffect, useRef, useState } from 'react'
import CarArt from './CarArt'
import { LANES, PLAYER_X, moveLane, startRun, stepRun, type RunState } from './carRun'

const bestKey = (id: string) => `carrun-best-${id}`
function loadBest(id: string): number { try { return Number(localStorage.getItem(bestKey(id))) || 0 } catch { return 0 } }

/** Autobahn: mit dem eigenen Auto langsameren Autos ausweichen (oben/unten oder Pfeiltasten/W/S, am iPad auf die obere/untere Hälfte tippen). */
export default function CarRun({ car }: { car: { id: string; name: string; kind: string; color: string } }) {
  const [s, setS] = useState<RunState>(() => startRun())
  const [running, setRunning] = useState(false)
  const [best, setBest] = useState(() => loadBest(car.id))
  const ref = useRef(s)
  ref.current = s

  useEffect(() => { setBest(loadBest(car.id)) }, [car.id])
  const up = useCallback(() => setS((x) => moveLane(x, -1)), [])
  const down = useCallback(() => setS((x) => moveLane(x, 1)), [])
  const start = () => { setS(startRun()); setRunning(true) }

  useEffect(() => {
    if (!running) return
    let raf = 0
    let last = performance.now()
    const frame = (t: number) => {
      const dt = Math.min((t - last) / 1000, 0.05)
      last = t
      const next = stepRun(ref.current, dt)
      if (next.over) {
        setRunning(false)
        const d = Math.floor(next.dist)
        if (d > loadBest(car.id)) { try { localStorage.setItem(bestKey(car.id), String(d)) } catch { /* ohne Speicher */ } setBest(d) }
      }
      setS(next)
      if (!next.over) raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [running, car.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (['ArrowUp', 'KeyW'].includes(e.code)) { e.preventDefault(); up() }
      else if (['ArrowDown', 'KeyS'].includes(e.code)) { e.preventDefault(); down() }
      else if ((e.code === 'Space' || e.code === 'Enter') && !running && (e.target as HTMLElement).tagName !== 'BUTTON') { e.preventDefault(); start() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, up, down])

  const laneTop = (l: number) => `${6 + l * (88 / LANES)}%`
  const laneH = `${88 / LANES}%`
  return (
    <div className="space-y-2">
      <div className="relative h-56 w-full touch-none select-none overflow-hidden rounded-2xl border border-white/10 bg-slate-800 sm:h-64"
        onPointerDown={(e) => { if (!running) return; const r = e.currentTarget.getBoundingClientRect(); if (e.clientY - r.top < r.height / 2) up(); else down() }}>
        {[1, 2].map((i) => <div key={i} className="absolute left-0 right-0 border-t-2 border-dashed border-white/25" style={{ top: `${6 + i * (88 / LANES)}%` }} />)}
        {s.obstacles.map((o) => (
          <div key={o.id} className="absolute" style={{ top: laneTop(o.lane), height: laneH, width: '16%', left: `${o.x * 100 - 8}%` }}><CarArt kind={o.kind} color={o.color} className="h-full w-full" label="Hindernis" /></div>
        ))}
        <div className="absolute transition-[top] duration-100" style={{ top: laneTop(s.lane), height: laneH, width: '16%', left: `${PLAYER_X * 100 - 8}%` }}><CarArt kind={car.kind} color={car.color} className="h-full w-full" label={car.name} /></div>
        <div className="pointer-events-none absolute left-3 top-2 rounded bg-black/50 px-2 py-0.5 text-xs text-white">{Math.floor(s.dist)} m · Rekord {best} m</div>
        {!running && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/55 text-center text-white">
            <p className="text-sm">{s.over ? `Crash nach ${Math.floor(s.dist)} m${Math.floor(s.dist) >= best && s.dist > 0 ? ' – neuer Rekord!' : ''}` : 'Weiche den langsameren Autos aus.'}</p>
            <button type="button" onClick={start} className="min-h-[44px] rounded-lg bg-accent-cyan px-5 font-semibold text-slate-950">{s.over ? 'Nochmal' : 'Losfahren'}</button>
            <p className="text-xs text-white/70">Pfeil hoch/runter oder W/S · am iPad obere/untere Hälfte antippen</p>
          </div>
        )}
      </div>
      <div className="flex gap-2 sm:hidden">
        <button type="button" onClick={up} className="min-h-[48px] flex-1 rounded-lg border border-white/15">▲ Spur hoch</button>
        <button type="button" onClick={down} className="min-h-[48px] flex-1 rounded-lg border border-white/15">▼ Spur runter</button>
      </div>
    </div>
  )
}
