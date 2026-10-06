import { useState } from 'react'
import { Trophy } from 'lucide-react'
import PlayerTag from '../components/profile/PlayerTag'
import Card from '../components/ui/Card'
import PageHeader from '../components/ui/PageHeader'
import { EmptyState, ErrorBox, Spinner } from '../components/ui/States'
import { useAsync } from '../lib/useAsync'
import { getLeaderboard } from '../services/stats'
import type { LeaderboardPeriod } from '../types'
import LeagueView from './LeagueView'
import CoinBoard from './CoinBoard'

const PERIODS: Array<{ id: LeaderboardPeriod | 'league' | 'coins'; label: string }> = [
  { id: 'week', label: 'Woche' },
  { id: 'month', label: 'Monat' },
  { id: 'all', label: 'Gesamt' },
  { id: 'league', label: 'Liga' },
  { id: 'coins', label: 'Coins' },
]

const MEDAL = ['text-amber-300', 'text-slate-300', 'text-orange-400']

export default function Leaderboard() {
  const [period, setPeriod] = useState<LeaderboardPeriod | 'league' | 'coins'>('week')
  const board = useAsync(() => (period === 'league' || period === 'coins' ? Promise.resolve([]) : getLeaderboard(period)), [period])

  return (
    <div>
      <PageHeader eyebrow="Wettkampf" title="Rangliste" />
      <div role="tablist" className="glass mb-4 inline-flex flex-wrap rounded-xl p-1">
        {PERIODS.map((p) => (
          <button
            key={p.id}
            role="tab"
            aria-selected={period === p.id}
            onClick={() => setPeriod(p.id)}
            className={`min-h-[40px] rounded-lg px-5 text-sm font-medium transition ${
              period === p.id ? 'bg-accent-cyan/15 text-accent-cyan' : 'text-slate-400 hover:text-white'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {period === 'league' && <LeagueView />}
      {period === 'coins' && <CoinBoard />}
      {period !== 'league' && period !== 'coins' && (<>
      {board.loading && !board.data && <Spinner />}
      {board.error && <ErrorBox message={board.error} onRetry={board.reload} />}
      {board.data && board.data.length === 0 && <EmptyState title="Noch niemand auf der Rangliste" text="Starte eine Lernrunde, um Punkte zu sammeln." />}
      {board.data && board.data.length > 0 && (
        <Card className="p-2">
          <ol>
            {board.data.map((r) => (
              <li
                key={`${r.rank}-${r.display_name}`}
                className={`flex min-h-[52px] items-center gap-4 rounded-xl px-4 ${r.is_me ? 'bg-accent-cyan/10 ring-1 ring-accent-cyan/30' : ''}`}
              >
                <span className={`w-8 text-center font-mono text-lg ${MEDAL[r.rank - 1] ?? 'text-slate-500'}`}>
                  {r.rank <= 3 ? <Trophy size={18} className="mx-auto" /> : r.rank}
                </span>
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <PlayerTag name={r.display_name} cosmetics={r} framed size={36} />
                  {r.is_me && <span className="label-mono shrink-0 text-accent-cyan">Du</span>}
                </span>
                <span className="font-mono text-accent-cyan">{r.points}</span>
              </li>
            ))}
          </ol>
        </Card>
      )}
      <p className="mt-4 max-w-xl text-xs text-slate-500">
        Punkte: pro richtiger Antwort 2 Punkte (max. 200 Antworten pro Tag), 25 Punkte Bonus für jeden aktiven Tag und bis zu 20 Punkte für eine hohe Trefferquote.
        Die Größe deiner Bücher spielt keine Rolle.
      </p>
      </>)}
    </div>
  )
}
