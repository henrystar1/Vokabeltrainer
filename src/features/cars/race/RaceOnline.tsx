import { useEffect, useMemo, useRef, useState } from 'react'
import CarArt from '../CarArt'
import { carKmh } from '../stats'
import { raceTrackList, type RaceTrackRow } from '../../../services/cars'
import { ogRacePick, type OgView } from '../../../services/online'
import RaceView, { type RaceCarInfo } from './RaceView'
import { TrackPreview } from './RaceMenu'
import { TRACKS, customTrackDef } from './track'
import { useRaceCars } from './useRaceCars'

const KEY = 'vt-race-car'
const LOAN: RaceCarInfo = { name: 'Leihwagen', kind: 'kleinwagen', color: '#94a3b8' }
const getPick = () => { try { return localStorage.getItem(KEY) } catch { return null } }

/** Lobby: alle sehen die gewählten Autos der Mitspieler, jeder wählt seins; der Gastgeber wählt Strecke (fest oder gemalt) und Runden. */
export function RaceLobbyOptions({ view, isHost, busy, onSet }: { view: OgView; isHost: boolean; busy: boolean; onSet: (track: number, laps: number, custom?: string | null) => void }) {
  const { cars, ready } = useRaceCars()
  const [custom, setCustom] = useState<RaceTrackRow[]>([])
  const [err, setErr] = useState<string | null>(null)
  const sent = useRef<string | null>(null)
  const mine = view.state.cars?.[view.me.user_id]
  const laps = view.state.laps ?? 3
  const track = view.state.track ?? 0
  const cust = view.state.custom ?? null

  useEffect(() => { if (isHost) void raceTrackList().then(setCustom).catch(() => undefined) }, [isHost])

  const choose = (id: string) => {
    try { localStorage.setItem(KEY, id) } catch { /* ignorieren */ }
    sent.current = id
    setErr(null)
    void ogRacePick(view.id, id).catch((e: unknown) => setErr(e instanceof Error ? e.message : 'Auto konnte nicht gewählt werden.'))
  }
  // Beim Betreten das zuletzt gewählte (oder erste) Auto automatisch wählen
  useEffect(() => {
    if (!ready || cars.length === 0 || mine) return
    const want = cars.find((c) => c.id === getPick()) ?? cars.find((c) => c.id !== 'supercar') ?? cars[0]
    if (sent.current === want.id) return
    choose(want.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, cars, mine])

  const chip = (on: boolean) => `min-h-[44px] rounded-lg border px-4 ${on ? 'border-accent-cyan bg-accent-cyan/20' : 'border-white/15 hover:bg-white/10'}`
  const joined = view.players.filter((p) => p.join_state === 'joined')
  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1 text-sm font-semibold">Dein Auto</p>
        {ready && cars.length === 0 ? <p className="text-sm text-slate-400">Du hast noch kein Auto – du fährst mit einem Leihwagen. Im Autohaus kannst du eins kaufen.</p> : (
          <div className="flex flex-wrap gap-2">{cars.map((c) => <button key={c.id} type="button" onClick={() => choose(c.id)} aria-pressed={mine?.id === c.id} className={`w-24 rounded-xl border p-1 text-center text-xs ${mine?.id === c.id ? 'border-accent-cyan bg-white/10' : 'border-white/10'}`}><CarArt kind={c.kind} color={c.color} label={c.name} className="w-full" />{c.name}<span className="block text-slate-400">{carKmh(c.kind, c.top)} km/h</span></button>)}</div>
        )}
        {err && <p className="mt-1 text-sm text-amber-200" role="alert">{err}</p>}
      </div>
      <div>
        <p className="mb-1 text-sm font-semibold">Auf der Startaufstellung</p>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {joined.map((p) => {
            const c = view.state.cars?.[p.user_id]
            return (
              <li key={p.user_id} className="rounded-xl border border-white/10 p-1 text-center text-xs">
                {c ? <CarArt kind={c.kind} color={c.color} label={c.name ?? 'Auto'} className="w-full" /> : <div className="grid h-14 place-items-center text-slate-500">wählt …</div>}
                <b className="block truncate">{p.name}</b><span className="block truncate text-slate-400">{c ? `${c.name ?? ''} · ${carKmh(c.kind, c.top)} km/h` : ' '}</span>
              </li>
            )
          })}
        </ul>
      </div>
      <div>
        <p className="mb-1 text-sm font-semibold">Strecke: {cust ? cust.name : TRACKS[track]?.name}</p>
        {isHost ? (
          <div className="space-y-2">
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {TRACKS.map((t) => <li key={t.id}><button type="button" disabled={busy} onClick={() => onSet(t.id, TRACKS[t.id].laps === laps ? laps : laps, null)} aria-pressed={!cust && track === t.id} className={`w-full rounded-lg border p-1 text-[11px] ${!cust && track === t.id ? 'border-accent-cyan bg-white/10' : 'border-white/10'}`}><TrackPreview id={t.id} className="w-full" />{t.name}</button></li>)}
            </ul>
            {custom.length > 0 && (
              <>
                <p className="text-xs text-slate-400">Gemalte Strecken</p>
                <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {custom.map((c) => <li key={c.id}><button type="button" disabled={busy} onClick={() => onSet(0, laps, c.id)} aria-pressed={cust?.id === c.id} className={`w-full rounded-lg border p-1 text-[11px] ${cust?.id === c.id ? 'border-accent-cyan bg-white/10' : 'border-white/10'}`}><TrackPreview def={customTrackDef(c.name, c.pts, c.width, `c:${c.id}`)} className="w-full" />{c.name}</button></li>)}
                </ul>
              </>
            )}
          </div>
        ) : <TrackPreview id={track} def={cust ? customTrackDef(cust.name, cust.pts, cust.width, `c:${cust.id}`) : undefined} className="h-24 rounded-lg bg-slate-800/60" />}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">Runden:</span>
        {isHost ? [1, 2, 3, 5].map((n) => <button key={n} type="button" disabled={busy} className={chip(laps === n)} onClick={() => onSet(track, n, cust?.id ?? null)}>{n}</button>) : <span className="text-sm">{laps}</span>}
      </div>
    </div>
  )
}

/** Das laufende Online-Rennen: jeder fährt das Auto, das er in der Lobby gewählt hat (steht auf dem Server). */
export function RaceOnline({ view, onFinish }: { view: OgView; onFinish: (ms: number) => void }) {
  const { superOk } = useRaceCars()
  const players = view.players.filter((p) => p.seat !== null && p.join_state === 'joined')
  const mine = view.state.cars?.[view.me.user_id]
  const car = useMemo<RaceCarInfo>(() => (mine ? { id: mine.id, name: mine.name ?? 'Auto', kind: mine.kind, color: mine.color, top: mine.top ?? null } : LOAN), [mine])
  const cust = view.state.custom ?? null
  const def = useMemo(() => (cust ? customTrackDef(cust.name, cust.pts, cust.width, `c:${cust.id}`) : undefined), [cust])
  return (
    <RaceView key={view.id} trackId={view.state.track ?? 0} custom={def} laps={view.state.laps ?? 3} me={car} assistOk={superOk && mine?.id === 'supercar'}
      online={{ gameId: view.id, userId: view.me.user_id, players: players.map((p) => ({ id: p.user_id, name: p.name })), cars: view.state.cars }} onFinish={onFinish} />
  )
}
