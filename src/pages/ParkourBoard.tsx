import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Avatar } from '../components/profile/PlayerTag'
import Card from '../components/ui/Card'
import { EmptyState, ErrorBox, Spinner } from '../components/ui/States'
import { errorMessage } from '../lib/errors'
import { useAsync } from '../lib/useAsync'
import { deathrunBoard, teamParkourBoard } from '../services/play'

const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`
const MEDAL = ['text-amber-300', 'text-slate-300', 'text-orange-400']

/** Bestenlisten für Team-Parkour (Teams) und Deathrun (einzelne Personen); gehört zur Seite „Rangliste“. */
export default function ParkourBoard() {
  const [kind, setKind] = useState<'deathrun' | 'team'>('deathrun')
  const team = useAsync(() => (kind === 'team' ? teamParkourBoard() : Promise.resolve([])), [kind])
  const run = useAsync(() => (kind === 'deathrun' ? deathrunBoard() : Promise.resolve([])), [kind])

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Parkour-Art" className="grid max-w-md grid-cols-2 gap-2">
        {([['deathrun', 'Deathrun · einzeln'], ['team', 'Team-Parkour · Teams']] as const).map(([k, label]) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
            className={`min-h-[44px] rounded-xl border text-sm font-semibold transition ${kind === k ? 'border-cyan-300/60 bg-cyan-400/15 text-cyan-200' : 'border-white/10 bg-white/5 text-slate-300'}`}>{label}</button>
        ))}
      </div>
      {(team.loading && !team.data && kind === 'team') || (run.loading && !run.data && kind === 'deathrun') ? <Spinner /> : null}
      {team.error && kind === 'team' && <ErrorBox message={errorMessage(team.error)} onRetry={team.reload} />}
      {run.error && kind === 'deathrun' && <ErrorBox message={errorMessage(run.error)} onRetry={run.reload} />}

      {kind === 'deathrun' && run.data && (run.data.length === 0 ? (
        <EmptyState title="Noch kein Deathrun" text="Startet einen Deathrun unter „Parkour“. Das beste Ergebnis jeder Person steht hier." />
      ) : (
        <Card className="p-2">
          <ol className="space-y-1">
            {run.data.map((r, i) => (
              <li key={`${r.name}-${r.finished_at}`} className="flex min-h-[48px] items-center gap-2 rounded-xl px-2">
                <span className={`w-7 text-center font-mono ${MEDAL[i] ?? 'text-slate-500'}`}>{i + 1}.</span>
                <Avatar name={r.name} avatarId={r.avatar_id} colorId={r.color_id} size={32} />
                <span className="min-w-0 flex-1 truncate text-sm">{r.name}<span className="ml-1 text-xs text-slate-500">({r.group_size} im Lauf)</span></span>
                <span className="shrink-0 text-right font-mono text-xs text-amber-200">Level {r.levels}<br /><span className="text-slate-400">{fmt(r.millis)} · {r.deaths} Stürze</span></span>
              </li>
            ))}
          </ol>
        </Card>
      ))}

      {kind === 'team' && team.data && (team.data.length === 0 ? (
        <EmptyState title="Noch kein Team-Parkour" text="Schafft den ersten Eintrag unter „Parkour“." />
      ) : (
        <Card className="p-2">
          <ol className="space-y-1">
            {team.data.map((r, i) => (
              <li key={`${r.host_name}-${r.partner_name}-${r.finished_at}`} className="flex min-h-[48px] items-center gap-2 rounded-xl px-2">
                <span className={`w-7 text-center font-mono ${MEDAL[i] ?? 'text-slate-500'}`}>{i + 1}.</span>
                <span className="flex -space-x-2"><Avatar name={r.host_name} avatarId={r.host_avatar_id} colorId={r.host_color_id} size={30} /><Avatar name={r.partner_name} avatarId={r.partner_avatar_id} colorId={r.partner_color_id} size={30} /></span>
                <span className="min-w-0 flex-1 truncate text-sm">{r.host_name} &amp; {r.partner_name}{(r.group_size ?? 2) > 2 ? ` +${(r.group_size ?? 2) - 2}` : ''}</span>
                <span className="shrink-0 text-right font-mono text-xs text-amber-200">Level {r.levels}<br /><span className="text-slate-400">{fmt(r.millis)}</span></span>
              </li>
            ))}
          </ol>
        </Card>
      ))}
      <Link to="/parkour" className="inline-block text-sm text-accent-cyan hover:underline">Zum Parkour</Link>
    </div>
  )
}
