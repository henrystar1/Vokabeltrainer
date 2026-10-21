import { useEffect, useRef, useState } from 'react'
import { Heart } from 'lucide-react'
import { Avatar } from '../../components/profile/PlayerTag'
import type { TeamPerson, TeamState } from '../../services/play'

const OBSTACLES = ['🧱', '🪵', '🕳️', '🪨', '🔥', '🌵', '🚧']
const COLORS = ['#22d3ee', '#e879f9']

/** Ein Läufer: bleibt vor dem Hindernis stehen, bis auch der Partner es geschafft hat, dann springen beide. */
function Runner({ person, color, pos, size, hop }: { person: TeamPerson; color: string; pos: number; size: number; hop: boolean }) {
  return (
    <div className={`tp-runner ${hop ? 'hop' : ''}`} style={{ left: `${pos}%`, '--lane': color } as React.CSSProperties}>
      <div className="tp-ring"><Avatar name={person.name} avatarId={person.avatar_id} colorId={person.color_id} size={size} /></div>
    </div>
  )
}

export function Hearts({ left, total }: { left: number; total: number }) {
  return (
    <span className="flex items-center gap-1" aria-label={`${left} von ${total} Leben`}>
      {Array.from({ length: total }, (_, i) => (
        <Heart key={i} size={20} className={i < left ? 'fill-rose-500 text-rose-400 drop-shadow-[0_0_6px_rgb(244_63_94/0.7)]' : 'text-slate-600'} />
      ))}
    </span>
  )
}

/** Parcours mit zwei Bahnen (Host oben, Partner unten) und Hindernissen, die ihr nur zusammen überwindet. */
export default function TeamTrack({ st }: { st: TeamState }) {
  const n = st.obstacles
  const won = st.status === 'won'
  const step = st.step
  const people = [...st.people].sort((a, b) => Number(b.is_host) - Number(a.is_host))
  const prev = useRef(step)
  const [hop, setHop] = useState(false)
  useEffect(() => {
    if (step > prev.current) {
      setHop(true)
      const t = window.setTimeout(() => setHop(false), 700)
      prev.current = step
      return () => window.clearTimeout(t)
    }
    prev.current = step
  }, [step])
  const posOf = (ok: boolean) => (won ? 100 : ((step + (ok ? 0.62 : 0.12)) / (n + 1)) * 100)
  return (
    <div className="tp-wrap" aria-label="Parcours">
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-mono text-slate-300">Hindernis {Math.min(step + 1, n)} / {n}</span>
        <Hearts left={st.lives_left} total={st.lives} />
      </div>
      {people.map((p, i) => {
        const ok = p.is_host ? st.host_ok : st.partner_ok
        return (
          <div key={p.user_id} className="tp-lane" style={{ '--lane': COLORS[i] } as React.CSSProperties}>
            <span className="tp-name" style={{ color: COLORS[i] }}>{p.name}{p.user_id === st.me ? ' (du)' : ''}{ok && !won ? ' ✓' : ''}</span>
            <div className="tp-ground" />
            {Array.from({ length: n }, (_, k) => (
              <span key={k} aria-hidden className={`tp-obs ${k < step || won ? 'done' : k === step ? 'now' : ''}`} style={{ left: `${((k + 1) / (n + 1)) * 100}%` }}>{OBSTACLES[k % OBSTACLES.length]}</span>
            ))}
            <span aria-hidden className="tp-flag" style={{ left: '100%' }}>🏁</span>
            <Runner person={p} color={COLORS[i]} pos={posOf(ok)} size={34} hop={hop && !won} />
          </div>
        )
      })}
    </div>
  )
}
