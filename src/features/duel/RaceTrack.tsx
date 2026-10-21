import { useEffect, useRef, useState } from 'react'
import { Crown } from 'lucide-react'
import { Avatar } from '../../components/profile/PlayerTag'
import type { LivePlayer } from '../../services/play'

export const LANE_COLORS = ['#22d3ee', '#e879f9', '#fbbf24', '#a3e635']

/** Ein Strahl pro Spieler: je mehr Fragen beantwortet, desto weiter vorn sitzt das Profilbild. */
function Lane({ p, color, total, leader, me }: { p: LivePlayer; color: string; total: number; leader: boolean; me: boolean }) {
  const pct = total > 0 ? Math.min(100, (p.answered / total) * 100) : 0
  const prev = useRef(p.answered)
  const [hop, setHop] = useState(0)
  useEffect(() => {
    if (p.answered > prev.current) setHop((h) => h + 1)
    prev.current = p.answered
  }, [p.answered])
  const style = { '--lane': color } as React.CSSProperties
  return (
    <li style={style} className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="flex min-w-0 items-center gap-1.5 font-semibold" style={{ color }}>
          {leader && p.answered > 0 && <Crown size={13} aria-label="Führt" />}
          <span className="truncate">{p.name}{me ? ' (du)' : ''}</span>
        </span>
        <span className="shrink-0 font-mono text-slate-300">{p.finished ? 'fertig · ' : ''}{p.answered}/{total}</span>
      </div>
      <div className="mx-5 pt-3">
        <div className="race-rail">
          <div className="race-beam" style={{ width: `${pct}%` }} />
          <div key={hop} className={`race-head ${hop > 0 ? 'hop' : ''}`} style={{ left: `${pct}%` }}>
            {hop > 0 && <span className="race-spark" style={{ '--dy': '-10px' } as React.CSSProperties} />}
            {hop > 0 && <span className="race-spark" style={{ '--dy': '8px', animationDelay: '0.08s' } as React.CSSProperties} />}
            <div className="ring"><Avatar name={p.name} avatarId={p.avatar_id} colorId={p.color_id} size={38} /></div>
          </div>
        </div>
      </div>
    </li>
  )
}

export default function RaceTrack({ players, total, meId }: { players: LivePlayer[]; total: number; meId: string }) {
  const racers = players.filter((p) => p.state === 'joined' || p.state === 'left')
  const best = Math.max(0, ...racers.map((p) => p.answered))
  return (
    <ul className="space-y-3 rounded-2xl border border-white/10 bg-space-900/80 p-4 backdrop-blur" aria-label="Fortschritt aller Spieler">
      {racers.map((p, i) => (
        <Lane key={p.user_id} p={p} color={LANE_COLORS[i % LANE_COLORS.length]} total={total} leader={p.answered === best} me={p.user_id === meId} />
      ))}
    </ul>
  )
}
