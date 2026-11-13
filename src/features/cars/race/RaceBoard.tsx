import { useEffect, useState } from 'react'
import CarArt from '../CarArt'
import { carKmh } from '../stats'
import { raceBoard, raceCarBoard, raceTrackList, type BoardRow, type CarBoardRow, type CarRow, type RaceTrackRow } from '../../../services/cars'
import { TRACKS } from './track'

const fmt = (ms: number) => { const m = Math.floor(ms / 60000); const s = ms / 1000 - m * 60; return `${m}:${s.toFixed(2).padStart(5, '0')}` }

/** Ranglisten: schnellste Fahrer und schnellste Autos je Strecke (beste Runde), dazu alle Autos nach Höchstgeschwindigkeit. */
export default function RaceBoard({ cars }: { cars: CarRow[] }) {
  const [custom, setCustom] = useState<RaceTrackRow[]>([])
  const [track, setTrack] = useState('t0')
  const [drivers, setDrivers] = useState<BoardRow[] | null>(null)
  const [byCar, setByCar] = useState<CarBoardRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { void raceTrackList().then(setCustom).catch(() => undefined) }, [])
  useEffect(() => {
    let on = true
    setDrivers(null); setByCar(null); setErr(null)
    void Promise.all([raceBoard(track), raceCarBoard(track)]).then(([d, c]) => { if (on) { setDrivers(d); setByCar(c) } }).catch(() => { if (on) setErr('Die Rangliste konnte nicht geladen werden.') })
    return () => { on = false }
  }, [track])
  const chip = (on: boolean) => `min-h-[40px] rounded-lg border px-3 text-sm ${on ? 'border-accent-cyan bg-accent-cyan/20' : 'border-white/15 hover:bg-white/10'}`
  const speed = [...cars].sort((a, b) => carKmh(b.kind, b.top_kmh) - carKmh(a.kind, a.top_kmh))
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Strecke">
        {TRACKS.map((t) => <button key={t.id} type="button" className={chip(track === `t${t.id}`)} aria-pressed={track === `t${t.id}`} onClick={() => setTrack(`t${t.id}`)}>{t.name}</button>)}
        {custom.map((c) => <button key={c.id} type="button" className={chip(track === `c:${c.id}`)} aria-pressed={track === `c:${c.id}`} onClick={() => setTrack(`c:${c.id}`)}>{c.name}</button>)}
      </div>
      {err && <p className="text-sm text-amber-200" role="alert">{err}</p>}
      <div className="grid gap-5 lg:grid-cols-2">
        <section>
          <h3 className="mb-2 font-semibold">Schnellste Fahrer (beste Runde)</h3>
          {!drivers ? <p className="text-sm text-slate-400">Lädt …</p> : drivers.length === 0 ? <p className="text-sm text-slate-400">Noch keine Zeit. Fahre eine Runde!</p> : (
            <ol className="space-y-1">{drivers.map((r, i) => <li key={i} className={`flex items-center gap-2 rounded-lg px-2 py-1 text-sm ${r.me ? 'bg-accent-cyan/15 font-semibold' : 'bg-white/5'}`}><span className="w-6 text-slate-400">{i + 1}.</span><CarArt kind={r.kind} color={r.color} label={r.car} className="w-14" /><span className="min-w-0 flex-1 truncate">{r.name}<span className="block truncate text-xs text-slate-400">{r.car}</span></span><span className="font-mono">{fmt(r.ms)}</span></li>)}</ol>
          )}
        </section>
        <section>
          <h3 className="mb-2 font-semibold">Schnellste Autos (beste Runde)</h3>
          {!byCar ? <p className="text-sm text-slate-400">Lädt …</p> : byCar.length === 0 ? <p className="text-sm text-slate-400">Noch kein Auto hat hier eine Zeit.</p> : (
            <ol className="space-y-1">{byCar.map((r, i) => <li key={i} className="flex items-center gap-2 rounded-lg bg-white/5 px-2 py-1 text-sm"><span className="w-6 text-slate-400">{i + 1}.</span><CarArt kind={r.kind} color={r.color} label={r.name} className="w-14" /><span className="min-w-0 flex-1 truncate">{r.name}<span className="block truncate text-xs text-slate-400">{carKmh(r.kind, r.top)} km/h · {r.driver}</span></span><span className="font-mono">{fmt(r.ms)}</span></li>)}</ol>
          )}
        </section>
      </div>
      <section>
        <h3 className="mb-2 font-semibold">Alle Autos nach Höchstgeschwindigkeit</h3>
        <ol className="grid gap-1 sm:grid-cols-2">{speed.map((c, i) => <li key={c.id} className="flex items-center gap-2 rounded-lg bg-white/5 px-2 py-1 text-sm"><span className="w-6 text-slate-400">{i + 1}.</span><CarArt kind={c.kind} color={c.color} label={c.name} className="w-14" /><span className="min-w-0 flex-1 truncate">{c.name}{c.owned ? ' ✓' : ''}</span><span className="font-mono">{carKmh(c.kind, c.top_kmh)} km/h</span></li>)}</ol>
      </section>
    </div>
  )
}
