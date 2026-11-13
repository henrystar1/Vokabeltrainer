import { useEffect, useMemo, useState } from 'react'
import { buildTrack, customTrackDef, TRACKS, type TrackDef } from './track'
import RaceView, { type RaceCarInfo } from './RaceView'
import TrackEditor from './TrackEditor'
import { raceTrackDelete, raceTrackList, type RaceTrackRow } from '../../../services/cars'

const BOT_NAMES = ['Blitz', 'Turbo Tom', 'Rennfuchs', 'Drift-Dora', 'Pit-Paul', 'Nitro Nina', 'Kurven-Karl', 'Gummi-Gerd', 'Apex-Alex', 'Schumi Jr.']
const BOT_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6', '#eab308', '#f8fafc', '#0ea5e9']
type Pool = Array<{ kind: string; top: number }>
/** Bots fahren gute Autos – je höher die Stufe, desto schneller. */
const LEVELS: ReadonlyArray<{ id: string; label: string; skill: number; pool: Pool }> = [
  { id: 'leicht', label: 'Leicht', skill: 0.7, pool: [{ kind: 'sportwagen', top: 200 }, { kind: 'cabrio', top: 190 }, { kind: 'limousine', top: 180 }, { kind: 'suv', top: 170 }, { kind: 'kombi', top: 170 }] },
  { id: 'mittel', label: 'Mittel', skill: 0.85, pool: [{ kind: 'sportwagen', top: 250 }, { kind: 'gt', top: 270 }, { kind: 'muscle', top: 235 }, { kind: 'rallye', top: 240 }, { kind: 'cabrio', top: 220 }] },
  { id: 'schwer', label: 'Schwer', skill: 0.95, pool: [{ kind: 'gt', top: 290 }, { kind: 'hypercar', top: 330 }, { kind: 'rennwagen', top: 340 }, { kind: 'sportwagen', top: 280 }, { kind: 'gt', top: 300 }] },
  { id: 'profi', label: 'Profi', skill: 1, pool: [{ kind: 'rennwagen', top: 400 }, { kind: 'hypercar', top: 400 }, { kind: 'rennwagen', top: 380 }, { kind: 'hypercar', top: 370 }, { kind: 'gt', top: 340 }] },
]

/** Kleine Streckenvorschau als SVG. */
export function TrackPreview({ id = 0, def, className = '' }: { id?: number; def?: TrackDef; className?: string }) {
  const use = def ?? TRACKS[id]
  const d = useMemo(() => {
    const t = buildTrack(use, Math.max(12, use.pts.length > 0 ? 12 : 12))
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
    for (let i = 0; i < t.n; i++) { x0 = Math.min(x0, t.x[i]); x1 = Math.max(x1, t.x[i]); z0 = Math.min(z0, t.z[i]); z1 = Math.max(z1, t.z[i]) }
    const sc = Math.min(180 / (x1 - x0), 100 / (z1 - z0))
    const ox = (200 - (x1 - x0) * sc) / 2 - x0 * sc, oz = (120 - (z1 - z0) * sc) / 2 - z0 * sc
    let p = ''
    for (let i = 0; i < t.n; i++) p += `${i ? 'L' : 'M'}${(t.x[i] * sc + ox).toFixed(1)} ${(t.z[i] * sc + oz).toFixed(1)}`
    return { p: p + 'Z', sx: t.x[0] * sc + ox, sz: t.z[0] * sc + oz }
  }, [use])
  return (
    <svg viewBox="0 0 200 120" className={className} role="img" aria-label={`Strecke ${use.name}`}>
      <path d={d.p} fill="none" stroke="#0f172a" strokeWidth="11" strokeLinejoin="round" />
      <path d={d.p} fill="none" stroke="#cbd5e1" strokeWidth="7" strokeLinejoin="round" />
      <circle cx={d.sx} cy={d.sz} r="4.5" fill="#22d3ee" />
    </svg>
  )
}

/** Einzelspieler: Strecke wählen (feste oder gemalte), Training oder gegen Bots. */
export default function RaceMenu({ car, assistOk = false }: { car: RaceCarInfo; assistOk?: boolean }) {
  const [sel, setSel] = useState<{ t: number } | { c: RaceTrackRow }>({ t: 0 })
  const [laps, setLaps] = useState(3)
  const [mode, setMode] = useState<'train' | 'bots'>('bots')
  const [level, setLevel] = useState('mittel')
  const [run, setRun] = useState<{ key: number } | null>(null)
  const [test, setTest] = useState<TrackDef | null>(null)
  const [editor, setEditor] = useState(false)
  const [custom, setCustom] = useState<RaceTrackRow[]>([])
  const loadCustom = () => { void raceTrackList().then(setCustom).catch(() => undefined) }
  useEffect(loadCustom, [])
  const def: TrackDef = 'c' in sel ? customTrackDef(sel.c.name, sel.c.pts, sel.c.width, `c:${sel.c.id}`) : TRACKS[sel.t]
  const pickTrack = (s: { t: number } | { c: RaceTrackRow }) => { setSel(s); setLaps('c' in s ? 2 : TRACKS[s.t].laps) }
  const bots = useMemo(() => {
    if (mode === 'train') return []
    const lv = LEVELS.find((l) => l.id === level) ?? LEVELS[1]
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5)
    const cols = [...BOT_COLORS].sort(() => Math.random() - 0.5)
    const pool = [...lv.pool].sort(() => Math.random() - 0.5)
    return Array.from({ length: 4 }, (_, i) => ({ name: names[i], kind: pool[i % pool.length].kind, top: pool[i % pool.length].top, color: cols[i], skill: Math.min(1, lv.skill - 0.04 + i * 0.015) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, level, run?.key])

  if (test) return <RaceView key="test" trackId={0} custom={test} laps={1} me={car} assistOk={assistOk} onAgain={() => setTest({ ...test })} onExit={() => setTest(null)} />
  if (run) return <RaceView key={run.key} trackId={'t' in sel ? sel.t : 0} custom={'c' in sel ? def : undefined} laps={laps} me={car} assistOk={assistOk} bots={bots} onAgain={() => setRun({ key: run.key + 1 })} onExit={() => setRun(null)} />
  if (editor) return <TrackEditor onClose={() => setEditor(false)} onTest={(d) => setTest(d)} onSaved={() => { setEditor(false); loadCustom() }} />

  const chip = (on: boolean) => `min-h-[44px] rounded-lg border px-4 ${on ? 'border-accent-cyan bg-accent-cyan/20' : 'border-white/15 hover:bg-white/10'}`
  const card = (on: boolean) => `w-full rounded-xl border p-2 text-left ${on ? 'border-accent-cyan bg-white/10' : 'border-white/10 hover:bg-white/5'}`
  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-2 font-semibold">Strecke</h3>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {TRACKS.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => pickTrack({ t: t.id })} aria-pressed={'t' in sel && sel.t === t.id} className={card('t' in sel && sel.t === t.id)}>
                <TrackPreview id={t.id} className="w-full rounded-lg bg-slate-800/60" />
                <p className="mt-1 text-sm font-semibold">{t.name}</p>
                <p className="text-xs text-slate-400">{t.text}</p>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Eigene Strecken</h3><button type="button" onClick={() => setEditor(true)} className="min-h-[44px] rounded-lg bg-accent-cyan px-4 font-semibold text-slate-950">Strecke malen</button></div>
        {custom.length === 0 ? <p className="text-sm text-slate-400">Noch keine. Male deine eigene Strecke – allein oder online fahrbar.</p> : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {custom.map((c) => {
              const d = customTrackDef(c.name, c.pts, c.width, `c:${c.id}`)
              const on = 'c' in sel && sel.c.id === c.id
              return (
                <li key={c.id}>
                  <button type="button" onClick={() => pickTrack({ c })} aria-pressed={on} className={card(on)}>
                    <TrackPreview def={d} className="w-full rounded-lg bg-slate-800/60" />
                    <p className="mt-1 text-sm font-semibold">{c.name}</p>
                    <p className="text-xs text-slate-400">von {c.mine ? 'dir' : c.owner}{c.public ? '' : ' · privat'}</p>
                  </button>
                  {c.mine && <button type="button" onClick={() => { if (window.confirm(`„${c.name}“ löschen?`)) void raceTrackDelete(c.id).then(loadCustom).catch(() => undefined) }} className="mt-1 text-xs text-rose-300 hover:underline">Löschen</button>}
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-300">Modus:</span>
        <button type="button" className={chip(mode === 'bots')} onClick={() => setMode('bots')}>Gegen Bots</button>
        <button type="button" className={chip(mode === 'train')} onClick={() => setMode('train')}>Training allein</button>
      </div>
      {mode === 'bots' && (
        <div className="flex flex-wrap items-center gap-2"><span className="text-sm text-slate-300">Schwierigkeit:</span>{LEVELS.map((l) => <button key={l.id} type="button" className={chip(level === l.id)} onClick={() => setLevel(l.id)}>{l.label}</button>)}<span className="text-xs text-slate-400">Profi fährt starke Autos exakt auf der Ideallinie.</span></div>
      )}
      <div className="flex flex-wrap items-center gap-2"><span className="text-sm text-slate-300">Runden:</span>{[1, 2, 3, 5].map((n) => <button key={n} type="button" className={chip(laps === n)} onClick={() => setLaps(n)}>{n}</button>)}</div>
      <button type="button" onClick={() => setRun({ key: 1 })} className="min-h-[48px] rounded-xl bg-accent-cyan px-6 text-lg font-bold text-slate-950">Rennen starten</button>
      <p className="text-xs text-slate-400">Steuerung: links ◀ ▶, rechts Gas und Bremse (am iPad mit den Fingern, am Computer Pfeiltasten oder WASD, Leertaste bremst, R repariert und setzt das Auto zurück). Driften: Bremse und Lenken gleichzeitig. Wände und andere Autos machen Schaden. Online gegen Freunde: unter Mehrspieler → Rennen.</p>
    </div>
  )
}
