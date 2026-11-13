import { useEffect, useMemo, useState } from 'react'
import CarArt from '../CarArt'
import { carList, type CarRow } from '../../../services/cars'
import type { OgView } from '../../../services/online'
import RaceView, { type RaceCarInfo } from './RaceView'
import { TrackPreview } from './RaceMenu'
import { TRACKS } from './track'

const KEY = 'vt-race-car'
const LOAN: RaceCarInfo = { name: 'Leihwagen', kind: 'kleinwagen', color: '#94a3b8' }

/** Eigenes Auto fürs Online-Rennen: gekaufte Autos zur Wahl, sonst ein Leihwagen. */
export function useRaceCar(): { cars: CarRow[]; car: RaceCarInfo; pick: string | null; setPick: (id: string) => void } {
  const [cars, setCars] = useState<CarRow[]>([])
  const [pick, setPickState] = useState<string | null>(() => { try { return localStorage.getItem(KEY) } catch { return null } })
  useEffect(() => { let on = true; void carList().then((l) => { if (on) setCars(l.filter((c) => c.owned)) }).catch(() => undefined); return () => { on = false } }, [])
  const sel = cars.find((c) => c.id === pick) ?? cars[0]
  const car = useMemo<RaceCarInfo>(() => (sel ? { name: sel.name, kind: sel.kind, color: sel.color, top: sel.top_kmh } : LOAN), [sel])
  return { cars, car, pick: sel?.id ?? null, setPick: (id) => { setPickState(id); try { localStorage.setItem(KEY, id) } catch { /* ignorieren */ } } }
}

/** Lobby: Auto wählen; der Gastgeber wählt Strecke und Runden. */
export function RaceLobbyOptions({ view, isHost, busy, onSet }: { view: OgView; isHost: boolean; busy: boolean; onSet: (track: number, laps: number) => void }) {
  const { cars, pick, setPick } = useRaceCar()
  const track = view.state.track ?? 0
  const laps = view.state.laps ?? 3
  const chip = (on: boolean) => `min-h-[44px] rounded-lg border px-4 ${on ? 'border-accent-cyan bg-accent-cyan/20' : 'border-white/15 hover:bg-white/10'}`
  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1 text-sm font-semibold">Dein Auto</p>
        {cars.length === 0 ? <p className="text-sm text-slate-400">Du hast noch kein Auto – du fährst mit einem Leihwagen. Im Autohaus kannst du eins kaufen.</p> : (
          <div className="flex flex-wrap gap-2">{cars.map((c) => <button key={c.id} type="button" onClick={() => setPick(c.id)} aria-pressed={pick === c.id} className={`w-24 rounded-xl border p-1 text-center text-xs ${pick === c.id ? 'border-accent-cyan bg-white/10' : 'border-white/10'}`}><CarArt kind={c.kind} color={c.color} label={c.name} className="w-full" />{c.name}</button>)}</div>
        )}
      </div>
      <div>
        <p className="mb-1 text-sm font-semibold">Strecke: {TRACKS[track]?.name}</p>
        {isHost ? (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {TRACKS.map((t) => <li key={t.id}><button type="button" disabled={busy} onClick={() => onSet(t.id, laps)} aria-pressed={track === t.id} className={`w-full rounded-lg border p-1 text-[11px] ${track === t.id ? 'border-accent-cyan bg-white/10' : 'border-white/10'}`}><TrackPreview id={t.id} className="w-full" />{t.name}</button></li>)}
          </ul>
        ) : <TrackPreview id={track} className="h-24 rounded-lg bg-slate-800/60" />}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">Runden:</span>
        {isHost ? [1, 3, 5].map((n) => <button key={n} type="button" disabled={busy} className={chip(laps === n)} onClick={() => onSet(track, n)}>{n}</button>) : <span className="text-sm">{laps}</span>}
      </div>
    </div>
  )
}

/** Das laufende Online-Rennen. */
export function RaceOnline({ view, onFinish }: { view: OgView; onFinish: (ms: number) => void }) {
  const { car } = useRaceCar()
  const players = view.players.filter((p) => p.seat !== null && p.join_state === 'joined')
  return <RaceView key={view.id} trackId={view.state.track ?? 0} laps={view.state.laps ?? 3} me={car} online={{ gameId: view.id, userId: view.me.user_id, players: players.map((p) => ({ id: p.user_id, name: p.name })) }} onFinish={onFinish} />
}
