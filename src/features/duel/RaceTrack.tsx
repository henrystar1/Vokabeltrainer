import { useEffect, useRef, useState } from 'react'
import { Crown } from 'lucide-react'
import { Avatar } from '../../components/profile/PlayerTag'
import type { LivePlayer } from '../../services/play'

export const LANE_COLORS = ['#22d3ee', '#e879f9', '#fbbf24', '#a3e635']
/** Ab so vielen Spielern zeigt die Strecke nur die Besten und dich. */
const COMPACT_FROM = 5
const TOP = 4

/** Ein Strahl pro Spieler: je mehr Fragen beantwortet, desto weiter vorn sitzt das Profilbild. */
function Lane({ p, color, total, leader, me, place, size }: { p: LivePlayer; color: string; total: number; leader: boolean; me: boolean; place?: number; size: number }) {
  const pct = total > 0 ? Math.min(100, (p.answered / total) * 100) : 0
  const prev = useRef(p.answered)
  const [hop, setHop] = useState(0)
  const [hopping, setHopping] = useState(false)
  useEffect(() => {
    if (p.answered > prev.current) {
      setHop((h) => h + 1)
      setHopping(true)
      const t = window.setTimeout(() => setHopping(false), 520)
      prev.current = p.answered
      return () => window.clearTimeout(t)
    }
    prev.current = p.answered
  }, [p.answered])
  const style = { '--lane': color } as React.CSSProperties
  return (
    <li style={style} className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="flex min-w-0 items-center gap-1.5 font-semibold" style={{ color }}>
          {place !== undefined && <span className="font-mono text-slate-400">{place}.</span>}
          {leader && p.answered > 0 && <Crown size={13} aria-label="Führt" />}
          <span className="truncate">{p.name}{me ? ' (du)' : ''}</span>
        </span>
        <span className="shrink-0 font-mono text-slate-300">{p.finished ? 'fertig · ' : ''}{p.answered}/{total}</span>
      </div>
      <div className="mx-5 pt-3">
        <div className="race-rail">
          <div className="race-beam" style={{ width: `${pct}%` }} />
          {/* Kein key am Kopf: sonst startet das Profilbild (z. B. das Schwarze Loch) bei jeder Antwort neu. */}
          <div className={`race-head ${hopping ? 'hop' : ''}`} style={{ left: `${pct}%` }}>
            {hop > 0 && <span key={`a${hop}`} className="race-spark" style={{ '--dy': '-10px' } as React.CSSProperties} />}
            {hop > 0 && <span key={`b${hop}`} className="race-spark" style={{ '--dy': '8px', animationDelay: '0.08s' } as React.CSSProperties} />}
            <div className="ring"><Avatar name={p.name} avatarId={p.avatar_id} colorId={p.color_id} size={size} /></div>
          </div>
        </div>
      </div>
    </li>
  )
}

export default function RaceTrack({ players, total, meId }: { players: LivePlayer[]; total: number; meId: string }) {
  const racers = players.filter((p) => p.state === 'joined' || p.state === 'left')
  const best = Math.max(0, ...racers.map((p) => p.answered))
  const colorOf = (uid: string) => LANE_COLORS[Math.max(0, racers.findIndex((p) => p.user_id === uid)) % LANE_COLORS.length]
  if (racers.length < COMPACT_FROM) {
    return (
      <ul className="space-y-3 rounded-2xl border border-white/10 bg-space-900/80 p-4 backdrop-blur" aria-label="Fortschritt aller Spieler">
        {racers.map((p) => <Lane key={p.user_id} p={p} color={colorOf(p.user_id)} total={total} leader={p.answered === best} me={p.user_id === meId} size={38} />)}
      </ul>
    )
  }
  // Viele Spieler: Rangliste nach Fortschritt, oben die Besten, dazu immer du
  const order = [...racers].sort((a, b) => b.answered - a.answered || b.correct - a.correct)
  const top = order.slice(0, TOP)
  const myIdx = order.findIndex((p) => p.user_id === meId)
  const shown = myIdx >= TOP && myIdx >= 0 ? [...top, order[myIdx]] : order.slice(0, TOP + 1)
  return (
    <div className="space-y-2 rounded-2xl border border-white/10 bg-space-900/80 p-4 backdrop-blur" aria-label="Fortschritt aller Spieler">
      <ul className="space-y-2">
        {shown.map((p) => <Lane key={p.user_id} p={p} color={colorOf(p.user_id)} total={total} leader={p.answered === best} me={p.user_id === meId} place={order.indexOf(p) + 1} size={30} />)}
      </ul>
      <p className="text-center text-[11px] text-slate-500">{racers.length} Spieler · {racers.filter((p) => p.finished).length} fertig</p>
    </div>
  )
}
