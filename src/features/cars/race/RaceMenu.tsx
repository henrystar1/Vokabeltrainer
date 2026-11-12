import { useMemo, useState } from 'react'
import { buildTrack, TRACKS } from './track'
import RaceView, { type RaceCarInfo } from './RaceView'

const BOT_NAMES = ['Blitz', 'Turbo Tom', 'Rennfuchs', 'Drift-Dora', 'Pit-Paul', 'Nitro Nina', 'Kurven-Karl', 'Gummi-Gerd']
const BOT_KINDS = ['sportwagen', 'cabrio', 'limousine', 'suv', 'kleinwagen', 'kombi', 'pickup']
const BOT_COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6', '#eab308']
const LEVELS = [{ id: 'leicht', label: 'Leicht', skill: 0.7 }, { id: 'mittel', label: 'Mittel', skill: 0.85 }, { id: 'schwer', label: 'Schwer', skill: 1 }] as const

/** Kleine Streckenvorschau als SVG. */
export function TrackPreview({ id, className = '' }: { id: number; className?: string }) {
  const d = useMemo(() => {
    const t = buildTrack(TRACKS[id], 12)
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
    for (let i = 0; i < t.n; i++) { x0 = Math.min(x0, t.x[i]); x1 = Math.max(x1, t.x[i]); z0 = Math.min(z0, t.z[i]); z1 = Math.max(z1, t.z[i]) }
    const sc = Math.min(180 / (x1 - x0), 100 / (z1 - z0))
    const ox = (200 - (x1 - x0) * sc) / 2 - x0 * sc, oz = (120 - (z1 - z0) * sc) / 2 - z0 * sc
    let p = ''
    for (let i = 0; i < t.n; i++) p += `${i ? 'L' : 'M'}${(t.x[i] * sc + ox).toFixed(1)} ${(t.z[i] * sc + oz).toFixed(1)}`
    return { p: p + 'Z', sx: t.x[0] * sc + ox, sz: t.z[0] * sc + oz }
  }, [id])
  return (
    <svg viewBox="0 0 200 120" className={className} role="img" aria-label={`Strecke ${TRACKS[id].name}`}>
      <path d={d.p} fill="none" stroke="#0f172a" strokeWidth="11" strokeLinejoin="round" />
      <path d={d.p} fill="none" stroke="#cbd5e1" strokeWidth="7" strokeLinejoin="round" />
      <circle cx={d.sx} cy={d.sz} r="4.5" fill="#22d3ee" />
    </svg>
  )
}

/** Einzelspieler: Strecke wählen, Training oder gegen Bots. */
export default function RaceMenu({ car }: { car: RaceCarInfo }) {
  const [track, setTrack] = useState(0)
  const [laps, setLaps] = useState(3)
  const [mode, setMode] = useState<'train' | 'bots'>('bots')
  const [level, setLevel] = useState<(typeof LEVELS)[number]['id']>('mittel')
  const [run, setRun] = useState<{ key: number } | null>(null)
  const bots = useMemo(() => {
    if (mode === 'train') return []
    const sk = LEVELS.find((l) => l.id === level)?.skill ?? 0.85
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5)
    const kinds = [...BOT_KINDS].sort(() => Math.random() - 0.5)
    const cols = [...BOT_COLORS].sort(() => Math.random() - 0.5)
    return Array.from({ length: 3 }, (_, i) => ({ name: names[i], kind: kinds[i], color: cols[i], skill: Math.min(1, sk - 0.04 + i * 0.03) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, level, run?.key])

  if (run) return <RaceView key={run.key} trackId={track} laps={laps} me={car} bots={bots} onAgain={() => setRun({ key: run.key + 1 })} onExit={() => setRun(null)} />

  const chip = (on: boolean) => `min-h-[44px] rounded-lg border px-4 ${on ? 'border-accent-cyan bg-accent-cyan/20' : 'border-white/15 hover:bg-white/10'}`
  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-2 font-semibold">Strecke</h3>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {TRACKS.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => setTrack(t.id)} aria-pressed={track === t.id} className={`w-full rounded-xl border p-2 text-left ${track === t.id ? 'border-accent-cyan bg-white/10' : 'border-white/10 hover:bg-white/5'}`}>
                <TrackPreview id={t.id} className="w-full rounded-lg bg-slate-800/60" />
                <p className="mt-1 text-sm font-semibold">{t.name}</p>
                <p className="text-xs text-slate-400">{t.text}</p>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-300">Modus:</span>
        <button type="button" className={chip(mode === 'bots')} onClick={() => setMode('bots')}>Gegen Bots</button>
        <button type="button" className={chip(mode === 'train')} onClick={() => setMode('train')}>Training allein</button>
      </div>
      {mode === 'bots' && (
        <div className="flex flex-wrap items-center gap-2"><span className="text-sm text-slate-300">Schwierigkeit:</span>{LEVELS.map((l) => <button key={l.id} type="button" className={chip(level === l.id)} onClick={() => setLevel(l.id)}>{l.label}</button>)}</div>
      )}
      <div className="flex flex-wrap items-center gap-2"><span className="text-sm text-slate-300">Runden:</span>{[1, 3, 5].map((n) => <button key={n} type="button" className={chip(laps === n)} onClick={() => setLaps(n)}>{n}</button>)}</div>
      <button type="button" onClick={() => setRun({ key: 1 })} className="min-h-[48px] rounded-xl bg-accent-cyan px-6 text-lg font-bold text-slate-950">Rennen starten</button>
      <p className="text-xs text-slate-400">Steuerung: links ◀ ▶, rechts Gas und Bremse (am iPad mit den Fingern, am Computer Pfeiltasten oder WASD, Leertaste bremst, R setzt das Auto zurück). Online gegen Freunde: unter Mehrspieler → Rennen.</p>
    </div>
  )
}
